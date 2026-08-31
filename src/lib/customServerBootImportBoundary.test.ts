import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";

const repoRoot = process.cwd();
const require = createRequire(import.meta.url);

const SERVER_ONLY_FAILURE =
  "This module cannot be imported from a Client Component module.";

function importWakeupSchedulerWithoutBootBoundary(): string {
  const script = `
    import("./src/lib/derivedCache/wakeupScheduler.ts")
      .then(() => process.exit(0))
      .catch((err) => {
        console.log(err instanceof Error ? err.message : String(err));
        process.exit(1);
      });
  `;
  try {
    execFileSync(
      process.execPath,
      ["--import", "tsx", "-e", script],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          DISABLE_DERIVED_CACHE_WORKER: "1",
          REGULAR_TEST_REAL_PROVIDER_CALLS: "0",
        },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    return "";
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    return `${err.stdout ?? ""}${err.stderr ?? ""}${err.message ?? ""}`;
  }
}

describe("custom server boot import boundary", () => {
  it("FAIL_BEFORE: plain tsx import of wakeupScheduler fails on server-only without boot boundary", () => {
    const output = importWakeupSchedulerWithoutBootBoundary();
    assert.match(output, new RegExp(SERVER_ONLY_FAILURE));
  });

  it("PASS_AFTER: boot boundary allows plain tsx import of wakeupScheduler", async () => {
    require("../lib/customServerBootImportBoundary.js");
    const mod = await import("./derivedCache/wakeupScheduler.ts");
    assert.equal(typeof mod.startDerivedCacheWakeup, "function");
    assert.equal(typeof mod.isDerivedCacheWorkerDisabled, "function");
  });

  it("PASS_AFTER: startDerivedCacheWakeup logs started when worker enabled", () => {
    delete process.env.DISABLE_DERIVED_CACHE_WORKER;
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      require("../lib/customServerBootImportBoundary.js");
      const { startDerivedCacheWakeup } = require("./derivedCache/wakeupScheduler.ts") as {
        startDerivedCacheWakeup: () => void;
      };
      startDerivedCacheWakeup();
      assert.ok(logs.some((line) => line.includes("[derivedCache] wakeup scheduler started")));
    } finally {
      console.log = originalLog;
      process.env.DISABLE_DERIVED_CACHE_WORKER = "1";
    }
  });

  it("PASS_AFTER: DISABLE_DERIVED_CACHE_WORKER=1 keeps worker/provider activity off", () => {
    process.env.DISABLE_DERIVED_CACHE_WORKER = "1";
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      require("../lib/customServerBootImportBoundary.js");
      const { startDerivedCacheWakeup } = require("./derivedCache/wakeupScheduler.ts") as {
        startDerivedCacheWakeup: () => void;
      };
      startDerivedCacheWakeup();
      assert.ok(
        logs.some((line) =>
          line.includes("[server] derived cache worker disabled (DISABLE_DERIVED_CACHE_WORKER=1)")
        )
      );
      assert.equal(
        logs.some((line) => line.includes("[derivedCache] wakeup scheduler started")),
        false
      );
    } finally {
      console.log = originalLog;
    }
  });

  it("common boot imports succeed after boundary install", async () => {
    require("../lib/customServerBootImportBoundary.js");
    await import("./episodicMemoryFacts.ts");
    await import("../cron/financeScheduler.ts");
    await import("./webPush.ts");
    await import("../cron/payoutScheduler.ts");
  });
});

describe("server.js boot contract", () => {
  it("requires boot import boundary before background initialization dynamic imports", () => {
    const serverJs = readFileSync(path.join(repoRoot, "server.js"), "utf8");
    const boundaryIndex = serverJs.indexOf("customServerBootImportBoundary");
    const backgroundIndex = serverJs.indexOf("runBackgroundInitialization");
    const derivedCacheImportIndex = serverJs.indexOf(
      'await import("./src/lib/derivedCache/wakeupScheduler.ts")'
    );

    assert.ok(boundaryIndex >= 0, "server.js must require customServerBootImportBoundary");
    assert.ok(backgroundIndex >= 0, "server.js must define runBackgroundInitialization");
    assert.ok(derivedCacheImportIndex >= 0, "server.js must import derived-cache wakeup");
    assert.ok(
      boundaryIndex < backgroundIndex,
      "boot boundary must be installed before runBackgroundInitialization"
    );
    assert.ok(
      boundaryIndex < derivedCacheImportIndex,
      "boot boundary must be installed before derived-cache wakeup import"
    );
    assert.match(serverJs, /installCustomServerBootImportBoundary\(\)/);
  });

  it("does not add global --conditions=react-server to production start", () => {
    const pkg = readFileSync(path.join(repoRoot, "package.json"), "utf8");
    assert.match(pkg, /"start": "tsx server\.js"/);
    assert.doesNotMatch(pkg, /--conditions=react-server/);
  });
});

describe("admin warmup 502 audit (static)", () => {
  it("application route returns JSON 502 only for completed failed warmup results", () => {
    const route = readFileSync(
      path.join(repoRoot, "src/app/api/admin/trpg-blueprint-warmup/route.ts"),
      "utf8"
    );
    const helper = readFileSync(
      path.join(repoRoot, "src/lib/trpg/blueprintWarmupForAdmin.ts"),
      "utf8"
    );
    assert.match(route, /const status = result\.ok \? 200 : 502/);
    assert.match(helper, /await refreshWorldBlueprintArtifact\(/);
    assert.match(helper, /loadValidWorldBlueprintPlan\(db, worldId, currentSnapshot\)/);
    assert.doesNotMatch(route, /setTimeout|AbortSignal/);
  });
});

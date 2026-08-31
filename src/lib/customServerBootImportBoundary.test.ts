import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import Module from "node:module";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";

const repoRoot = process.cwd();
const require = createRequire(import.meta.url);

const SERVER_ONLY_FAILURE =
  "This module cannot be imported from a Client Component module.";

const boundary = require("../lib/customServerBootImportBoundary.js") as {
  withCustomServerBootImportBoundary: <T>(fn: () => T | Promise<T>) => Promise<T>;
  isCustomServerBootImportBoundaryActive: () => boolean;
  getCustomServerBootImportBoundaryDepth: () => number;
};

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
    execFileSync(process.execPath, ["--import", "tsx", "-e", script], {
      cwd: repoRoot,
      env: {
        ...process.env,
        DISABLE_DERIVED_CACHE_WORKER: "1",
        REGULAR_TEST_REAL_PROVIDER_CALLS: "0",
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return "";
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    return `${err.stdout ?? ""}${err.stderr ?? ""}${err.message ?? ""}`;
  }
}

function plainServerOnlyThrows(): boolean {
  try {
    require("server-only");
    return false;
  } catch (error) {
    return error instanceof Error && error.message.includes(SERVER_ONLY_FAILURE);
  }
}

describe("custom server boot import boundary", () => {
  it("R1 FAIL_BEFORE: plain tsx import of wakeupScheduler fails on server-only without boundary", () => {
    const output = importWakeupSchedulerWithoutBootBoundary();
    assert.match(output, new RegExp(SERVER_ONLY_FAILURE));
  });

  it("R2 PASS_INSIDE_BOUNDARY: scoped import of wakeupScheduler succeeds", async () => {
    const mod = await boundary.withCustomServerBootImportBoundary(() =>
      import("./derivedCache/wakeupScheduler.ts")
    );
    assert.equal(typeof mod.startDerivedCacheWakeup, "function");
    assert.equal(typeof mod.isDerivedCacheWorkerDisabled, "function");
    assert.equal(boundary.isCustomServerBootImportBoundaryActive(), false);
  });

  it("R3 MODULE_LOAD_RESTORED_AFTER: Module._load is exact original after scoped import", async () => {
    const originalLoad = Module._load;
    await boundary.withCustomServerBootImportBoundary(async () => {
      assert.equal(boundary.isCustomServerBootImportBoundaryActive(), true);
      await import("./derivedCache/wakeupScheduler.ts");
    });
    assert.strictEqual(Module._load, originalLoad);
    assert.equal(boundary.getCustomServerBootImportBoundaryDepth(), 0);
  });

  it("R4 SERVER_ONLY_THROWS_AFTER_RESTORE: plain server-only throws again after boundary", async () => {
    await boundary.withCustomServerBootImportBoundary(async () => {
      await import("./derivedCache/wakeupScheduler.ts");
    });
    assert.equal(boundary.isCustomServerBootImportBoundaryActive(), false);
    assert.equal(plainServerOnlyThrows(), true);
  });

  it("nested scoped imports keep boundary active until outer scope completes", async () => {
    const originalLoad = Module._load;
    await boundary.withCustomServerBootImportBoundary(async () => {
      assert.equal(boundary.getCustomServerBootImportBoundaryDepth(), 1);
      await boundary.withCustomServerBootImportBoundary(async () => {
        assert.equal(boundary.getCustomServerBootImportBoundaryDepth(), 2);
        await import("./derivedCache/wakeupScheduler.ts");
      });
      assert.equal(boundary.getCustomServerBootImportBoundaryDepth(), 1);
      assert.notStrictEqual(Module._load, originalLoad);
    });
    assert.strictEqual(Module._load, originalLoad);
    assert.equal(boundary.getCustomServerBootImportBoundaryDepth(), 0);
  });

  it("startDerivedCacheWakeup logs started when worker enabled inside scoped boundary", async () => {
    delete process.env.DISABLE_DERIVED_CACHE_WORKER;
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      await boundary.withCustomServerBootImportBoundary(async () => {
        const { startDerivedCacheWakeup } = await import("./derivedCache/wakeupScheduler.ts");
        startDerivedCacheWakeup();
      });
      assert.ok(logs.some((line) => line.includes("[derivedCache] wakeup scheduler started")));
    } finally {
      console.log = originalLog;
      process.env.DISABLE_DERIVED_CACHE_WORKER = "1";
    }
  });

  it("DISABLE_DERIVED_CACHE_WORKER=1 keeps worker/provider activity off inside scoped boundary", async () => {
    process.env.DISABLE_DERIVED_CACHE_WORKER = "1";
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      await boundary.withCustomServerBootImportBoundary(async () => {
        const { startDerivedCacheWakeup } = await import("./derivedCache/wakeupScheduler.ts");
        startDerivedCacheWakeup();
      });
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

  it("same-root boot imports wrapped by scoped boundary can load", async () => {
    await boundary.withCustomServerBootImportBoundary(async () => {
      await import("./episodicMemoryFacts.ts");
      await import("../cron/financeScheduler.ts");
      await import("./webPush.ts");
      await import("../cron/payoutScheduler.ts");
      await import("../cron/trainingScheduler.ts");
      await import("./derivedCache/wakeupScheduler.ts");
    });
    assert.equal(boundary.isCustomServerBootImportBoundaryActive(), false);
  });

  it("exchangeRate remains plain-import safe without scoped boundary", async () => {
    const originalLoad = Module._load;
    await import("./exchangeRate.ts");
    assert.strictEqual(Module._load, originalLoad);
    assert.equal(boundary.isCustomServerBootImportBoundaryActive(), false);
  });
});

describe("server.js boot contract", () => {
  it("does not install boundary before require(next) or app.prepare", () => {
    const serverJs = readFileSync(path.join(repoRoot, "server.js"), "utf8");
    const nextRequireIndex = serverJs.indexOf('require("next")');
    const prepareIndex = serverJs.indexOf("app.prepare()");
    const scopedHelperIndex = serverJs.indexOf("withCustomServerBootImportBoundary");
    const backgroundInvokeIndex = serverJs.indexOf("void runBackgroundInitialization()");

    assert.ok(nextRequireIndex >= 0);
    assert.ok(prepareIndex >= 0);
    assert.ok(scopedHelperIndex >= 0);
    assert.doesNotMatch(serverJs, /installCustomServerBootImportBoundary/);
    assert.doesNotMatch(serverJs, /Module\._load\s*=/);
    assert.ok(
      scopedHelperIndex > nextRequireIndex,
      "scoped boundary helper must not precede require(next)"
    );
    assert.ok(
      backgroundInvokeIndex > prepareIndex,
      "background initialization must run after app.prepare wiring"
    );
    assert.match(serverJs, /importBackgroundModule/);
    assert.match(
      serverJs,
      /await importBackgroundModule\(\s*\n?\s*"\.\/src\/lib\/derivedCache\/wakeupScheduler\.ts"/
    );
    assert.match(serverJs, /await import\("\.\/src\/lib\/exchangeRate\.ts"\)/);
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

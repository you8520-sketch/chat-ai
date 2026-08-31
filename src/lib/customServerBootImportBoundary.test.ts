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
  resolveCustomServerImportedExport: (moduleNamespace: unknown, exportName: string) => unknown;
  requireCustomServerBootFunction: (
    moduleNamespace: unknown,
    exportName: string,
    moduleId: string
  ) => (...args: unknown[]) => unknown;
  isCustomServerBootImportBoundaryActive: () => boolean;
  getCustomServerBootImportBoundaryDepth: () => number;
};

type BootModuleProbe = {
  specifier: string;
  exportName: string;
  directType: string;
  defaultType: string;
  resolvedType: string;
  directDestructuringWorks: boolean;
};

function runCustomServerCjsProbe(
  scriptBody: string,
  env: Record<string, string | undefined> = {}
): string {
  const script = `
    import { createRequire } from "node:module";
    const cjsRequire = createRequire(process.cwd() + "/");
    ${scriptBody}
  `;
  return execFileSync(process.execPath, ["--import", "tsx", "-e", script], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DISABLE_DERIVED_CACHE_WORKER: "1",
      REGULAR_TEST_REAL_PROVIDER_CALLS: "0",
      ...env,
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function probeBootModule(specifier: string, exportName: string): BootModuleProbe {
  const output = runCustomServerCjsProbe(`
    const boundary = cjsRequire("./src/lib/customServerBootImportBoundary.js");
    await boundary.withCustomServerBootImportBoundary(async () => {
      const mod = await import(${JSON.stringify(specifier)});
      const direct = mod[${JSON.stringify(exportName)}];
      const fromDefault = mod.default?.[${JSON.stringify(exportName)}];
      const resolved = boundary.resolveCustomServerImportedExport(mod, ${JSON.stringify(exportName)});
      console.log(JSON.stringify({
        directType: typeof direct,
        defaultType: typeof fromDefault,
        resolvedType: typeof resolved,
        directDestructuringWorks: typeof direct === "function",
      }));
    });
  `);
  const parsed = JSON.parse(output) as {
    directType?: string;
    defaultType?: string;
    resolvedType?: string;
    directDestructuringWorks?: boolean;
    error?: string;
  };
  if (parsed.error) {
    throw new Error(`probe failed for ${specifier}: ${parsed.error}`);
  }
  return {
    specifier,
    exportName,
    directType: parsed.directType ?? "undefined",
    defaultType: parsed.defaultType ?? "undefined",
    resolvedType: parsed.resolvedType ?? "undefined",
    directDestructuringWorks: parsed.directDestructuringWorks === true,
  };
}

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

const BOOT_MODULES = [
  {
    specifier: "./src/lib/episodicMemoryFacts.ts",
    exportName: "warnEpisodicMemoryRecallDisabledInProduction",
  },
  { specifier: "./src/cron/payoutScheduler.ts", exportName: "startPayoutScheduler" },
  { specifier: "./src/cron/trainingScheduler.ts", exportName: "startTrainingScheduler" },
  { specifier: "./src/cron/financeScheduler.ts", exportName: "startFinanceScheduler" },
  { specifier: "./src/lib/webPush.ts", exportName: "startWebPushSchedulers" },
  {
    specifier: "./src/lib/derivedCache/wakeupScheduler.ts",
    exportName: "startDerivedCacheWakeup",
  },
] as const;

describe("custom server boot import boundary", () => {
  it("P1 FAIL_BEFORE: plain tsx import of wakeupScheduler fails on server-only without boundary", () => {
    const output = importWakeupSchedulerWithoutBootBoundary();
    assert.match(output, new RegExp(SERVER_ONLY_FAILURE));
  });

  it("P2 PASS_INSIDE_BOUNDARY: scoped CJS-style import loads affected module", () => {
    const output = runCustomServerCjsProbe(`
      const boundary = cjsRequire("./src/lib/customServerBootImportBoundary.js");
      await boundary.withCustomServerBootImportBoundary(async () => {
        await import("./src/lib/derivedCache/wakeupScheduler.ts");
        console.log("loaded");
      });
    `);
    assert.equal(output, "loaded");
  });

  it("P3/P4 production-equivalent namespace shape: direct named absent, default-wrapped present", () => {
    for (const entry of BOOT_MODULES) {
      const probe = probeBootModule(entry.specifier, entry.exportName);
      assert.equal(
        probe.directDestructuringWorks,
        false,
        `${entry.specifier}: direct destructuring must fail in CJS custom-server mode`
      );
      assert.equal(probe.directType, "undefined", `${entry.specifier}: direct export absent`);
      assert.equal(probe.defaultType, "function", `${entry.specifier}: default export present`);
    }
  });

  it("P5–P10 canonical resolver finds all same-class boot functions", () => {
    for (const entry of BOOT_MODULES) {
      const probe = probeBootModule(entry.specifier, entry.exportName);
      assert.equal(probe.resolvedType, "function", `${entry.exportName} from ${entry.specifier}`);
    }
  });

  it("FAIL_BEFORE: direct destructuring from CJS custom-server import is not a function", () => {
    const output = runCustomServerCjsProbe(`
      const boundary = cjsRequire("./src/lib/customServerBootImportBoundary.js");
      await boundary.withCustomServerBootImportBoundary(async () => {
        const { startDerivedCacheWakeup } = await import("./src/lib/derivedCache/wakeupScheduler.ts");
        console.log(typeof startDerivedCacheWakeup);
      });
    `);
    assert.equal(output, "undefined");
  });

  it("P11 MODULE_LOAD_RESTORED_AFTER: Module._load is exact original after scoped import", async () => {
    const originalLoad = Module._load;
    await boundary.withCustomServerBootImportBoundary(async () => {
      assert.equal(boundary.isCustomServerBootImportBoundaryActive(), true);
      await import("./derivedCache/wakeupScheduler.ts");
    });
    assert.strictEqual(Module._load, originalLoad);
    assert.equal(boundary.getCustomServerBootImportBoundaryDepth(), 0);
  });

  it("P12 SERVER_ONLY_THROWS_AFTER_RESTORE: plain server-only throws again after boundary", async () => {
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

  it("requireCustomServerBootFunction throws clear TypeError when export missing", () => {
    assert.throws(
      () => boundary.requireCustomServerBootFunction({}, "missingExport", "./missing.ts"),
      (error: unknown) =>
        error instanceof TypeError &&
        error.message.includes('[boot] ./missing.ts: export "missingExport" is not a function')
    );
  });

  it("startDerivedCacheWakeup resolves and logs started when worker enabled", () => {
    const output = runCustomServerCjsProbe(
      `
      const boundary = cjsRequire("./src/lib/customServerBootImportBoundary.js");
      await boundary.withCustomServerBootImportBoundary(async () => {
        const mod = await import("./src/lib/derivedCache/wakeupScheduler.ts");
        boundary.requireCustomServerBootFunction(
          mod,
          "startDerivedCacheWakeup",
          "./src/lib/derivedCache/wakeupScheduler.ts"
        )();
        console.log("started");
      });
    `,
      { DISABLE_DERIVED_CACHE_WORKER: "0" }
    );
    assert.match(output, /\bstarted\b/);
  });

  it("DISABLE_DERIVED_CACHE_WORKER=1 keeps worker/provider activity off after resolved export", () => {
    const output = runCustomServerCjsProbe(`
      const boundary = cjsRequire("./src/lib/customServerBootImportBoundary.js");
      const logs = [];
      const originalLog = console.log;
      console.log = (...args) => logs.push(args.join(" "));
      await boundary.withCustomServerBootImportBoundary(async () => {
        const mod = await import("./src/lib/derivedCache/wakeupScheduler.ts");
        boundary.requireCustomServerBootFunction(
          mod,
          "startDerivedCacheWakeup",
          "./src/lib/derivedCache/wakeupScheduler.ts"
        )();
        console.log = originalLog;
        console.log(JSON.stringify({
          disabled: logs.some((line) => line.includes("derived cache worker disabled")),
          started: logs.some((line) => line.includes("wakeup scheduler started")),
        }));
      });
    `);
    const parsed = JSON.parse(output) as { disabled: boolean; started: boolean };
    assert.equal(parsed.disabled, true);
    assert.equal(parsed.started, false);
  });

  it("resolveCustomServerImportedExport prefers direct named export when present", () => {
    const directFn = () => "direct";
    const wrappedFn = () => "wrapped";
    assert.equal(
      boundary.resolveCustomServerImportedExport(
        { directFn, default: { directFn: wrappedFn } },
        "directFn"
      ),
      directFn
    );
  });

  it("exchangeRate plain import resolves warmExchangeRateCache via canonical resolver", async () => {
    const originalLoad = Module._load;
    const mod = await import("./exchangeRate.ts");
    assert.strictEqual(Module._load, originalLoad);
    assert.equal(
      typeof boundary.resolveCustomServerImportedExport(mod, "warmExchangeRateCache"),
      "function"
    );
  });
});

describe("server.js boot contract", () => {
  it("uses canonical export resolver for background boot functions", () => {
    const serverJs = readFileSync(path.join(repoRoot, "server.js"), "utf8");
    assert.match(serverJs, /requireCustomServerBootFunction/);
    assert.match(serverJs, /resolveCustomServerImportedExport/);
    assert.doesNotMatch(serverJs, /webPushMod\.startWebPushSchedulers\s*\?\?/);
    assert.doesNotMatch(serverJs, /const \{ startDerivedCacheWakeup \} = await importBackgroundModule/);
    assert.doesNotMatch(serverJs, /installCustomServerBootImportBoundary/);
    assert.doesNotMatch(serverJs, /Module\._load\s*=/);
  });

  it("does not install boundary before require(next) or app.prepare", () => {
    const serverJs = readFileSync(path.join(repoRoot, "server.js"), "utf8");
    const nextRequireIndex = serverJs.indexOf('require("next")');
    const prepareIndex = serverJs.indexOf("app.prepare()");
    const scopedHelperIndex = serverJs.indexOf("withCustomServerBootImportBoundary");
    const backgroundInvokeIndex = serverJs.indexOf("void runBackgroundInitialization()");

    assert.ok(nextRequireIndex >= 0);
    assert.ok(prepareIndex >= 0);
    assert.ok(scopedHelperIndex >= 0);
    assert.ok(
      scopedHelperIndex > nextRequireIndex,
      "scoped boundary helper must not precede require(next)"
    );
    assert.ok(
      backgroundInvokeIndex > prepareIndex,
      "background initialization must run after app.prepare wiring"
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

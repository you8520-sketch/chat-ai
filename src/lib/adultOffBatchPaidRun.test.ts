import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
  assertIsolatedTestDatabaseActive,
} from "@/lib/test/isolatedTestDatabase";
import {
  ADULT_OFF_GUARD_POLICY_VERSION,
  AdultOffClassifierCallError,
  adultOffApprovedTextHash,
  adultOffStoredTextDisposition,
  ADULT_OFF_CLASSIFIER_JSON_SCHEMA,
  ADULT_OFF_CLASSIFIER_SYSTEM_PROMPT,
  buildAdultOffClassifierUserMessage,
  type AdultOffClassify,
  type AdultOffClassifierResult,
} from "@/lib/adultOffOutputGuard";
import {
  ADULT_OFF_CLASSIFIER_MAX_TOKENS,
  type AdultOffClassifierTurnScope,
} from "@/lib/adultOffOutputClassifier";
import {
  AdultOffBatchConfigError,
  AdultOffBatchRunRefusedError,
  acquireAdultOffBatchExecutionLock,
  adultOffBatchWindowReserveKrw,
  buildAdultOffBatchPlanReport,
  defaultAdultOffBatchStateDir,
  executeAdultOffBatchPaidRun,
  isLiveProductionDatabase,
  loadAdultOffBatchState,
  parseAdultOffBatchPaidRunConfig,
  type AdultOffBatchExecuteReport,
  type AdultOffBatchPaidRunConfig,
} from "@/lib/adultOffBatchPaidRun";
import {
  copySqliteDatabaseForRehearsal,
  loadAssistantRowsForAdultOffInspection,
  surveyAdultOffAuxSurfaces,
} from "@/lib/adultOffBatchInspectionPrep";
import { ensureProviderCostLedgerSchema } from "@/lib/providerCostLedger";

const REPO_ROOT = path.resolve(__dirname, "../..");
const RESTRICTED_MARK = "ZZ_SYNTHETIC_BATCH_RESTRICTED";
const USD_PER_CALL = 0.0003;
const KRW_PER_CALL = USD_PER_CALL * 1450 * 1.02;
const PRICING = { fxKrwPerUsd: 1450, reservePerWindowKrw: 0.45 } as const;
const reserveFor = (text: string): number => adultOffBatchWindowReserveKrw(text, PRICING);

type MockOptions = {
  usdPerCall?: number | null;
  ledgerSource?: string;
  ledgerStatus?: string;
  failWith?: "http_error" | "invalid_output" | null;
  failAfterLedger?: boolean;
  onCall?: (call: { index: number; text: string; scope: AdultOffClassifierTurnScope }) => void | Promise<void>;
  verdict?: (text: string) => "allow" | "restrict" | "low";
};

function sha256File(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

describe("adult-off batch paid runner", { concurrency: 1 }, () => {
  let templatePath: string;
  let workRoot: string;
  const openHandles: DatabaseType[] = [];
  let scenarioSerial = 0;

  before(async () => {
    installIsolatedTestDatabase();
    const dbMod = await import("@/lib/db");
    const db = dbMod.getDb();
    assertIsolatedTestDatabaseActive();
    ensureProviderCostLedgerSchema(db);
    templatePath = path.join(os.tmpdir(), `c3d-template-${randomUUID()}.db`);
    copySqliteDatabaseForRehearsal(path.join(process.env.DATA_DIR!, "app.db"), templatePath);
    workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "c3d-work-"));
  });

  after(() => {
    for (const handle of openHandles) {
      if (handle.open) handle.close();
    }
    uninstallIsolatedTestDatabase();
    fs.rmSync(workRoot, { recursive: true, force: true });
    fs.rmSync(templatePath, { force: true });
  });

  type Scenario = {
    dir: string;
    dbPath: string;
    stateDir: string;
    fx: DatabaseType;
    env: (overrides?: Record<string, string | undefined>) => Record<string, string | undefined>;
    config: (overrides?: Record<string, string | undefined>) => AdultOffBatchPaidRunConfig;
  };

  function scenario(runId = "run-alpha", cap = "1500"): Scenario {
    scenarioSerial += 1;
    const dir = path.join(workRoot, `s${scenarioSerial}`);
    fs.mkdirSync(dir, { recursive: true });
    const dbPath = path.join(dir, "app.db");
    copySqliteDatabaseForRehearsal(templatePath, dbPath);
    const stateDir = path.join(dir, "state");
    const fx = new Database(dbPath);
    fx.pragma("busy_timeout = 5000");
    openHandles.push(fx);
    const env = (overrides: Record<string, string | undefined> = {}) => {
      const base: Record<string, string | undefined> = {
        ADULT_OFF_BATCH_MODE: "execute",
        ADULT_OFF_BATCH_RUN_ID: runId,
        ADULT_OFF_BATCH_CAP_KRW: cap,
        ADULT_OFF_BATCH_APPROVE_PAID: "1",
        ADULT_OFF_BATCH_ALLOW_ISOLATED_PAID: "1",
        CHEAPER_INFERENCE_API_KEY: "dummy-not-a-real-key",
        ...overrides,
      };
      for (const key of Object.keys(base)) {
        if (base[key] === undefined) delete base[key];
      }
      return base;
    };
    return {
      dir,
      dbPath,
      stateDir,
      fx,
      env,
      config: (overrides) => parseAdultOffBatchPaidRunConfig(env(overrides), dbPath, { stateDir }),
    };
  }

  function insertAssistant(
    fx: DatabaseType,
    input: {
      content: string;
      usage?: unknown;
      alternates?: unknown;
      activeVariant?: number;
      chatId?: number;
      statusMeta?: unknown;
      replies?: unknown;
      widgetJson?: string;
      requestId?: string;
    }
  ): number {
    const result = fx
      .prepare(
        `INSERT INTO messages (chat_id, role, content, model, usage, alternates, active_variant,
           generation_status, request_id, status_meta, suggested_replies_json, status_widget_values_json)
         VALUES (?, 'assistant', ?, 'gemini', ?, ?, ?, 'completed', ?, ?, ?, ?)`
      )
      .run(
        input.chatId ?? 1,
        input.content,
        JSON.stringify(input.usage ?? { cost: 1 }),
        input.alternates === undefined ? "[]" : JSON.stringify(input.alternates),
        input.activeVariant ?? 0,
        input.requestId ?? "req-run",
        input.statusMeta === undefined ? null : JSON.stringify(input.statusMeta),
        input.replies === undefined ? null : JSON.stringify(input.replies),
        input.widgetJson ?? ""
      );
    return Number(result.lastInsertRowid);
  }

  function insertLedger(
    fx: DatabaseType,
    requestId: string,
    options: { usd: number | null; source?: string; status?: string; messageId?: number | null }
  ): void {
    fx.prepare(
      `INSERT INTO api_cost_ledger (
         event_key, chat_id, assistant_message_id, generation_sequence, family, funding_class,
         execution_phase, attempt_ordinal, requested_provider, requested_model, provider, model,
         request_kind, generation_request_id, event_status, exchange_rate_krw_per_usd, cost_krw,
         estimated, actual_cost_usd, actual_cost_source, created_at
       ) VALUES (?, 1, ?, 0, 'background', 'platform_funded', 'sync_post_turn', 1, 'cheaperinference',
         'gpt-6-luna', 'cheaperinference', 'gpt-6-luna', 'adult-off-output-moderation', ?, ?, 1450,
         0, 0, ?, ?, datetime('now'))`
    ).run(
      randomUUID(),
      options.messageId ?? null,
      requestId,
      options.status ?? "settled",
      options.usd,
      options.source ?? "cheaper_inference_billed"
    );
  }

  function mockClassifier(sc: Scenario, options: MockOptions = {}) {
    const calls: Array<{ requestId: string | null; text: string; messageId: number }> = [];
    const createClassifier = (scope: AdultOffClassifierTurnScope): AdultOffClassify =>
      async (windowText): Promise<AdultOffClassifierResult> => {
        const index = calls.length;
        calls.push({
          requestId: scope.generationRequestId,
          text: windowText,
          messageId: scope.assistantMessageId,
        });
        await options.onCall?.({ index, text: windowText, scope });
        const usd = options.usdPerCall === undefined ? USD_PER_CALL : options.usdPerCall;
        if (usd !== null && scope.generationRequestId) {
          insertLedger(sc.fx, scope.generationRequestId, {
            usd,
            source: options.ledgerSource,
            status: options.ledgerStatus,
            messageId: scope.assistantMessageId,
          });
        }
        const usage = {
          model: "mock",
          inputTokens: 1,
          outputTokens: 1,
          costUsd: usd,
          providerRequestId: null,
          latencyMs: 1,
          outcome: "ok" as const,
          httpStatus: null,
        };
        if (options.failWith) {
          throw new AdultOffClassifierCallError("mock failure", options.failWith, {
            ...usage,
            outcome: options.failWith,
          });
        }
        const verdictKind =
          options.verdict?.(windowText) ??
          (windowText.includes(RESTRICTED_MARK) ? "restrict" : "allow");
        return {
          verdict:
            verdictKind === "restrict"
              ? { decision: "restrict", category: "sexual_act", confidence: "high", firstParagraph: 0 }
              : {
                  decision: "allow",
                  category: "none",
                  confidence: verdictKind === "low" ? "low" : "high",
                  firstParagraph: -1,
                },
          usage,
        };
      };
    return { calls, createClassifier };
  }

  async function run(
    sc: Scenario,
    classifier: ReturnType<typeof mockClassifier>,
    overrides?: Record<string, string | undefined>
  ): Promise<AdultOffBatchExecuteReport> {
    return executeAdultOffBatchPaidRun({
      config: sc.config(overrides),
      openDatabase: () => new Database(sc.dbPath, { fileMustExist: true }),
      createClassifier: classifier.createClassifier,
    });
  }

  function usageOf(fx: DatabaseType, id: number): Record<string, unknown> {
    const row = fx.prepare("SELECT usage FROM messages WHERE id=?").get(id) as { usage: string };
    return JSON.parse(row.usage) as Record<string, unknown>;
  }

  describe("config validation (no database, no state, no paid call)", () => {
    const dbFile = () => {
      const sc = scenario();
      return sc;
    };

    it("defaults to plan and rejects every mode other than plan or execute", () => {
      const sc = dbFile();
      assert.equal(parseAdultOffBatchPaidRunConfig({}, sc.dbPath).mode, "plan");
      assert.equal(parseAdultOffBatchPaidRunConfig({ ADULT_OFF_BATCH_MODE: "plan" }, sc.dbPath).mode, "plan");
      for (const mode of ["Execute", "EXECUTE", "paid", "run", "", " ", "execute ; plan", "true", "1"]) {
        if (mode.trim() === "plan" || mode.trim() === "execute") continue;
        assert.throws(
          () => parseAdultOffBatchPaidRunConfig({ ADULT_OFF_BATCH_MODE: mode }, sc.dbPath),
          (error: unknown) => error instanceof AdultOffBatchConfigError && error.code === "invalid_mode",
          `mode ${JSON.stringify(mode)}`
        );
      }
    });

    it("requires explicit run id, cap, approval, state dir and key for execute", () => {
      const sc = dbFile();
      const cases: Array<[string, Record<string, string | undefined>, string]> = [
        ["missing run id", { ADULT_OFF_BATCH_RUN_ID: undefined }, "missing_run_id"],
        ["bad run id", { ADULT_OFF_BATCH_RUN_ID: "a/b" }, "invalid_run_id"],
        ["short run id", { ADULT_OFF_BATCH_RUN_ID: "ab" }, "invalid_run_id"],
        ["missing cap", { ADULT_OFF_BATCH_CAP_KRW: undefined }, "missing_adult_off_batch_cap_krw"],
        ["missing approval", { ADULT_OFF_BATCH_APPROVE_PAID: undefined }, "paid_not_approved"],
        ["approval 0", { ADULT_OFF_BATCH_APPROVE_PAID: "0" }, "paid_not_approved"],
        ["approval true", { ADULT_OFF_BATCH_APPROVE_PAID: "true" }, "paid_not_approved"],
        ["state dir env", { ADULT_OFF_BATCH_STATE_DIR: "/tmp/elsewhere" }, "state_dir_not_configurable"],
        ["blank state dir env", { ADULT_OFF_BATCH_STATE_DIR: "" }, "state_dir_not_configurable"],
        ["isolated without ack", { ADULT_OFF_BATCH_ALLOW_ISOLATED_PAID: undefined }, "isolated_paid_not_a_completion_path"],
        ["isolated ack 0", { ADULT_OFF_BATCH_ALLOW_ISOLATED_PAID: "0" }, "isolated_paid_not_a_completion_path"],
        ["raise-from NaN", { ADULT_OFF_BATCH_CAP_RAISE_FROM_KRW: "NaN" }, "invalid_adult_off_batch_cap_raise_from_krw"],
        ["blank ack id", { ADULT_OFF_BATCH_ACK_UNRESOLVED_REQUEST_ID: " " }, "invalid_ack_unresolved_request_id"],
        ["missing key", { CHEAPER_INFERENCE_API_KEY: undefined }, "missing_cheaper_inference_api_key"],
        ["blank key", { CHEAPER_INFERENCE_API_KEY: "  " }, "missing_cheaper_inference_api_key"],
      ];
      for (const [name, overrides, code] of cases) {
        assert.throws(
          () => sc.config(overrides),
          (error: unknown) => error instanceof AdultOffBatchConfigError && error.code === code,
          name
        );
      }
      const ok = sc.config();
      assert.equal(ok.mode, "execute");
      assert.equal(ok.runId, "run-alpha");
      assert.equal(ok.stateDir, sc.stateDir);
    });

    it("pins the batch state to one fixed location that no environment variable can move", () => {
      const sc = dbFile();
      const canonical = path.join(os.userInfo().homedir, ".hav-adult-off-batch");
      assert.equal(defaultAdultOffBatchStateDir(), canonical);
      const savedHome = process.env.HOME;
      const savedTmp = process.env.TMPDIR;
      try {
        process.env.HOME = path.join(sc.dir, "other-home");
        process.env.TMPDIR = path.join(sc.dir, "other-tmp");
        assert.equal(defaultAdultOffBatchStateDir(), canonical);
        const config = parseAdultOffBatchPaidRunConfig(sc.env(), sc.dbPath);
        assert.equal(config.stateDir, canonical);
      } finally {
        if (savedHome === undefined) delete process.env.HOME;
        else process.env.HOME = savedHome;
        if (savedTmp === undefined) delete process.env.TMPDIR;
        else process.env.TMPDIR = savedTmp;
      }
    });

    it("rejects non-finite, zero and negative cap, fx rate and per-window reserve", () => {
      const sc = dbFile();
      const bad = ["NaN", "Infinity", "-Infinity", "-1", "0", "0.0", "", " ", "abc", "1e400", "0x10", "1,5", "+5"];
      const names = [
        "ADULT_OFF_BATCH_CAP_KRW",
        "ADULT_OFF_BATCH_USD_KRW",
        "ADULT_OFF_BATCH_RESERVE_KRW_PER_WINDOW",
      ];
      for (const name of names) {
        for (const value of bad) {
          assert.throws(
            () => sc.config({ [name]: value }),
            (error: unknown) => error instanceof AdultOffBatchConfigError,
            `${name}=${JSON.stringify(value)}`
          );
          assert.throws(
            () =>
              parseAdultOffBatchPaidRunConfig({ ADULT_OFF_BATCH_MODE: "plan", [name]: value }, sc.dbPath),
            (error: unknown) => error instanceof AdultOffBatchConfigError,
            `plan ${name}=${JSON.stringify(value)}`
          );
        }
      }
      assert.equal(sc.config({ ADULT_OFF_BATCH_CAP_KRW: "2.5" }).capKrw, 2.5);
      assert.equal(sc.config({ ADULT_OFF_BATCH_USD_KRW: "1400" }).fxKrwPerUsd, 1400);
      assert.equal(sc.config({ ADULT_OFF_BATCH_RESERVE_KRW_PER_WINDOW: "0.9" }).reservePerWindowKrw, 0.9);
    });

    it("detects the live production database by identity, not by spelling", () => {
      const sc = dbFile();
      const volume = path.join(sc.dir, "volume");
      fs.mkdirSync(volume);
      const liveDb = path.join(volume, "app.db");
      fs.copyFileSync(sc.dbPath, liveDb);
      const env = { RAILWAY_VOLUME_MOUNT_PATH: volume };

      const symlink = path.join(sc.dir, "alias.db");
      fs.symlinkSync(liveDb, symlink);
      const hardlink = path.join(sc.dir, "hard.db");
      fs.linkSync(liveDb, hardlink);
      const dotted = path.join(volume, "..", path.basename(volume), "app.db");
      const relative = path.relative(process.cwd(), liveDb);
      const dirLink = path.join(sc.dir, "dirlink");
      fs.symlinkSync(volume, dirLink);

      for (const candidate of [liveDb, symlink, hardlink, dotted, relative, path.join(dirLink, "app.db")]) {
        assert.equal(isLiveProductionDatabase(candidate, env), true, candidate);
        assert.throws(
          () =>
            parseAdultOffBatchPaidRunConfig(
              { ...sc.env(), RAILWAY_VOLUME_MOUNT_PATH: volume },
              candidate
            ),
          (error: unknown) => error instanceof AdultOffBatchConfigError && error.code === "prod_write_refused",
          candidate
        );
      }
      assert.equal(isLiveProductionDatabase(sc.dbPath, env), false);
      const allowed = parseAdultOffBatchPaidRunConfig(
        { ...sc.env(), RAILWAY_VOLUME_MOUNT_PATH: volume, ADULT_OFF_BATCH_ALLOW_PROD_WRITE: "1" },
        symlink
      );
      assert.equal(allowed.liveProductionDb, true);
      const plan = parseAdultOffBatchPaidRunConfig(
        { RAILWAY_VOLUME_MOUNT_PATH: volume },
        symlink
      );
      assert.equal(plan.mode, "plan");
      assert.equal(plan.liveProductionDb, true);
    });
  });

  describe("PLAN_ONLY", () => {
    it("reports counts from a read-only handle and leaves the database bytes untouched", () => {
      const sc = scenario();
      insertAssistant(sc.fx, { content: "계획 본문 하나" });
      insertAssistant(sc.fx, { content: "계획 본문 둘" });
      sc.fx.pragma("wal_checkpoint(TRUNCATE)");
      sc.fx.close();
      const before = sha256File(sc.dbPath);
      const config = parseAdultOffBatchPaidRunConfig({ ADULT_OFF_BATCH_MODE: "plan" }, sc.dbPath);
      const db = new Database(sc.dbPath, { readonly: true, fileMustExist: true });
      try {
        const report = buildAdultOffBatchPlanReport(db, config);
        assert.equal(report.status, "plan_only_ok");
        assert.equal(report.targets.needsClassification, 2);
        assert.equal(report.pendingClassification.uniqueTexts, 2);
        assert.equal(report.database.readonly, true);
        assert.equal(JSON.stringify(report).includes("계획 본문"), false);
      } finally {
        db.close();
      }
      assert.equal(sha256File(sc.dbPath), before);
    });
  });

  describe("execute: fingerprints, budget, exclusion", () => {
    it("keeps the fingerprint made before the paid call and skips targets changed meanwhile", async () => {
      type Mutation = { name: string; setup: (sc: Scenario) => number; mutate: (sc: Scenario, id: number) => void };
      const mutations: Mutation[] = [
        {
          name: "active variant switch",
          setup: (sc) =>
            insertAssistant(sc.fx, {
              content: "현재 활성 본문",
              alternates: [
                { content: "이전 변종 본문", model: "gemini", usage: { cost: 1 }, created_at: "" },
                { content: "현재 활성 본문", model: "gemini", usage: { cost: 1 }, created_at: "" },
              ],
              activeVariant: 1,
            }),
          mutate: (sc, id) =>
            sc.fx
              .prepare("UPDATE messages SET active_variant=0, content='이전 변종 본문' WHERE id=?")
              .run(id),
        },
        {
          name: "body changed",
          setup: (sc) => insertAssistant(sc.fx, { content: "원래 본문" }),
          mutate: (sc, id) =>
            sc.fx.prepare("UPDATE messages SET content='바뀐 본문' WHERE id=?").run(id),
        },
        {
          name: "regeneration appended",
          setup: (sc) =>
            insertAssistant(sc.fx, {
              content: "첫 생성 본문",
              alternates: [{ content: "첫 생성 본문", model: "gemini", usage: { cost: 1 }, created_at: "" }],
              activeVariant: 0,
            }),
          mutate: (sc, id) =>
            sc.fx
              .prepare("UPDATE messages SET content=?, alternates=?, active_variant=1 WHERE id=?")
              .run(
                "재생성 본문",
                JSON.stringify([
                  { content: "첫 생성 본문", model: "gemini", usage: { cost: 1 }, created_at: "" },
                  { content: "재생성 본문", model: "gemini", usage: { cost: 1 }, created_at: "" },
                ]),
                id
              ),
        },
      ];
      for (const mutation of mutations) {
        const sc = scenario(`run-stale-${scenarioSerial}`);
        const id = mutation.setup(sc);
        let mutated = false;
        const mock = mockClassifier(sc, {
          onCall: () => {
            if (mutated) return;
            mutated = true;
            mutation.mutate(sc, id);
          },
        });
        const report = await run(sc, mock);
        assert.equal(report.stopReason, "completed", mutation.name);
        assert.equal(report.body.written, 0, mutation.name);
        assert.equal(report.body.writtenVariantIsolated, 0, mutation.name);
        assert.ok(report.body.skippedStale >= 1, mutation.name);
        const row = sc.fx
          .prepare("SELECT usage, alternates FROM messages WHERE id=?")
          .get(id) as { usage: string; alternates: string };
        assert.equal(row.usage.includes("adultOffGuard"), false, `${mutation.name} usage`);
        assert.equal(row.alternates.includes("adultOffGuard"), false, `${mutation.name} alternates`);
      }
    });

    it("applies 1,345 mirrored body approvals and 2 variant-isolated writes with one paid call per unique text", async () => {
      const sc = scenario("run-bulk", "1500");
      sc.fx.transaction(() => {
        for (let i = 0; i < 1_345; i += 1) {
          insertAssistant(sc.fx, { content: `거울 본문 ${i}`, chatId: 1 + (i % 7) });
        }
        for (let i = 0; i < 2; i += 1) {
          insertAssistant(sc.fx, {
            content: `행 본문 ${i}`,
            alternates: [
              { content: `활성 variant 본문 ${i}`, model: "gemini", usage: { cost: 1 }, created_at: "" },
            ],
            activeVariant: 0,
          });
        }
        insertAssistant(sc.fx, { content: "거울 본문 0", chatId: 3 });
      })();
      const mock = mockClassifier(sc, { usdPerCall: 0.0001 });
      const report = await run(sc, mock);
      assert.equal(report.stopReason, "completed");
      assert.equal(mock.calls.length, 1_347);
      assert.equal(report.body.written, 1_346);
      assert.equal(report.body.writtenVariantIsolated, 2);
      assert.equal(report.body.skippedStale, 0);
      assert.equal(report.body.classifiedTexts, 1_347);
      assert.ok(report.budget.settledKrwAtEnd > 0 && report.budget.settledKrwAtEnd < 1500);
      const rows = loadAssistantRowsForAdultOffInspection(sc.fx);
      for (const row of rows.slice(0, 1_345)) {
        assert.equal(adultOffStoredTextDisposition(JSON.parse(row.usage!), row.content), "approved");
      }
      const isolated = rows.slice(1_345, 1_347);
      for (const row of isolated) {
        assert.equal(JSON.parse(row.usage!).adultOffGuard, undefined);
        const variants = JSON.parse(row.alternates!) as Array<{ content: string; usage: Record<string, unknown> }>;
        assert.equal(adultOffStoredTextDisposition(variants[0]!.usage, variants[0]!.content), "approved");
      }
    });

    it("stores restricted outcomes and leaves unresolved low-confidence results unwritten", async () => {
      const sc = scenario("run-outcomes");
      const restrictedId = insertAssistant(sc.fx, { content: `${RESTRICTED_MARK} 본문` });
      const lowId = insertAssistant(sc.fx, { content: "확신이 낮은 본문" });
      const okId = insertAssistant(sc.fx, { content: "평범한 본문" });
      const mock = mockClassifier(sc, {
        verdict: (text) => (text.includes("확신이 낮은") ? "low" : text.includes(RESTRICTED_MARK) ? "restrict" : "allow"),
      });
      const report = await run(sc, mock);
      assert.equal(report.stopReason, "completed");
      assert.equal(report.body.written, 2);
      assert.equal(report.body.skippedUnresolved, 1);
      assert.equal(
        adultOffStoredTextDisposition(usageOf(sc.fx, restrictedId), `${RESTRICTED_MARK} 본문`),
        "restricted"
      );
      assert.equal(usageOf(sc.fx, lowId).adultOffGuard, undefined);
      assert.equal(adultOffStoredTextDisposition(usageOf(sc.fx, okId), "평범한 본문"), "approved");
    });

    it("stops at the cap, carries cost across restarts and resumes only with an explicitly approved cap raise", async () => {
      const capKrw = (KRW_PER_CALL + reserveFor("캡 본문 0") + 0.01).toFixed(4);
      const sc = scenario("run-cap", capKrw);
      for (let i = 0; i < 5; i += 1) insertAssistant(sc.fx, { content: `캡 본문 ${i}` });
      const first = mockClassifier(sc);
      const r1 = await run(sc, first);
      assert.equal(r1.status, "execute_stopped");
      assert.equal(r1.stopReason, "cap_reached");
      assert.equal(first.calls.length, 2);
      assert.equal(r1.body.written, 2);
      const spentAfterFirst = loadAdultOffBatchState(sc.stateDir).settledKrw;
      assert.ok(Math.abs(spentAfterFirst - 2 * KRW_PER_CALL) < 1e-9);

      const second = mockClassifier(sc);
      const r2 = await run(sc, second);
      assert.equal(r2.stopReason, "cap_reached");
      assert.equal(second.calls.length, 0);
      assert.ok(Math.abs(r2.budget.settledKrwAtStart - spentAfterFirst) < 1e-9);

      const refused = mockClassifier(sc);
      await assert.rejects(
        () => run(sc, refused, { ADULT_OFF_BATCH_CAP_KRW: "8" }),
        (error: unknown) =>
          error instanceof AdultOffBatchRunRefusedError && error.code === "cap_increase_not_approved"
      );
      await assert.rejects(
        () =>
          run(sc, refused, { ADULT_OFF_BATCH_CAP_KRW: "8", ADULT_OFF_BATCH_CAP_RAISE_FROM_KRW: "1499" }),
        (error: unknown) =>
          error instanceof AdultOffBatchRunRefusedError && error.code === "cap_increase_not_approved"
      );
      assert.equal(refused.calls.length, 0);

      const third = mockClassifier(sc);
      const r3 = await run(sc, third, {
        ADULT_OFF_BATCH_CAP_KRW: "8",
        ADULT_OFF_BATCH_CAP_RAISE_FROM_KRW: capKrw,
      });
      assert.equal(r3.stopReason, "completed");
      assert.equal(third.calls.length, 3);
      assert.equal(r3.body.written, 3);
      const total = loadAdultOffBatchState(sc.stateDir).settledKrw;
      assert.ok(Math.abs(total - 5 * KRW_PER_CALL) < 1e-9);
      assert.equal(loadAdultOffBatchState(sc.stateDir).approvedCapKrw, 8);
      const texts = new Set([...first.calls, ...third.calls].map((call) => call.text));
      assert.equal(texts.size, 5);
    });

    it("never expands the approved cap by itself: a lower cap ratchets down and a later higher cap needs approval", async () => {
      const sc = scenario("run-ratchet", "1500");
      insertAssistant(sc.fx, { content: "래칫 본문" });
      const lower = mockClassifier(sc);
      const r1 = await run(sc, lower, { ADULT_OFF_BATCH_CAP_KRW: "0.5" });
      assert.equal(r1.stopReason, "cap_reached");
      assert.equal(lower.calls.length, 0);
      assert.equal(loadAdultOffBatchState(sc.stateDir).approvedCapKrw, 0.5);

      const back = mockClassifier(sc);
      await assert.rejects(
        () => run(sc, back, { ADULT_OFF_BATCH_CAP_KRW: "1500" }),
        (error: unknown) =>
          error instanceof AdultOffBatchRunRefusedError && error.code === "cap_increase_not_approved"
      );
      assert.equal(back.calls.length, 0);
      assert.equal(loadAdultOffBatchState(sc.stateDir).approvedCapKrw, 0.5);
    });

    it("keeps one cumulative budget when the run id changes between sequential runs", async () => {
      const capKrw = (KRW_PER_CALL + reserveFor("공유 본문 0") + 0.01).toFixed(4);
      const sc = scenario("run-share-a", capKrw);
      for (let i = 0; i < 6; i += 1) insertAssistant(sc.fx, { content: `공유 본문 ${i}` });
      const a = mockClassifier(sc);
      const r1 = await run(sc, a);
      assert.equal(r1.stopReason, "cap_reached");
      assert.equal(a.calls.length, 2);

      const b = mockClassifier(sc);
      const r2 = await run(sc, b, { ADULT_OFF_BATCH_RUN_ID: "run-share-b" });
      assert.equal(r2.stopReason, "cap_reached");
      assert.equal(b.calls.length, 0);
      assert.ok(Math.abs(r2.budget.settledKrwAtStart - 2 * KRW_PER_CALL) < 1e-9);

      const c = mockClassifier(sc);
      await run(sc, c, { ADULT_OFF_BATCH_RUN_ID: "run-share-c" });
      assert.equal(c.calls.length, 0);
      const state = loadAdultOffBatchState(sc.stateDir);
      assert.deepEqual(state.runIds, ["run-share-a", "run-share-b", "run-share-c"]);
      assert.ok(Math.abs(state.settledKrw - 2 * KRW_PER_CALL) < 1e-9);
    });

    it("reserves each call's own worst-case bound and never starts a call that could cross the cap", async () => {
      const longText = "가".repeat(3_000);
      const bound = reserveFor(longText);
      assert.ok(bound > 1.5, `bound ${bound}`);
      const sc = scenario("run-bound", "1.5");
      insertAssistant(sc.fx, { content: longText });
      const shortId = insertAssistant(sc.fx, { content: "짧은 본문" });
      const mock = mockClassifier(sc);
      const report = await run(sc, mock);
      assert.equal(mock.calls.length, 0, "the long window's own bound exceeds the cap");
      assert.equal(report.stopReason, "cap_reached");
      assert.equal(usageOf(sc.fx, shortId).adultOffGuard, undefined);
      assert.equal(report.budget.settledKrwAtEnd, 0);

      const shortOnly = scenario("run-bound-short", "1.5");
      insertAssistant(shortOnly.fx, { content: "짧은 본문" });
      const shortMock = mockClassifier(shortOnly);
      const shortReport = await run(shortOnly, shortMock);
      assert.equal(shortReport.stopReason, "completed");
      assert.equal(shortMock.calls.length, 1);
    });

    it("derives the per-call bound from request bytes, max_tokens and provider rates, not from 0.45 KRW", () => {
      const rates = { input: 0.07, cacheWrite: 1.25, output: 0.35 };
      const staticBytes =
        Buffer.byteLength(ADULT_OFF_CLASSIFIER_SYSTEM_PROMPT, "utf8") +
        Buffer.byteLength(JSON.stringify(ADULT_OFF_CLASSIFIER_JSON_SCHEMA), "utf8") +
        512;
      const expected = (text: string): number => {
        const bytes = staticBytes + Buffer.byteLength(buildAdultOffClassifierUserMessage(text), "utf8");
        const usd = (bytes * rates.input * rates.cacheWrite + ADULT_OFF_CLASSIFIER_MAX_TOKENS * rates.output) / 1e6;
        return usd * 1450 * 1.02;
      };
      for (const text of ["a", "짧은 본문", "가".repeat(3_000), "가".repeat(36_000)]) {
        assert.ok(Math.abs(reserveFor(text) - Math.max(0.45, expected(text))) < 1e-9, text.length.toString());
      }
      assert.ok(reserveFor("가".repeat(36_000)) > 10);
      assert.ok(reserveFor("가".repeat(36_000)) > reserveFor("가".repeat(3_000)));
      assert.equal(adultOffBatchWindowReserveKrw("a", { fxKrwPerUsd: 1450, reservePerWindowKrw: 50 }), 50);
      assert.ok(
        adultOffBatchWindowReserveKrw("a", { fxKrwPerUsd: 2900, reservePerWindowKrw: 0.45 }) >
          adultOffBatchWindowReserveKrw("a", { fxKrwPerUsd: 1450, reservePerWindowKrw: 0.45 })
      );
    });

    it("stops after a call whose actual cost is above its bound, counts it fully and halts the batch", async () => {
      const sc = scenario("run-exceed", "50");
      for (let i = 0; i < 4; i += 1) insertAssistant(sc.fx, { content: `고비용 본문 ${i}` });
      const mock = mockClassifier(sc, { usdPerCall: 0.01 });
      const report = await run(sc, mock);
      const perCall = 0.01 * 1450 * 1.02;
      assert.equal(report.status, "execute_stopped");
      assert.equal(report.stopReason, "halted_cost_exceeds_bound");
      assert.equal(mock.calls.length, 1);
      assert.ok(perCall > reserveFor("고비용 본문 0"));
      assert.ok(Math.abs(report.budget.settledKrwAtEnd - perCall) < 1e-9);
      assert.ok(report.budget.settledKrwAtEnd <= 50);
      assert.ok(loadAdultOffBatchState(sc.stateDir).halted);
      const again = mockClassifier(sc);
      await assert.rejects(
        () => run(sc, again, { ADULT_OFF_BATCH_RUN_ID: "run-exceed-2" }),
        (error: unknown) => error instanceof AdultOffBatchRunRefusedError && error.code === "batch_halted"
      );
      assert.equal(again.calls.length, 0);
    });

    it("bounds the overshoot past the cap to a single call's actual cost", async () => {
      const sc = scenario("run-overshoot", "10");
      for (let i = 0; i < 3; i += 1) insertAssistant(sc.fx, { content: `초과 본문 ${i}` });
      const mock = mockClassifier(sc, { usdPerCall: 0.01 });
      const report = await run(sc, mock);
      assert.equal(mock.calls.length, 1);
      assert.ok(report.budget.settledKrwAtEnd > 10);
      assert.ok(report.budget.settledKrwAtEnd <= 10 + 0.01 * 1450 * 1.02);
      const again = mockClassifier(sc);
      await assert.rejects(() => run(sc, again, { ADULT_OFF_BATCH_RUN_ID: "run-overshoot-2" }));
      assert.equal(again.calls.length, 0);
    });

    it("fails closed when a paid call has no exact ledger cost and refuses every later run id", async () => {
      for (const variant of [
        { name: "no ledger row", options: { usdPerCall: null } as MockOptions },
        {
          name: "unavailable source",
          options: { ledgerSource: "unavailable", ledgerStatus: "completed_without_exact_cost" } as MockOptions,
        },
        { name: "zero cost", options: { usdPerCall: 0 } as MockOptions },
      ]) {
        const sc = scenario(`run-unknown-${scenarioSerial}`);
        const id = insertAssistant(sc.fx, { content: "비용 미상 본문" });
        insertAssistant(sc.fx, { content: "뒤따르는 본문" });
        const mock = mockClassifier(sc, variant.options);
        const report = await run(sc, mock);
        assert.equal(report.status, "execute_stopped", variant.name);
        assert.equal(report.stopReason, "halted_unknown_cost", variant.name);
        assert.equal(mock.calls.length, 1, variant.name);
        assert.equal(usageOf(sc.fx, id).adultOffGuard, undefined, variant.name);
        assert.ok(loadAdultOffBatchState(sc.stateDir).halted, variant.name);
        const again = mockClassifier(sc);
        await assert.rejects(
          () => run(sc, again, { ADULT_OFF_BATCH_RUN_ID: `${sc.config().runId}-retry` }),
          (error: unknown) => error instanceof AdultOffBatchRunRefusedError && error.code === "batch_halted",
          variant.name
        );
        assert.equal(again.calls.length, 0, variant.name);
      }
    });

    it("halts on a classifier call error even when its cost is known, but treats invalid output as unresolved", async () => {
      const failing = scenario("run-http-error");
      const failId = insertAssistant(failing.fx, { content: "호출 오류 본문" });
      insertAssistant(failing.fx, { content: "오류 뒤 본문" });
      const httpMock = mockClassifier(failing, { failWith: "http_error" });
      const httpReport = await run(failing, httpMock);
      assert.equal(httpReport.stopReason, "halted_classifier_error");
      assert.equal(httpMock.calls.length, 1);
      assert.equal(usageOf(failing.fx, failId).adultOffGuard, undefined);
      assert.ok(Math.abs(httpReport.budget.settledKrwAtEnd - KRW_PER_CALL) < 1e-9);

      const invalid = scenario("run-invalid-output");
      const invalidId = insertAssistant(invalid.fx, { content: "무효 출력 본문" });
      const invalidMock = mockClassifier(invalid, { failWith: "invalid_output" });
      const invalidReport = await run(invalid, invalidMock);
      assert.equal(invalidReport.stopReason, "completed");
      assert.equal(invalidReport.body.skippedUnresolved, 1);
      assert.equal(usageOf(invalid.fx, invalidId).adultOffGuard, undefined);
    });

    it("blocks same-run and different-run concurrent executions behind one global lock", async () => {
      const sc = scenario("run-lock-a");
      insertAssistant(sc.fx, { content: "잠금 본문 하나" });
      let releaseGate: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });
      let started = false;
      const holder = mockClassifier(sc, {
        onCall: async () => {
          started = true;
          await gate;
        },
      });
      const running = run(sc, holder);
      for (let i = 0; i < 200 && !started; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(started, true);

      const sameRun = mockClassifier(sc);
      await assert.rejects(
        () => run(sc, sameRun),
        (error: unknown) => error instanceof AdultOffBatchRunRefusedError && error.code === "concurrent_run_locked"
      );
      const otherRun = mockClassifier(sc);
      await assert.rejects(
        () => run(sc, otherRun, { ADULT_OFF_BATCH_RUN_ID: "run-lock-b", ADULT_OFF_BATCH_CAP_KRW: "99999" }),
        (error: unknown) => error instanceof AdultOffBatchRunRefusedError && error.code === "concurrent_run_locked"
      );
      assert.equal(sameRun.calls.length, 0);
      assert.equal(otherRun.calls.length, 0);

      releaseGate();
      const report = await running;
      assert.equal(report.stopReason, "completed");
      assert.equal(fs.existsSync(path.join(sc.stateDir, "execution.lock")), false);

      const followUp = mockClassifier(sc);
      const next = await run(sc, followUp, { ADULT_OFF_BATCH_RUN_ID: "run-lock-b" });
      assert.equal(next.stopReason, "completed");
    });

    it("reclaims a lock left by a dead process on this host and refuses a foreign or live holder", () => {
      const sc = scenario();
      fs.mkdirSync(sc.stateDir, { recursive: true });
      const lockFile = path.join(sc.stateDir, "execution.lock");
      const dead = spawnSync(process.execPath, ["-e", ""]);
      assert.ok(dead.pid);
      fs.writeFileSync(
        lockFile,
        JSON.stringify({ pid: dead.pid, host: os.hostname(), runId: "ghost-run", startedAt: "" })
      );
      const lock = acquireAdultOffBatchExecutionLock(sc.stateDir, "run-reclaim");
      lock.release();
      assert.equal(fs.existsSync(lockFile), false);

      fs.writeFileSync(
        lockFile,
        JSON.stringify({ pid: dead.pid, host: "another-host", runId: "ghost-run", startedAt: "" })
      );
      assert.throws(
        () => acquireAdultOffBatchExecutionLock(sc.stateDir, "run-reclaim"),
        (error: unknown) => error instanceof AdultOffBatchRunRefusedError && error.code === "concurrent_run_locked"
      );
      fs.writeFileSync(
        lockFile,
        JSON.stringify({ pid: process.pid, host: os.hostname(), runId: "live-run", startedAt: "" })
      );
      assert.throws(
        () => acquireAdultOffBatchExecutionLock(sc.stateDir, "run-reclaim"),
        (error: unknown) => error instanceof AdultOffBatchRunRefusedError && error.code === "concurrent_run_locked"
      );
      fs.unlinkSync(lockFile);
    });

    it("does not stamp or re-bill a text whose paid call finished but whose verdict was never stored", async () => {
      const sc = scenario("run-unresolved", "50");
      const id = insertAssistant(sc.fx, { content: "판정 미확정 본문" });
      const requestId = "adult-off-batch/run-before-crash/1";
      fs.mkdirSync(sc.stateDir, { recursive: true });
      fs.writeFileSync(
        path.join(sc.stateDir, "batch.state.json"),
        JSON.stringify({
          version: 2,
          settledKrw: 0,
          maxObservedWindowKrw: 0,
          callCount: 0,
          nextCallSeq: 2,
          approvedCapKrw: 50,
          runIds: ["run-before-crash"],
          paidDatabases: [],
          inFlight: { messageId: id, surface: "body", requestIds: [requestId], openRequestId: requestId, reservedKrw: 0.75 },
          unresolved: null,
          halted: null,
          updatedAt: "",
        })
      );
      insertLedger(sc.fx, requestId, { usd: 0.0003, messageId: id });

      const blocked = mockClassifier(sc);
      await assert.rejects(
        () => run(sc, blocked),
        (error: unknown) =>
          error instanceof AdultOffBatchRunRefusedError && error.code === "interrupted_call_unresolved"
      );
      assert.equal(blocked.calls.length, 0);
      const afterFirst = loadAdultOffBatchState(sc.stateDir);
      assert.equal(afterFirst.inFlight, null);
      assert.deepEqual(afterFirst.unresolved?.requestIds, [requestId]);
      assert.equal(afterFirst.unresolved?.messageId, id);
      assert.ok(Math.abs(afterFirst.settledKrw - KRW_PER_CALL) < 1e-9, "the interrupted call's cost is counted once");
      assert.equal(usageOf(sc.fx, id).adultOffGuard, undefined);

      const stillBlocked = mockClassifier(sc);
      await assert.rejects(
        () => run(sc, stillBlocked, { ADULT_OFF_BATCH_RUN_ID: "run-after-crash-2" }),
        (error: unknown) =>
          error instanceof AdultOffBatchRunRefusedError && error.code === "interrupted_call_unresolved"
      );
      await assert.rejects(
        () => run(sc, stillBlocked, { ADULT_OFF_BATCH_ACK_UNRESOLVED_REQUEST_ID: "adult-off-batch/other/9" }),
        (error: unknown) =>
          error instanceof AdultOffBatchRunRefusedError && error.code === "interrupted_call_unresolved"
      );
      assert.equal(stillBlocked.calls.length, 0);
      assert.ok(Math.abs(loadAdultOffBatchState(sc.stateDir).settledKrw - KRW_PER_CALL) < 1e-9);

      const accepted = mockClassifier(sc);
      const report = await run(sc, accepted, { ADULT_OFF_BATCH_ACK_UNRESOLVED_REQUEST_ID: requestId });
      assert.equal(report.stopReason, "completed");
      assert.equal(accepted.calls.length, 1);
      assert.ok(Math.abs(report.budget.settledKrwAtStart - KRW_PER_CALL) < 1e-9);
      assert.ok(Math.abs(report.budget.settledKrwAtEnd - 2 * KRW_PER_CALL) < 1e-9);
      assert.equal(adultOffStoredTextDisposition(usageOf(sc.fx, id), "판정 미확정 본문"), "approved");
      assert.equal(loadAdultOffBatchState(sc.stateDir).unresolved, null);
    });

    it("does not count a settled call twice when the process died after settling but before the commit", async () => {
      const sc = scenario("run-settled-then-died", "50");
      const id = insertAssistant(sc.fx, { content: "정산 뒤 종료 본문" });
      const requestId = "adult-off-batch/run-before-death/1";
      fs.mkdirSync(sc.stateDir, { recursive: true });
      fs.writeFileSync(
        path.join(sc.stateDir, "batch.state.json"),
        JSON.stringify({
          version: 2,
          settledKrw: KRW_PER_CALL,
          maxObservedWindowKrw: KRW_PER_CALL,
          callCount: 1,
          nextCallSeq: 2,
          approvedCapKrw: 50,
          runIds: ["run-before-death"],
          paidDatabases: [],
          inFlight: { messageId: id, surface: "body", requestIds: [requestId], openRequestId: null, reservedKrw: 0.75 },
          unresolved: null,
          halted: null,
          updatedAt: "",
        })
      );
      insertLedger(sc.fx, requestId, { usd: USD_PER_CALL, messageId: id });
      const mock = mockClassifier(sc);
      await assert.rejects(
        () => run(sc, mock),
        (error: unknown) =>
          error instanceof AdultOffBatchRunRefusedError && error.code === "interrupted_call_unresolved"
      );
      assert.equal(mock.calls.length, 0);
      assert.ok(Math.abs(loadAdultOffBatchState(sc.stateDir).settledKrw - KRW_PER_CALL) < 1e-9);
    });

    it("stops with an unresolved result after a real process kill right after the paid call", async () => {
      const sc = scenario("run-kill", "50");
      const id = insertAssistant(sc.fx, { content: "강제 종료 본문" });
      sc.fx.pragma("wal_checkpoint(TRUNCATE)");
      const childDir = sc.dir;
      const child = path.join(childDir, "kill-child.ts");
      fs.writeFileSync(
        child,
        `import Database from ${JSON.stringify(path.join(REPO_ROOT, "node_modules/better-sqlite3"))};
import { randomUUID } from "node:crypto";
import { executeAdultOffBatchPaidRun, parseAdultOffBatchPaidRunConfig } from ${JSON.stringify(path.join(REPO_ROOT, "src/lib/adultOffBatchPaidRun.ts"))};

const [dbPath, stateDir] = process.argv.slice(2);
const config = parseAdultOffBatchPaidRunConfig(
  {
    ADULT_OFF_BATCH_MODE: "execute",
    ADULT_OFF_BATCH_RUN_ID: "run-kill-child",
    ADULT_OFF_BATCH_CAP_KRW: "50",
    ADULT_OFF_BATCH_APPROVE_PAID: "1",
    ADULT_OFF_BATCH_ALLOW_ISOLATED_PAID: "1",
    CHEAPER_INFERENCE_API_KEY: "dummy-not-a-real-key",
  },
  dbPath,
  { stateDir }
);
async function main() {
await executeAdultOffBatchPaidRun({
  config,
  openDatabase: () => new Database(dbPath, { fileMustExist: true }),
  createClassifier: (scope) => async () => {
    const fx = new Database(dbPath);
    fx.prepare(
      \`INSERT INTO api_cost_ledger (
         event_key, chat_id, assistant_message_id, generation_sequence, family, funding_class,
         execution_phase, attempt_ordinal, requested_provider, requested_model, provider, model,
         request_kind, generation_request_id, event_status, exchange_rate_krw_per_usd, cost_krw,
         estimated, actual_cost_usd, actual_cost_source, created_at
       ) VALUES (?, 1, ?, 0, 'background', 'platform_funded', 'sync_post_turn', 1, 'cheaperinference',
         'gpt-6-luna', 'cheaperinference', 'gpt-6-luna', 'adult-off-output-moderation', ?, 'settled', 1450,
         0, 0, 0.0003, 'cheaper_inference_billed', datetime('now'))\`
    ).run(randomUUID(), scope.assistantMessageId, scope.generationRequestId);
    fx.close();
    process.kill(process.pid, "SIGKILL");
    throw new Error("unreachable");
  },
});
}
main();
`
      );
      const result = spawnSync(
        process.execPath,
        ["--conditions=react-server", "--import", "tsx", child, sc.dbPath, sc.stateDir],
        { cwd: REPO_ROOT, env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" }, encoding: "utf8" }
      );
      assert.equal(result.signal, "SIGKILL", `${result.stdout}${result.stderr}`);
      assert.equal(usageOf(sc.fx, id).adultOffGuard, undefined);
      const crashed = loadAdultOffBatchState(sc.stateDir);
      assert.equal(crashed.inFlight?.messageId, id);
      assert.equal(crashed.inFlight?.openRequestId, crashed.inFlight?.requestIds[0]);

      const retry = mockClassifier(sc);
      await assert.rejects(
        () => run(sc, retry, { ADULT_OFF_BATCH_RUN_ID: "run-kill-retry" }),
        (error: unknown) =>
          error instanceof AdultOffBatchRunRefusedError && error.code === "interrupted_call_unresolved"
      );
      assert.equal(retry.calls.length, 0, "no automatic re-classification of the same text");
      const after = loadAdultOffBatchState(sc.stateDir);
      assert.ok(Math.abs(after.settledKrw - KRW_PER_CALL) < 1e-9);
      assert.equal(after.unresolved?.messageId, id);
      assert.equal(usageOf(sc.fx, id).adultOffGuard, undefined);
    });

    it("refuses to resume after an interrupted call whose cost cannot be confirmed", async () => {
      const sc = scenario("run-interrupted", "50");
      const id = insertAssistant(sc.fx, { content: "중단 본문" });
      fs.mkdirSync(sc.stateDir, { recursive: true });
      const requestId = "adult-off-batch/run-interrupted/1";
      fs.writeFileSync(
        path.join(sc.stateDir, "batch.state.json"),
        JSON.stringify({
          version: 2,
          settledKrw: 0,
          maxObservedWindowKrw: 0,
          callCount: 0,
          nextCallSeq: 2,
          approvedCapKrw: 50,
          runIds: ["run-interrupted"],
          paidDatabases: [],
          inFlight: { messageId: id, surface: "body", requestIds: [requestId], openRequestId: requestId, reservedKrw: 0.75 },
          unresolved: null,
          halted: null,
          updatedAt: "",
        })
      );
      insertLedger(sc.fx, requestId, { usd: null, source: "unavailable", status: "started" });
      const mock = mockClassifier(sc);
      await assert.rejects(
        () => run(sc, mock),
        (error: unknown) =>
          error instanceof AdultOffBatchRunRefusedError && error.code === "interrupted_call_cost_unknown"
      );
      assert.equal(mock.calls.length, 0);
      assert.ok(loadAdultOffBatchState(sc.stateDir).halted);
      await assert.rejects(
        () => run(sc, mock, { ADULT_OFF_BATCH_ACK_UNRESOLVED_REQUEST_ID: requestId }),
        (error: unknown) => error instanceof AdultOffBatchRunRefusedError && error.code === "batch_halted"
      );
      assert.equal(mock.calls.length, 0);
    });

    it("clears the in-flight marker only after the verdict commit and leaves nothing unresolved on success", async () => {
      const sc = scenario("run-marker");
      insertAssistant(sc.fx, { content: "표식 본문" });
      let seenInFlight = false;
      const mock = mockClassifier(sc, {
        onCall: () => {
          const state = loadAdultOffBatchState(sc.stateDir);
          seenInFlight = state.inFlight?.openRequestId != null;
        },
      });
      const report = await run(sc, mock);
      assert.equal(report.stopReason, "completed");
      assert.equal(seenInFlight, true);
      const state = loadAdultOffBatchState(sc.stateDir);
      assert.equal(state.inFlight, null);
      assert.equal(state.unresolved, null);
      assert.deepEqual(state.paidDatabases.map((entry) => entry.liveProductionDb), [false]);
    });

    it("refuses when the ledger already holds unknown-cost events in the batch", async () => {
      const sc = scenario("run-ledger-unknown");
      insertAssistant(sc.fx, { content: "원장 미상 본문" });
      insertLedger(sc.fx, "adult-off-batch/run-ledger-unknown/9", {
        usd: null,
        source: "unavailable",
        status: "completed_without_exact_cost",
      });
      const mock = mockClassifier(sc);
      await assert.rejects(
        () => run(sc, mock),
        (error: unknown) => error instanceof AdultOffBatchRunRefusedError && error.code === "ledger_unknown_cost"
      );
      assert.equal(mock.calls.length, 0);
    });

    it("falls back to the ledger floor when the state file is missing", async () => {
      const capKrw = (2 * KRW_PER_CALL + reserveFor("원장 본문 0") - 0.01).toFixed(4);
      const sc = scenario("run-ledger-only", capKrw);
      for (let i = 0; i < 3; i += 1) insertAssistant(sc.fx, { content: `원장 본문 ${i}` });
      for (let i = 1; i <= 2; i += 1) {
        insertLedger(sc.fx, `adult-off-batch/run-ledger-only/${i}`, { usd: USD_PER_CALL });
      }
      const mock = mockClassifier(sc);
      const report = await run(sc, mock);
      assert.equal(report.stopReason, "cap_reached");
      assert.equal(mock.calls.length, 0);
      assert.ok(Math.abs(report.budget.settledKrwAtStart - 2 * KRW_PER_CALL) < 1e-9);
    });

    it("counts ledger rows of every run id toward the one batch budget and never reuses a call number", async () => {
      const capKrw = (3 * KRW_PER_CALL + reserveFor("접두사 본문") + 0.01).toFixed(4);
      const sc = scenario("run-pre", capKrw);
      insertAssistant(sc.fx, { content: "접두사 본문" });
      insertLedger(sc.fx, "adult-off-batch/run-other-a/7", { usd: USD_PER_CALL });
      insertLedger(sc.fx, "adult-off-batch/run-other-b/12", { usd: USD_PER_CALL });
      insertLedger(sc.fx, "adult-off-batch/run-pre_/3", { usd: USD_PER_CALL });
      insertLedger(sc.fx, "unrelated/adult-off-batch/1", { usd: 5 });
      const mock = mockClassifier(sc);
      const report = await run(sc, mock);
      assert.equal(report.stopReason, "completed");
      assert.equal(mock.calls.length, 1);
      assert.ok(Math.abs(report.budget.settledKrwAtStart - 3 * KRW_PER_CALL) < 1e-9);
      assert.equal(mock.calls[0]!.requestId, "adult-off-batch/run-pre/13");

      const full = scenario("run-pre-full", (3 * KRW_PER_CALL + 0.2).toFixed(4));
      insertAssistant(full.fx, { content: "접두사 본문" });
      for (const [index, other] of ["run-other-a", "run-other-b", "run-other-c"].entries()) {
        insertLedger(full.fx, `adult-off-batch/${other}/${index + 1}`, { usd: USD_PER_CALL });
      }
      const blocked = mockClassifier(full);
      const blockedReport = await run(full, blocked);
      assert.equal(blockedReport.stopReason, "cap_reached");
      assert.equal(blocked.calls.length, 0);
    });

    it("keeps the same budget state when the batch moves between an isolated copy and another database", async () => {
      const capKrw = (KRW_PER_CALL + reserveFor("이동 본문 0") + 0.01).toFixed(4);
      const first = scenario("run-moving-a", capKrw);
      for (let i = 0; i < 4; i += 1) insertAssistant(first.fx, { content: `이동 본문 ${i}` });
      const r1 = await run(first, mockClassifier(first));
      assert.equal(r1.stopReason, "cap_reached");
      const spent = loadAdultOffBatchState(first.stateDir).settledKrw;

      const second = scenario("run-moving-b", capKrw);
      for (let i = 0; i < 4; i += 1) insertAssistant(second.fx, { content: `이동 본문 ${i}` });
      const secondMock = mockClassifier(second);
      const r2 = await executeAdultOffBatchPaidRun({
        config: parseAdultOffBatchPaidRunConfig(second.env(), second.dbPath, { stateDir: first.stateDir }),
        openDatabase: () => new Database(second.dbPath, { fileMustExist: true }),
        createClassifier: secondMock.createClassifier,
      });
      assert.equal(r2.stopReason, "cap_reached");
      assert.equal(secondMock.calls.length, 0);
      assert.ok(Math.abs(r2.budget.settledKrwAtStart - spent) < 1e-9);
      assert.equal(loadAdultOffBatchState(first.stateDir).paidDatabases.length, 1);
    });

    it("does not carry isolated proofs to production: a production run re-classifies within the remaining shared budget and loses no production data", async () => {
      const texts = Array.from({ length: 5 }, (_, i) => `운영 반영 본문 ${i}`);
      const capKrw = (3 * KRW_PER_CALL + reserveFor(texts[0]!) + 0.01).toFixed(4);
      const isolated = scenario("run-iso-rehearsal", capKrw);
      for (const text of texts) insertAssistant(isolated.fx, { content: text });

      const prod = scenario("run-iso-prod", capKrw);
      const volume = path.join(prod.dir, "volume");
      fs.mkdirSync(volume);
      const liveDb = path.join(volume, "app.db");
      prod.fx.pragma("wal_checkpoint(TRUNCATE)");
      fs.copyFileSync(prod.dbPath, liveDb);
      const liveFx = new Database(liveDb);
      liveFx.pragma("busy_timeout = 5000");
      openHandles.push(liveFx);
      const prodLive: Scenario = { ...prod, dbPath: liveDb, fx: liveFx };
      for (const text of texts) insertAssistant(liveFx, { content: text });
      const newerLiveId = insertAssistant(liveFx, { content: "운영에만 있는 새 본문" });
      const contentBefore = JSON.stringify(
        liveFx.prepare("SELECT id, content, alternates, active_variant FROM messages ORDER BY id").all()
      );

      const isolatedMock = mockClassifier(isolated);
      const r1 = await run(isolated, isolatedMock);
      assert.equal(r1.stopReason, "cap_reached");
      assert.equal(isolatedMock.calls.length, 4);
      const isolatedBytes = sha256File(isolated.dbPath);

      const prodMock = mockClassifier(prodLive);
      const r2 = await executeAdultOffBatchPaidRun({
        config: parseAdultOffBatchPaidRunConfig(
          {
            ...prod.env(),
            ADULT_OFF_BATCH_ALLOW_ISOLATED_PAID: undefined,
            ADULT_OFF_BATCH_ALLOW_PROD_WRITE: "1",
            ADULT_OFF_BATCH_CAP_KRW: capKrw,
            RAILWAY_VOLUME_MOUNT_PATH: volume,
          },
          liveDb,
          { stateDir: isolated.stateDir }
        ),
        openDatabase: () => new Database(liveDb, { fileMustExist: true }),
        createClassifier: prodMock.createClassifier,
      });
      assert.equal(r2.database.liveProductionDb, true);
      assert.ok(Math.abs(r2.budget.settledKrwAtStart - 4 * KRW_PER_CALL) < 1e-9);
      assert.equal(r2.stopReason, "cap_reached");
      assert.equal(prodMock.calls.length, 0, "the shared cap, not the isolated proofs, decides what production may still pay for");
      assert.equal(usageOf(liveFx, newerLiveId).adultOffGuard, undefined);
      assert.equal(
        JSON.stringify(
          liveFx.prepare("SELECT id, content, alternates, active_variant FROM messages ORDER BY id").all()
        ),
        contentBefore
      );
      assert.equal(sha256File(isolated.dbPath), isolatedBytes, "production run never touches the isolated copy");
      const rows = loadAssistantRowsForAdultOffInspection(liveFx);
      assert.equal(
        rows.filter((row) => adultOffStoredTextDisposition(JSON.parse(row.usage!), row.content) === "approved").length,
        0,
        "isolated proofs were not copied into production"
      );
      assert.deepEqual(
        loadAdultOffBatchState(isolated.stateDir).paidDatabases.map((entry) => entry.liveProductionDb),
        [false]
      );
    });
  });

  describe("execute: auxiliary surfaces end to end", () => {
    it("commits status meta, replies and widgets from fingerprints taken before the paid calls", async () => {
      const sc = scenario("run-aux");
      const replies = [
        { kind: "natural", text: "첫 번째 추천 답장입니다. 지금 장면의 분위기를 유지하면서 자연스럽게 이어갑니다." },
        { kind: "twist", text: "두 번째 추천 답장입니다. 예상 밖의 각도로 반응하되 개연성은 지킵니다." },
        { kind: "banter", text: "세 번째 추천 답장입니다. 페르소나 말투로 가볍게 장난치는 반응입니다." },
      ];
      const repliesRaw = {
        items: replies,
        extractedAt: "2026-01-01T00:00:00.000Z",
        source: "post-turn-shared",
        generationSequence: 0,
        generationRequestId: "req-aux-run",
        futureField: { keep: [1, 2] },
      };
      const metaRaw = {
        meta: { location: "비 오는 골목" },
        extractedAt: "",
        source: "background-deepseek",
        generationSequence: 0,
        generationRequestId: "req-aux-run",
        diagnostics: { keep: true },
      };
      const id = insertAssistant(sc.fx, {
        content: "보조 표면이 있는 본문",
        requestId: "req-aux-run",
        replies: repliesRaw,
        statusMeta: metaRaw,
        widgetJson: JSON.stringify({ character: { location: "교실 복도" }, user: null }),
      });
      const mock = mockClassifier(sc);
      const report = await run(sc, mock);
      assert.equal(report.stopReason, "completed");
      assert.equal(report.body.written, 1);
      assert.equal(report.aux.written, 3);
      assert.equal(report.aux.fingerprintMissing, 0);
      assert.equal(mock.calls.length, 1 + 3 + 1 + 1);
      const row = sc.fx
        .prepare(
          "SELECT usage, status_meta, suggested_replies_json, status_widget_values_json FROM messages WHERE id=?"
        )
        .get(id) as Record<string, string>;
      const storedReplies = JSON.parse(row.suggested_replies_json!) as Record<string, unknown>;
      assert.deepEqual(storedReplies.futureField, { keep: [1, 2] });
      assert.equal(
        (storedReplies.adultOffGuard as { policyVersion: number }).policyVersion,
        ADULT_OFF_GUARD_POLICY_VERSION
      );
      assert.deepEqual((JSON.parse(row.status_meta!) as { diagnostics: unknown }).diagnostics, { keep: true });
      assert.equal(row.status_widget_values_json, JSON.stringify({ character: { location: "교실 복도" }, user: null }));
      const after = surveyAdultOffAuxSurfaces(loadAssistantRowsForAdultOffInspection(sc.fx));
      assert.equal(after.auxUnreviewedVisibleTextCount, 0);
      assert.equal(
        adultOffStoredTextDisposition(JSON.parse(row.usage!), "교실 복도"),
        "approved"
      );
      assert.equal(adultOffApprovedTextHash("교실 복도").length, 64);
    });

    it("does not stamp an aux record whose generation changed during the paid calls", async () => {
      const sc = scenario("run-aux-stale");
      const metaRaw = {
        meta: { location: "소나기 거리" },
        extractedAt: "",
        source: "background-deepseek",
        generationSequence: 0,
        generationRequestId: "req-aux-stale",
      };
      const id = insertAssistant(sc.fx, {
        content: "재생성될 본문",
        requestId: "req-aux-stale",
        alternates: [{ content: "재생성될 본문", model: "gemini", usage: { cost: 1 }, created_at: "" }],
        statusMeta: metaRaw,
      });
      let mutated = false;
      const mock = mockClassifier(sc, {
        onCall: () => {
          if (mutated) return;
          mutated = true;
          sc.fx
            .prepare("UPDATE messages SET alternates=?, active_variant=1, content='새 본문' WHERE id=?")
            .run(
              JSON.stringify([
                { content: "재생성될 본문", model: "gemini", usage: { cost: 1 }, created_at: "" },
                { content: "새 본문", model: "gemini", usage: { cost: 1 }, created_at: "" },
              ]),
              id
            );
        },
      });
      const report = await run(sc, mock);
      assert.equal(report.aux.written, 0);
      assert.ok(report.aux.skippedStale >= 1);
      const stored = sc.fx.prepare("SELECT status_meta FROM messages WHERE id=?").get(id) as { status_meta: string };
      assert.equal(stored.status_meta.includes("adultOffGuard"), false);
    });
  });

  describe("script subprocess (real entry point, mock-free boundary)", () => {
    const guardDir = () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "c3d-guard-"));
      const preload = path.join(dir, "fetch-guard.mjs");
      fs.writeFileSync(
        preload,
        `import fs from "node:fs";
import http from "node:http";
import https from "node:https";
const log = process.env.FETCH_GUARD_LOG;
const record = (kind) => fs.appendFileSync(log, kind + "\\n");
globalThis.fetch = async (input) => { record("fetch " + String((input && input.url) || input)); throw new Error("blocked by test fetch guard"); };
http.request = () => { record("http"); throw new Error("blocked by test http guard"); };
https.request = () => { record("https"); throw new Error("blocked by test https guard"); };
`
      );
      return { dir, preload, log: path.join(dir, "network.log") };
    };

    type Result = { status: number | null; stdout: string; stderr: string };

    function runScript(
      env: Record<string, string | undefined>,
      guard: ReturnType<typeof guardDir>,
      dataDir: string
    ): Promise<Result> {
      return new Promise((resolve) => {
        const child = spawn(
          process.execPath,
          [
            "--conditions=react-server",
            "--import",
            "tsx",
            "--import",
            guard.preload,
            path.join(REPO_ROOT, "scripts/adult-off-batch-paid-run.ts"),
          ],
          {
            cwd: REPO_ROOT,
            env: {
              PATH: process.env.PATH ?? "",
              HOME: process.env.HOME ?? "",
              DATA_DIR: dataDir,
              FETCH_GUARD_LOG: guard.log,
              ...(env as Record<string, string>),
            },
          }
        );
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
        child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
        child.on("close", (status) => resolve({ status, stdout, stderr }));
      });
    }

    function ledgerRowCount(file: string): number {
      const db = new Database(file, { readonly: true });
      try {
        return (db.prepare("SELECT COUNT(*) AS c FROM api_cost_ledger").get() as { c: number }).c;
      } finally {
        db.close();
      }
    }

    function dataDirFor(sc: Scenario): string {
      const dataDir = path.join(sc.dir, "data");
      fs.mkdirSync(dataDir, { recursive: true });
      fs.copyFileSync(sc.dbPath, path.join(dataDir, "app.db"));
      return dataDir;
    }

    it("runs PLAN_ONLY for real: valid report, no database change, no network", async () => {
      const sc = scenario();
      insertAssistant(sc.fx, { content: "스크립트 계획 본문" });
      sc.fx.pragma("wal_checkpoint(TRUNCATE)");
      sc.fx.close();
      const dataDir = dataDirFor(sc);
      const dbFile = path.join(dataDir, "app.db");
      const before = sha256File(dbFile);
      const guard = guardDir();
      const result = await runScript({}, guard, dataDir);
      assert.equal(result.status, 0, result.stderr);
      const report = JSON.parse(result.stdout) as { status: string; targets: { needsClassification: number } };
      assert.equal(report.status, "plan_only_ok");
      assert.equal(report.targets.needsClassification, 1);
      assert.equal(sha256File(dbFile), before);
      assert.equal(fs.existsSync(guard.log), false);
      assert.equal(result.stdout.includes("스크립트 계획 본문"), false);
      fs.rmSync(guard.dir, { recursive: true, force: true });
    });

    it("blocks bad mode, missing flags and invalid numbers before touching the database or the network", async () => {
      const sc = scenario();
      insertAssistant(sc.fx, { content: "스크립트 차단 본문" });
      sc.fx.pragma("wal_checkpoint(TRUNCATE)");
      sc.fx.close();
      const dataDir = dataDirFor(sc);
      const dbFile = path.join(dataDir, "app.db");
      const before = sha256File(dbFile);
      const ledgerBefore = ledgerRowCount(dbFile);
      const stateDir = path.join(sc.dir, "subprocess-state");
      const canonicalStateDir = defaultAdultOffBatchStateDir();
      const canonicalExisted = fs.existsSync(canonicalStateDir);
      const valid = {
        ADULT_OFF_BATCH_MODE: "execute",
        ADULT_OFF_BATCH_RUN_ID: "run-subproc",
        ADULT_OFF_BATCH_CAP_KRW: "10",
        ADULT_OFF_BATCH_APPROVE_PAID: "1",
        CHEAPER_INFERENCE_API_KEY: "dummy-not-a-real-key",
      } as Record<string, string | undefined>;
      const cases: Array<[string, Record<string, string | undefined>, string]> = [
        ["mode Execute", { ADULT_OFF_BATCH_MODE: "Execute" }, "invalid_mode"],
        ["mode paid", { ADULT_OFF_BATCH_MODE: "paid" }, "invalid_mode"],
        ["mode blank", { ADULT_OFF_BATCH_MODE: "" }, "invalid_mode"],
        ["no run id", { ADULT_OFF_BATCH_RUN_ID: undefined }, "missing_run_id"],
        ["no cap", { ADULT_OFF_BATCH_CAP_KRW: undefined }, "missing_adult_off_batch_cap_krw"],
        ["no approval", { ADULT_OFF_BATCH_APPROVE_PAID: undefined }, "paid_not_approved"],
        ["state dir env", { ADULT_OFF_BATCH_STATE_DIR: stateDir }, "state_dir_not_configurable"],
        ["no isolated ack", {}, "isolated_paid_not_a_completion_path"],
        ["no api key", { CHEAPER_INFERENCE_API_KEY: undefined }, "missing_cheaper_inference_api_key"],
        ["cap NaN", { ADULT_OFF_BATCH_CAP_KRW: "NaN" }, "invalid_adult_off_batch_cap_krw"],
        ["cap Infinity", { ADULT_OFF_BATCH_CAP_KRW: "Infinity" }, "invalid_adult_off_batch_cap_krw"],
        ["cap negative", { ADULT_OFF_BATCH_CAP_KRW: "-5" }, "invalid_adult_off_batch_cap_krw"],
        ["fx bad", { ADULT_OFF_BATCH_USD_KRW: "abc" }, "invalid_adult_off_batch_usd_krw"],
        ["fx zero", { ADULT_OFF_BATCH_USD_KRW: "0" }, "invalid_adult_off_batch_usd_krw"],
        ["reserve negative", { ADULT_OFF_BATCH_RESERVE_KRW_PER_WINDOW: "-1" }, "invalid_adult_off_batch_reserve_krw_per_window"],
        [
          "live volume db without allow",
          { RAILWAY_VOLUME_MOUNT_PATH: dataDir },
          "prod_write_refused",
        ],
      ];
      const guard = guardDir();
      for (let start = 0; start < cases.length; start += 5) {
        const chunk = cases.slice(start, start + 5);
        const results = await Promise.all(
          chunk.map(([, overrides]) => {
            const env: Record<string, string | undefined> = { ...valid, ...overrides };
            for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
            return runScript(env, guard, dataDir);
          })
        );
        results.forEach((result, index) => {
          const [name, , code] = chunk[index]!;
          assert.equal(result.status, 2, `${name}: ${result.stderr}`);
          assert.equal(result.stdout, "", name);
          assert.equal(JSON.parse(result.stderr.trim().split("\n").at(-1)!).code, code, name);
        });
      }
      assert.equal(sha256File(dbFile), before);
      assert.equal(ledgerRowCount(dbFile), ledgerBefore);
      assert.equal(fs.existsSync(stateDir), false);
      assert.equal(fs.existsSync(canonicalStateDir), canonicalExisted);
      assert.equal(fs.existsSync(guard.log), false);
      fs.rmSync(guard.dir, { recursive: true, force: true });
    });
  });
  describe("real classifier boundary (network blocked)", () => {
    it("makes exactly one provider attempt, then fails closed and halts the batch", async () => {
      const { createAdultOffClassifier } = await import("@/lib/adultOffOutputClassifier");
      const sc = scenario("run-real-path");
      const id = insertAssistant(sc.fx, { content: "실제 분류기 경로 본문" });
      insertAssistant(sc.fx, { content: "실제 분류기 뒤 본문" });
      const attempted: string[] = [];
      const savedFetch = globalThis.fetch;
      const savedKey = process.env.CHEAPER_INFERENCE_API_KEY;
      process.env.CHEAPER_INFERENCE_API_KEY = "dummy-not-a-real-key";
      globalThis.fetch = (async (input: unknown) => {
        attempted.push(String((input as { url?: string } | null)?.url ?? input));
        throw new Error("blocked by test fetch guard");
      }) as typeof fetch;
      let report: AdultOffBatchExecuteReport;
      try {
        report = await executeAdultOffBatchPaidRun({
          config: sc.config(),
          openDatabase: () => new Database(sc.dbPath, { fileMustExist: true }),
          createClassifier: createAdultOffClassifier,
        });
      } finally {
        globalThis.fetch = savedFetch;
        if (savedKey === undefined) delete process.env.CHEAPER_INFERENCE_API_KEY;
        else process.env.CHEAPER_INFERENCE_API_KEY = savedKey;
      }
      assert.equal(report.status, "execute_stopped");
      assert.ok(report.stopReason === "halted_unknown_cost" || report.stopReason === "halted_classifier_error");
      assert.equal(attempted.filter((url) => url.includes("/chat/completions")).length, 1, attempted.join("|"));
      assert.deepEqual(
        attempted.filter((url) => !url.includes("/chat/completions") && !url.includes("open.er-api.com")),
        []
      );
      assert.ok(loadAdultOffBatchState(sc.stateDir).halted);
      assert.equal(usageOf(sc.fx, id).adultOffGuard, undefined);
    });
  });
});

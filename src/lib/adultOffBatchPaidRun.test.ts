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
  ADULT_OFF_BATCH_CLASSIFIER_TIMEOUT_MS,
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
  buildAdultOffBatchGenerationRequestId,
  copySqliteDatabaseForRehearsal,
  loadAssistantRowsForAdultOffInspection,
  sumAdultOffBatchModerationSpend,
  surveyAdultOffAuxSurfaces,
} from "@/lib/adultOffBatchInspectionPrep";
import { ensureProviderCostLedgerSchema } from "@/lib/providerCostLedger";
import { resolveOpenRouterModelRates, type OpenRouterModelRates } from "@/lib/openRouterModelPricing";

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

/** 부모 프로세스의 공급자 키 등을 물려주지 않는 최소 자식 환경. */
function childEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...extra } as unknown as NodeJS.ProcessEnv;
}

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
        ADULT_OFF_BATCH_USD_KRW: "1450",
        ADULT_OFF_BATCH_APPROVED_RATES: "0.07/0.35",
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
    options: {
      usd: number | null;
      source?: string;
      status?: string;
      messageId?: number | null;
      eventKey?: string;
      providerRequestId?: string | null;
    }
  ): void {
    fx.prepare(
      `INSERT INTO api_cost_ledger (
         event_key, chat_id, assistant_message_id, generation_sequence, family, funding_class,
         execution_phase, attempt_ordinal, requested_provider, requested_model, provider, model,
         request_kind, generation_request_id, provider_request_id, event_status, exchange_rate_krw_per_usd,
         cost_krw, estimated, actual_cost_usd, actual_cost_source, created_at
       ) VALUES (?, 1, ?, 0, 'background', 'platform_funded', 'sync_post_turn', 1, 'cheaperinference',
         'gpt-6-luna', 'cheaperinference', 'gpt-6-luna', 'adult-off-output-moderation', ?, ?, ?, 1450,
         0, 0, ?, ?, datetime('now'))`
    ).run(
      options.eventKey ?? randomUUID(),
      options.messageId ?? null,
      requestId,
      options.providerRequestId ?? null,
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
      const unmounted = { ...sc.env(), RAILWAY_VOLUME_MOUNT_PATH: volume, ADULT_OFF_BATCH_ALLOW_PROD_WRITE: "1" };
      assert.throws(
        () => parseAdultOffBatchPaidRunConfig(unmounted, symlink),
        (error: unknown) =>
          error instanceof AdultOffBatchConfigError && error.code === "persistent_state_volume_not_confirmed"
      );
      const allowed = parseAdultOffBatchPaidRunConfig(unmounted, symlink, { isMountedVolume: () => true });
      assert.equal(allowed.liveProductionDb, true);
      assert.equal(allowed.statePersistent, true);
      assert.equal(allowed.stateDir, path.join(fs.realpathSync(volume), "private", "adult-off-batch"));
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
          unresolved: [],
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
      assert.deepEqual(afterFirst.unresolved[0]?.requestIds, [requestId]);
      assert.equal(afterFirst.unresolved[0]?.messageId, id);
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
      assert.deepEqual(loadAdultOffBatchState(sc.stateDir).unresolved, []);
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
          unresolved: [],
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
    ADULT_OFF_BATCH_USD_KRW: "1450",
    ADULT_OFF_BATCH_APPROVED_RATES: "0.07/0.35",
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
        { cwd: REPO_ROOT, env: childEnv({}), encoding: "utf8" }
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
      assert.equal(after.unresolved[0]?.messageId, id);
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
          unresolved: [],
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
      const stopped = loadAdultOffBatchState(sc.stateDir);
      assert.equal(stopped.halted, null, "an unapproved STOP leaves the state recoverable instead of poisoning it");
      assert.equal(stopped.inFlight?.openRequestId, requestId);
      assert.deepEqual(stopped.unresolved, []);
      await assert.rejects(
        () => run(sc, mock, { ADULT_OFF_BATCH_ACK_UNRESOLVED_REQUEST_ID: requestId }),
        (error: unknown) =>
          error instanceof AdultOffBatchRunRefusedError && error.code === "interrupted_call_cost_unknown"
      );
      assert.equal(mock.calls.length, 0, "an ACK never turns an unknown-cost call into permission to pay again");
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
      assert.deepEqual(state.unresolved, []);
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
      const onVolume = (sc: Scenario, dbPath: string, overrides: Record<string, string | undefined> = {}) =>
        parseAdultOffBatchPaidRunConfig(
          { ...sc.env(overrides), RAILWAY_VOLUME_MOUNT_PATH: volume, ADULT_OFF_BATCH_CAP_KRW: capKrw },
          dbPath,
          { isMountedVolume: () => true }
        );
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
      const isolatedConfig = onVolume(isolated, isolated.dbPath);
      const r1 = await executeAdultOffBatchPaidRun({
        config: isolatedConfig,
        openDatabase: () => new Database(isolated.dbPath, { fileMustExist: true }),
        createClassifier: isolatedMock.createClassifier,
      });
      assert.equal(r1.stopReason, "cap_reached");
      assert.equal(isolatedMock.calls.length, 4);
      const isolatedBytes = sha256File(isolated.dbPath);

      const prodMock = mockClassifier(prodLive);
      const r2 = await executeAdultOffBatchPaidRun({
        config: onVolume(prod, liveDb, {
          ADULT_OFF_BATCH_ALLOW_ISOLATED_PAID: undefined,
          ADULT_OFF_BATCH_ALLOW_PROD_WRITE: "1",
        }),
        openDatabase: () => new Database(liveDb, { fileMustExist: true }),
        createClassifier: prodMock.createClassifier,
      });
      assert.equal(r2.database.liveProductionDb, true);
      assert.equal(isolatedConfig.stateDir, path.join(fs.realpathSync(volume), "private", "adult-off-batch"));
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
        loadAdultOffBatchState(isolatedConfig.stateDir).paidDatabases.map((entry) => entry.liveProductionDb),
        [false]
      );
    });
  });

  describe("persistent state placement (synthetic production volume)", () => {
    const mounted = () => true;
    const unmounted = () => false;
    const volumeConfig = (
      sc: Scenario,
      volume: string,
      overrides: Record<string, string | undefined> = {},
      isMountedVolume: (dir: string) => boolean = mounted
    ) =>
      parseAdultOffBatchPaidRunConfig(
        { ...sc.env(overrides), RAILWAY_VOLUME_MOUNT_PATH: volume },
        sc.dbPath,
        { isMountedVolume }
      );
    const runOn = (
      sc: Scenario,
      config: AdultOffBatchPaidRunConfig,
      classifier: ReturnType<typeof mockClassifier>,
      resolveRates?: (model: string) => OpenRouterModelRates
    ) =>
      executeAdultOffBatchPaidRun({
        config,
        openDatabase: () => new Database(sc.dbPath, { fileMustExist: true }),
        createClassifier: classifier.createClassifier,
        resolveRates,
      });
    const refusedWith = (code: string) => (error: unknown) =>
      error instanceof AdultOffBatchRunRefusedError && error.code === code;
    const configErrorWith = (code: string) => (error: unknown) =>
      error instanceof AdultOffBatchConfigError && error.code === code;

    function liveVolumeScenario(runId: string, cap = "1500") {
      const sc = scenario(runId, cap);
      const volume = path.join(sc.dir, "data");
      fs.mkdirSync(volume);
      const liveDb = path.join(volume, "app.db");
      sc.fx.pragma("wal_checkpoint(TRUNCATE)");
      fs.copyFileSync(sc.dbPath, liveDb);
      const fx = new Database(liveDb);
      fx.pragma("busy_timeout = 5000");
      openHandles.push(fx);
      const live: Scenario = { ...sc, dbPath: liveDb, fx };
      return { sc: live, volume };
    }

    it("places the one batch state under <volume>/private/adult-off-batch with owner-only permissions", () => {
      const { sc, volume } = liveVolumeScenario("run-volume-shape");
      const config = volumeConfig(sc, volume, { ADULT_OFF_BATCH_ALLOW_PROD_WRITE: "1" });
      const expected = path.join(fs.realpathSync(volume), "private", "adult-off-batch");
      assert.equal(config.liveProductionDb, true);
      assert.equal(config.statePersistent, true);
      assert.equal(config.stateDir, expected);
      assert.equal(config.stateVolumeRoot, fs.realpathSync(volume));
      assert.equal(
        volumeConfig(sc, volume, { ADULT_OFF_BATCH_ALLOW_PROD_WRITE: "1" }).stateDir,
        config.stateDir,
        "same fixed path on every start"
      );
    });

    it("refuses a live production execute when no mounted persistent volume is confirmed", () => {
      const { sc, volume } = liveVolumeScenario("run-volume-unmounted");
      assert.throws(
        () => volumeConfig(sc, volume, { ADULT_OFF_BATCH_ALLOW_PROD_WRITE: "1" }, unmounted),
        configErrorWith("persistent_state_volume_not_confirmed")
      );
      assert.equal(fs.existsSync(path.join(volume, "private")), false, "nothing is created before the refusal");
      const plan = volumeConfig(sc, volume, { ADULT_OFF_BATCH_MODE: "plan" }, unmounted);
      assert.equal(plan.statePersistent, false);
    });

    it("keeps isolated rehearsals on the home fallback and moves them to the volume only when one is mounted", () => {
      const sc = scenario("run-isolated-placement");
      const home = parseAdultOffBatchPaidRunConfig(sc.env(), sc.dbPath, { isMountedVolume: unmounted });
      assert.equal(home.stateDir, defaultAdultOffBatchStateDir());
      assert.equal(home.statePersistent, false);
      const volume = path.join(sc.dir, "data");
      fs.mkdirSync(volume);
      const onVolume = parseAdultOffBatchPaidRunConfig(
        { ...sc.env(), RAILWAY_VOLUME_MOUNT_PATH: volume },
        sc.dbPath,
        { isMountedVolume: mounted }
      );
      assert.equal(onVolume.stateDir, path.join(fs.realpathSync(volume), "private", "adult-off-batch"));
    });

    it("rejects an unsafe state directory: symlink, escape outside the volume, foreign permissions", async () => {
      const { sc, volume } = liveVolumeScenario("run-volume-unsafe");
      const outside = path.join(sc.dir, "outside");
      fs.mkdirSync(outside);
      const real = fs.realpathSync(volume);
      const stateDir = path.join(real, "private", "adult-off-batch");

      fs.mkdirSync(path.join(real, "private"));
      fs.symlinkSync(outside, stateDir);
      const mock = mockClassifier(sc);
      const config = volumeConfig(sc, volume, { ADULT_OFF_BATCH_ALLOW_PROD_WRITE: "1" });
      await assert.rejects(() => runOn(sc, config, mock), refusedWith("state_dir_unsafe"));
      fs.unlinkSync(stateDir);
      fs.rmSync(path.join(real, "private"), { recursive: true });

      fs.symlinkSync(outside, path.join(real, "private"));
      await assert.rejects(() => runOn(sc, config, mock), refusedWith("state_dir_unsafe"));
      fs.unlinkSync(path.join(real, "private"));
      assert.equal(mock.calls.length, 0);
      assert.deepEqual(fs.readdirSync(outside), [], "nothing was written outside the volume");

      fs.mkdirSync(stateDir, { recursive: true, mode: 0o777 });
      fs.chmodSync(stateDir, 0o777);
      await runOn(sc, config, mockClassifier(sc));
      assert.equal(fs.statSync(stateDir).mode & 0o077, 0, "group/world access is removed");
    });

    it("recovers the single budget and state after a redeploy that wipes the home directory", async () => {
      const capKrw = (KRW_PER_CALL + reserveFor("재배포 본문 0") + 0.01).toFixed(4);
      const { sc, volume } = liveVolumeScenario("run-redeploy-a", capKrw);
      for (let i = 0; i < 4; i += 1) insertAssistant(sc.fx, { content: `재배포 본문 ${i}` });
      const savedHome = process.env.HOME;
      const liveEnv = { ADULT_OFF_BATCH_ALLOW_PROD_WRITE: "1", ADULT_OFF_BATCH_CAP_KRW: capKrw };
      try {
        const first = mockClassifier(sc);
        const r1 = await runOn(sc, volumeConfig(sc, volume, liveEnv), first);
        assert.equal(r1.stopReason, "cap_reached");
        assert.equal(first.calls.length, 2);
        const spent = loadAdultOffBatchState(volumeConfig(sc, volume, liveEnv).stateDir!).settledKrw;
        assert.ok(Math.abs(spent - 2 * KRW_PER_CALL) < 1e-9);

        process.env.HOME = path.join(sc.dir, "fresh-container-home");
        const redeployed = volumeConfig(sc, volume, { ...liveEnv, ADULT_OFF_BATCH_RUN_ID: "run-redeploy-b" });
        assert.equal(redeployed.stateDir, volumeConfig(sc, volume, liveEnv).stateDir);
        const second = mockClassifier(sc);
        const r2 = await runOn(sc, redeployed, second);
        assert.equal(second.calls.length, 0, "the cumulative budget survives the redeploy");
        assert.equal(r2.stopReason, "cap_reached");
        assert.ok(Math.abs(r2.budget.settledKrwAtStart - spent) < 1e-9);
        assert.equal(fs.existsSync(path.join(process.env.HOME, ".hav-adult-off-batch")), false);

        const bypass = mockClassifier(sc);
        await assert.rejects(
          () => runOn(sc, volumeConfig(sc, volume, { ...liveEnv, ADULT_OFF_BATCH_CAP_KRW: "50" }), bypass),
          refusedWith("cap_increase_not_approved")
        );
        assert.equal(bypass.calls.length, 0);
      } finally {
        if (savedHome === undefined) delete process.env.HOME;
        else process.env.HOME = savedHome;
      }
    });

    it("keeps the in-flight unresolved STOP across a redeploy and never re-classifies automatically", async () => {
      const { sc, volume } = liveVolumeScenario("run-redeploy-unresolved", "50");
      const id = insertAssistant(sc.fx, { content: "재배포 뒤 판정 미확정 본문" });
      const liveEnv = { ADULT_OFF_BATCH_ALLOW_PROD_WRITE: "1", ADULT_OFF_BATCH_CAP_KRW: "50" };
      const stateDir = volumeConfig(sc, volume, liveEnv).stateDir!;
      const requestId = "adult-off-batch/run-before-redeploy/1";
      fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(
        path.join(stateDir, "batch.state.json"),
        JSON.stringify({
          version: 2,
          settledKrw: 0,
          maxObservedWindowKrw: 0,
          callCount: 0,
          nextCallSeq: 2,
          approvedCapKrw: 50,
          fxKrwPerUsd: 1450,
          providerRates: { inputUsdPerM: 0.07, outputUsdPerM: 0.35, cacheWriteMultiplier: 1.25 },
          runIds: ["run-before-redeploy"],
          paidDatabases: [],
          inFlight: { messageId: id, surface: "body", requestIds: [requestId], openRequestId: requestId, reservedKrw: 0.75 },
          unresolved: [],
          halted: null,
          updatedAt: "",
        })
      );
      insertLedger(sc.fx, requestId, { usd: 0.0003, messageId: id });
      const savedHome = process.env.HOME;
      try {
        process.env.HOME = path.join(sc.dir, "fresh-container-home-2");
        for (const runId of ["run-after-redeploy-1", "run-after-redeploy-2"]) {
          const mock = mockClassifier(sc);
          await assert.rejects(
            () => runOn(sc, volumeConfig(sc, volume, { ...liveEnv, ADULT_OFF_BATCH_RUN_ID: runId }), mock),
            refusedWith("interrupted_call_unresolved")
          );
          assert.equal(mock.calls.length, 0);
        }
        assert.equal(usageOf(sc.fx, id).adultOffGuard, undefined);
        const state = loadAdultOffBatchState(stateDir);
        assert.deepEqual(state.unresolved[0]?.requestIds, [requestId]);
        assert.ok(Math.abs(state.settledKrw - KRW_PER_CALL) < 1e-9, "the interrupted call is counted exactly once");
      } finally {
        if (savedHome === undefined) delete process.env.HOME;
        else process.env.HOME = savedHome;
      }
    });
  });

  describe("pinned exchange rate and provider rates", () => {
    const refusedWith = (code: string) => (error: unknown) =>
      error instanceof AdultOffBatchRunRefusedError && error.code === code;
    const configErrorWith = (code: string) => (error: unknown) =>
      error instanceof AdultOffBatchConfigError && error.code === code;
    const changedRates = (rates: Partial<OpenRouterModelRates>) => (model: string) => ({
      ...resolveOpenRouterModelRates(model),
      ...rates,
    });

    it("requires an explicit conservative USD/KRW inside the allowed band for execute", () => {
      const sc = scenario("run-fx-config");
      assert.throws(() => sc.config({ ADULT_OFF_BATCH_USD_KRW: undefined }), configErrorWith("missing_adult_off_batch_usd_krw"));
      for (const bad of ["0.0001", "1", "1299.99", "3000.01", "1e6"]) {
        assert.throws(
          () => sc.config({ ADULT_OFF_BATCH_USD_KRW: bad }),
          (error: unknown) =>
            error instanceof AdultOffBatchConfigError &&
            (error.code === "usd_krw_out_of_range" || error.code === "invalid_adult_off_batch_usd_krw"),
          bad
        );
      }
      assert.equal(sc.config({ ADULT_OFF_BATCH_USD_KRW: "1300" }).fxKrwPerUsd, 1300);
      assert.equal(sc.config({ ADULT_OFF_BATCH_USD_KRW: "3000" }).fxKrwPerUsd, 3000);
      assert.throws(
        () => parseAdultOffBatchPaidRunConfig({ ADULT_OFF_BATCH_MODE: "plan", ADULT_OFF_BATCH_USD_KRW: "2" }, sc.dbPath),
        configErrorWith("usd_krw_out_of_range"),
        "PLAN_ONLY shows the same bound so a bad value is caught before execute"
      );
    });

    it("pins the first execute's USD/KRW and refuses any other rate on resume, so spend cannot be lowered", async () => {
      const capKrw = (KRW_PER_CALL + reserveFor("환율 본문 0") + 0.01).toFixed(4);
      const sc = scenario("run-fx-pin", capKrw);
      for (let i = 0; i < 3; i += 1) insertAssistant(sc.fx, { content: `환율 본문 ${i}` });
      const first = mockClassifier(sc);
      await run(sc, first);
      assert.equal(first.calls.length, 2);
      const before = loadAdultOffBatchState(sc.stateDir);
      assert.equal(before.fxKrwPerUsd, 1450);

      for (const lower of ["1300", "1400", "1449.99", "1451", "2500"]) {
        const refused = mockClassifier(sc);
        await assert.rejects(
          () => run(sc, refused, { ADULT_OFF_BATCH_USD_KRW: lower }),
          refusedWith("usd_krw_changed"),
          lower
        );
        assert.equal(refused.calls.length, 0);
      }
      const after = loadAdultOffBatchState(sc.stateDir);
      assert.equal(after.settledKrw, before.settledKrw);
      assert.equal(after.fxKrwPerUsd, 1450);
      assert.equal(after.approvedCapKrw, before.approvedCapKrw);
    });

    it("refuses a USD/KRW far below the rate already recorded in the cost ledger", async () => {
      const sc = scenario("run-fx-ledger");
      insertAssistant(sc.fx, { content: "원장 환율 본문" });
      sc.fx.prepare("UPDATE api_cost_ledger SET exchange_rate_krw_per_usd = 1500").run();
      insertLedger(sc.fx, "adult-off-batch/prev/1", { usd: 0.0003 });
      sc.fx.prepare("UPDATE api_cost_ledger SET exchange_rate_krw_per_usd = 1500").run();
      const mock = mockClassifier(sc);
      await assert.rejects(
        () => run(sc, mock, { ADULT_OFF_BATCH_USD_KRW: "1300" }),
        refusedWith("usd_krw_below_ledger_rate")
      );
      assert.equal(mock.calls.length, 0);
      assert.equal(loadAdultOffBatchState(sc.stateDir).fxKrwPerUsd, null, "a refused run pins nothing");
      const ok = await run(sc, mockClassifier(sc), { ADULT_OFF_BATCH_USD_KRW: "1500" });
      assert.equal(ok.stopReason, "completed");
    });

    it("needs the user's explicit rate approval and refuses a mismatch with the repository rate table", async () => {
      const sc = scenario("run-rates-approval");
      insertAssistant(sc.fx, { content: "단가 승인 본문" });
      assert.throws(
        () => sc.config({ ADULT_OFF_BATCH_APPROVED_RATES: undefined }),
        configErrorWith("missing_approved_rates")
      );
      for (const bad of ["", "0.07", "0.07/", "a/b", "0/0.35", "-1/2", "0.07/0.35/1", "1e-3/2"]) {
        assert.throws(
          () => sc.config({ ADULT_OFF_BATCH_APPROVED_RATES: bad }),
          configErrorWith("invalid_approved_rates"),
          bad
        );
      }
      const mock = mockClassifier(sc);
      for (const mismatch of ["0.01/0.05", "0.07/0.05", "0.7/0.35"]) {
        await assert.rejects(
          () => run(sc, mock, { ADULT_OFF_BATCH_APPROVED_RATES: mismatch }),
          refusedWith("provider_rates_not_approved"),
          mismatch
        );
      }
      assert.equal(mock.calls.length, 0);
      assert.equal(loadAdultOffBatchState(sc.stateDir).providerRates, null);
    });

    it("stops when the provider unit price changes after the batch was approved, even if the new price is approved", async () => {
      const capKrw = (KRW_PER_CALL + reserveFor("단가 본문 0") + 0.01).toFixed(4);
      const sc = scenario("run-rates-change", capKrw);
      for (let i = 0; i < 3; i += 1) insertAssistant(sc.fx, { content: `단가 본문 ${i}` });
      const first = mockClassifier(sc);
      await run(sc, first);
      assert.equal(first.calls.length, 2);
      const pinned = loadAdultOffBatchState(sc.stateDir);
      assert.deepEqual(pinned.providerRates, { inputUsdPerM: 0.07, outputUsdPerM: 0.35, cacheWriteMultiplier: 1.25 });

      const second = mockClassifier(sc);
      await assert.rejects(
        () =>
          executeAdultOffBatchPaidRun({
            config: sc.config({ ADULT_OFF_BATCH_APPROVED_RATES: "0.2/0.9", ADULT_OFF_BATCH_CAP_KRW: "50", ADULT_OFF_BATCH_CAP_RAISE_FROM_KRW: capKrw }),
            openDatabase: () => new Database(sc.dbPath, { fileMustExist: true }),
            createClassifier: second.createClassifier,
            resolveRates: changedRates({ inputUsdPerM: 0.2, outputUsdPerM: 0.9 }),
          }),
        refusedWith("provider_rates_changed")
      );
      assert.equal(second.calls.length, 0);
      assert.deepEqual(loadAdultOffBatchState(sc.stateDir).providerRates, pinned.providerRates);
      assert.equal(loadAdultOffBatchState(sc.stateDir).settledKrw, pinned.settledKrw);
    });

    it("reports in PLAN_ONLY that provider rates must be re-checked and what to approve", () => {
      const sc = scenario("run-plan-rates");
      insertAssistant(sc.fx, { content: "계획 단가 본문" });
      sc.fx.pragma("wal_checkpoint(TRUNCATE)");
      const config = parseAdultOffBatchPaidRunConfig({ ADULT_OFF_BATCH_MODE: "plan" }, sc.dbPath, {
        isMountedVolume: () => false,
      });
      const db = new Database(sc.dbPath, { readonly: true, fileMustExist: true });
      try {
        const report = buildAdultOffBatchPlanReport(db, config);
        assert.equal(report.providerRates.recheckBeforeExecute, true);
        assert.equal(report.providerRates.approveWith, "ADULT_OFF_BATCH_APPROVED_RATES=0.07/0.35");
        assert.match(report.providerRates.source, /NOT consulted/);
        assert.deepEqual(report.usdKrw.allowedRange, [1300, 3000]);
        assert.equal(report.batchState.persistentVolumeConfirmed, false);
        assert.equal(report.batchState.requiredForLiveDatabase, true);
        assert.equal(report.batchState.existing, null);
        assert.equal(JSON.stringify(report).includes("계획 단가"), false);
      } finally {
        db.close();
      }
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
            env: childEnv({
              DATA_DIR: dataDir,
              FETCH_GUARD_LOG: guard.log,
              ...(env as Record<string, string>),
            }),
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
        ADULT_OFF_BATCH_USD_KRW: "1450",
        ADULT_OFF_BATCH_APPROVED_RATES: "0.07/0.35",
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

  describe("unconfirmed call quarantine (#208 recovery)", () => {
    const SEED_RUN_ID = "adult-off-c3-test";
    const TARGET_TEXT = "격리 대상 본문";
    const refusedWith = (code: string) => (error: unknown) =>
      error instanceof AdultOffBatchRunRefusedError && error.code === code;
    const configErrorWith = (code: string) => (error: unknown) =>
      error instanceof AdultOffBatchConfigError && error.code === code;

    type Seed = {
      sc: Scenario;
      config: AdultOffBatchPaidRunConfig;
      stateDir: string;
      runId: string;
      requestId: string;
      eventKey: string;
      targetId: number;
      duplicateId: number;
      protectedIds: number[];
      settledCalls: number;
    };

    const runConfig = (
      sc: Scenario,
      config: AdultOffBatchPaidRunConfig,
      classifier: ReturnType<typeof mockClassifier>
    ): Promise<AdultOffBatchExecuteReport> =>
      executeAdultOffBatchPaidRun({
        config,
        openDatabase: () => new Database(sc.dbPath, { fileMustExist: true }),
        createClassifier: classifier.createClassifier,
      });

    /** 정산이 끝난 호출·증명을 실제 실행기로 만든 뒤, 같은 상태 파일에 "started·비용 미상" 호출 하나를 남긴다. */
    async function seedUnconfirmedCall(
      sc: Scenario,
      options: { config?: AdultOffBatchPaidRunConfig; targetText?: string; reservedKrw?: number } = {}
    ): Promise<Seed> {
      const config = options.config ?? sc.config();
      const stateDir = config.stateDir!;
      const plainIds = [0, 1, 2].map((i) => insertAssistant(sc.fx, { content: `정산 완료 본문 ${i}` }));
      const variantId = insertAssistant(sc.fx, {
        content: "정산 완료 행 본문",
        alternates: [{ content: "정산 완료 variant 본문", model: "gemini", usage: { cost: 1 }, created_at: "" }],
        activeVariant: 0,
      });
      const settled = mockClassifier(sc);
      const first = await runConfig(sc, config, settled);
      assert.equal(first.stopReason, "completed");
      const targetText = options.targetText ?? TARGET_TEXT;
      const targetId = insertAssistant(sc.fx, { content: targetText });
      const duplicateId = insertAssistant(sc.fx, { content: targetText, chatId: 2 });
      const state = loadAdultOffBatchState(stateDir);
      const requestId = buildAdultOffBatchGenerationRequestId(SEED_RUN_ID, state.nextCallSeq);
      const eventKey = randomUUID();
      fs.writeFileSync(
        path.join(stateDir, "batch.state.json"),
        JSON.stringify({
          ...state,
          inFlight: {
            messageId: targetId,
            surface: "body",
            requestIds: [requestId],
            openRequestId: requestId,
            reservedKrw: options.reservedKrw ?? 10,
          },
          nextCallSeq: state.nextCallSeq + 1,
        })
      );
      insertLedger(sc.fx, requestId, {
        usd: null,
        source: "unavailable",
        status: "started",
        messageId: targetId,
        eventKey,
      });
      return {
        sc,
        config,
        stateDir,
        runId: SEED_RUN_ID,
        requestId,
        eventKey,
        targetId,
        duplicateId,
        protectedIds: [...plainIds, variantId],
        settledCalls: settled.calls.length,
      };
    }

    const approvalEnv = (seed: Seed, overrides: Record<string, string> = {}): Record<string, string> => ({
      ADULT_OFF_BATCH_QUARANTINE_RUN_ID: seed.runId,
      ADULT_OFF_BATCH_QUARANTINE_REQUEST_ID: seed.requestId,
      ADULT_OFF_BATCH_QUARANTINE_EVENT_KEY: seed.eventKey,
      ADULT_OFF_BATCH_QUARANTINE_MESSAGE_ID: String(seed.targetId),
      ...overrides,
    });

    const stateBytes = (seed: Seed): string => fs.readFileSync(path.join(seed.stateDir, "batch.state.json"), "utf8");
    const ledgerRow = (seed: Seed, requestId = seed.requestId): string =>
      JSON.stringify(
        seed.sc.fx.prepare("SELECT * FROM api_cost_ledger WHERE generation_request_id = ?").all(requestId)
      );
    const ledgerSettledRows = (seed: Seed): string =>
      JSON.stringify(
        seed.sc.fx
          .prepare("SELECT * FROM api_cost_ledger WHERE generation_request_id != ? ORDER BY id")
          .all(seed.requestId)
      );
    const protectedRows = (seed: Seed): string =>
      JSON.stringify(
        seed.sc.fx
          .prepare(`SELECT * FROM messages WHERE id IN (${seed.protectedIds.join(",")}) ORDER BY id`)
          .all()
      );

    it("fails closed on the old interrupted state until an exact approval exists, and never poisons the state meanwhile", async () => {
      const seed = await seedUnconfirmedCall(scenario(SEED_RUN_ID));
      const before = stateBytes(seed);
      const blocked = mockClassifier(seed.sc);
      await assert.rejects(() => run(seed.sc, blocked), refusedWith("interrupted_call_cost_unknown"));
      await assert.rejects(
        () => run(seed.sc, blocked, { ADULT_OFF_BATCH_ACK_UNRESOLVED_REQUEST_ID: seed.requestId }),
        refusedWith("interrupted_call_cost_unknown")
      );
      assert.equal(blocked.calls.length, 0);
      assert.equal(stateBytes(seed), before, "an unapproved STOP changes nothing");
      assert.equal(loadAdultOffBatchState(seed.stateDir).halted, null);
    });

    it("quarantines exactly the approved call, holds its reserve, never re-calls the text and preserves every settled cost and proof", async () => {
      const seed = await seedUnconfirmedCall(scenario(SEED_RUN_ID));
      const { sc } = seed;
      const otherId = insertAssistant(sc.fx, { content: "격리와 무관한 대기 본문" });
      const pendingBefore = ledgerSettledRows(seed);
      const quarantinedLedgerBefore = ledgerRow(seed);
      const protectedBefore = protectedRows(seed);
      const settledKrwBefore = loadAdultOffBatchState(seed.stateDir).settledKrw;

      const mock = mockClassifier(sc);
      const report = await run(sc, mock, approvalEnv(seed));

      assert.equal(report.stopReason, "quarantine_pending", "a held quarantine is never reported as a finished batch");
      assert.equal(report.status, "execute_stopped");
      assert.deepEqual(
        mock.calls.map((call) => call.text),
        ["격리와 무관한 대기 본문"],
        "only unrelated text is paid for; the quarantined target text is never sent again"
      );
      assert.equal(adultOffStoredTextDisposition(usageOf(sc.fx, otherId), "격리와 무관한 대기 본문"), "approved");
      assert.equal(report.body.quarantinedSkipped, 2, "the same text on another message is skipped too");
      assert.equal(usageOf(sc.fx, seed.targetId).adultOffGuard, undefined);
      assert.equal(usageOf(sc.fx, seed.duplicateId).adultOffGuard, undefined);
      assert.equal(report.quarantines[0]?.requestId, seed.requestId);
      assert.equal(report.quarantines[0]?.reserveKrw, 10, "the existing 10 KRW per-call reserve, not 0");
      assert.equal(report.budget.heldQuarantineReserveKrw, 10);

      const state = loadAdultOffBatchState(seed.stateDir);
      assert.equal(state.halted, null);
      assert.equal(state.inFlight, null);
      assert.deepEqual(state.unresolved[0]?.requestIds, [seed.requestId]);
      assert.equal(state.unresolved[0]?.messageId, seed.targetId);
      assert.equal(state.unresolved[0]?.quarantine?.eventKey, seed.eventKey);
      assert.ok(
        Math.abs(state.settledKrw - settledKrwBefore - KRW_PER_CALL) < 1e-9,
        "settled actual cost grows only by the one real call; the reserve is held separately"
      );
      assert.ok(Math.abs(report.budget.settledKrwAtEnd + report.budget.heldQuarantineReserveKrw - state.settledKrw - 10) < 1e-9);

      assert.equal(ledgerRow(seed), quarantinedLedgerBefore, "the unconfirmed ledger row is left exactly as it was");
      assert.equal(ledgerSettledRows(seed).startsWith(pendingBefore.slice(0, -1)), true, "earlier settled rows are untouched");
      assert.equal(protectedRows(seed), protectedBefore, "settled proofs and isolated variant proofs are untouched");
      for (const id of seed.protectedIds.slice(0, 3)) {
        assert.equal(adultOffStoredTextDisposition(usageOf(sc.fx, id), `정산 완료 본문 ${seed.protectedIds.indexOf(id)}`), "approved");
      }
    });

    it("counts the held reserve against the cap before every call and never bypasses it", async () => {
      const probe = await seedUnconfirmedCall(scenario(SEED_RUN_ID));
      const settledKrw = loadAdultOffBatchState(probe.stateDir).settledKrw;
      const otherText = "예약액 때문에 못 부르는 본문";
      const bound = reserveFor(otherText);

      insertAssistant(probe.sc.fx, { content: otherText });
      const tooTight = (settledKrw + 10 + bound - 0.01).toFixed(4);
      const stopped = mockClassifier(probe.sc);
      const r1 = await run(probe.sc, stopped, approvalEnv(probe, { ADULT_OFF_BATCH_CAP_KRW: tooTight }));
      assert.equal(r1.stopReason, "cap_reached");
      assert.equal(stopped.calls.length, 0, "settled + held reserve + this call's bound exceeds the cap");

      const roomy = await seedUnconfirmedCall(scenario(SEED_RUN_ID));
      insertAssistant(roomy.sc.fx, { content: otherText });
      const fits = (loadAdultOffBatchState(roomy.stateDir).settledKrw + 10 + bound + 0.01).toFixed(4);
      const allowed = mockClassifier(roomy.sc);
      const r2 = await run(roomy.sc, allowed, approvalEnv(roomy, { ADULT_OFF_BATCH_CAP_KRW: fits }));
      assert.equal(allowed.calls.length, 1);
      assert.equal(r2.stopReason, "quarantine_pending");
    });

    it("accepts a reserve only as large as the proven window bound at the account cache-write multiplier", async () => {
      const typical = await seedUnconfirmedCall(scenario(SEED_RUN_ID));
      const r1 = await run(typical.sc, mockClassifier(typical.sc), approvalEnv(typical));
      assert.equal(r1.quarantines[0]?.reserveKrw, 10);
      const rates = resolveOpenRouterModelRates("gpt-6-luna");
      const accountBound = adultOffBatchWindowReserveKrw(TARGET_TEXT, {
        ...PRICING,
        rates: { ...rates, cacheWriteMultiplier: 2.5 },
      });
      assert.ok(accountBound <= 10, `a normal window's account-rate bound ${accountBound} fits in the 10 KRW reserve`);

      const hugeText = "가".repeat(36_000);
      const huge = await seedUnconfirmedCall(scenario(SEED_RUN_ID), { targetText: hugeText, reservedKrw: 0.45 });
      const r2 = await run(huge.sc, mockClassifier(huge.sc), approvalEnv(huge));
      const hugeBound = adultOffBatchWindowReserveKrw(hugeText, {
        ...PRICING,
        rates: { ...rates, cacheWriteMultiplier: 2.5 },
      });
      assert.ok(hugeBound > 10 && hugeBound > 0.45);
      assert.ok(
        (r2.quarantines[0]?.reserveKrw ?? 0) >= hugeBound - 1e-9,
        "a recorded bound below the proven window bound is raised, never trusted"
      );
    });

    it("refuses any approval that is not exactly the interrupted call and leaves the state untouched", async () => {
      const seed = await seedUnconfirmedCall(scenario(SEED_RUN_ID));
      const before = stateBytes(seed);
      const nextSeq = Number(seed.requestId.slice(seed.requestId.lastIndexOf("/") + 1)) + 1;
      const wrong: Array<[string, Record<string, string>]> = [
        ["event_key", { ADULT_OFF_BATCH_QUARANTINE_EVENT_KEY: randomUUID() }],
        ["message id", { ADULT_OFF_BATCH_QUARANTINE_MESSAGE_ID: String(seed.duplicateId) }],
        [
          "request seq",
          { ADULT_OFF_BATCH_QUARANTINE_REQUEST_ID: `adult-off-batch/${SEED_RUN_ID}/${nextSeq}` },
        ],
        [
          "other run",
          {
            ADULT_OFF_BATCH_QUARANTINE_RUN_ID: "ghost-run-id",
            ADULT_OFF_BATCH_QUARANTINE_REQUEST_ID: `adult-off-batch/ghost-run-id/${nextSeq - 1}`,
          },
        ],
      ];
      for (const [name, overrides] of wrong) {
        const mock = mockClassifier(seed.sc);
        await assert.rejects(
          () => run(seed.sc, mock, approvalEnv(seed, overrides)),
          refusedWith("quarantine_approval_mismatch"),
          name
        );
        assert.equal(mock.calls.length, 0, name);
        assert.equal(stateBytes(seed), before, name);
      }

      seed.sc.fx.prepare("UPDATE api_cost_ledger SET provider_request_id = 'prov-candidate' WHERE generation_request_id = ?").run(seed.requestId);
      await assert.rejects(() => run(seed.sc, mockClassifier(seed.sc), approvalEnv(seed)), refusedWith("quarantine_approval_mismatch"));
      seed.sc.fx.prepare("UPDATE api_cost_ledger SET provider_request_id = NULL WHERE generation_request_id = ?").run(seed.requestId);

      insertLedger(seed.sc.fx, seed.requestId, { usd: null, source: "unavailable", status: "started", messageId: seed.targetId });
      await assert.rejects(() => run(seed.sc, mockClassifier(seed.sc), approvalEnv(seed)), refusedWith("quarantine_approval_mismatch"));
      assert.equal(stateBytes(seed), before);

      for (const name of [
        "ADULT_OFF_BATCH_QUARANTINE_RUN_ID",
        "ADULT_OFF_BATCH_QUARANTINE_REQUEST_ID",
        "ADULT_OFF_BATCH_QUARANTINE_EVENT_KEY",
        "ADULT_OFF_BATCH_QUARANTINE_MESSAGE_ID",
      ]) {
        assert.throws(
          () => seed.sc.config({ ...approvalEnv(seed), [name]: undefined }),
          configErrorWith("invalid_quarantine_unconfirmed"),
          `partial approval without ${name}`
        );
      }
      assert.throws(
        () => seed.sc.config(approvalEnv(seed, { ADULT_OFF_BATCH_QUARANTINE_REQUEST_ID: `adult-off-batch/other-run-xyz/${nextSeq - 1}` })),
        configErrorWith("invalid_quarantine_unconfirmed")
      );
    });

    it("keeps every other unknown-cost ledger event fail-closed even with a valid approval", async () => {
      const seed = await seedUnconfirmedCall(scenario(SEED_RUN_ID));
      insertLedger(seed.sc.fx, `adult-off-batch/${SEED_RUN_ID}/900`, {
        usd: null,
        source: "unavailable",
        status: "started",
        messageId: seed.duplicateId,
      });
      const mock = mockClassifier(seed.sc);
      await assert.rejects(() => run(seed.sc, mock, approvalEnv(seed)), refusedWith("ledger_unknown_cost"));
      assert.equal(mock.calls.length, 0);
      assert.equal(loadAdultOffBatchState(seed.stateDir).halted?.reason, "halted_unknown_cost");
    });

    it("keeps quarantine, reserve and skipped text across a RUN_ID change, a restart and a wiped home, and ignores an ACK", async () => {
      const seed = await seedUnconfirmedCall(scenario(SEED_RUN_ID));
      const first = await run(seed.sc, mockClassifier(seed.sc), approvalEnv(seed));
      assert.equal(first.stopReason, "quarantine_pending");
      const settledKrw = loadAdultOffBatchState(seed.stateDir).settledKrw;
      const quarantinedLedgerBefore = ledgerRow(seed);
      insertAssistant(seed.sc.fx, { content: TARGET_TEXT, chatId: 3 });

      const savedHome = process.env.HOME;
      try {
        process.env.HOME = path.join(seed.sc.dir, "fresh-container-home");
        for (const runId of ["adult-off-c3-restart-1", "adult-off-c3-restart-2"]) {
          const mock = mockClassifier(seed.sc);
          const report = await run(seed.sc, mock, {
            ADULT_OFF_BATCH_RUN_ID: runId,
            ADULT_OFF_BATCH_ACK_UNRESOLVED_REQUEST_ID: seed.requestId,
          });
          assert.equal(report.stopReason, "quarantine_pending");
          assert.equal(mock.calls.length, 0, "no automatic or ACK-driven re-call of the quarantined text");
          assert.equal(report.body.quarantinedSkipped, 3);
          assert.equal(report.quarantines[0]?.reserveKrw, 10);
          assert.ok(Math.abs(report.budget.settledKrwAtStart - settledKrw) < 1e-9, "the budget is not reset by a new RUN_ID");
        }
        const bypass = mockClassifier(seed.sc);
        await assert.rejects(
          () => run(seed.sc, bypass, { ADULT_OFF_BATCH_CAP_KRW: "1600" }),
          refusedWith("cap_increase_not_approved")
        );
        assert.equal(bypass.calls.length, 0);
      } finally {
        if (savedHome === undefined) delete process.env.HOME;
        else process.env.HOME = savedHome;
      }
      assert.equal(ledgerRow(seed), quarantinedLedgerBefore);
      assert.ok(loadAdultOffBatchState(seed.stateDir).runIds.includes("adult-off-c3-restart-2"));
    });

    it("survives a redeploy on the persistent volume with the reserve still held", async () => {
      const base = scenario(SEED_RUN_ID);
      const volume = path.join(base.dir, "data");
      fs.mkdirSync(volume);
      const liveDb = path.join(volume, "app.db");
      base.fx.pragma("wal_checkpoint(TRUNCATE)");
      fs.copyFileSync(base.dbPath, liveDb);
      const liveFx = new Database(liveDb);
      liveFx.pragma("busy_timeout = 5000");
      openHandles.push(liveFx);
      const live: Scenario = { ...base, dbPath: liveDb, fx: liveFx };
      const configOn = (overrides: Record<string, string | undefined> = {}) =>
        parseAdultOffBatchPaidRunConfig(
          {
            ...live.env({ ADULT_OFF_BATCH_ALLOW_PROD_WRITE: "1", ...overrides }),
            RAILWAY_VOLUME_MOUNT_PATH: volume,
          },
          liveDb,
          { isMountedVolume: () => true }
        );
      const seed = await seedUnconfirmedCall(live, { config: configOn() });
      assert.equal(seed.stateDir, path.join(fs.realpathSync(volume), "private", "adult-off-batch"));
      await runConfig(live, configOn(approvalEnv(seed)), mockClassifier(live));

      const savedHome = process.env.HOME;
      try {
        process.env.HOME = path.join(base.dir, "fresh-container-home");
        const mock = mockClassifier(live);
        const report = await runConfig(live, configOn({ ADULT_OFF_BATCH_RUN_ID: "adult-off-c3-redeploy" }), mock);
        assert.equal(report.stopReason, "quarantine_pending");
        assert.equal(mock.calls.length, 0);
        assert.equal(report.budget.heldQuarantineReserveKrw, 10);
      } finally {
        if (savedHome === undefined) delete process.env.HOME;
        else process.env.HOME = savedHome;
      }
    });

    it("replaces the reserve with the real cost once billing is confirmed, without double counting, and then needs the usual ACK to re-classify", async () => {
      const seed = await seedUnconfirmedCall(scenario(SEED_RUN_ID));
      await run(seed.sc, mockClassifier(seed.sc), approvalEnv(seed));
      const heldState = loadAdultOffBatchState(seed.stateDir);
      const settledBefore = heldState.settledKrw;
      assert.ok(heldState.unresolved[0]?.quarantine);

      seed.sc.fx
        .prepare(
          `UPDATE api_cost_ledger SET actual_cost_usd = ?, actual_cost_source = 'cheaper_inference_billed',
             event_status = 'settled', provider_request_id = 'prov-confirmed-208' WHERE generation_request_id = ?`
        )
        .run(USD_PER_CALL, seed.requestId);

      const blocked = mockClassifier(seed.sc);
      await assert.rejects(() => run(seed.sc, blocked), refusedWith("interrupted_call_unresolved"));
      assert.equal(blocked.calls.length, 0);
      const settled = loadAdultOffBatchState(seed.stateDir);
      assert.equal(settled.unresolved[0]?.quarantine, null, "the reserve is released");
      assert.ok(
        Math.abs(settled.settledKrw - settledBefore - KRW_PER_CALL) < 1e-9,
        "the confirmed cost is added once and the 10 KRW reserve is not added on top"
      );
      assert.equal(settled.callCount, heldState.callCount + 1);

      const accepted = mockClassifier(seed.sc);
      const report = await run(seed.sc, accepted, { ADULT_OFF_BATCH_ACK_UNRESOLVED_REQUEST_ID: seed.requestId });
      assert.equal(report.stopReason, "completed");
      assert.equal(report.budget.heldQuarantineReserveKrw, 0);
      assert.deepEqual(report.quarantines, []);
      assert.equal(accepted.calls.length, 1, "one explicitly acknowledged re-classification, like any finished call without a verdict");
    });

    it("stops and halts when the confirmed cost exceeds the reserve, still counting the full cost", async () => {
      const seed = await seedUnconfirmedCall(scenario(SEED_RUN_ID));
      await run(seed.sc, mockClassifier(seed.sc), approvalEnv(seed));
      const settledBefore = loadAdultOffBatchState(seed.stateDir).settledKrw;
      seed.sc.fx
        .prepare(
          `UPDATE api_cost_ledger SET actual_cost_usd = 1, actual_cost_source = 'cheaper_inference_billed',
             event_status = 'settled', provider_request_id = 'prov-expensive' WHERE generation_request_id = ?`
        )
        .run(seed.requestId);
      const mock = mockClassifier(seed.sc);
      await assert.rejects(() => run(seed.sc, mock), refusedWith("quarantine_cost_exceeds_reserve"));
      assert.equal(mock.calls.length, 0);
      const state = loadAdultOffBatchState(seed.stateDir);
      assert.equal(state.halted?.reason, "halted_cost_exceeds_bound");
      assert.ok(state.settledKrw - settledBefore > 1400, "the whole actual cost is counted");
      await assert.rejects(() => run(seed.sc, mock), refusedWith("batch_halted"));
    });

    describe("quarantined ledger row is re-verified on every resume", () => {
      async function held(): Promise<Seed> {
        const seed = await seedUnconfirmedCall(scenario(SEED_RUN_ID));
        const report = await run(seed.sc, mockClassifier(seed.sc), approvalEnv(seed));
        assert.equal(report.stopReason, "quarantine_pending");
        return seed;
      }
      const resumeRefused = async (seed: Seed, code: string): Promise<void> => {
        const before = stateBytes(seed);
        const mock = mockClassifier(seed.sc);
        await assert.rejects(() => run(seed.sc, mock), refusedWith(code));
        assert.equal(mock.calls.length, 0);
        assert.equal(stateBytes(seed), before, "a refused resume changes no state");
      };

      it("resumes while the row is still exactly started, cost-less and provider-id-less", async () => {
        const seed = await held();
        const mock = mockClassifier(seed.sc);
        const report = await run(seed.sc, mock);
        assert.equal(report.stopReason, "quarantine_pending");
        assert.equal(report.budget.heldQuarantineReserveKrw, 10);
        assert.equal(mock.calls.length, 0);
      });

      it("stops when the row changed from started to failed_without_usage", async () => {
        const seed = await held();
        seed.sc.fx
          .prepare("UPDATE api_cost_ledger SET event_status = 'failed_without_usage' WHERE generation_request_id = ?")
          .run(seed.requestId);
        await resumeRefused(seed, "quarantine_ledger_changed");
      });

      it("stops when the row gained a provider id or a different message id without a confirmed cost", async () => {
        const seed = await held();
        seed.sc.fx.prepare("UPDATE api_cost_ledger SET provider_request_id = 'prov-x' WHERE generation_request_id = ?").run(seed.requestId);
        await resumeRefused(seed, "quarantine_ledger_changed");
        seed.sc.fx.prepare("UPDATE api_cost_ledger SET provider_request_id = NULL, assistant_message_id = ? WHERE generation_request_id = ?").run(seed.duplicateId, seed.requestId);
        await resumeRefused(seed, "quarantine_ledger_changed");
      });

      it("stops when the quarantined row was deleted", async () => {
        const seed = await held();
        seed.sc.fx.prepare("DELETE FROM api_cost_ledger WHERE generation_request_id = ?").run(seed.requestId);
        await resumeRefused(seed, "quarantine_ledger_changed");
      });

      it("stops when a duplicate ledger row exists for the same request id", async () => {
        const seed = await held();
        insertLedger(seed.sc.fx, seed.requestId, {
          usd: null,
          source: "unavailable",
          status: "started",
          messageId: seed.targetId,
        });
        await resumeRefused(seed, "quarantine_ledger_changed");
      });

      it("keeps any other unknown-cost row fail-closed after the quarantine was established", async () => {
        const seed = await held();
        insertLedger(seed.sc.fx, `adult-off-batch/${SEED_RUN_ID}/901`, {
          usd: null,
          source: "unavailable",
          status: "started",
          messageId: seed.duplicateId,
        });
        const mock = mockClassifier(seed.sc);
        await assert.rejects(() => run(seed.sc, mock), refusedWith("ledger_unknown_cost"));
        assert.equal(mock.calls.length, 0);
      });

      it("never excludes a row from the unknown-cost count unless it is the exact unconfirmed row and a valid reserve is held", async () => {
        const seed = await held();
        const call = { requestId: seed.requestId, eventKey: seed.eventKey, messageId: seed.targetId };
        assert.equal(sumAdultOffBatchModerationSpend(seed.sc.fx, [call]).unknownCostEvents, 0);
        assert.equal(sumAdultOffBatchModerationSpend(seed.sc.fx, []).unknownCostEvents, 1);
        assert.equal(sumAdultOffBatchModerationSpend(seed.sc.fx, [{ ...call, messageId: seed.duplicateId }]).unknownCostEvents, 1);
        assert.equal(sumAdultOffBatchModerationSpend(seed.sc.fx, [{ ...call, eventKey: randomUUID() }]).unknownCostEvents, 1);
        seed.sc.fx.prepare("UPDATE api_cost_ledger SET event_status = 'failed_with_usage' WHERE generation_request_id = ?").run(seed.requestId);
        assert.equal(sumAdultOffBatchModerationSpend(seed.sc.fx, [call]).unknownCostEvents, 1);

        const tampered = await held();
        const state = JSON.parse(stateBytes(tampered));
        state.unresolved[0].quarantine.reserveKrw = 0;
        fs.writeFileSync(path.join(tampered.stateDir, "batch.state.json"), JSON.stringify(state));
        await resumeRefused(tampered, "state_invalid");
      });
    });

    describe("confirmed quarantine cost is applied in one atomic state save", () => {
      type KillMode = "before-write" | "before-rename" | "after-rename";

      async function heldAndConfirmed(usd: number): Promise<Seed> {
        const seed = await seedUnconfirmedCall(scenario(SEED_RUN_ID));
        const report = await run(seed.sc, mockClassifier(seed.sc), approvalEnv(seed));
        assert.equal(report.stopReason, "quarantine_pending");
        seed.sc.fx
          .prepare(
            `UPDATE api_cost_ledger SET actual_cost_usd = ?, actual_cost_source = 'cheaper_inference_billed',
               event_status = 'settled', provider_request_id = 'prov-synthetic-confirmed' WHERE generation_request_id = ?`
          )
          .run(usd, seed.requestId);
        return seed;
      }

      /** 격리 비용을 확정 반영하는 상태 저장 한가운데서 실제 프로세스를 SIGKILL한다. */
      function killDuringSettlement(seed: Seed, mode: KillMode): void {
        const child = path.join(seed.sc.dir, `kill-settle-${mode}.ts`);
        fs.writeFileSync(
          child,
          `import fs from "node:fs";
import Database from ${JSON.stringify(path.join(REPO_ROOT, "node_modules/better-sqlite3"))};
import { executeAdultOffBatchPaidRun, parseAdultOffBatchPaidRunConfig } from ${JSON.stringify(path.join(REPO_ROOT, "src/lib/adultOffBatchPaidRun.ts"))};

const [dbPath, stateDir, mode] = process.argv.slice(2);
const kill = () => process.kill(process.pid, "SIGKILL");
const isState = (target) => String(target).endsWith("batch.state.json");
const realOpen = fs.openSync;
const realRename = fs.renameSync;
fs.openSync = (target, ...rest) => {
  if (mode === "before-write" && String(target).includes("batch.state.json.") && String(target).endsWith(".tmp")) kill();
  return realOpen(target, ...rest);
};
fs.renameSync = (from, to) => {
  if (isState(to) && mode === "before-rename") kill();
  realRename(from, to);
  if (isState(to) && mode === "after-rename") kill();
};
const config = parseAdultOffBatchPaidRunConfig(
  {
    ADULT_OFF_BATCH_MODE: "execute",
    ADULT_OFF_BATCH_RUN_ID: "adult-off-c3-test",
    ADULT_OFF_BATCH_CAP_KRW: "1500",
    ADULT_OFF_BATCH_APPROVE_PAID: "1",
    ADULT_OFF_BATCH_ALLOW_ISOLATED_PAID: "1",
    ADULT_OFF_BATCH_USD_KRW: "1450",
    ADULT_OFF_BATCH_APPROVED_RATES: "0.07/0.35",
    CHEAPER_INFERENCE_API_KEY: "dummy-not-a-real-key",
  },
  dbPath,
  { stateDir }
);
async function main() {
  await executeAdultOffBatchPaidRun({
    config,
    openDatabase: () => new Database(dbPath, { fileMustExist: true }),
    createClassifier: () => async () => {
      throw new Error("no paid call may happen while settling a quarantined call");
    },
  });
}
main();
`
        );
        seed.sc.fx.pragma("wal_checkpoint(TRUNCATE)");
        const result = spawnSync(
          process.execPath,
          ["--conditions=react-server", "--import", "tsx", child, seed.sc.dbPath, seed.stateDir, mode],
          { cwd: REPO_ROOT, env: childEnv({}), encoding: "utf8" }
        );
        assert.equal(result.signal, "SIGKILL", `${mode}: ${result.stdout}${result.stderr}`);
      }

      const ledgerRowCount = (seed: Seed): number =>
        (seed.sc.fx.prepare("SELECT COUNT(*) AS n FROM api_cost_ledger WHERE generation_request_id = ?").get(seed.requestId) as { n: number }).n;

      for (const mode of ["before-write", "before-rename"] as const) {
        it(`keeps the quarantine and reserve untouched when killed ${mode === "before-write" ? "before the settlement save starts" : "after the temp file is written but before the rename"}, then applies the cost exactly once`, async () => {
          const seed = await heldAndConfirmed(USD_PER_CALL);
          const held = loadAdultOffBatchState(seed.stateDir);
          const bytes = stateBytes(seed);
          const rowsBefore = ledgerRowCount(seed);
          const protectedBefore = protectedRows(seed);

          killDuringSettlement(seed, mode);
          assert.equal(stateBytes(seed), bytes, "the original quarantine, reserve and counters survive byte for byte");
          assert.equal(loadAdultOffBatchState(seed.stateDir).unresolved[0]?.quarantine?.reserveKrw, 10);

          for (let attempt = 0; attempt < 2; attempt += 1) {
            const mock = mockClassifier(seed.sc);
            await assert.rejects(() => run(seed.sc, mock), refusedWith("interrupted_call_unresolved"));
            assert.equal(mock.calls.length, 0);
            const state = loadAdultOffBatchState(seed.stateDir);
            assert.ok(Math.abs(state.settledKrw - held.settledKrw - KRW_PER_CALL) < 1e-9, `attempt ${attempt}: cost counted once`);
            assert.equal(state.callCount, held.callCount + 1, `attempt ${attempt}: call counted once`);
            assert.equal(state.unresolved[0]?.quarantine, null);
            assert.equal(state.halted, null);
            assert.equal(state.approvedCapKrw, 1500);
          }
          assert.equal(ledgerRowCount(seed), rowsBefore, "no ledger row is created or re-settled");
          assert.equal(protectedRows(seed), protectedBefore);
        });
      }

      it("does not count the call twice when killed right after the atomic save, and still needs the ACK", async () => {
        const seed = await heldAndConfirmed(USD_PER_CALL);
        const held = loadAdultOffBatchState(seed.stateDir);
        const rowsBefore = ledgerRowCount(seed);
        const protectedBefore = protectedRows(seed);

        killDuringSettlement(seed, "after-rename");
        const saved = loadAdultOffBatchState(seed.stateDir);
        assert.ok(Math.abs(saved.settledKrw - held.settledKrw - KRW_PER_CALL) < 1e-9);
        assert.equal(saved.callCount, held.callCount + 1);
        assert.equal(saved.unresolved[0]?.quarantine, null, "cost, call count and reserve release land in the same save");
        assert.deepEqual(saved.unresolved[0]?.requestIds, [seed.requestId], "the call stays an unjudged unresolved target");
        assert.equal(saved.halted, null);
        const afterKill = stateBytes(seed);

        for (let attempt = 0; attempt < 2; attempt += 1) {
          const mock = mockClassifier(seed.sc);
          await assert.rejects(() => run(seed.sc, mock), refusedWith("interrupted_call_unresolved"));
          assert.equal(mock.calls.length, 0);
          const state = loadAdultOffBatchState(seed.stateDir);
          assert.equal(state.callCount, saved.callCount);
          assert.ok(Math.abs(state.settledKrw - saved.settledKrw) < 1e-9);
        }
        assert.equal(
          JSON.stringify({ ...JSON.parse(stateBytes(seed)), updatedAt: "" }),
          JSON.stringify({ ...JSON.parse(afterKill), updatedAt: "" }),
          "resuming without the ACK changes nothing"
        );
        assert.equal(ledgerRowCount(seed), rowsBefore);
        assert.equal(protectedRows(seed), protectedBefore);
      });

      it("re-classifies only the acknowledged target, once, after the settlement", async () => {
        const seed = await heldAndConfirmed(USD_PER_CALL);
        const otherId = insertAssistant(seed.sc.fx, { content: "확정 뒤 새로 생긴 대기 본문" });
        killDuringSettlement(seed, "after-rename");
        const settled = loadAdultOffBatchState(seed.stateDir);
        const mock = mockClassifier(seed.sc);
        const report = await run(seed.sc, mock, { ADULT_OFF_BATCH_ACK_UNRESOLVED_REQUEST_ID: seed.requestId });
        assert.equal(report.stopReason, "completed");
        assert.deepEqual(report.quarantines, []);
        assert.equal(report.budget.heldQuarantineReserveKrw, 0);
        assert.deepEqual(
          mock.calls.map((call) => call.text).sort(),
          [TARGET_TEXT, "확정 뒤 새로 생긴 대기 본문"].sort(),
          "the target is re-classified once (both messages share the verdict) next to the unrelated pending text"
        );
        assert.equal(adultOffStoredTextDisposition(usageOf(seed.sc.fx, seed.targetId), TARGET_TEXT), "approved");
        assert.equal(adultOffStoredTextDisposition(usageOf(seed.sc.fx, otherId), "확정 뒤 새로 생긴 대기 본문"), "approved");
        const state = loadAdultOffBatchState(seed.stateDir);
        assert.deepEqual(state.unresolved, []);
        assert.equal(state.callCount, settled.callCount + 2);
        assert.ok(Math.abs(state.settledKrw - settled.settledKrw - 2 * KRW_PER_CALL) < 1e-9);
        assert.equal(state.approvedCapKrw, 1500);
      });

      for (const mode of ["before-rename", "after-rename"] as const) {
        it(`keeps cost, call count and halt in one save when the confirmed cost exceeds the reserve (killed ${mode})`, async () => {
          const seed = await heldAndConfirmed(1);
          const held = loadAdultOffBatchState(seed.stateDir);
          const bytes = stateBytes(seed);
          killDuringSettlement(seed, mode);
          if (mode === "before-rename") {
            assert.equal(stateBytes(seed), bytes, "no half-applied cost or halt");
            assert.equal(loadAdultOffBatchState(seed.stateDir).halted, null);
            const mock = mockClassifier(seed.sc);
            await assert.rejects(() => run(seed.sc, mock), refusedWith("quarantine_cost_exceeds_reserve"));
            assert.equal(mock.calls.length, 0);
          }
          const state = loadAdultOffBatchState(seed.stateDir);
          assert.equal(state.halted?.reason, "halted_cost_exceeds_bound");
          assert.equal(state.unresolved[0]?.quarantine, null);
          assert.equal(state.callCount, held.callCount + 1);
          const costKrw = 1 * 1450 * 1.02;
          assert.ok(Math.abs(state.settledKrw - held.settledKrw - costKrw) < 1e-6, "the full cost is counted exactly once");
          assert.ok(Math.abs(state.maxObservedWindowKrw - costKrw) < 1e-6);

          const after = stateBytes(seed);
          const mock = mockClassifier(seed.sc);
          await assert.rejects(() => run(seed.sc, mock), refusedWith("batch_halted"));
          assert.equal(mock.calls.length, 0);
          assert.equal(stateBytes(seed), after, "a halted batch is not changed or recounted by later runs");
        });
      }
    });

    it("never overwrites a held quarantine when another call is interrupted without its own approval", async () => {
      const seed = await seedUnconfirmedCall(scenario(SEED_RUN_ID));
      await run(seed.sc, mockClassifier(seed.sc), approvalEnv(seed));
      const held = loadAdultOffBatchState(seed.stateDir);
      const secondId = insertAssistant(seed.sc.fx, { content: "두 번째로 끊긴 본문" });
      const secondRequestId = buildAdultOffBatchGenerationRequestId(SEED_RUN_ID, held.nextCallSeq);
      fs.writeFileSync(
        path.join(seed.stateDir, "batch.state.json"),
        JSON.stringify({
          ...held,
          inFlight: {
            messageId: secondId,
            surface: "body",
            requestIds: [secondRequestId],
            openRequestId: secondRequestId,
            reservedKrw: 10,
          },
          nextCallSeq: held.nextCallSeq + 1,
        })
      );
      insertLedger(seed.sc.fx, secondRequestId, { usd: null, source: "unavailable", status: "started", messageId: secondId });
      const before = stateBytes(seed);
      const mock = mockClassifier(seed.sc);
      await assert.rejects(() => run(seed.sc, mock), refusedWith("interrupted_call_cost_unknown"));
      assert.equal(mock.calls.length, 0);
      assert.equal(stateBytes(seed), before, "the quarantine and the second marker are both kept");
    });

    it("shows the quarantined target in PLAN_ONLY instead of hiding it", async () => {
      const seed = await seedUnconfirmedCall(scenario(SEED_RUN_ID));
      await run(seed.sc, mockClassifier(seed.sc), approvalEnv(seed));
      const db = new Database(seed.sc.dbPath, { readonly: true, fileMustExist: true });
      try {
        const planConfig = parseAdultOffBatchPaidRunConfig(
          { ...seed.sc.env(), ADULT_OFF_BATCH_MODE: "plan" },
          seed.sc.dbPath
        );
        const plan = buildAdultOffBatchPlanReport(db, { ...planConfig, stateDir: seed.stateDir });
        assert.deepEqual(plan.batchState.quarantines, [
          {
            requestId: seed.requestId,
            messageId: seed.targetId,
            ledgerStatus: "started",
            reserveKrw: 10,
            bodyItemsRemaining: 2,
            auxItemsRemaining: 0,
          },
        ]);
        assert.ok(plan.pendingClassification.uniqueTexts >= 1, "the quarantined text is still counted as pending");
        assert.equal(plan.batchState.existing?.unresolvedCall, true);
      } finally {
        db.close();
      }
    });

    describe("second unresolved call after a batch timeout (#325) and its exact halt recovery", () => {
      type SecondCall = { requestId: string; eventKey: string; messageId: number; text: string };
      type HaltedSeed = Seed & { second: SecondCall; otherText: string };

      const SECOND_TEXT = "두 번째로 시간 초과된 본문";
      const OTHER_TEXT = "두 호출과 무관한 대기 본문";
      const allLedger = (seed: Seed): string =>
        JSON.stringify(seed.sc.fx.prepare("SELECT * FROM api_cost_ledger ORDER BY id").all());
      const unresolvedIds = (seed: Seed): string[] =>
        loadAdultOffBatchState(seed.stateDir).unresolved.map((call) => call.quarantine?.requestId ?? "");
      const approvalFor = (seed: HaltedSeed, overrides: Record<string, string> = {}): Record<string, string> => ({
        ADULT_OFF_BATCH_QUARANTINE_RUN_ID: seed.runId,
        ADULT_OFF_BATCH_QUARANTINE_REQUEST_ID: seed.second.requestId,
        ADULT_OFF_BATCH_QUARANTINE_EVENT_KEY: seed.second.eventKey,
        ADULT_OFF_BATCH_QUARANTINE_MESSAGE_ID: String(seed.second.messageId),
        ADULT_OFF_BATCH_QUARANTINE_LEDGER_STATUS: "failed_without_usage",
        ...overrides,
      });
      const confirm = (seed: Seed, requestId: string, usd: number): void => {
        seed.sc.fx
          .prepare(
            `UPDATE api_cost_ledger SET actual_cost_usd = ?, actual_cost_source = 'cheaper_inference_billed',
               event_status = 'settled', provider_request_id = ? WHERE generation_request_id = ?`
          )
          .run(usd, `prov-synthetic-${randomUUID()}`, requestId);
      };

      /** #208이 이미 격리된 운영 상태에서, 다음 호출이 25초에 로컬 타임아웃으로 끝나 `halted_unknown_cost`로 멈춘 상태를 실제 실행기로 만든다. */
      async function seedHaltedSecondCall(options: { legacyShape?: boolean } = {}): Promise<HaltedSeed> {
        const seed = await seedUnconfirmedCall(scenario(SEED_RUN_ID));
        const held = await run(seed.sc, mockClassifier(seed.sc), approvalEnv(seed));
        assert.equal(held.stopReason, "quarantine_pending");
        const messageId = insertAssistant(seed.sc.fx, { content: SECOND_TEXT });
        const eventKey = randomUUID();
        let requestId = "";
        const timingOut = {
          calls: [] as Array<{ requestId: string | null; text: string; messageId: number }>,
          createClassifier:
            (scope: AdultOffClassifierTurnScope): AdultOffClassify =>
            async (windowText) => {
              requestId = scope.generationRequestId ?? "";
              timingOut.calls.push({ requestId, text: windowText, messageId: scope.assistantMessageId });
              insertLedger(seed.sc.fx, requestId, {
                usd: null,
                source: "unavailable",
                status: "failed_without_usage",
                messageId: scope.assistantMessageId,
                eventKey,
              });
              throw new AdultOffClassifierCallError("The operation timed out.", "timeout", {
                model: "mock",
                inputTokens: null,
                outputTokens: null,
                costUsd: null,
                providerRequestId: null,
                latencyMs: 25_000,
                outcome: "timeout",
                httpStatus: null,
              });
            },
        };
        const stopped = await run(seed.sc, timingOut, { ADULT_OFF_BATCH_RESERVE_KRW_PER_WINDOW: "10" });
        assert.equal(stopped.stopReason, "halted_unknown_cost");
        assert.deepEqual(
          timingOut.calls.map((call) => call.text),
          [SECOND_TEXT]
        );
        const state = loadAdultOffBatchState(seed.stateDir);
        assert.equal(state.halted?.reason, "halted_unknown_cost");
        assert.equal(state.inFlight?.openRequestId, requestId);
        if (options.legacyShape) {
          const raw = JSON.parse(stateBytes(seed));
          const legacy = { ...raw.unresolved[0] };
          delete legacy.quarantine.ledgerStatus;
          fs.writeFileSync(path.join(seed.stateDir, "batch.state.json"), JSON.stringify({ ...raw, unresolved: legacy }));
        }
        const otherId = insertAssistant(seed.sc.fx, { content: OTHER_TEXT });
        assert.ok(otherId > 0);
        return { ...seed, second: { requestId, eventKey, messageId, text: SECOND_TEXT }, otherText: OTHER_TEXT };
      }

      /** 상태 파일 저장 한가운데서 실제 프로세스를 SIGKILL한다. env는 자식에 그대로 전달된다. */
      function killDuringStateSave(
        seed: Seed,
        mode: "before-rename" | "after-rename",
        env: Record<string, string>
      ): void {
        const child = path.join(seed.sc.dir, `kill-recovery-${mode}-${randomUUID()}.ts`);
        fs.writeFileSync(
          child,
          `import fs from "node:fs";
import Database from ${JSON.stringify(path.join(REPO_ROOT, "node_modules/better-sqlite3"))};
import { executeAdultOffBatchPaidRun, parseAdultOffBatchPaidRunConfig } from ${JSON.stringify(path.join(REPO_ROOT, "src/lib/adultOffBatchPaidRun.ts"))};

const [dbPath, stateDir, mode, envJson] = process.argv.slice(2);
const kill = () => process.kill(process.pid, "SIGKILL");
const isState = (target) => String(target).endsWith("batch.state.json");
const realRename = fs.renameSync;
fs.renameSync = (from, to) => {
  if (isState(to) && mode === "before-rename") kill();
  realRename(from, to);
  if (isState(to) && mode === "after-rename") kill();
};
const config = parseAdultOffBatchPaidRunConfig(
  {
    ADULT_OFF_BATCH_MODE: "execute",
    ADULT_OFF_BATCH_RUN_ID: "adult-off-c3-test",
    ADULT_OFF_BATCH_CAP_KRW: "1500",
    ADULT_OFF_BATCH_APPROVE_PAID: "1",
    ADULT_OFF_BATCH_ALLOW_ISOLATED_PAID: "1",
    ADULT_OFF_BATCH_USD_KRW: "1450",
    ADULT_OFF_BATCH_APPROVED_RATES: "0.07/0.35",
    CHEAPER_INFERENCE_API_KEY: "dummy-not-a-real-key",
    ...JSON.parse(envJson),
  },
  dbPath,
  { stateDir }
);
async function main() {
  await executeAdultOffBatchPaidRun({
    config,
    openDatabase: () => new Database(dbPath, { fileMustExist: true }),
    createClassifier: () => async () => {
      throw new Error("no paid call may happen in this recovery kill test");
    },
  });
}
main();
`
        );
        seed.sc.fx.pragma("wal_checkpoint(TRUNCATE)");
        const result = spawnSync(
          process.execPath,
          ["--conditions=react-server", "--import", "tsx", child, seed.sc.dbPath, seed.stateDir, mode, JSON.stringify(env)],
          { cwd: REPO_ROOT, env: childEnv({}), encoding: "utf8" }
        );
        assert.equal(result.signal, "SIGKILL", `${mode}: ${result.stdout}${result.stderr}`);
      }

      it("reads the stored production shape of the #208 quarantine without changing any of its values", async () => {
        const seed = await seedHaltedSecondCall({ legacyShape: true });
        const raw = JSON.parse(stateBytes(seed));
        assert.equal(Array.isArray(raw.unresolved), false, "the fixture is the single-object shape that production stores");
        const loaded = loadAdultOffBatchState(seed.stateDir);
        assert.equal(loaded.unresolved.length, 1);
        assert.deepEqual(loaded.unresolved[0]?.requestIds, [seed.requestId]);
        assert.deepEqual(loaded.unresolved[0]?.quarantine, { ...raw.unresolved.quarantine, ledgerStatus: "started" });
        assert.equal(loaded.unresolved[0]?.quarantine?.reserveKrw, 10);
        assert.equal(loaded.unresolved[0]?.quarantine?.eventKey, seed.eventKey);
      });

      it("keeps the exact unsettled #325 state byte-identical without an exact approval, and never re-calls either target", async () => {
        const seed = await seedHaltedSecondCall();
        const before = stateBytes(seed);
        const ledgerBefore = allLedger(seed);
        const attempts: Array<[string, Record<string, string> | undefined]> = [
          ["no approval", undefined],
          ["the #208 approval only", approvalEnv(seed)],
          ["an ACK for the first call", { ADULT_OFF_BATCH_ACK_UNRESOLVED_REQUEST_ID: seed.requestId }],
        ];
        for (const [label, env] of attempts) {
          const mock = mockClassifier(seed.sc);
          await assert.rejects(() => run(seed.sc, mock, env), (error: unknown) =>
            error instanceof AdultOffBatchRunRefusedError &&
            (error.code === "batch_halted" || error.code === "halted_recovery_mismatch")
          );
          assert.equal(mock.calls.length, 0, label);
          assert.equal(stateBytes(seed), before, `${label}: the state file is not touched`);
        }
        assert.equal(allLedger(seed), ledgerBefore);
      });

      it("rejects every wrong identifier, ledger status and run, leaving the halted state byte-identical", async () => {
        const seed = await seedHaltedSecondCall();
        const before = stateBytes(seed);
        const wrong: Array<[string, Record<string, string>]> = [
          ["event_key", approvalFor(seed, { ADULT_OFF_BATCH_QUARANTINE_EVENT_KEY: randomUUID() })],
          ["message id", approvalFor(seed, { ADULT_OFF_BATCH_QUARANTINE_MESSAGE_ID: String(seed.second.messageId + 1) })],
          [
            "request id",
            approvalFor(seed, {
              ADULT_OFF_BATCH_QUARANTINE_REQUEST_ID: buildAdultOffBatchGenerationRequestId(
                SEED_RUN_ID,
                Number(seed.second.requestId.split("/").pop()) + 1
              ),
            }),
          ],
          ["the #208 request id", approvalFor(seed, { ADULT_OFF_BATCH_QUARANTINE_REQUEST_ID: seed.requestId })],
          ["ledger status", approvalFor(seed, { ADULT_OFF_BATCH_QUARANTINE_LEDGER_STATUS: "started" })],
          ["run id", approvalFor(seed, { ADULT_OFF_BATCH_QUARANTINE_RUN_ID: "some-other-run" })],
        ];
        for (const [label, env] of wrong) {
          const mock = mockClassifier(seed.sc);
          await assert.rejects(
            () => run(seed.sc, mock, env),
            (error: unknown) =>
              error instanceof AdultOffBatchRunRefusedError || error instanceof AdultOffBatchConfigError,
            label
          );
          assert.equal(mock.calls.length, 0, label);
          assert.equal(stateBytes(seed), before, `${label}: nothing changed`);
        }
        assert.throws(
          () => seed.sc.config(approvalFor(seed, { ADULT_OFF_BATCH_QUARANTINE_LEDGER_STATUS: "settled" })),
          configErrorWith("invalid_quarantine_unconfirmed")
        );
        assert.throws(
          () => seed.sc.config({ ADULT_OFF_BATCH_QUARANTINE_LEDGER_STATUS: "failed_without_usage" }),
          configErrorWith("invalid_quarantine_unconfirmed"),
          "the status value alone is not an approval"
        );
      });

      it("enrolls #325 beside #208 in one atomic save, clears only that halt, and keeps its cost unresolved instead of settling it", async () => {
        const seed = await seedHaltedSecondCall({ legacyShape: true });
        const before = loadAdultOffBatchState(seed.stateDir);
        const ledgerBefore = allLedger(seed);
        const protectedBefore = protectedRows(seed);
        const mock = mockClassifier(seed.sc);
        const report = await run(seed.sc, mock, approvalFor(seed));

        assert.equal(report.stopReason, "quarantine_pending", "a held quarantine is never reported as a finished batch");
        assert.deepEqual(
          mock.calls.map((call) => call.text),
          [OTHER_TEXT],
          "zero re-calls of the #208 and #325 texts; only the unrelated pending text is classified"
        );
        assert.equal(report.body.quarantinedSkipped, 3, "#208 target, its duplicate and #325 are skipped");
        assert.deepEqual(
          report.quarantines.map((held) => [held.requestId, held.ledgerStatus, held.reserveKrw]),
          [
            [seed.requestId, "started", 10],
            [seed.second.requestId, "failed_without_usage", 10],
          ]
        );
        assert.equal(report.budget.heldQuarantineReserveKrw, 20);
        assert.equal(report.halted, null);

        const state = loadAdultOffBatchState(seed.stateDir);
        assert.equal(state.halted, null);
        assert.equal(state.inFlight, null);
        assert.deepEqual(state.unresolved[0], before.unresolved[0], "the #208 quarantine, reserve and marker are unchanged");
        assert.equal(state.unresolved[1]?.quarantine?.eventKey, seed.second.eventKey);
        assert.equal(state.unresolved[1]?.messageId, seed.second.messageId);
        assert.equal(
          state.callCount,
          before.callCount + 1,
          "only the one unrelated classification call is counted; #325 is not counted as a settled call"
        );
        assert.ok(
          Math.abs(state.settledKrw - before.settledKrw - KRW_PER_CALL) < 1e-9,
          "#325 adds 0 KRW of settled cost; its unresolved cost is the held reserve, not a settled value"
        );
        assert.equal(ledgerRow(seed, seed.second.requestId).includes('"actual_cost_usd":null'), true);
        assert.equal(allLedger(seed).startsWith(ledgerBefore.slice(0, -1)), true, "no ledger row is edited or settled");
        assert.equal(protectedRows(seed), protectedBefore, "settled proofs and isolated variant proofs are untouched");
        assert.equal(usageOf(seed.sc.fx, seed.second.messageId).adultOffGuard, undefined);
        assert.equal(Array.isArray(JSON.parse(stateBytes(seed)).unresolved), true, "saved in the canonical list shape");
      });

      it("reserves the larger of the call's recorded reserve and the proven window bound", async () => {
        const seed = await seedHaltedSecondCall();
        const raw = JSON.parse(stateBytes(seed));
        raw.inFlight.reservedKrw = 25;
        fs.writeFileSync(path.join(seed.stateDir, "batch.state.json"), JSON.stringify(raw));
        const report = await run(seed.sc, mockClassifier(seed.sc), approvalFor(seed));
        assert.equal(report.quarantines[1]?.reserveKrw, 25);

        const tiny = await seedHaltedSecondCall();
        const rawTiny = JSON.parse(stateBytes(tiny));
        rawTiny.inFlight.reservedKrw = 0.01;
        fs.writeFileSync(path.join(tiny.stateDir, "batch.state.json"), JSON.stringify(rawTiny));
        const tinyReport = await run(tiny.sc, mockClassifier(tiny.sc), approvalFor(tiny));
        const windowBound = adultOffBatchWindowReserveKrw(SECOND_TEXT, {
          ...PRICING,
          rates: { ...resolveOpenRouterModelRates("gpt-6-luna"), cacheWriteMultiplier: 2.5 },
        });
        assert.ok(Math.abs((tinyReport.quarantines[1]?.reserveKrw ?? 0) - windowBound) < 1e-9);
      });

      it("counts the sum of all held reserves in the cap gate before every call", async () => {
        const probe = await seedHaltedSecondCall();
        const settledKrw = loadAdultOffBatchState(probe.stateDir).settledKrw;
        const bound = reserveFor(OTHER_TEXT);
        const tooTight = (settledKrw + 20 + bound - 0.01).toFixed(4);
        const stopped = mockClassifier(probe.sc);
        const r1 = await run(probe.sc, stopped, approvalFor(probe, { ADULT_OFF_BATCH_CAP_KRW: tooTight }));
        assert.equal(r1.stopReason, "cap_reached");
        assert.equal(stopped.calls.length, 0, "settled + #208 reserve + #325 reserve + this call's bound exceeds the cap");
        assert.equal(r1.budget.heldQuarantineReserveKrw, 20);

        const roomy = await seedHaltedSecondCall();
        const fits = (loadAdultOffBatchState(roomy.stateDir).settledKrw + 20 + bound + 0.01).toFixed(4);
        const allowed = mockClassifier(roomy.sc);
        const r2 = await run(roomy.sc, allowed, approvalFor(roomy, { ADULT_OFF_BATCH_CAP_KRW: fits }));
        assert.equal(allowed.calls.length, 1);
        assert.equal(r2.stopReason, "quarantine_pending");
      });

      it("refuses to clear the halt when the two reserves plus settled cost would not fit the cap, changing nothing", async () => {
        const seed = await seedHaltedSecondCall();
        const settledKrw = loadAdultOffBatchState(seed.stateDir).settledKrw;
        const before = stateBytes(seed);
        const mock = mockClassifier(seed.sc);
        await assert.rejects(
          () => run(seed.sc, mock, approvalFor(seed, { ADULT_OFF_BATCH_CAP_KRW: (settledKrw + 19.9).toFixed(4) })),
          refusedWith("halted_recovery_mismatch")
        );
        assert.equal(mock.calls.length, 0);
        assert.equal(stateBytes(seed), before);
      });

      it("never clears any other halt or a halt whose cause is not the approved call's unknown cost", async () => {
        const cases: Array<[string, (raw: Record<string, any>, seed: HaltedSeed) => void]> = [
          ["a classifier-error halt", (raw) => (raw.halted.reason = "halted_classifier_error")],
          ["a cost-exceeds-bound halt", (raw) => (raw.halted.reason = "halted_cost_exceeds_bound")],
          ["a cap-style halt", (raw) => (raw.halted.reason = "cap_reached")],
          [
            "an unknown-cost halt of a different call",
            (raw, seed) => (raw.halted.detail = `call ${seed.requestId}: ledger cost unknown (events=1)`),
          ],
          ["a halt with no in-flight marker", (raw) => (raw.inFlight = null)],
          ["an in-flight marker for another request", (raw) => (raw.inFlight.openRequestId = "adult-off-batch/adult-off-c3-test/999")],
          ["an in-flight marker for another message", (raw) => (raw.inFlight.messageId += 1)],
        ];
        for (const [label, mutate] of cases) {
          const seed = await seedHaltedSecondCall();
          const raw = JSON.parse(stateBytes(seed));
          mutate(raw, seed);
          fs.writeFileSync(path.join(seed.stateDir, "batch.state.json"), JSON.stringify(raw));
          const before = stateBytes(seed);
          const mock = mockClassifier(seed.sc);
          await assert.rejects(() => run(seed.sc, mock, approvalFor(seed)), refusedWith("halted_recovery_mismatch"), label);
          assert.equal(mock.calls.length, 0, label);
          assert.equal(stateBytes(seed), before, `${label}: the halt stays and nothing is rewritten`);
        }
      });

      it("refuses when the #325 ledger row is not exactly the approved single unsettled row, or when anything else is unknown-cost", async () => {
        const mutations: Array<[string, (seed: HaltedSeed) => void]> = [
          [
            "a provider request id appeared",
            (seed) =>
              seed.sc.fx
                .prepare("UPDATE api_cost_ledger SET provider_request_id = 'prov-1' WHERE generation_request_id = ?")
                .run(seed.second.requestId),
          ],
          [
            "the row became started",
            (seed) =>
              seed.sc.fx
                .prepare("UPDATE api_cost_ledger SET event_status = 'started' WHERE generation_request_id = ?")
                .run(seed.second.requestId),
          ],
          [
            "a duplicate row exists",
            (seed) =>
              insertLedger(seed.sc.fx, seed.second.requestId, {
                usd: null,
                source: "unavailable",
                status: "failed_without_usage",
                messageId: seed.second.messageId,
              }),
          ],
          [
            "the row is gone",
            (seed) => seed.sc.fx.prepare("DELETE FROM api_cost_ledger WHERE generation_request_id = ?").run(seed.second.requestId),
          ],
          [
            "another unknown-cost event exists",
            (seed) =>
              insertLedger(seed.sc.fx, buildAdultOffBatchGenerationRequestId(SEED_RUN_ID, 9000), {
                usd: null,
                source: "unavailable",
                status: "failed_without_usage",
                messageId: seed.targetId,
              }),
          ],
        ];
        for (const [label, mutate] of mutations) {
          const seed = await seedHaltedSecondCall();
          mutate(seed);
          const before = stateBytes(seed);
          const mock = mockClassifier(seed.sc);
          await assert.rejects(() => run(seed.sc, mock, approvalFor(seed)), (error: unknown) => error instanceof AdultOffBatchRunRefusedError, label);
          assert.equal(mock.calls.length, 0, label);
          assert.equal(stateBytes(seed), before, `${label}: the halt stays and nothing is rewritten`);
          assert.notEqual(loadAdultOffBatchState(seed.stateDir).halted, null, label);
        }
      });

      it("refuses while another runner holds the lock and while the #208 ledger row has changed", async () => {
        const locked = await seedHaltedSecondCall();
        const lock = acquireAdultOffBatchExecutionLock(locked.stateDir, "some-other-run");
        const beforeLocked = stateBytes(locked);
        try {
          const mock = mockClassifier(locked.sc);
          await assert.rejects(() => run(locked.sc, mock, approvalFor(locked)), refusedWith("concurrent_run_locked"));
          assert.equal(stateBytes(locked), beforeLocked);
        } finally {
          lock.release();
        }

        const changed = await seedHaltedSecondCall();
        changed.sc.fx
          .prepare("UPDATE api_cost_ledger SET provider_request_id = 'prov-moved' WHERE generation_request_id = ?")
          .run(changed.requestId);
        const beforeChanged = stateBytes(changed);
        await assert.rejects(
          () => run(changed.sc, mockClassifier(changed.sc), approvalFor(changed)),
          refusedWith("quarantine_ledger_changed")
        );
        assert.equal(stateBytes(changed), beforeChanged);
      });

      for (const mode of ["before-rename", "after-rename"] as const) {
        it(`keeps enrollment, reserve and halt in one save when killed ${mode}, and never double-reserves on resume`, async () => {
          const seed = await seedHaltedSecondCall();
          const before = stateBytes(seed);
          const reserveBefore = 10;
          killDuringStateSave(seed, mode, approvalFor(seed));
          if (mode === "before-rename") {
            assert.equal(stateBytes(seed), before, "no half-applied enrollment, reserve or halt change");
            assert.notEqual(loadAdultOffBatchState(seed.stateDir).halted, null);
          } else {
            const saved = loadAdultOffBatchState(seed.stateDir);
            assert.equal(saved.halted, null, "the halt is cleared in the same save that enrolls #325");
            assert.equal(saved.inFlight, null);
            assert.equal(saved.unresolved.length, 2);
            assert.equal(saved.unresolved[1]?.quarantine?.requestId, seed.second.requestId);
          }
          const resumed = await run(seed.sc, mockClassifier(seed.sc), approvalFor(seed));
          assert.equal(resumed.stopReason, "quarantine_pending");
          assert.deepEqual(unresolvedIds(seed), [seed.requestId, seed.second.requestId], "exactly one entry per call");
          assert.equal(resumed.budget.heldQuarantineReserveKrw, reserveBefore * 2);
          const again = await run(seed.sc, mockClassifier(seed.sc));
          assert.equal(again.budget.heldQuarantineReserveKrw, reserveBefore * 2, "a second resume does not add the reserve again");
          assert.equal(loadAdultOffBatchState(seed.stateDir).halted, null);
        });
      }

      it("settles one confirmed call on its own and leaves the other quarantine, reserve and skipped text untouched", async () => {
        const first = await seedHaltedSecondCall();
        await run(first.sc, mockClassifier(first.sc), approvalFor(first));
        confirm(first, first.second.requestId, USD_PER_CALL);
        const heldBefore = loadAdultOffBatchState(first.stateDir);
        const mock = mockClassifier(first.sc);
        await assert.rejects(() => run(first.sc, mock), refusedWith("interrupted_call_unresolved"));
        assert.equal(mock.calls.length, 0);
        const afterSecond = loadAdultOffBatchState(first.stateDir);
        assert.equal(afterSecond.unresolved[0]?.quarantine?.requestId, first.requestId, "#208 stays quarantined");
        assert.equal(afterSecond.unresolved[0]?.quarantine?.reserveKrw, 10);
        assert.equal(afterSecond.unresolved[1]?.quarantine, null, "#325's reserve is released");
        assert.equal(afterSecond.callCount, heldBefore.callCount + 1);
        assert.ok(Math.abs(afterSecond.settledKrw - heldBefore.settledKrw - KRW_PER_CALL) < 1e-9);

        const settledBytes = stateBytes(first);
        await assert.rejects(() => run(first.sc, mockClassifier(first.sc)), refusedWith("interrupted_call_unresolved"));
        assert.equal(stateBytes(first), settledBytes, "re-running without the ACK neither re-settles nor changes anything");

        const acked = mockClassifier(first.sc);
        const report = await run(first.sc, acked, { ADULT_OFF_BATCH_ACK_UNRESOLVED_REQUEST_ID: first.second.requestId });
        assert.equal(report.stopReason, "quarantine_pending", "#208 is still held, so the batch is not complete");
        assert.deepEqual(
          acked.calls.map((call) => call.text),
          [SECOND_TEXT],
          "only the acknowledged #325 text is re-classified; the #208 text is never sent"
        );
        assert.deepEqual(unresolvedIds(first), [first.requestId]);

        const reverse = await seedHaltedSecondCall();
        await run(reverse.sc, mockClassifier(reverse.sc), approvalFor(reverse));
        confirm(reverse, reverse.requestId, USD_PER_CALL);
        await assert.rejects(() => run(reverse.sc, mockClassifier(reverse.sc)), refusedWith("interrupted_call_unresolved"));
        const reversed = loadAdultOffBatchState(reverse.stateDir);
        assert.equal(reversed.unresolved[0]?.quarantine, null);
        assert.equal(reversed.unresolved[1]?.quarantine?.requestId, reverse.second.requestId, "#325 stays quarantined");
        assert.equal(reversed.unresolved[1]?.quarantine?.reserveKrw, 10);
      });

      it("asks for one ACK per unresolved call and never re-classifies both texts from a single ACK", async () => {
        const seed = await seedHaltedSecondCall();
        await run(seed.sc, mockClassifier(seed.sc), approvalFor(seed));
        confirm(seed, seed.requestId, USD_PER_CALL);
        confirm(seed, seed.second.requestId, USD_PER_CALL);
        await assert.rejects(() => run(seed.sc, mockClassifier(seed.sc)), refusedWith("interrupted_call_unresolved"));
        const mock = mockClassifier(seed.sc);
        await assert.rejects(
          () => run(seed.sc, mock, { ADULT_OFF_BATCH_ACK_UNRESOLVED_REQUEST_ID: seed.requestId }),
          refusedWith("interrupted_call_unresolved")
        );
        assert.equal(mock.calls.length, 0);
        const state = loadAdultOffBatchState(seed.stateDir);
        assert.deepEqual(state.unresolved.map((call) => call.requestIds[0]), [seed.second.requestId]);
        const last = mockClassifier(seed.sc);
        const report = await run(seed.sc, last, { ADULT_OFF_BATCH_ACK_UNRESOLVED_REQUEST_ID: seed.second.requestId });
        assert.equal(report.stopReason, "completed");
        assert.deepEqual(loadAdultOffBatchState(seed.stateDir).unresolved, []);
      });

      for (const mode of ["before-rename", "after-rename"] as const) {
        it(`applies one of two confirmed costs exactly once when killed ${mode}, keeping the other quarantine`, async () => {
          const seed = await seedHaltedSecondCall();
          await run(seed.sc, mockClassifier(seed.sc), approvalFor(seed));
          confirm(seed, seed.second.requestId, USD_PER_CALL);
          const held = loadAdultOffBatchState(seed.stateDir);
          const bytes = stateBytes(seed);
          killDuringStateSave(seed, mode, {});
          if (mode === "before-rename") {
            assert.equal(stateBytes(seed), bytes, "no half-applied settlement");
          } else {
            const saved = loadAdultOffBatchState(seed.stateDir);
            assert.equal(saved.callCount, held.callCount + 1, "cost, call count and reserve release land in the same save");
            assert.equal(saved.unresolved[1]?.quarantine, null);
          }
          for (let attempt = 0; attempt < 2; attempt += 1) {
            await assert.rejects(() => run(seed.sc, mockClassifier(seed.sc)), refusedWith("interrupted_call_unresolved"));
            const state = loadAdultOffBatchState(seed.stateDir);
            assert.equal(state.callCount, held.callCount + 1, `attempt ${attempt}: call counted once`);
            assert.ok(Math.abs(state.settledKrw - held.settledKrw - KRW_PER_CALL) < 1e-9, `attempt ${attempt}: cost counted once`);
            assert.equal(state.unresolved[0]?.quarantine?.requestId, seed.requestId, "#208 stays quarantined");
            assert.equal(state.unresolved[0]?.quarantine?.reserveKrw, 10);
          }
        });
      }

      it("keeps every other unknown-cost call a STOP while two calls are quarantined", async () => {
        const seed = await seedHaltedSecondCall();
        await run(seed.sc, mockClassifier(seed.sc), approvalFor(seed));
        insertLedger(seed.sc.fx, buildAdultOffBatchGenerationRequestId(SEED_RUN_ID, 9001), {
          usd: null,
          source: "unavailable",
          status: "failed_without_usage",
          messageId: seed.targetId,
        });
        const mock = mockClassifier(seed.sc);
        await assert.rejects(() => run(seed.sc, mock), refusedWith("ledger_unknown_cost"));
        assert.equal(mock.calls.length, 0);
        assert.equal(loadAdultOffBatchState(seed.stateDir).halted?.reason, "halted_unknown_cost");
      });

      it("keeps a new interrupted call a STOP while others are quarantined unless that exact call is approved", async () => {
        const seed = await seedHaltedSecondCall();
        await run(seed.sc, mockClassifier(seed.sc), approvalFor(seed));
        const state = loadAdultOffBatchState(seed.stateDir);
        const thirdId = insertAssistant(seed.sc.fx, { content: "세 번째로 끊긴 본문" });
        const thirdRequestId = buildAdultOffBatchGenerationRequestId(SEED_RUN_ID, state.nextCallSeq);
        const thirdKey = randomUUID();
        fs.writeFileSync(
          path.join(seed.stateDir, "batch.state.json"),
          JSON.stringify({
            ...state,
            inFlight: {
              messageId: thirdId,
              surface: "body",
              requestIds: [thirdRequestId],
              openRequestId: thirdRequestId,
              reservedKrw: 10,
            },
            nextCallSeq: state.nextCallSeq + 1,
          })
        );
        insertLedger(seed.sc.fx, thirdRequestId, {
          usd: null,
          source: "unavailable",
          status: "started",
          messageId: thirdId,
          eventKey: thirdKey,
        });
        const before = stateBytes(seed);
        const mock = mockClassifier(seed.sc);
        await assert.rejects(() => run(seed.sc, mock), refusedWith("interrupted_call_cost_unknown"));
        await assert.rejects(() => run(seed.sc, mock, approvalFor(seed)), refusedWith("quarantine_approval_mismatch"));
        assert.equal(mock.calls.length, 0);
        assert.equal(stateBytes(seed), before, "the two held quarantines and the third marker are all kept");
      });

      it("shows every held call, its reserve and the real remaining window count in PLAN_ONLY and in the execute report", async () => {
        const seed = await seedHaltedSecondCall();
        const report = await run(seed.sc, mockClassifier(seed.sc), approvalFor(seed));
        assert.equal(report.stopReason, "quarantine_pending");
        assert.equal(report.quarantines.length, 2);
        const db = new Database(seed.sc.dbPath, { readonly: true, fileMustExist: true });
        try {
          const planConfig = parseAdultOffBatchPaidRunConfig(
            { ...seed.sc.env(), ADULT_OFF_BATCH_MODE: "plan" },
            seed.sc.dbPath
          );
          const plan = buildAdultOffBatchPlanReport(db, { ...planConfig, stateDir: seed.stateDir });
          assert.deepEqual(
            plan.batchState.quarantines.map((held) => [held.requestId, held.ledgerStatus, held.reserveKrw]),
            [
              [seed.requestId, "started", 10],
              [seed.second.requestId, "failed_without_usage", 10],
            ]
          );
          assert.equal(plan.batchState.existing?.unresolvedCalls, 2);
          assert.equal(plan.batchState.existing?.heldReserveKrw, 20);
          assert.ok(plan.pendingClassification.windows >= 2, "both quarantined texts still count as pending windows");
        } finally {
          db.close();
        }
      });
    });

    describe("batch classifier timeout wiring and failure log", () => {
      it("gives every batch call the batch-only timeout and never retries a failed call", async () => {
        const sc = scenario(SEED_RUN_ID);
        insertAssistant(sc.fx, { content: "시간 초과 본문" });
        const seen: Array<{ timeoutMs: number | undefined }> = [];
        const logged: unknown[] = [];
        const failing = {
          calls: [] as Array<{ requestId: string | null }>,
          createClassifier:
            (scope: AdultOffClassifierTurnScope, options: { timeoutMs?: number }): AdultOffClassify =>
            async () => {
              seen.push({ timeoutMs: options.timeoutMs });
              failing.calls.push({ requestId: scope.generationRequestId });
              insertLedger(sc.fx, scope.generationRequestId!, {
                usd: null,
                source: "unavailable",
                status: "failed_without_usage",
                messageId: scope.assistantMessageId,
              });
              throw new AdultOffClassifierCallError("The operation timed out.", "timeout", {
                model: "mock",
                inputTokens: null,
                outputTokens: null,
                costUsd: null,
                providerRequestId: null,
                latencyMs: 60_001,
                outcome: "timeout",
                httpStatus: null,
              });
            },
        };
        const report = await executeAdultOffBatchPaidRun({
          config: sc.config(),
          openDatabase: () => new Database(sc.dbPath, { fileMustExist: true }),
          createClassifier: failing.createClassifier,
          onClassifierFailure: (failure) => logged.push(failure),
        });
        assert.equal(ADULT_OFF_BATCH_CLASSIFIER_TIMEOUT_MS, 60_000);
        assert.deepEqual(seen, [{ timeoutMs: 60_000 }]);
        assert.equal(failing.calls.length, 1, "a real timeout is a single attempt with no automatic retry");
        assert.equal(report.stopReason, "halted_unknown_cost");
        const expected = {
          requestId: failing.calls[0]!.requestId,
          outcome: "timeout",
          httpStatus: null,
          responseReceived: false,
          elapsedMs: 60_001,
          timeoutMs: 60_000,
        };
        assert.deepEqual(report.classifierFailures, [expected]);
        assert.deepEqual(logged, [expected]);
        assert.ok(!JSON.stringify(report.classifierFailures).includes("시간 초과 본문"), "no RP text in the failure log");
      });

      it("records an HTTP failure with its status and a received response", async () => {
        const sc = scenario(SEED_RUN_ID);
        insertAssistant(sc.fx, { content: "HTTP 오류 본문" });
        const failing = {
          createClassifier:
            (scope: AdultOffClassifierTurnScope): AdultOffClassify =>
            async () => {
              insertLedger(sc.fx, scope.generationRequestId!, { usd: 0.0001, messageId: scope.assistantMessageId });
              throw new AdultOffClassifierCallError("upstream unavailable", "http_error", {
                model: "mock",
                inputTokens: null,
                outputTokens: null,
                costUsd: null,
                providerRequestId: "prov-http",
                latencyMs: 812,
                outcome: "http_error",
                httpStatus: 503,
              });
            },
        };
        const report = await executeAdultOffBatchPaidRun({
          config: sc.config(),
          openDatabase: () => new Database(sc.dbPath, { fileMustExist: true }),
          createClassifier: failing.createClassifier,
        });
        assert.equal(report.stopReason, "halted_classifier_error");
        assert.deepEqual(
          report.classifierFailures.map(({ outcome, httpStatus, responseReceived, elapsedMs }) => ({
            outcome,
            httpStatus,
            responseReceived,
            elapsedMs,
          })),
          [{ outcome: "http_error", httpStatus: 503, responseReceived: true, elapsedMs: 812 }]
        );
      });
    });
  });

  describe("foreign-host stale lock recovery", () => {
    const OLD_HOST = "railway-old-container";
    const HOUR_MS = 60 * 60 * 1000;
    const refusedLocked = (error: unknown) =>
      error instanceof AdultOffBatchRunRefusedError && error.code === "concurrent_run_locked";

    function foreignLock(sc: Scenario, overrides: Record<string, unknown> = {}) {
      fs.mkdirSync(sc.stateDir, { recursive: true, mode: 0o700 });
      const holder = {
        pid: 4242,
        host: OLD_HOST,
        runId: "adult-off-c3-20261023",
        startedAt: "2026-10-23T06:00:00.000Z",
        ...overrides,
      };
      const file = path.join(sc.stateDir, "execution.lock");
      fs.writeFileSync(file, JSON.stringify(holder));
      const old = new Date(Date.now() - HOUR_MS);
      fs.utimesSync(file, old, old);
      const pin = {
        host: holder.host as string,
        pid: holder.pid as number,
        runId: holder.runId as string,
        startedAt: holder.startedAt as string,
      };
      return { file, holder, pin };
    }

    const tombstones = (sc: Scenario): string[] =>
      fs.readdirSync(sc.stateDir).filter((name) => name.startsWith("execution.lock.reclaimed."));

    it("reclaims a previous container's lock only with an exact pin on a quiescent state, keeping a tombstone", () => {
      const sc = scenario("run-foreign-ok");
      const { file, holder, pin } = foreignLock(sc);
      fs.writeFileSync(path.join(sc.stateDir, "batch.state.json"), "{}");
      const old = new Date(Date.now() - HOUR_MS);
      fs.utimesSync(path.join(sc.stateDir, "batch.state.json"), old, old);
      const original = fs.readFileSync(file, "utf8");

      const lock = acquireAdultOffBatchExecutionLock(sc.stateDir, "run-foreign-ok", { foreignLockPin: pin });
      const held = JSON.parse(fs.readFileSync(file, "utf8")) as { pid: number; host: string; runId: string };
      assert.equal(held.pid, process.pid);
      assert.equal(held.host, os.hostname());
      assert.equal(held.runId, "run-foreign-ok");
      const kept = tombstones(sc);
      assert.equal(kept.length, 1, "the old lock is moved aside, never deleted");
      assert.equal(fs.readFileSync(path.join(sc.stateDir, kept[0]!), "utf8"), original);
      assert.equal(JSON.parse(original).host, holder.host);
      assert.equal(fs.existsSync(path.join(sc.stateDir, "execution.lock.reclaim")), false, "the reclaim guard is released");
      lock.release();
      assert.equal(fs.existsSync(file), false);
    });

    it("refuses without a pin, with any mismatching pin field, with a fresh lock or state, and for a live or same-deployment holder", () => {
      const sc = scenario("run-foreign-refused");
      const { file, pin } = foreignLock(sc);
      const original = fs.readFileSync(file, "utf8");
      const attempt = (foreignLockPin: typeof pin | null) => () =>
        acquireAdultOffBatchExecutionLock(sc.stateDir, "run-foreign-refused", { foreignLockPin });
      const unchanged = (name: string): void => {
        assert.equal(fs.readFileSync(file, "utf8"), original, name);
        assert.deepEqual(tombstones(sc), [], name);
      };

      assert.throws(attempt(null), refusedLocked);
      unchanged("no pin: a different host name alone never reclaims");
      for (const [name, patch] of [
        ["host", { host: "someone-else" }],
        ["pid", { pid: 4243 }],
        ["runId", { runId: "adult-off-c3-other" }],
        ["startedAt", { startedAt: "2026-10-23T06:00:01.000Z" }],
      ] as const) {
        assert.throws(attempt({ ...pin, ...patch }), refusedLocked, name);
        unchanged(name);
      }

      const fresh = new Date();
      fs.utimesSync(file, fresh, fresh);
      assert.throws(attempt(pin), refusedLocked);
      unchanged("a lock that was just written may belong to an active run");
      const old = new Date(Date.now() - HOUR_MS);
      fs.utimesSync(file, old, old);

      fs.writeFileSync(path.join(sc.stateDir, "batch.state.json"), "{}");
      assert.throws(attempt(pin), refusedLocked);
      unchanged("a state file written moments ago means an active run");
      fs.unlinkSync(path.join(sc.stateDir, "batch.state.json"));

      const savedDeployment = process.env.RAILWAY_DEPLOYMENT_ID;
      try {
        process.env.RAILWAY_DEPLOYMENT_ID = "dep-current";
        const { file: sameDeploymentFile, pin: samePin } = foreignLock(sc, { deploymentId: "dep-current" });
        assert.throws(attempt(samePin), refusedLocked);
        assert.ok(fs.existsSync(sameDeploymentFile));
      } finally {
        if (savedDeployment === undefined) delete process.env.RAILWAY_DEPLOYMENT_ID;
        else process.env.RAILWAY_DEPLOYMENT_ID = savedDeployment;
      }

      const live = foreignLock(sc, { pid: process.pid, host: os.hostname(), runId: "live-run-here" });
      assert.throws(attempt(live.pin), refusedLocked);
      assert.ok(fs.existsSync(live.file), "a live process on this host is never reclaimed, pin or not");
      assert.deepEqual(tombstones(sc), []);
    });

    async function raceForLock(
      sc: Scenario,
      pin: { host: string; pid: number; runId: string; startedAt: string } | null
    ): Promise<string[]> {
      const barrier = path.join(sc.dir, "go");
      const child = path.join(sc.dir, "race-child.ts");
      fs.writeFileSync(
        child,
        `import fs from "node:fs";
import { acquireAdultOffBatchExecutionLock } from ${JSON.stringify(path.join(REPO_ROOT, "src/lib/adultOffBatchPaidRun.ts"))};

const [stateDir, barrier, index] = process.argv.slice(2);
const pin = ${JSON.stringify(pin)};
async function main() {
  fs.writeFileSync(barrier + ".ready." + index, "1");
  while (!fs.existsSync(barrier)) await new Promise((resolve) => setTimeout(resolve, 2));
  try {
    const lock = acquireAdultOffBatchExecutionLock(stateDir, "race-run-" + index, { foreignLockPin: pin });
    console.log("ACQUIRED");
    await new Promise((resolve) => setTimeout(resolve, 1500));
    lock.release();
  } catch (error) {
    console.log("REFUSED " + (error && error.code));
  }
}
main();
`
      );
      const workers = Array.from({ length: 6 }, (_, index) =>
        new Promise<string>((resolve, reject) => {
          const proc = spawn(
            process.execPath,
            ["--conditions=react-server", "--import", "tsx", child, sc.stateDir, barrier, String(index)],
            { cwd: REPO_ROOT, env: childEnv({}) }
          );
          let out = "";
          proc.stdout.on("data", (chunk) => (out += String(chunk)));
          proc.stderr.on("data", (chunk) => (out += String(chunk)));
          proc.on("error", reject);
          proc.on("close", () => resolve(out.trim()));
        })
      );
      const readyDeadline = Date.now() + 60_000;
      while (
        Array.from({ length: 6 }, (_, index) => fs.existsSync(`${barrier}.ready.${index}`)).includes(false)
      ) {
        assert.ok(Date.now() < readyDeadline, "every racing process must be ready before the start signal");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      fs.writeFileSync(barrier, "go");
      return Promise.all(workers);
    }

    it("lets only one of several concurrent recoveries take the lock", async () => {
      const sc = scenario("run-foreign-race");
      const { pin } = foreignLock(sc);
      const outputs = await raceForLock(sc, pin);
      assert.equal(outputs.filter((out) => out === "ACQUIRED").length, 1, outputs.join(" | "));
      assert.equal(outputs.filter((out) => out === "REFUSED concurrent_run_locked").length, 5, outputs.join(" | "));
      assert.equal(tombstones(sc).length, 1);
    });

    it("lets only one of several concurrent first acquisitions take a fresh lock", async () => {
      const sc = scenario("run-fresh-race");
      fs.mkdirSync(sc.stateDir, { recursive: true, mode: 0o700 });
      const outputs = await raceForLock(sc, null);
      assert.equal(outputs.filter((out) => out === "ACQUIRED").length, 1, outputs.join(" | "));
      assert.equal(outputs.filter((out) => out === "REFUSED concurrent_run_locked").length, 5, outputs.join(" | "));
      assert.deepEqual(tombstones(sc), []);
    });

    it("refuses a first acquisition while a reclaim guard is left and creates no lock", () => {
      const sc = scenario("run-guard-only");
      fs.mkdirSync(sc.stateDir, { recursive: true, mode: 0o700 });
      const guard = path.join(sc.stateDir, "execution.lock.reclaim");
      fs.writeFileSync(guard, JSON.stringify({ pid: 999999, host: OLD_HOST, at: "2026-10-23T06:00:00.000Z" }));
      assert.throws(
        () => acquireAdultOffBatchExecutionLock(sc.stateDir, "run-guard-only"),
        (error: unknown) => refusedLocked(error) && /operator must review/.test((error as Error).message)
      );
      assert.equal(fs.existsSync(path.join(sc.stateDir, "execution.lock")), false, "no lock is created behind the guard");
      assert.equal(fs.existsSync(guard), true, "the interruption trace is kept for the operator");
      const { pin } = foreignLock(sc);
      assert.throws(
        () => acquireAdultOffBatchExecutionLock(sc.stateDir, "run-guard-only", { foreignLockPin: pin }),
        refusedLocked
      );
      assert.deepEqual(tombstones(sc), []);
    });

    const assertInterruptedReclaimLeavesGuard = (
      sc: Scenario,
      file: string,
      pin: ReturnType<typeof foreignLock>["pin"],
      original: string,
      afterReclaimRename: string
    ): void => {
      const child = path.join(sc.dir, "reclaim-interrupt-child.ts");
      fs.writeFileSync(
        child,
        `import { acquireAdultOffBatchExecutionLock } from ${JSON.stringify(path.join(REPO_ROOT, "src/lib/adultOffBatchPaidRun.ts"))};

const [stateDir] = process.argv.slice(2);
try {
  acquireAdultOffBatchExecutionLock(stateDir, "interrupted-reclaim", {
    foreignLockPin: ${JSON.stringify(pin)},
    afterReclaimRename: ${afterReclaimRename},
  });
} catch (error) {
  console.error(error);
  process.exit(1);
}
`
      );
      const result = spawnSync(
        process.execPath,
        ["--conditions=react-server", "--import", "tsx", child, sc.stateDir],
        { cwd: REPO_ROOT, env: childEnv({}), encoding: "utf8" }
      );
      assert.notEqual(result.status, 0, `${result.stdout}${result.stderr}`);
      assert.equal(fs.existsSync(file), false, "the old lock was already moved aside");
      assert.equal(tombstones(sc).length, 1);
      assert.equal(fs.readFileSync(path.join(sc.stateDir, tombstones(sc)[0]!), "utf8"), original);
      assert.equal(
        fs.existsSync(path.join(sc.stateDir, "execution.lock.reclaim")),
        true,
        "the guard must stay when reclaim moved the lock aside but acquisition did not finish"
      );

      for (const options of [{}, { foreignLockPin: pin }]) {
        assert.throws(
          () => acquireAdultOffBatchExecutionLock(sc.stateDir, "after-interrupted-reclaim", options),
          refusedLocked
        );
        assert.equal(fs.existsSync(file), false, "nobody takes the lock behind the leftover guard");
      }
    };

    it("refuses every later run after a process is killed right after moving the old lock aside", () => {
      const sc = scenario("run-killed-reclaim");
      const { file, pin } = foreignLock(sc);
      const original = fs.readFileSync(file, "utf8");
      assertInterruptedReclaimLeavesGuard(
        sc,
        file,
        pin,
        original,
        "() => process.kill(process.pid, \"SIGKILL\")"
      );
    });

    it("refuses every later run after a thrown error right after moving the old lock aside", () => {
      const sc = scenario("run-throw-reclaim");
      const { file, pin } = foreignLock(sc);
      const original = fs.readFileSync(file, "utf8");
      assertInterruptedReclaimLeavesGuard(
        sc,
        file,
        pin,
        original,
        "() => { throw new Error(\"reclaim interrupted after rename\"); }"
      );
    });

    it("keeps a normal acquire and release working and leaves no guard behind", () => {
      const sc = scenario("run-normal-lock");
      const first = acquireAdultOffBatchExecutionLock(sc.stateDir, "run-normal-lock");
      assert.equal(fs.existsSync(path.join(sc.stateDir, "execution.lock.reclaim")), false);
      assert.throws(() => acquireAdultOffBatchExecutionLock(sc.stateDir, "run-normal-lock-2"), refusedLocked);
      assert.equal(fs.existsSync(path.join(sc.stateDir, "execution.lock.reclaim")), false, "a clean refusal also releases the guard");
      first.release();
      assert.equal(fs.existsSync(path.join(sc.stateDir, "execution.lock")), false);
      acquireAdultOffBatchExecutionLock(sc.stateDir, "run-normal-lock-3").release();
      assert.deepEqual(tombstones(sc), []);
    });

    it("keeps the same-host dead-PID reclaim on the same single guarded path", () => {
      const sc = scenario("run-same-host-dead");
      fs.mkdirSync(sc.stateDir, { recursive: true, mode: 0o700 });
      const dead = spawnSync(process.execPath, ["-e", ""]);
      const file = path.join(sc.stateDir, "execution.lock");
      fs.writeFileSync(file, JSON.stringify({ pid: dead.pid, host: os.hostname(), runId: "ghost", startedAt: "" }));
      const lock = acquireAdultOffBatchExecutionLock(sc.stateDir, "run-same-host-dead");
      assert.equal(tombstones(sc).length, 1);
      lock.release();
    });

    it("validates the lock reclaim approval before anything runs", () => {
      const sc = scenario("run-lock-config");
      const pinEnv = {
        ADULT_OFF_BATCH_RECLAIM_LOCK_HOST: OLD_HOST,
        ADULT_OFF_BATCH_RECLAIM_LOCK_PID: "4242",
        ADULT_OFF_BATCH_RECLAIM_LOCK_RUN_ID: "adult-off-c3-20261023",
        ADULT_OFF_BATCH_RECLAIM_LOCK_STARTED_AT: "2026-10-23T06:00:00.000Z",
      };
      assert.deepEqual(sc.config(pinEnv).reclaimForeignLock, {
        host: OLD_HOST,
        pid: 4242,
        runId: "adult-off-c3-20261023",
        startedAt: "2026-10-23T06:00:00.000Z",
      });
      assert.equal(sc.config().reclaimForeignLock, null);
      for (const name of Object.keys(pinEnv)) {
        assert.throws(
          () => sc.config({ ...pinEnv, [name]: undefined }),
          (error: unknown) => error instanceof AdultOffBatchConfigError && error.code === "invalid_reclaim_foreign_lock",
          name
        );
      }
      assert.throws(
        () => sc.config({ ...pinEnv, ADULT_OFF_BATCH_RECLAIM_LOCK_PID: "0" }),
        (error: unknown) => error instanceof AdultOffBatchConfigError && error.code === "invalid_reclaim_foreign_lock"
      );
    });
  });
});

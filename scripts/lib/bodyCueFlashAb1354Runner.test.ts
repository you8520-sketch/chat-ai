import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createRequire } from "node:module";

import { adaptCheaperInferenceChatBody } from "@/lib/cheaperInferenceConfig";
import { CHEAPER_INFERENCE_MODELS_SOURCE_URL } from "@/lib/modelPricingTrackingConfig";
import {
  APPROVED_EXECUTION_PLAN,
  assertArtifactHasNoSecrets,
  assertCall1Gate,
  assertPacketReadyForPaid,
  applyBodyCue1354ExperimentOverrides,
  assignBlindLabels,
  BODY_CUE_1354_MAX_TOKENS,
  BODY_CUE_1354_MIN_DISCOUNT_PERCENT,
  BODY_CUE_1354_MODEL,
  BODY_CUE_1354_SUPPLY_URL,
  CatalogGateError,
  createOperatorCheaperInferenceTransport,
  deriveExperimentRequests,
  ExperimentSecretError,
  interpretPaidCompletion,
  LiveSealError,
  MAX_PAID_ATTEMPTS,
  openSqliteQueryOnly,
  PaidAttemptBudget,
  PaidAttemptBudgetError,
  parseFlashCatalogGate,
  parseFlashSupplyGate,
  readExperimentSecretOnce,
  runBodyCueFlashAb1354,
  RunnerStopError,
  sealLiveDeployedInputFromDb,
  type CatalogGetFn,
  type ExperimentArmRequest,
  type LiveSeal,
  type PaidCallResult,
  type ProviderPostFn,
} from "./bodyCueFlashAb1354Runner";
import type { LiveDeployedBodyCueRows } from "./mainRpBodyCuePreflight";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as typeof import("better-sqlite3");

const SECRET = "sk-test-experiment-secret";
const PROD_KEY = "prod-key-must-never-be-used";
const SOURCE_MARKER = "UNIQUE_SOURCE_MARKER_렌본부숙소창가";
const FORBIDDEN = [SECRET, PROD_KEY, SOURCE_MARKER, "닉네임테스트", "Authorization"];

function syntheticRows(): LiveDeployedBodyCueRows {
  return {
    character: {
      id: 18,
      name: "라이크",
      gender: "male",
      system_prompt: `${SOURCE_MARKER} 공개 테스트 캐릭터. 본부 숙소에서 대기한다.`,
      world: "테스트 세계. 본부 숙소가 있다.",
      example_dialog: "라이크: 앉아.",
      description: "짧게 말한다.",
      greeting: "라이크는 숙소 안을 한 번 둘러보고 고개를 끄덕였다.",
      setting_chunks: "[]",
      setting_chunks_en: "[]",
      speech_profile: "",
      creator_compiled_description_json: "",
      appearance_raw: "",
      appearance_compiled: "",
      narration_style_instructions: "",
      content_kind: "character",
    },
    persona: {
      name: "렌",
      gender: "male",
      description: "공개 테스트 페르소나. 신입 가이드.",
    },
    userNickname: "닉네임테스트",
  };
}

function passingPacket(overrides?: { soleAllowedDiff?: boolean; source?: "LIVE_VERIFIED" | "SYNTHETIC" }): LiveSeal["packet"] {
  const scene = {
    soleAllowedDiff: overrides?.soleAllowedDiff ?? true,
    rulesShaEqual: true,
    dynamicShaEqual: true,
    promptChars: 100,
    flatCharDelta: -8,
    baseline: { cached: [true, true, false], safeContract: true, normalAuthoring: true },
    candidate: { cached: [true, true, false], safeContract: true, normalAuthoring: true },
  };
  return {
    evidence: { source: overrides?.source ?? "LIVE_VERIFIED", characterId: 18 },
    authoringLevel: "NORMAL",
    scenes: [
      { id: "quiet_window_safe", ...scene },
      { id: "relationship_turn_safe", ...scene },
    ],
  } as LiveSeal["packet"];
}

function passingSeal(): LiveSeal {
  return {
    rows: syntheticRows(),
    packet: passingPacket(),
    queryOnly: true,
    report: {
      characterId: 18,
      likeUnique: true,
      id10IsLike: false,
      adminCount: 1,
      adminRenCount: 1,
      hashMatrix: {
        greeting: "MATCH",
        system_prompt: "MATCH",
        world: "MATCH",
        setting_chunks: "MATCH",
        public_persona_description: "MATCH",
      },
      nickname_equals_persona: false,
      nicknameLength: 6,
      english: {
        setting_chunks_en_present: false,
        prompt_translation_hash_present: false,
        classifyEnglishLayer: "MISSING",
        usedEnglish: false,
        bytesPresent: false,
        applied: false,
      },
    },
  };
}

function passingCatalogPayload(overrides?: {
  missing?: boolean;
  available?: boolean;
  input?: number;
  output?: number;
}) {
  if (overrides?.missing) {
    return {
      pricing_version: "pv-1",
      pricing_checked_at: "2026-10-04T00:00:00Z",
      pricing_updated_at: "2026-10-04T00:00:00Z",
      data: [{ id: "other-model", available: true, pricing: { input_per_million: 0.01, output_per_million: 0.02 } }],
    };
  }
  return {
    pricing_version: "pv-1",
    pricing_checked_at: "2026-10-04T00:00:00Z",
    pricing_updated_at: "2026-10-04T00:00:00Z",
    data: [
      {
        id: BODY_CUE_1354_MODEL,
        available: overrides?.available ?? true,
        pricing: {
          input_per_million: overrides?.input ?? 0.075,
          output_per_million: overrides?.output ?? 0.3,
          cache_read_input_per_million: 0.0075,
          cache_write_input_per_million: 0.075,
        },
      },
    ],
  };
}

function passingSupplyPayload(overrides?: { candidateCount?: number; maxInput?: number; maxOutput?: number }) {
  return {
    candidate_count: overrides?.candidateCount ?? 2,
    max_input_per_million: overrides?.maxInput ?? 0.075,
    max_output_per_million: overrides?.maxOutput ?? 0.3,
  };
}

function passingCatalogGet(overrides?: {
  modelsOk?: boolean;
  modelsPayload?: unknown;
  supplyOk?: boolean;
  supplyPayload?: unknown;
}): { fn: CatalogGetFn; urls: string[] } {
  const urls: string[] = [];
  const fn: CatalogGetFn = async (input) => {
    urls.push(input.url);
    if (input.url.includes("/models/supply")) {
      return {
        ok: overrides?.supplyOk ?? true,
        httpStatus: (overrides?.supplyOk ?? true) ? 200 : 503,
        payload: overrides?.supplyPayload ?? passingSupplyPayload(),
      };
    }
    return {
      ok: overrides?.modelsOk ?? true,
      httpStatus: (overrides?.modelsOk ?? true) ? 200 : 503,
      payload: overrides?.modelsPayload ?? passingCatalogPayload(),
    };
  };
  return { fn, urls };
}

function successCall(n: number, overrides?: Partial<PaidCallResult>): PaidCallResult {
  return {
    httpStatus: 200,
    model: BODY_CUE_1354_MODEL,
    promptTokens: 100,
    completionTokens: 16,
    cacheReadTokens: 4,
    cacheWriteTokens: 1,
    billedCostUsd: 0.001 * n,
    settled: true,
    requestId: `req-${n}`,
    text: `generated-output-${n}`,
    retried: false,
    fallback: false,
    ...overrides,
  };
}

function trackingPost(overridesForCall?: (n: number) => Partial<PaidCallResult> | Error): {
  fn: ProviderPostFn;
  box: { calls: number };
} {
  const box = { calls: 0 };
  const fn: ProviderPostFn = async () => {
    box.calls += 1;
    const override = overridesForCall?.(box.calls);
    if (override instanceof Error) throw override;
    return successCall(box.calls, override);
  };
  return { fn, box };
}

function sequentialLabels(requests: ExperimentArmRequest[]) {
  const labels = ["Q-X7", "R-P4", "Q-M2", "R-K9"];
  const labeled = requests.map((request, index) => ({
    ...request,
    opaqueLabel: labels[index] ?? `X-${index}`,
  }));
  const mapping = labeled.map((item) => ({
    opaqueLabel: item.opaqueLabel,
    sceneId: item.sceneId,
    variant: item.variant,
  }));
  return {
    labeled,
    reveal: {
      nonce: "test-nonce",
      commitmentSha256: "commitment-test",
      mapping,
    },
  };
}

function tempDbPath(): string {
  return path.join(os.tmpdir(), `body-cue-1354-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
}

function writeSqlite(dbPath: string, setup: (db: import("better-sqlite3").Database) => void) {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY,
      name TEXT,
      greeting TEXT DEFAULT '',
      system_prompt TEXT DEFAULT '',
      world TEXT DEFAULT '',
      setting_chunks TEXT DEFAULT '',
      setting_chunks_en TEXT DEFAULT '',
      prompt_translation_hash TEXT DEFAULT '',
      gender TEXT DEFAULT 'male',
      nsfw INTEGER DEFAULT 0,
      official INTEGER DEFAULT 0,
      speech_profile TEXT DEFAULT '',
      creator_compiled_description_json TEXT DEFAULT '',
      appearance_raw TEXT DEFAULT '',
      appearance_compiled TEXT DEFAULT '',
      appearance_compiled_source_hash TEXT DEFAULT '',
      appearance_compiled_version INTEGER DEFAULT 0,
      example_dialog TEXT DEFAULT '',
      description TEXT DEFAULT '',
      content_kind TEXT DEFAULT 'character',
      narration_style_instructions TEXT DEFAULT ''
    );
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      email TEXT,
      is_admin INTEGER DEFAULT 0,
      account_kind TEXT,
      nickname TEXT DEFAULT ''
    );
    CREATE TABLE user_personas (
      id INTEGER PRIMARY KEY,
      user_id INTEGER,
      name TEXT,
      gender TEXT DEFAULT 'male',
      description TEXT DEFAULT ''
    );
  `);
  setup(db);
  db.close();
}

async function expectZeroPost(run: () => Promise<unknown>, post: { calls: number }) {
  await assert.rejects(run);
  assert.equal(post.calls, 0);
}

describe("#1354 Flash A/B operator runner", () => {
  it("fails closed with zero POST when experiment secret is missing", async () => {
    const post = trackingPost();
    process.env.CHEAPER_INFERENCE_API_KEY = PROD_KEY;
    await assert.rejects(
      () =>
        runBodyCueFlashAb1354({
          mode: "execute",
          secretSource: null,
          seal: passingSeal,
          post: post.fn,
          catalogGet: passingCatalogGet().fn,
        }),
      ExperimentSecretError
    );
    assert.equal(post.box.calls, 0);
  });

  it("fails closed with zero POST when only the production key is present", async () => {
    const post = trackingPost();
    process.env.CHEAPER_INFERENCE_API_KEY = PROD_KEY;
    await assert.rejects(
      () =>
        runBodyCueFlashAb1354({
          mode: "execute",
          secretSource: null,
          seal: passingSeal,
          post: post.fn,
          catalogGet: passingCatalogGet().fn,
        }),
      (error: unknown) =>
        error instanceof ExperimentSecretError &&
        !String(error.message).includes(PROD_KEY) &&
        !String(error.message).includes(SECRET)
    );
    assert.equal(post.box.calls, 0);
  });

  it("fails closed with zero POST on malformed experiment secret", async () => {
    const post = trackingPost();
    for (const raw of ["", "   ", "<EXPERIMENT_KEY>", "short"]) {
      await assert.rejects(
        () =>
          runBodyCueFlashAb1354({
            mode: "execute",
            secretSource: { kind: "stdin", read: () => raw },
            seal: passingSeal,
            post: post.fn,
            catalogGet: passingCatalogGet().fn,
          }),
        ExperimentSecretError
      );
    }
    assert.equal(post.box.calls, 0);
  });

  it("unlinks a 0600 secret file after one successful read and never prints it", () => {
    const file = path.join(os.tmpdir(), `exp-1354-${process.pid}.key`);
    fs.writeFileSync(file, `${SECRET}\n`, { mode: 0o600 });
    fs.chmodSync(file, 0o600);
    const value = readExperimentSecretOnce({ kind: "file", path: file });
    assert.equal(value, SECRET);
    assert.equal(fs.existsSync(file), false);
  });

  it("rejects a world-readable secret file before POST", async () => {
    const file = path.join(os.tmpdir(), `exp-1354-open-${process.pid}.key`);
    fs.writeFileSync(file, `${SECRET}\n`, { mode: 0o644 });
    fs.chmodSync(file, 0o644);
    const post = trackingPost();
    await assert.rejects(
      () =>
        runBodyCueFlashAb1354({
          mode: "execute",
          secretSource: { kind: "file", path: file },
          seal: passingSeal,
          post: post.fn,
          catalogGet: passingCatalogGet().fn,
        }),
      ExperimentSecretError
    );
    assert.equal(post.box.calls, 0);
    fs.unlinkSync(file);
  });

  it("opens sqlite with query_only and rejects writes", () => {
    const dbPath = tempDbPath();
    writeSqlite(dbPath, (db) => {
      db.prepare("INSERT INTO characters (id, name) VALUES (1, 'x')").run();
    });
    const db = openSqliteQueryOnly(dbPath);
    const queryOnly = db.pragma("query_only", { simple: true }) as unknown;
    const on =
      queryOnly === 1 ||
      queryOnly === "1" ||
      (typeof queryOnly === "object" &&
        queryOnly != null &&
        Number((queryOnly as { query_only?: unknown }).query_only) === 1);
    assert.equal(on, true);
    assert.throws(() => db.prepare("UPDATE characters SET name='y' WHERE id=1").run());
    db.close();
    fs.unlinkSync(dbPath);
  });

  it("live row mismatch fails closed with zero POST", async () => {
    const dbPath = tempDbPath();
    writeSqlite(dbPath, (db) => {
      db.prepare("INSERT INTO characters (id, name) VALUES (18, '라이크')").run();
      db.prepare("INSERT INTO characters (id, name) VALUES (19, '라이크')").run();
    });
    const post = trackingPost();
    await assert.rejects(
      () =>
        runBodyCueFlashAb1354({
          mode: "execute",
          secretSource: { kind: "stdin", read: () => SECRET },
          seal: () => sealLiveDeployedInputFromDb(dbPath),
          post: post.fn,
          catalogGet: passingCatalogGet().fn,
        }),
      LiveSealError
    );
    assert.equal(post.box.calls, 0);
    fs.unlinkSync(dbPath);
  });

  it("LIVE_VERIFIED false fails closed with zero POST", async () => {
    const post = trackingPost();
    await expectZeroPost(
      () =>
        runBodyCueFlashAb1354({
          mode: "execute",
          secretSource: { kind: "stdin", read: () => SECRET },
          seal: () => ({ ...passingSeal(), packet: passingPacket({ source: "SYNTHETIC" }) }),
          post: post.fn,
          catalogGet: passingCatalogGet().fn,
        }),
      post.box
    );
  });

  it("soleAllowedDiff false fails closed with zero POST", async () => {
    const post = trackingPost();
    await assert.rejects(
      () =>
        runBodyCueFlashAb1354({
          mode: "execute",
          secretSource: { kind: "stdin", read: () => SECRET },
          seal: () => ({ ...passingSeal(), packet: passingPacket({ soleAllowedDiff: false }) }),
          post: post.fn,
          catalogGet: passingCatalogGet().fn,
        }),
      (error: unknown) => error instanceof LiveSealError && error.reason === "sole_allowed_diff_false"
    );
    assert.equal(post.box.calls, 0);
  });

  it("attempt 5 throws before provider fetch", () => {
    const budget = new PaidAttemptBudget();
    let fetches = 0;
    for (let i = 0; i < MAX_PAID_ATTEMPTS; i += 1) {
      budget.consumeBeforePost();
      fetches += 1;
    }
    assert.throws(() => budget.consumeBeforePost(), PaidAttemptBudgetError);
    assert.equal(fetches, 4);
    assert.equal(budget.count, 4);
  });

  it("does not retry a failed CALL 1 and keeps attempted count", async () => {
    const post = trackingPost((n) => (n === 1 ? new Error("provider 503") : {}));
    const error = await runBodyCueFlashAb1354({
      mode: "execute",
      secretSource: { kind: "stdin", read: () => SECRET },
      seal: passingSeal,
      post: post.fn,
      catalogGet: passingCatalogGet().fn,
    }).catch((caught: unknown) => caught);
    assert.ok(error instanceof RunnerStopError);
    assert.equal(post.box.calls, 1);
    assert.equal(error.artifact.status, "CALL1_BLOCKED");
    assert.equal(error.artifact.attemptCount, 1);
    assert.equal(error.artifact.attemptedPostCount, 1);
    assert.equal(error.artifact.retries, 0);
    assert.equal(error.artifact.fallback, 0);
    assertArtifactHasNoSecrets(error.artifact, FORBIDDEN);
  });

  it("CALL 1 missing request id blocks CALL 2-4", async () => {
    const post = trackingPost((n) => (n === 1 ? { requestId: null } : {}));
    const error = await runBodyCueFlashAb1354({
      mode: "execute",
      secretSource: { kind: "stdin", read: () => SECRET },
      seal: passingSeal,
      post: post.fn,
      catalogGet: passingCatalogGet().fn,
    }).catch((caught: unknown) => caught);
    assert.ok(error instanceof RunnerStopError);
    assert.match(error.message, /missing request id/);
    assert.equal(post.box.calls, 1);
    assert.equal(error.artifact.status, "CALL1_BLOCKED");
  });

  it("prepare mode seals and assembles with paid POST count 0", async () => {
    const post = trackingPost();
    const { artifact, reveal } = await runBodyCueFlashAb1354({
      mode: "prepare",
      secretSource: null,
      seal: passingSeal,
      post: post.fn,
      catalogGet: passingCatalogGet().fn,
      assignLabels: sequentialLabels,
    });
    assert.equal(artifact.status, "PREPARE_READY");
    assert.equal(artifact.paidPostCount, 0);
    assert.equal(artifact.attemptedPostCount, 0);
    assert.equal(post.box.calls, 0);
    assert.equal(artifact.requests.length, 4);
    assert.equal(artifact.retries, 0);
    assert.equal(artifact.fallback, 0);
    assert.equal(artifact.catalog.url, CHEAPER_INFERENCE_MODELS_SOURCE_URL);
    assert.equal(artifact.catalog.available, null);
    assert.equal(artifact.catalog.inputUsdPerMillion, null);
    assert.equal(artifact.supply.url, BODY_CUE_1354_SUPPLY_URL);
    assert.equal(artifact.supply.min_discount_percent, BODY_CUE_1354_MIN_DISCOUNT_PERCENT);
    assert.equal(artifact.supply.candidateCount, null);
    assert.equal(artifact.labelCommitmentSha256, reveal.commitmentSha256);
    assert.equal(JSON.stringify(artifact).includes('"variant":"baseline"'), false);
    assert.equal(JSON.stringify(artifact).includes('"variant":"candidate"'), false);
    assertArtifactHasNoSecrets(artifact, FORBIDDEN);
  });

  it("execute control flow is GET models, GET supply, CALL 1, then 2-4", async () => {
    const catalogPayload = passingCatalogPayload();
    const supplyPayload = passingSupplyPayload();
    const catalog = passingCatalogGet({
      modelsPayload: catalogPayload,
      supplyPayload,
    });
    const post = trackingPost();
    const sequence: string[] = [];
    const catalogGet: CatalogGetFn = async (input) => {
      sequence.push(input.url.includes("/models/supply") ? "GET /models/supply" : "GET /models");
      return catalog.fn(input);
    };
    const providerPost: ProviderPostFn = async (input) => {
      sequence.push("POST");
      return post.fn(input);
    };
    const { artifact } = await runBodyCueFlashAb1354({
      mode: "execute",
      secretSource: { kind: "stdin", read: () => SECRET },
      seal: passingSeal,
      post: providerPost,
      catalogGet,
      assignLabels: sequentialLabels,
    });
    assert.deepEqual(sequence.slice(0, 3), ["GET /models", "GET /models/supply", "POST"]);
    assert.equal(catalog.urls[0], CHEAPER_INFERENCE_MODELS_SOURCE_URL);
    assert.match(catalog.urls[1] ?? "", /models\/supply/);
    assert.match(catalog.urls[1] ?? "", /min_discount_percent=50/);
    const expectedCatalog = parseFlashCatalogGate(catalogPayload);
    const expectedSupply = parseFlashSupplyGate(supplyPayload);
    assert.deepEqual(
      {
        available: artifact.catalog.available,
        inputUsdPerMillion: artifact.catalog.inputUsdPerMillion,
        outputUsdPerMillion: artifact.catalog.outputUsdPerMillion,
        cacheReadUsdPerMillion: artifact.catalog.cacheReadUsdPerMillion,
        cacheWriteUsdPerMillion: artifact.catalog.cacheWriteUsdPerMillion,
        pricingVersion: artifact.catalog.pricingVersion,
        pricingCheckedAt: artifact.catalog.pricingCheckedAt,
        pricingUpdatedAt: artifact.catalog.pricingUpdatedAt,
      },
      expectedCatalog
    );
    assert.deepEqual(
      {
        candidateCount: artifact.supply.candidateCount,
        maxInputPerMillion: artifact.supply.maxInputPerMillion,
        maxOutputPerMillion: artifact.supply.maxOutputPerMillion,
      },
      expectedSupply
    );
    assert.equal(artifact.supply.min_discount_percent, BODY_CUE_1354_MIN_DISCOUNT_PERCENT);
    assert.equal(post.box.calls, 4);
    assert.equal(artifact.paidPostCount, 4);
    assert.equal(artifact.attemptedPostCount, 4);
    assert.equal(artifact.status, "EXECUTE_COMPLETE");
    assert.equal(artifact.results.length, 4);
    assert.equal(artifact.totalSettledBilledUsd, 0.01);
    assert.equal(JSON.stringify(artifact).includes('"variant":"baseline"'), false);
    assert.equal(JSON.stringify(artifact).includes('"variant":"candidate"'), false);
    assertArtifactHasNoSecrets(artifact, FORBIDDEN);
  });

  it("adapter keeps experiment max_tokens and min_discount_percent", () => {
    const adapted = applyBodyCue1354ExperimentOverrides({
      model: "other",
      messages: [],
    });
    assert.equal(adapted.model, BODY_CUE_1354_MODEL);
    assert.equal(adapted.max_tokens, BODY_CUE_1354_MAX_TOKENS);
    assert.equal(adapted.min_discount_percent, BODY_CUE_1354_MIN_DISCOUNT_PERCENT);
    assert.equal(
      adaptCheaperInferenceChatBody({
        model: BODY_CUE_1354_MODEL,
        max_tokens: 8192,
        min_discount_percent: 50,
      }).min_discount_percent,
      50
    );
  });

  it("CALL 1 gate accepts billed evidence and rejects retry/fallback", () => {
    assert.doesNotThrow(() =>
      assertCall1Gate({
        httpStatus: 200,
        model: BODY_CUE_1354_MODEL,
        promptTokens: 10,
        completionTokens: 8192,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        requestId: "req-1",
        billedCostUsd: 0.000003,
        settled: true,
        text: "ok",
        retried: false,
        fallback: false,
      })
    );
    assert.throws(() =>
      assertCall1Gate({
        httpStatus: 200,
        model: BODY_CUE_1354_MODEL,
        promptTokens: 10,
        completionTokens: 8192,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        requestId: "req-1",
        billedCostUsd: 0.000003,
        settled: true,
        text: "ok",
        retried: true,
        fallback: false,
      } as PaidCallResult)
    );
  });

  it("reuses existing owners and never calls resolveCheaperInferenceApiKey", () => {
    const src = fs.readFileSync(new URL("./bodyCueFlashAb1354Runner.ts", import.meta.url), "utf8");
    const cli = fs.readFileSync(new URL("../body-cue-flash-ab-1354.ts", import.meta.url), "utf8");
    assert.match(src, /buildLiveDeployedBodyCueReviewPacket/);
    assert.match(src, /assembleLiveDeployedBodyCueSceneRequests/);
    assert.match(src, /adaptCheaperInferenceChatBody/);
    assert.match(src, /buildCheaperInferenceHeaders/);
    assert.match(src, /buildCheaperInferenceChatCompletionsUrl/);
    assert.match(src, /parseCompatibleUsage/);
    assert.match(src, /readCompatibleCompletionProviderRequestId/);
    assert.match(src, /CHEAPER_INFERENCE_MODELS_SOURCE_URL/);
    assert.match(src, /createOperatorCheaperInferenceTransport/);
    assert.match(cli, /createOperatorCheaperInferenceTransport/);
    assert.match(cli, /post: transport\.post/);
    assert.match(cli, /catalogGet: transport\.catalogGet/);
    assert.equal(src.includes("parseProviderPostResult"), false);
    assert.equal(src.includes("resolveCheaperInferenceApiKey("), false);
    assert.equal(src.includes("from \"@/lib/db\""), false);
    assert.equal(src.includes("getDb("), false);
    assert.equal(src.includes("streamOpenRouterAdult"), false);
    assert.equal(src.includes("executeDeepSeekWithProviderFailover"), false);
    assert.equal(src.includes("callOpenRouterCompletion"), false);
    assertPacketReadyForPaid(passingPacket());
  });

  it("real CLI execute transport posts assembled bodies through a fetch stub", async () => {
    let posts = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = String(init?.method ?? "GET");
      if (method === "GET" && url.includes("/models/supply")) {
        return new Response(JSON.stringify(passingSupplyPayload()), { status: 200 });
      }
      if (method === "GET") {
        return new Response(JSON.stringify(passingCatalogPayload()), { status: 200 });
      }
      posts += 1;
      return new Response(
        JSON.stringify({
          model: BODY_CUE_1354_MODEL,
          choices: [{ message: { content: `wired-${posts}` } }],
          usage: {
            prompt_tokens: 11,
            completion_tokens: 7,
            prompt_tokens_details: { cached_tokens: 2, cache_creation_tokens: 1 },
          },
          cheaper_inference: { billing: { billed_cost_usd: 0.002, status: "settled" } },
        }),
        { status: 200, headers: { "x-ci-request-id": `wired-${posts}` } }
      );
    };
    const { artifact } = await runBodyCueFlashAb1354({
      mode: "execute",
      secretSource: { kind: "stdin", read: () => SECRET },
      seal: passingSeal,
      fetchImpl,
      assignLabels: sequentialLabels,
    });
    assert.equal(posts, 4);
    assert.equal(artifact.status, "EXECUTE_COMPLETE");
    assert.equal(artifact.results.length, 4);
    assert.equal(artifact.results[0]?.generatedText, "wired-1");
    assert.equal(artifact.results[0]?.billedCostUsd, 0.002);
    assert.equal(artifact.results[0]?.settled, true);
    assert.ok(artifact.results[0]?.requestIdSha256);
    assertArtifactHasNoSecrets(artifact, FORBIDDEN);
  });

  it("models GET non-ok yields 0 POST", async () => {
    const post = trackingPost();
    await assert.rejects(
      () =>
        runBodyCueFlashAb1354({
          mode: "execute",
          secretSource: { kind: "stdin", read: () => SECRET },
          seal: passingSeal,
          post: post.fn,
          catalogGet: passingCatalogGet({ modelsOk: false }).fn,
        }),
      (error: unknown) => error instanceof CatalogGateError && error.reason === "non_ok"
    );
    assert.equal(post.box.calls, 0);
  });

  it("supply GET non-ok yields 0 POST", async () => {
    const post = trackingPost();
    await assert.rejects(
      () =>
        runBodyCueFlashAb1354({
          mode: "execute",
          secretSource: { kind: "stdin", read: () => SECRET },
          seal: passingSeal,
          post: post.fn,
          catalogGet: passingCatalogGet({ supplyOk: false }).fn,
        }),
      (error: unknown) => error instanceof CatalogGateError && error.reason === "non_ok"
    );
    assert.equal(post.box.calls, 0);
  });

  it("catalog malformed yields 0 POST", async () => {
    const post = trackingPost();
    await assert.rejects(
      () =>
        runBodyCueFlashAb1354({
          mode: "execute",
          secretSource: { kind: "stdin", read: () => SECRET },
          seal: passingSeal,
          post: post.fn,
          catalogGet: passingCatalogGet({ modelsPayload: { data: "not-an-array" } }).fn,
        }),
      (error: unknown) => error instanceof CatalogGateError && error.reason === "malformed"
    );
    assert.equal(post.box.calls, 0);
  });

  it("model unavailable yields 0 POST", async () => {
    const post = trackingPost();
    await assert.rejects(
      () =>
        runBodyCueFlashAb1354({
          mode: "execute",
          secretSource: { kind: "stdin", read: () => SECRET },
          seal: passingSeal,
          post: post.fn,
          catalogGet: passingCatalogGet({ modelsPayload: passingCatalogPayload({ available: false }) }).fn,
        }),
      (error: unknown) => error instanceof CatalogGateError && error.reason === "model_missing"
    );
    assert.equal(post.box.calls, 0);
  });

  it("model missing yields 0 POST", async () => {
    const post = trackingPost();
    await assert.rejects(
      () =>
        runBodyCueFlashAb1354({
          mode: "execute",
          secretSource: { kind: "stdin", read: () => SECRET },
          seal: passingSeal,
          post: post.fn,
          catalogGet: passingCatalogGet({ modelsPayload: passingCatalogPayload({ missing: true }) }).fn,
        }),
      (error: unknown) => error instanceof CatalogGateError && error.reason === "model_missing"
    );
    assert.equal(post.box.calls, 0);
  });

  it("catalog price above ceiling yields 0 POST", async () => {
    const post = trackingPost();
    await assert.rejects(
      () =>
        runBodyCueFlashAb1354({
          mode: "execute",
          secretSource: { kind: "stdin", read: () => SECRET },
          seal: passingSeal,
          post: post.fn,
          catalogGet: passingCatalogGet({ modelsPayload: passingCatalogPayload({ input: 0.08 }) }).fn,
        }),
      (error: unknown) => error instanceof CatalogGateError && error.reason === "price_violation"
    );
    assert.equal(post.box.calls, 0);
  });

  it("supply candidate_count=0 yields 0 POST", async () => {
    const post = trackingPost();
    await assert.rejects(
      () =>
        runBodyCueFlashAb1354({
          mode: "execute",
          secretSource: { kind: "stdin", read: () => SECRET },
          seal: passingSeal,
          post: post.fn,
          catalogGet: passingCatalogGet({ supplyPayload: passingSupplyPayload({ candidateCount: 0 }) }).fn,
        }),
      (error: unknown) => error instanceof CatalogGateError && error.reason === "supply_empty"
    );
    assert.equal(post.box.calls, 0);
  });

  it("supply ceiling violation yields 0 POST", async () => {
    const post = trackingPost();
    await assert.rejects(
      () =>
        runBodyCueFlashAb1354({
          mode: "execute",
          secretSource: { kind: "stdin", read: () => SECRET },
          seal: passingSeal,
          post: post.fn,
          catalogGet: passingCatalogGet({ supplyPayload: passingSupplyPayload({ maxOutput: 0.31 }) }).fn,
        }),
      (error: unknown) => error instanceof CatalogGateError && error.reason === "supply_ceiling"
    );
    assert.equal(post.box.calls, 0);
  });

  it("nested cheaper_inference.billing fixture parses exact billed cost", () => {
    const parsed = interpretPaidCompletion({
      status: 200,
      headers: new Headers({ "x-ci-request-id": "req-nested" }),
      body: {
        model: BODY_CUE_1354_MODEL,
        choices: [{ message: { content: "nested-ok" } }],
        usage: {
          prompt_tokens: 21,
          completion_tokens: 9,
          prompt_tokens_details: { cached_tokens: 3, cache_creation_tokens: 2 },
        },
        cheaper_inference: {
          billing: { billed_cost_usd: 0.00456, status: "settled" },
        },
      },
    });
    assert.equal(parsed.billedCostUsd, 0.00456);
    assert.equal(parsed.settled, true);
    assert.equal(parsed.promptTokens, 21);
    assert.equal(parsed.completionTokens, 9);
    assert.equal(parsed.cacheReadTokens, 3);
    assert.equal(parsed.cacheWriteTokens, 2);
    assert.equal(parsed.requestId, "req-nested");
    assert.equal(parsed.text, "nested-ok");
    const catalog = parseFlashCatalogGate(passingCatalogPayload());
    assert.equal(catalog.available, true);
    assert.equal(catalog.inputUsdPerMillion, 0.075);
    assert.equal(catalog.outputUsdPerMillion, 0.3);
  });

  it("CALL 1 non-2xx blocks CALL 2", async () => {
    const post = trackingPost((n) => (n === 1 ? { httpStatus: 429, errorCategory: "http", settled: false, billedCostUsd: null } : {}));
    const error = await runBodyCueFlashAb1354({
      mode: "execute",
      secretSource: { kind: "stdin", read: () => SECRET },
      seal: passingSeal,
      post: post.fn,
      catalogGet: passingCatalogGet().fn,
    }).catch((caught: unknown) => caught);
    assert.ok(error instanceof RunnerStopError);
    assert.equal(post.box.calls, 1);
    assert.equal(error.artifact.status, "CALL1_BLOCKED");
    assert.equal(error.artifact.results[0]?.errorCategory, "http");
    assert.equal(error.artifact.results[0]?.generatedText, "");
  });

  it("CALL 1 unsettled blocks CALL 2", async () => {
    const post = trackingPost((n) => (n === 1 ? { settled: false, billedCostUsd: null } : {}));
    const error = await runBodyCueFlashAb1354({
      mode: "execute",
      secretSource: { kind: "stdin", read: () => SECRET },
      seal: passingSeal,
      post: post.fn,
      catalogGet: passingCatalogGet().fn,
    }).catch((caught: unknown) => caught);
    assert.ok(error instanceof RunnerStopError);
    assert.match(error.message, /unsettled/);
    assert.equal(post.box.calls, 1);
    assert.equal(error.artifact.status, "CALL1_BLOCKED");
  });

  it("CALL 2 wrong model blocks CALL 3/4", async () => {
    const post = trackingPost((n) => (n === 2 ? { model: "not-flash" } : {}));
    const error = await runBodyCueFlashAb1354({
      mode: "execute",
      secretSource: { kind: "stdin", read: () => SECRET },
      seal: passingSeal,
      post: post.fn,
      catalogGet: passingCatalogGet().fn,
    }).catch((caught: unknown) => caught);
    assert.ok(error instanceof RunnerStopError);
    assert.match(error.message, /model mismatch/);
    assert.equal(post.box.calls, 2);
    assert.equal(error.artifact.status, "EARLY_STOP");
    assert.equal(error.artifact.results.length, 2);
  });

  it("CALL 3 completion over 8192 blocks CALL 4", async () => {
    const post = trackingPost((n) => (n === 3 ? { completionTokens: 8193 } : {}));
    const error = await runBodyCueFlashAb1354({
      mode: "execute",
      secretSource: { kind: "stdin", read: () => SECRET },
      seal: passingSeal,
      post: post.fn,
      catalogGet: passingCatalogGet().fn,
    }).catch((caught: unknown) => caught);
    assert.ok(error instanceof RunnerStopError);
    assert.match(error.message, /8192/);
    assert.equal(post.box.calls, 3);
    assert.equal(error.artifact.status, "EARLY_STOP");
    assert.equal(error.artifact.results.length, 3);
  });

  it("four successes stay at exactly four attempts", async () => {
    const post = trackingPost();
    const { artifact } = await runBodyCueFlashAb1354({
      mode: "execute",
      secretSource: { kind: "stdin", read: () => SECRET },
      seal: passingSeal,
      post: post.fn,
      catalogGet: passingCatalogGet().fn,
    });
    assert.equal(post.box.calls, 4);
    assert.equal(artifact.attemptCount, 4);
    assert.equal(artifact.paidPostCount, 4);
    assert.equal(artifact.results.length, 4);
    assert.equal(artifact.status, "EXECUTE_COMPLETE");
  });

  it("approved AB/BA execution order is exact", () => {
    const requests = deriveExperimentRequests(syntheticRows());
    assert.deepEqual(
      requests.map((item) => `${item.sceneId}:${item.variant}`),
      APPROVED_EXECUTION_PLAN.map((item) => `${item.sceneId}:${item.variant}`)
    );
    assert.deepEqual(
      requests.map((item) => `${item.sceneId}:${item.variant}`),
      [
        "quiet_window_safe:baseline",
        "relationship_turn_safe:candidate",
        "quiet_window_safe:candidate",
        "relationship_turn_safe:baseline",
      ]
    );
  });

  it("result artifact contains four outputs/receipts and no mapping", async () => {
    const post = trackingPost();
    const { artifact, reveal } = await runBodyCueFlashAb1354({
      mode: "execute",
      secretSource: { kind: "stdin", read: () => SECRET },
      seal: passingSeal,
      post: post.fn,
      catalogGet: passingCatalogGet().fn,
      assignLabels: sequentialLabels,
    });
    assert.deepEqual(artifact.executionOrder, ["Q-X7", "R-P4", "Q-M2", "R-K9"]);
    assert.equal(artifact.results.length, 4);
    for (const [index, result] of artifact.results.entries()) {
      assert.equal(result.opaqueLabel, ["Q-X7", "R-P4", "Q-M2", "R-K9"][index]);
      assert.equal(result.generatedText, `generated-output-${index + 1}`);
      assert.ok(result.outputChars > 0);
      assert.equal(result.promptTokens, 100);
      assert.equal(result.completionTokens, 16);
      assert.equal(result.cacheReadTokens, 4);
      assert.equal(result.cacheWriteTokens, 1);
      assert.equal(result.billedCostUsd, 0.001 * (index + 1));
      assert.ok(result.requestIdSha256);
      assert.equal(result.httpStatus, 200);
      assert.equal(result.settled, true);
      assert.equal(result.model, BODY_CUE_1354_MODEL);
      assert.equal(result.attemptNumber, index + 1);
    }
    assert.equal(JSON.stringify(artifact).includes('"variant":"baseline"'), false);
    assert.equal(JSON.stringify(artifact).includes('"variant":"candidate"'), false);
    assert.equal(reveal.mapping[0]?.variant, "baseline");
    assertArtifactHasNoSecrets(artifact, FORBIDDEN);
  });

  it("opaque labels stay in the review artifact without revealing mapping", () => {
    const labeled = assignBlindLabels(deriveExperimentRequests(syntheticRows()));
    assert.equal(labeled.labeled.length, 4);
    assert.match(labeled.labeled[0]!.opaqueLabel, /^Q-[A-HJ-NP-Z][2-9]$/);
    assert.match(labeled.labeled[1]!.opaqueLabel, /^R-[A-HJ-NP-Z][2-9]$/);
    assert.equal(new Set(labeled.labeled.map((item) => item.opaqueLabel)).size, 4);
    assert.ok(labeled.reveal.mapping.some((item) => item.variant === "baseline"));
  });

  it("createOperatorCheaperInferenceTransport is the CLI execute owner", () => {
    const transport = createOperatorCheaperInferenceTransport({
      fetchImpl: (async () => new Response("{}", { status: 200 })) as typeof fetch,
    });
    assert.equal(typeof transport.post, "function");
    assert.equal(typeof transport.catalogGet, "function");
  });
});

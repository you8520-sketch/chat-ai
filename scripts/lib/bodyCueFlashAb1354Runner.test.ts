import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createRequire } from "node:module";

import { adaptCheaperInferenceChatBody } from "@/lib/cheaperInferenceConfig";
import { CHEAPER_INFERENCE_MODELS_SOURCE_URL } from "@/lib/modelPricingTrackingConfig";
import {
  assertArtifactHasNoSecrets,
  assertCall1Gate,
  assertPacketReadyForPaid,
  applyBodyCue1354ExperimentOverrides,
  BODY_CUE_1354_MAX_TOKENS,
  BODY_CUE_1354_MIN_DISCOUNT_PERCENT,
  BODY_CUE_1354_MODEL,
  BODY_CUE_1354_SUPPLY_URL,
  ExperimentSecretError,
  LiveSealError,
  MAX_PAID_ATTEMPTS,
  openSqliteQueryOnly,
  PaidAttemptBudget,
  PaidAttemptBudgetError,
  readExperimentSecretOnce,
  runBodyCueFlashAb1354,
  sealLiveDeployedInputFromDb,
  type LiveSeal,
  type ProviderPostFn,
} from "./bodyCueFlashAb1354Runner";
import type { LiveDeployedBodyCueRows } from "./mainRpBodyCuePreflight";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as typeof import("better-sqlite3");

const SECRET = "sk-test-experiment-secret";
const PROD_KEY = "prod-key-must-never-be-used";
const SOURCE_MARKER = "UNIQUE_SOURCE_MARKER_렌본부숙소창가";

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

function trackingPost(): { fn: ProviderPostFn; box: { calls: number } } {
  const box = { calls: 0 };
  const fn: ProviderPostFn = async () => {
    box.calls += 1;
    return {
      httpStatus: 200,
      model: BODY_CUE_1354_MODEL,
      completionTokens: 16,
      requestId: `req-${box.calls}`,
      billedMicroUsd: 12,
      settled: true,
      text: "ok",
      retried: false,
      fallback: false,
    };
  };
  return { fn, box };
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
          catalogGet: async () => ({ ok: true }),
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
          catalogGet: async () => ({ ok: true }),
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
            catalogGet: async () => ({ ok: true }),
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
          catalogGet: async () => ({ ok: true }),
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
          catalogGet: async () => ({ ok: true }),
        }),
      LiveSealError
    );
    assert.equal(post.box.calls, 0);
    fs.unlinkSync(dbPath);
  });

  it("LIVE_VERIFIED false fails closed with zero POST", async () => {
    const post = trackingPost();
    await assert.rejects(
      () =>
        runBodyCueFlashAb1354({
          mode: "execute",
          secretSource: { kind: "stdin", read: () => SECRET },
          seal: () => ({ ...passingSeal(), packet: passingPacket({ source: "SYNTHETIC" }) }),
          post: post.fn,
          catalogGet: async () => ({ ok: true }),
        }),
      LiveSealError
    );
    assert.equal(post.box.calls, 0);
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
          catalogGet: async () => ({ ok: true }),
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

  it("does not retry a failed CALL 1", async () => {
    let calls = 0;
    const post: ProviderPostFn = async () => {
      calls += 1;
      throw new Error("provider 503");
    };
    await assert.rejects(
      () =>
        runBodyCueFlashAb1354({
          mode: "execute",
          secretSource: { kind: "stdin", read: () => SECRET },
          seal: passingSeal,
          post,
          catalogGet: async () => ({ ok: true }),
        }),
      /provider 503/
    );
    assert.equal(calls, 1);
  });

  it("CALL 1 gate failure blocks CALL 2-4", async () => {
    let calls = 0;
    const post: ProviderPostFn = async () => {
      calls += 1;
      return {
        httpStatus: 200,
        model: BODY_CUE_1354_MODEL,
        completionTokens: 16,
        requestId: null,
        billedMicroUsd: 1,
        settled: true,
        text: "x",
        retried: false,
        fallback: false,
      };
    };
    await assert.rejects(
      () =>
        runBodyCueFlashAb1354({
          mode: "execute",
          secretSource: { kind: "stdin", read: () => SECRET },
          seal: passingSeal,
          post,
          catalogGet: async () => ({ ok: true }),
        }),
      /missing request id/
    );
    assert.equal(calls, 1);
  });

  it("prepare mode seals and assembles with paid POST count 0", async () => {
    const post = trackingPost();
    const artifact = await runBodyCueFlashAb1354({
      mode: "prepare",
      secretSource: null,
      seal: passingSeal,
      post: post.fn,
      catalogGet: async () => ({ ok: true }),
    });
    assert.equal(artifact.status, "PREPARE_READY");
    assert.equal(artifact.paidPostCount, 0);
    assert.equal(post.box.calls, 0);
    assert.equal(artifact.requests.length, 4);
    assert.equal(artifact.retries, 0);
    assert.equal(artifact.fallback, 0);
    assert.equal(artifact.catalog.url, CHEAPER_INFERENCE_MODELS_SOURCE_URL);
    assert.equal(artifact.supply.url, BODY_CUE_1354_SUPPLY_URL);
    assertArtifactHasNoSecrets(artifact, [SECRET, PROD_KEY, SOURCE_MARKER, "닉네임테스트"]);
  });

  it("execute control flow is GET models, GET supply, CALL 1, then 2-4", async () => {
    const urls: string[] = [];
    const post = trackingPost();
    const artifact = await runBodyCueFlashAb1354({
      mode: "execute",
      secretSource: { kind: "stdin", read: () => SECRET },
      seal: passingSeal,
      post: post.fn,
      catalogGet: async (input) => {
        urls.push(input.url);
        return { ok: true };
      },
    });
    assert.equal(urls[0], CHEAPER_INFERENCE_MODELS_SOURCE_URL);
    assert.match(urls[1] ?? "", /models\/supply/);
    assert.match(urls[1] ?? "", /min_discount_percent=50/);
    assert.equal(post.box.calls, 4);
    assert.equal(artifact.paidPostCount, 4);
    assert.equal(artifact.status, "EXECUTE_COMPLETE");
    assertArtifactHasNoSecrets(artifact, [SECRET, PROD_KEY, SOURCE_MARKER, "닉네임테스트"]);
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
        completionTokens: 8192,
        requestId: "req-1",
        billedMicroUsd: 3,
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
        completionTokens: 8192,
        requestId: "req-1",
        billedMicroUsd: 3,
        settled: true,
        text: "ok",
        retried: true,
        fallback: false,
      })
    );
  });

  it("reuses existing owners and never calls resolveCheaperInferenceApiKey", () => {
    const src = fs.readFileSync(new URL("./bodyCueFlashAb1354Runner.ts", import.meta.url), "utf8");
    assert.match(src, /buildLiveDeployedBodyCueReviewPacket/);
    assert.match(src, /assembleLiveDeployedBodyCueSceneRequests/);
    assert.match(src, /adaptCheaperInferenceChatBody/);
    assert.match(src, /buildCheaperInferenceHeaders/);
    assert.match(src, /buildCheaperInferenceChatCompletionsUrl/);
    assert.match(src, /parseOpenRouterUsage/);
    assert.match(src, /readCompatibleCompletionProviderRequestId/);
    assert.match(src, /CHEAPER_INFERENCE_MODELS_SOURCE_URL/);
    assert.equal(src.includes("resolveCheaperInferenceApiKey("), false);
    assert.equal(src.includes("from \"@/lib/db\""), false);
    assert.equal(src.includes("getDb("), false);
    assert.equal(src.includes("streamOpenRouterAdult"), false);
    assert.equal(src.includes("executeDeepSeekWithProviderFailover"), false);
    assertPacketReadyForPaid(passingPacket());
  });
});

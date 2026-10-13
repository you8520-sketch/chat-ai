import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";

import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import {
  createMemoryPaidRunnerArtifactStore,
} from "@/lib/rpQualityPaidRunnerArtifacts";
import {
  createMemoryPaidRunnerJournalStore,
  createMockPaidRunnerTransport,
  evaluatePaidRunnerAuthorizationPrerequisites,
  paidRunnerManifestFingerprint,
  type PaidRunnerAuthorizationInput,
  type PaidRunnerPublicManifest,
} from "@/lib/rpQualityPaidRunner";
import type { PrecallAssemblyRows } from "../../scripts/lib/rpQualityPrecallFinalWire";
import { preparePaidRunnerPack } from "../../scripts/lib/rpQualityPaidRunnerPrepare";
import {
  dispatchPaidRunnerLive,
  evaluatePaidRunnerLiveAssemblyGrant,
} from "../../scripts/lib/rpQualityPaidRunnerLiveDispatch";
import {
  loadInProcessPaidRunnerPack,
  observePaidRunnerRuntimeSha,
  resolveCanonicalProductionDbPath,
} from "../../scripts/lib/rpQualityPaidRunnerInProcessPack";
import {
  PUBLISHED_1587_A_SCOPE_MANIFEST_FINGERPRINT,
  PUBLISHED_1602_1595_A_SCOPE_MANIFEST_FINGERPRINT,
  PUBLISHED_1602_1595_PRODUCTION_SHA,
  compareToCanonicalPaidRunnerSeal,
  compareToPublished1466Seal,
  compareToPublishedPaidRunnerSeals,
  paidRunnerPublicSealFromManifest,
  published1466ComparableSeal,
  published1587ComparableSeal,
  publishedCanonicalComparableSeal,
  type Published1466ComparableSeal,
} from "../../scripts/lib/rpQualityPaidRunnerPublished1466Seal";

const SECRET = "rpq-paid-dispatch-secret-0000000001";
const MAIN_SHA = "7573e6fd3552a5802e97d1507f8f671d361447a2";
const OTHER_SHA = "88d277f868c4a445e8dd7d24ea50f322fff1483d";
const KEYS = {
  openRouterKey: "or-exp-dispatch-key-not-production",
  cheaperInferenceKey: "ci-exp-dispatch-key-not-production",
};

function syntheticRows(): PrecallAssemblyRows {
  return {
    character: {
      id: 18,
      name: "라이크",
      greeting: "창가에 서서 잠시 너를 바라본다.",
      system_prompt: "라이크는 말수가 적고 상대의 말을 끝까지 듣는다.",
      world: "늦은 오후 도시.",
      setting_chunks: "",
      gender: "male",
      content_kind: "character",
      genres: "[]",
      assets: "[]",
      status_widget_allow_user_override: 1,
    },
    persona: {
      id: 5,
      name: "렌",
      gender: "male",
      description: "조용한 사람",
    },
    user: {
      id: 1,
      nickname: "렌",
      user_note: "",
    },
    creatorLorebookAttachments: 0,
    globalLorebook: [],
  };
}

function fixturePack(sha = MAIN_SHA) {
  return preparePaidRunnerPack({
    rows: syntheticRows(),
    mainSha: sha,
    productionDeploySha: sha,
  });
}

function auth(
  manifest: PaidRunnerPublicManifest,
  extra: Partial<PaidRunnerAuthorizationInput> = {}
): PaidRunnerAuthorizationInput {
  return {
    userCostApproved: true,
    approvedManifestFingerprint: manifest.manifestFingerprint,
    expectedProductionSha: manifest.productionDeploySha,
    expectedIdentityHash: manifest.identityHash,
    experimentSecret: SECRET,
    allowlist: [...MAIN_RP_MODEL_IDS],
    plannedCalls: 12,
    ...extra,
  };
}

function countingMock() {
  const counts = { posts: 0 };
  const inner = createMockPaidRunnerTransport();
  return {
    counts,
    transport: {
      kind: "mock" as const,
      async post(input: Parameters<typeof inner.post>[0]) {
        counts.posts += 1;
        return inner.post(input);
      },
    },
  };
}

function readyDispatch(
  pack: ReturnType<typeof fixturePack>,
  extra: Partial<Parameters<typeof dispatchPaidRunnerLive>[0]> = {}
) {
  const mock = countingMock();
  return {
    mock,
    input: {
      acceptPaidExecution: true,
      liveExecuteEnabled: true,
      modelsCanonical: true,
      authorization: auth(pack.manifest),
      manifest: pack.manifest,
      sealedCalls: pack.sealedCalls,
      keys: KEYS,
      transport: mock.transport,
      actualRuntimeSha: pack.manifest.productionDeploySha,
      sealBaseline: paidRunnerPublicSealFromManifest(pack.manifest),
      ...extra,
    },
  };
}

function runLiveCli(args: string[], env: NodeJS.ProcessEnv = {}) {
  let stdout = "";
  try {
    stdout = execFileSync(
      process.execPath,
      ["--conditions=react-server", "--import", "tsx", "scripts/rp-quality-paid-runner-live.ts", ...args],
      {
        encoding: "utf8",
        env: (() => {
          const next = { ...process.env, ...env };
          for (const key of [
            "RP_QUALITY_PAID_LIVE_EXECUTE",
            "RP_QUALITY_PAID_OPENROUTER_KEY",
            "RP_QUALITY_PAID_CHEAPERINFERENCE_KEY",
            "RP_QUALITY_PAID_EXPERIMENT_SECRET",
            "OPENROUTER_API_KEY",
            "CHEAPER_INFERENCE_API_KEY",
            "OPENAI_API_KEY",
            "RAILWAY_GIT_COMMIT_SHA",
            "DATA_DIR",
          ]) {
            if (!(key in env)) delete next[key];
          }
          return next;
        })(),
      }
    );
  } catch (error) {
    stdout = String((error as { stdout?: string }).stdout ?? "");
  }
  const jsonStart = stdout.lastIndexOf('{\n  "ok":');
  const from = jsonStart >= 0 ? stdout.slice(jsonStart) : stdout;
  let depth = 0;
  let jsonEnd = from.length;
  for (let index = 0; index < from.length; index += 1) {
    if (from[index] === "{") depth += 1;
    if (from[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        jsonEnd = index + 1;
        break;
      }
    }
  }
  return {
    report: JSON.parse(from.slice(0, jsonEnd)) as {
      providerPosts: number;
      denialReason: string | null;
      approvalStatus: string;
      liveExecuteEnabled: boolean;
      dbWrites: number;
      runtimeShaObserved?: boolean;
      sealedCallsPresent?: boolean;
    },
    stdout,
  };
}

function writeSyntheticProductionDb(directory: string): string {
  const dbFile = path.join(directory, "app.db");
  const db = new DatabaseSync(dbFile);
  db.exec(`
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY, name TEXT, description TEXT, system_prompt TEXT, world TEXT,
      greeting TEXT, gender TEXT, content_kind TEXT, setting_chunks TEXT,
      status_widget_allow_user_override INTEGER, genres TEXT, assets TEXT
    );
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, nickname TEXT, user_note TEXT, sub_until TEXT, sub_plan TEXT,
      account_kind TEXT, is_admin INTEGER, email TEXT
    );
    CREATE TABLE user_status_widget_presets (id INTEGER PRIMARY KEY, user_id INTEGER, widget_json TEXT);
    CREATE TABLE user_personas (
      id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, gender TEXT, description TEXT,
      active_status_widget_preset_id INTEGER
    );
    CREATE TABLE character_lorebook_attachments (character_id INTEGER);
    CREATE TABLE global_lorebook_entries (
      id INTEGER PRIMARY KEY, name TEXT, triggers_json TEXT, content TEXT, depth INTEGER,
      enabled INTEGER, sort_order INTEGER
    );
    CREATE TABLE billing_fx_daily_snapshots (date_key TEXT, base_usd_krw REAL, source TEXT, fetched_at TEXT);
  `);
  db.prepare(
    `INSERT INTO characters (id, name, description, system_prompt, world, greeting, gender, content_kind,
       setting_chunks, status_widget_allow_user_override, genres, assets)
     VALUES (18, '라이크', '설명', '라이크는 말수가 적고 상대의 말을 끝까지 듣는다.', '늦은 오후 도시.',
       '창가에 서서 잠시 너를 바라본다.', 'male', 'character', '', 1, '[]', '[]')`
  ).run();
  db.prepare(
    "INSERT INTO users (id, nickname, user_note, account_kind, is_admin, email) VALUES (1, '렌', '', '', 1, 'a@b.c')"
  ).run();
  db.prepare(
    "INSERT INTO user_personas (id, user_id, name, gender, description) VALUES (5, 1, '렌', 'male', '조용한 사람')"
  ).run();
  db.close();
  return dbFile;
}

describe("rp quality paid runner live dispatch boundary", () => {
  it("published #1466 seal rematches itself and treats body edits as drift", () => {
    const published = published1466ComparableSeal();
    assert.equal(compareToPublished1466Seal(published).verdict, "MATCH");
    const rotated = compareToPublished1466Seal({
      ...published,
      productionDeploySha: MAIN_SHA,
      mainSha: MAIN_SHA,
      manifestFingerprint: "ff".repeat(32),
    });
    assert.equal(rotated.verdict, "EXPECTED_DEPLOY_SHA_ROTATION");
    assert.equal(rotated.bodyDrift, false);
    const drifted = compareToPublished1466Seal({
      ...published,
      calls: published.calls.map((call, index) =>
        index === 0 ? { ...call, requestBodyFingerprint: "aa".repeat(32) } : call
      ),
    });
    assert.equal(drifted.verdict, "BODY_DRIFT");
  });

  it("#1587 successor seal: only the pinned pacing change is approved, #1466 stays historical", () => {
    const base1466 = published1466ComparableSeal();
    assert.equal(base1466.productionDeploySha, "88d277f868c4a445e8dd7d24ea50f322fff1483d");
    assert.equal(
      base1466.manifestFingerprint,
      "a600358fcc7bc6772945f62a36bb7d7c2c57b2b7eeb2191e822d816353f01b1e"
    );
    assert.equal(base1466.calls[0]?.finalWireFingerprint.slice(0, 8), "d86943df");

    const baseline1587 = published1587ComparableSeal();
    const seal1587: Published1466ComparableSeal = {
      ...baseline1587,
      executionScope: "A_relationship_emotion",
    };
    const changedOrders = seal1587.calls
      .filter((call, index) => {
        const old = base1466.calls[index]!;
        return (
          call.requestBodyFingerprint !== old.requestBodyFingerprint ||
          call.finalWireFingerprint !== old.finalWireFingerprint
        );
      })
      .map((call) => call.requestOrder);
    assert.deepEqual(changedOrders, [1, 2, 3, 4, 9, 10, 11, 12]);
    for (const [index, call] of seal1587.calls.entries()) {
      const old = base1466.calls[index]!;
      assert.equal(call.requestOrder, old.requestOrder);
      assert.equal(call.fixtureId, old.fixtureId);
      assert.equal(call.canonicalId, old.canonicalId);
      assert.equal(call.provider, old.provider);
      assert.equal(call.wireModel, old.wireModel);
      assert.equal(call.effectiveCanonMode, old.effectiveCanonMode);
      assert.equal(call.maxTokensPresent, false);
    }
    assert.equal(seal1587.identityHash, base1466.identityHash);

    const draft = {
      version: 1 as const,
      mainSha: seal1587.productionDeploySha,
      productionDeploySha: seal1587.productionDeploySha,
      characterId: 18,
      personaName: "렌",
      identityHash: seal1587.identityHash,
      calls: seal1587.calls,
    };
    assert.equal(
      paidRunnerManifestFingerprint({ ...draft, executionScope: "A_relationship_emotion" } as never),
      PUBLISHED_1587_A_SCOPE_MANIFEST_FINGERPRINT
    );
    assert.equal(
      paidRunnerManifestFingerprint(draft as never),
      "f9abe8368d91efa08aa013fcdc735aa575b3251c04fcdaa646312640bc55f051"
    );
    assert.notEqual(
      PUBLISHED_1587_A_SCOPE_MANIFEST_FINGERPRINT,
      "f9abe8368d91efa08aa013fcdc735aa575b3251c04fcdaa646312640bc55f051"
    );

    assert.equal(compareToPublishedPaidRunnerSeals(base1466).verdict, "MATCH");
    assert.equal(compareToPublished1466Seal(seal1587).verdict, "BODY_DRIFT");
    assert.equal(compareToPublishedPaidRunnerSeals(baseline1587).verdict, "BODY_DRIFT");
    assert.equal(
      compareToPublishedPaidRunnerSeals({ ...baseline1587, productionDeploySha: MAIN_SHA, mainSha: MAIN_SHA }).verdict,
      "BODY_DRIFT"
    );
    const approved = compareToPublishedPaidRunnerSeals(seal1587);
    assert.equal(approved.verdict, "MATCH");
    assert.equal(approved.bodyDrift, false);

    const laterDeploy = compareToPublishedPaidRunnerSeals({
      ...seal1587,
      productionDeploySha: MAIN_SHA,
      mainSha: MAIN_SHA,
      manifestFingerprint: "ee".repeat(32),
    });
    assert.equal(laterDeploy.verdict, "EXPECTED_DEPLOY_SHA_ROTATION");
    assert.equal(
      compareToPublishedPaidRunnerSeals({
        ...baseline1587,
        productionDeploySha: MAIN_SHA,
        mainSha: MAIN_SHA,
        manifestFingerprint: "ee".repeat(32),
      }).verdict,
      "BODY_DRIFT"
    );
    assert.equal(
      compareToPublished1466Seal({ ...base1466, executionScope: "A_relationship_emotion" }).verdict,
      "MATCH"
    );
    assert.equal(
      compareToPublishedPaidRunnerSeals({ ...seal1587, manifestFingerprint: "ee".repeat(32) }).verdict,
      "UNEXPECTED_FINGERPRINT_ROTATION"
    );

    const tamper = (
      order: number,
      patch: Partial<Published1466ComparableSeal["calls"][number]>
    ): Published1466ComparableSeal => ({
      ...seal1587,
      calls: seal1587.calls.map((call) => (call.requestOrder === order ? { ...call, ...patch } : call)),
    });
    const wrong = "ab".repeat(32);
    for (const order of [1, 4, 5, 8, 9, 12]) {
      assert.equal(
        compareToPublishedPaidRunnerSeals(tamper(order, { requestBodyFingerprint: wrong })).verdict,
        "BODY_DRIFT",
        `body order ${order}`
      );
      assert.equal(
        compareToPublishedPaidRunnerSeals(tamper(order, { finalWireFingerprint: wrong })).verdict,
        "BODY_DRIFT",
        `wire order ${order}`
      );
    }
    assert.equal(compareToPublishedPaidRunnerSeals(tamper(2, { provider: "cheaperinference" })).verdict, "BODY_DRIFT");
    assert.equal(compareToPublishedPaidRunnerSeals(tamper(3, { wireModel: "gpt-other" })).verdict, "BODY_DRIFT");
    assert.equal(compareToPublishedPaidRunnerSeals(tamper(4, { canonicalId: "gpt-6.1-sol" })).verdict, "BODY_DRIFT");
    assert.equal(compareToPublishedPaidRunnerSeals(tamper(1, { effectiveCanonMode: "FULL_LEGACY" })).verdict, "BODY_DRIFT");
    assert.equal(compareToPublishedPaidRunnerSeals(tamper(1, { maxTokensPresent: true })).verdict, "BODY_DRIFT");
    assert.equal(compareToPublishedPaidRunnerSeals(tamper(6, { fixtureId: "A_relationship_emotion" })).verdict, "BODY_DRIFT");

    const mixedAWith1466C: Published1466ComparableSeal = {
      ...seal1587,
      calls: seal1587.calls.map((call, index) => (call.fixtureId[0] === "C" ? base1466.calls[index]! : call)),
    };
    assert.equal(compareToPublishedPaidRunnerSeals(mixedAWith1466C).verdict, "BODY_DRIFT");
    assert.equal(
      compareToPublishedPaidRunnerSeals({ ...seal1587, calls: seal1587.calls.slice(0, 4) }).verdict,
      "BODY_DRIFT"
    );
    assert.equal(
      compareToPublishedPaidRunnerSeals({
        ...seal1587,
        identityHash: "dd".repeat(32),
      }).verdict,
      "BODY_DRIFT"
    );
    assert.equal(
      compareToPublishedPaidRunnerSeals({
        ...seal1587,
        identityHashes: { ...seal1587.identityHashes, worldSha256: "dd".repeat(32) },
      }).verdict,
      "BODY_DRIFT"
    );
  });

  it("canonical seal: #1602/#1595 input changes are the only approved delta, everything else is drift", () => {
    const base1466 = published1466ComparableSeal();
    const base1587 = published1587ComparableSeal();
    const canonical = publishedCanonicalComparableSeal();
    assert.equal(canonical.productionDeploySha, "b7159ec6fe2aeea78c75d1bdb5256adac32d93eb");
    assert.equal(canonical.productionDeploySha, PUBLISHED_1602_1595_PRODUCTION_SHA);
    assert.equal(canonical.calls.length, 12);
    assert.equal(canonical.identityHash, base1466.identityHash);
    assert.deepEqual(canonical.identityHashes, base1466.identityHashes);

    for (const [index, call] of canonical.calls.entries()) {
      const old = base1466.calls[index]!;
      assert.equal(call.requestOrder, old.requestOrder);
      assert.equal(call.fixtureId, old.fixtureId);
      assert.equal(call.canonicalId, old.canonicalId);
      assert.equal(call.provider, old.provider);
      assert.equal(call.wireModel, old.wireModel);
      assert.equal(call.effectiveCanonMode, old.effectiveCanonMode);
      assert.equal(call.maxTokensPresent, false);
      assert.notEqual(call.requestBodyFingerprint, base1587.calls[index]!.requestBodyFingerprint, `order ${call.requestOrder}`);
      assert.notEqual(call.finalWireFingerprint, base1587.calls[index]!.finalWireFingerprint, `order ${call.requestOrder}`);
    }
    assert.deepEqual(
      canonical.calls.filter((call) => call.canonicalId === "deepseek-v4.1-flash").map((call) => call.requestOrder),
      [1, 5, 9]
    );

    const draft = {
      version: 1 as const,
      mainSha: canonical.productionDeploySha,
      productionDeploySha: canonical.productionDeploySha,
      characterId: 18,
      personaName: "렌",
      identityHash: canonical.identityHash,
      calls: canonical.calls,
    };
    assert.equal(
      paidRunnerManifestFingerprint({ ...draft, executionScope: "A_relationship_emotion" } as never),
      PUBLISHED_1602_1595_A_SCOPE_MANIFEST_FINGERPRINT
    );
    assert.equal(canonical.manifestFingerprint, PUBLISHED_1602_1595_A_SCOPE_MANIFEST_FINGERPRINT);

    const scoped: Published1466ComparableSeal = { ...canonical, executionScope: "A_relationship_emotion" };
    assert.equal(compareToCanonicalPaidRunnerSeal(scoped).verdict, "MATCH");
    assert.equal(compareToCanonicalPaidRunnerSeal(canonical).verdict, "MATCH");

    const laterDeploy = compareToCanonicalPaidRunnerSeal({
      ...scoped,
      productionDeploySha: MAIN_SHA,
      mainSha: MAIN_SHA,
      manifestFingerprint: "ee".repeat(32),
    });
    assert.equal(laterDeploy.verdict, "EXPECTED_DEPLOY_SHA_ROTATION");
    assert.equal(laterDeploy.bodyDrift, false);
    assert.equal(
      compareToCanonicalPaidRunnerSeal({ ...scoped, manifestFingerprint: "ee".repeat(32) }).verdict,
      "UNEXPECTED_FINGERPRINT_ROTATION"
    );

    assert.equal(
      compareToCanonicalPaidRunnerSeal({ ...base1587, executionScope: "A_relationship_emotion" }).verdict,
      "BODY_DRIFT"
    );
    assert.equal(
      compareToCanonicalPaidRunnerSeal({ ...base1466, executionScope: "A_relationship_emotion" }).verdict,
      "BODY_DRIFT"
    );
    assert.equal(compareToCanonicalPaidRunnerSeal(base1466).verdict, "BODY_DRIFT");
    assert.equal(compareToPublished1466Seal(scoped).verdict, "BODY_DRIFT");
    assert.equal(compareToPublishedPaidRunnerSeals(scoped).verdict, "BODY_DRIFT");

    const mixed: Published1466ComparableSeal = {
      ...scoped,
      calls: scoped.calls.map((call, index) => (call.fixtureId[0] === "C" ? base1587.calls[index]! : call)),
    };
    assert.equal(compareToCanonicalPaidRunnerSeal(mixed).verdict, "BODY_DRIFT");

    const tamper = (
      order: number,
      patch: Partial<Published1466ComparableSeal["calls"][number]>
    ): Published1466ComparableSeal => ({
      ...scoped,
      calls: scoped.calls.map((call) => (call.requestOrder === order ? { ...call, ...patch } : call)),
    });
    const flipLastChar = (value: string) => `${value.slice(0, -1)}${value.endsWith("0") ? "1" : "0"}`;
    for (const call of scoped.calls) {
      assert.equal(
        compareToCanonicalPaidRunnerSeal(
          tamper(call.requestOrder, { requestBodyFingerprint: flipLastChar(call.requestBodyFingerprint) })
        ).verdict,
        "BODY_DRIFT",
        `body order ${call.requestOrder}`
      );
      assert.equal(
        compareToCanonicalPaidRunnerSeal(
          tamper(call.requestOrder, { finalWireFingerprint: flipLastChar(call.finalWireFingerprint) })
        ).verdict,
        "BODY_DRIFT",
        `wire order ${call.requestOrder}`
      );
    }
    assert.equal(compareToCanonicalPaidRunnerSeal(tamper(2, { provider: "cheaperinference" })).verdict, "BODY_DRIFT");
    assert.equal(compareToCanonicalPaidRunnerSeal(tamper(3, { wireModel: "gpt-other" })).verdict, "BODY_DRIFT");
    assert.equal(compareToCanonicalPaidRunnerSeal(tamper(4, { canonicalId: "gpt-6.1-sol" })).verdict, "BODY_DRIFT");
    assert.equal(compareToCanonicalPaidRunnerSeal(tamper(1, { effectiveCanonMode: "FULL_LEGACY" })).verdict, "BODY_DRIFT");
    assert.equal(compareToCanonicalPaidRunnerSeal(tamper(1, { maxTokensPresent: true })).verdict, "BODY_DRIFT");
    assert.equal(compareToCanonicalPaidRunnerSeal(tamper(6, { fixtureId: "A_relationship_emotion" })).verdict, "BODY_DRIFT");
    assert.equal(
      compareToCanonicalPaidRunnerSeal({ ...scoped, calls: scoped.calls.slice(0, 4) }).verdict,
      "BODY_DRIFT"
    );
    assert.equal(
      compareToCanonicalPaidRunnerSeal({ ...scoped, identityHash: "dd".repeat(32) }).verdict,
      "BODY_DRIFT"
    );
    assert.equal(
      compareToCanonicalPaidRunnerSeal({
        ...scoped,
        identityHashes: { ...scoped.identityHashes, settingChunksSha256: "dd".repeat(32) },
      }).verdict,
      "BODY_DRIFT"
    );
  });

  it("승인 없음 / SHA / fingerprint / identity / 운영키 fallback 모두 POST 0", async () => {
    const pack = fixturePack();
    const noAccept = readyDispatch(pack, { acceptPaidExecution: false });
    const noAcceptReport = await dispatchPaidRunnerLive(noAccept.input);
    assert.equal(noAcceptReport.denialReason, "LIVE_EXECUTE_NOT_APPROVED");
    assert.equal(noAccept.mock.counts.posts, 0);

    const noUser = readyDispatch(pack, {
      authorization: auth(pack.manifest, { userCostApproved: false }),
    });
    const noUserReport = await dispatchPaidRunnerLive(noUser.input);
    assert.equal(noUserReport.denialReason, "MISSING_USER_COST_APPROVAL");
    assert.equal(noUser.mock.counts.posts, 0);

    const staleRuntime = readyDispatch(pack, { actualRuntimeSha: OTHER_SHA });
    const staleRuntimeReport = await dispatchPaidRunnerLive(staleRuntime.input);
    assert.equal(staleRuntimeReport.denialReason, "RUNTIME_SHA_MISMATCH");
    assert.equal(staleRuntime.mock.counts.posts, 0);

    const missingRuntime = readyDispatch(pack, { actualRuntimeSha: null });
    const missingRuntimeReport = await dispatchPaidRunnerLive(missingRuntime.input);
    assert.equal(missingRuntimeReport.denialReason, "RUNTIME_SHA_UNAVAILABLE");
    assert.equal(missingRuntime.mock.counts.posts, 0);

    const wrongFingerprint = readyDispatch(pack, {
      authorization: auth(pack.manifest, { approvedManifestFingerprint: "cc".repeat(32) }),
    });
    const wrongFingerprintReport = await dispatchPaidRunnerLive(wrongFingerprint.input);
    assert.equal(wrongFingerprintReport.denialReason, "MANIFEST_FINGERPRINT_MISMATCH");
    assert.equal(wrongFingerprint.mock.counts.posts, 0);

    const wrongIdentity = readyDispatch(pack, {
      authorization: auth(pack.manifest, { expectedIdentityHash: "dd".repeat(32) }),
    });
    const wrongIdentityReport = await dispatchPaidRunnerLive(wrongIdentity.input);
    assert.equal(wrongIdentityReport.denialReason, "IDENTITY_HASH_MISMATCH");
    assert.equal(wrongIdentity.mock.counts.posts, 0);

    process.env.OPENROUTER_API_KEY = "sk-or-production-lookalike-dispatch";
    try {
      const fallback = readyDispatch(pack, {
        keys: {
          openRouterKey: "sk-or-production-lookalike-dispatch",
          cheaperInferenceKey: KEYS.cheaperInferenceKey,
        },
      });
      const fallbackReport = await dispatchPaidRunnerLive(fallback.input);
      assert.equal(fallbackReport.denialReason, "PRODUCTION_KEY_FALLBACK_FORBIDDEN");
      assert.equal(fallback.mock.counts.posts, 0);
    } finally {
      delete process.env.OPENROUTER_API_KEY;
    }
  });

  it("body drift vs #1466 stops; deploy-SHA rotation does not reuse the old fingerprint", async () => {
    const pack = fixturePack();
    const vs1466 = readyDispatch(pack, { sealBaseline: undefined });
    const driftReport = await dispatchPaidRunnerLive(vs1466.input);
    assert.equal(driftReport.denialReason, "BODY_DRIFT");
    assert.equal(driftReport.sealCompareVerdict, "BODY_DRIFT");
    assert.equal(vs1466.mock.counts.posts, 0);

    const rotatedPack = fixturePack(MAIN_SHA);
    const oldSeal = paidRunnerPublicSealFromManifest(rotatedPack.manifest);
    const baseline = {
      ...oldSeal,
      productionDeploySha: OTHER_SHA,
      mainSha: OTHER_SHA,
      manifestFingerprint: published1466ComparableSeal().manifestFingerprint,
    };
    const reuseOldFingerprint = readyDispatch(rotatedPack, {
      sealBaseline: baseline,
      authorization: auth(rotatedPack.manifest, {
        approvedManifestFingerprint: baseline.manifestFingerprint,
      }),
    });
    const reuseReport = await dispatchPaidRunnerLive(reuseOldFingerprint.input);
    assert.equal(reuseReport.denialReason, "MANIFEST_FINGERPRINT_MISMATCH");
    assert.equal(reuseOldFingerprint.mock.counts.posts, 0);

    const rotatedOk = readyDispatch(rotatedPack, { sealBaseline: baseline });
    const rotatedReport = await dispatchPaidRunnerLive(rotatedOk.input);
    assert.equal(rotatedReport.sealCompareVerdict, "EXPECTED_DEPLOY_SHA_ROTATION");
    assert.equal(rotatedReport.denialReason, null);
    assert.equal(rotatedReport.providerPosts, 0);
    assert.equal(rotatedOk.mock.counts.posts, 12);
  });

  it("incomplete pack / duplicate / missing live file stores stay POST 0", async () => {
    const pack = fixturePack();
    const missingSeal = readyDispatch(pack, { sealedCalls: null });
    const missingSealReport = await dispatchPaidRunnerLive(missingSeal.input);
    assert.equal(missingSealReport.denialReason, "SEAL_VALIDATION_FAILED");
    assert.equal(missingSeal.mock.counts.posts, 0);

    const journal = createMemoryPaidRunnerJournalStore();
    const first = readyDispatch(pack, { journalStore: journal });
    const firstReport = await dispatchPaidRunnerLive(first.input);
    assert.equal(firstReport.denialReason, null);
    assert.equal(firstReport.providerPosts, 0);
    assert.equal(first.mock.counts.posts, 12);
    assert.doesNotMatch(JSON.stringify(firstReport), /창가에 서서|Authorization|Bearer |requestBody|rpq-paid-dispatch/);

    const replay = readyDispatch(pack, { journalStore: journal });
    const replayReport = await dispatchPaidRunnerLive(replay.input);
    assert.equal(replayReport.denialReason, "DUPLICATE_MANIFEST_EXECUTION");
    assert.equal(replay.mock.counts.posts, 0);

    const posts = { n: 0 };
    const fetchImpl: typeof fetch = async () => {
      posts.n += 1;
      throw new Error("fixture fetch must not run");
    };
    const missingJournal = await dispatchPaidRunnerLive({
      ...readyDispatch(pack).input,
      transport: undefined,
      allowCreateLiveTransport: true,
      fetchImpl,
      journalDir: undefined,
      artifactDir: undefined,
      journalStore: undefined,
      artifactStore: createMemoryPaidRunnerArtifactStore(),
    });
    assert.equal(missingJournal.denialReason, "JOURNAL_STORE_UNAVAILABLE");
    assert.equal(posts.n, 0);

    const dir = mkdtempSync(path.join(tmpdir(), "rpq-live-symlink-"));
    const real = path.join(dir, "real");
    const link = path.join(dir, "link");
    writeFileSync(path.join(dir, "keep"), "x");
    mkdirSync(real, { recursive: true });
    symlinkSync(real, link);
    const symlinkJournal = await dispatchPaidRunnerLive({
      ...readyDispatch(pack).input,
      transport: undefined,
      allowCreateLiveTransport: true,
      fetchImpl,
      journalDir: link,
      artifactDir: path.join(dir, "artifacts"),
      journalStore: undefined,
      artifactStore: undefined,
    });
    assert.equal(symlinkJournal.denialReason, "JOURNAL_STORE_UNAVAILABLE");
    assert.equal(posts.n, 0);
  });

  it("in-process canonical pack uses DATA_DIR/app.db only and refuses symlink/stale identity", () => {
    assert.equal(observePaidRunnerRuntimeSha({ RAILWAY_GIT_COMMIT_SHA: MAIN_SHA }), MAIN_SHA);
    assert.equal(observePaidRunnerRuntimeSha({ RAILWAY_GIT_COMMIT_SHA: "7573e6f" }), null);

    const dir = mkdtempSync(path.join(tmpdir(), "rpq-inprocess-"));
    writeSyntheticProductionDb(dir);
    const loaded = loadInProcessPaidRunnerPack({
      runtimeSha: MAIN_SHA,
      expectedProductionSha: MAIN_SHA,
      originalDataDir: dir,
      env: {},
    });
    assert.equal(loaded.ok, true);
    if (loaded.ok) {
      assert.equal(loaded.pack.manifest.calls.length, 12);
      assert.equal(loaded.pack.manifest.productionDeploySha, MAIN_SHA);
      assert.equal(loaded.pack.manifest.characterId, 18);
      assert.equal(loaded.pack.manifest.personaName, "렌");
      assert.equal("requestBody" in loaded.pack.manifest, false);
    }

    assert.equal(resolveCanonicalProductionDbPath(""), null);
    const linkDir = path.join(dir, "linked-root");
    symlinkSync(dir, linkDir);
    assert.equal(resolveCanonicalProductionDbPath(linkDir), null);

    const stale = mkdtempSync(path.join(tmpdir(), "rpq-stale-id-"));
    writeSyntheticProductionDb(stale);
    const db = new DatabaseSync(path.join(stale, "app.db"));
    db.exec("UPDATE characters SET name = '다른캐릭터'");
    db.close();
    const stalePack = loadInProcessPaidRunnerPack({
      runtimeSha: MAIN_SHA,
      expectedProductionSha: MAIN_SHA,
      originalDataDir: stale,
      env: {},
    });
    assert.equal(stalePack.ok, false);
    if (!stalePack.ok) assert.equal(stalePack.reason, "IDENTITY_HASH_MISMATCH");
  });

  it("live CLI default, missing approval, and sealed-pack-file stay POST 0 without leaking bodies", () => {
    const defaultRun = runLiveCli([]);
    assert.equal(defaultRun.report.providerPosts, 0);
    assert.equal(defaultRun.report.denialReason, "LIVE_EXECUTE_NOT_APPROVED");
    assert.equal(defaultRun.report.approvalStatus, "NOT_APPROVED");

    const emptyScope = runLiveCli(["--execution-scope"]);
    assert.equal(emptyScope.report.providerPosts, 0);
    assert.equal(emptyScope.report.denialReason, "EXECUTION_SCOPE_MISMATCH");
    assert.equal(emptyScope.report.dbWrites, 0);

    const liveEnvNoAccept = runLiveCli(["--user-cost-approved", "--accept-paid-execution"], {
      RP_QUALITY_PAID_LIVE_EXECUTE: "1",
      RP_QUALITY_PAID_OPENROUTER_KEY: KEYS.openRouterKey,
      RP_QUALITY_PAID_CHEAPERINFERENCE_KEY: KEYS.cheaperInferenceKey,
      RP_QUALITY_PAID_EXPERIMENT_SECRET: SECRET,
    });
    assert.equal(liveEnvNoAccept.report.providerPosts, 0);
    assert.equal(liveEnvNoAccept.report.denialReason, "RUNTIME_SHA_UNAVAILABLE");

    const dir = mkdtempSync(path.join(tmpdir(), "rpq-sealed-file-"));
    const packFile = path.join(dir, "pack.json");
    const marker = "SEALED-BODY-MUST-NOT-LEAVE-PROCESS";
    writeFileSync(
      packFile,
      JSON.stringify({
        manifest: fixturePack().manifest,
        sealedCalls: [{ requestBody: { content: marker } }],
      })
    );
    const ignoredFile = runLiveCli(
      [
        "--user-cost-approved",
        "--accept-paid-execution",
        "--sealed-pack-file",
        packFile,
        "--expected-production-sha",
        MAIN_SHA,
      ],
      {
        RP_QUALITY_PAID_LIVE_EXECUTE: "1",
        RP_QUALITY_PAID_OPENROUTER_KEY: KEYS.openRouterKey,
        RP_QUALITY_PAID_CHEAPERINFERENCE_KEY: KEYS.cheaperInferenceKey,
        RP_QUALITY_PAID_EXPERIMENT_SECRET: SECRET,
        RAILWAY_GIT_COMMIT_SHA: MAIN_SHA,
      }
    );
    assert.equal(ignoredFile.report.providerPosts, 0);
    assert.doesNotMatch(ignoredFile.stdout, /SEALED-BODY-MUST-NOT-LEAVE-PROCESS/);
    assert.doesNotMatch(defaultRun.stdout + liveEnvNoAccept.stdout, /sk-or-|ci_liv|Bearer /);
  });

  it("partial approval stops before production DB read; journal and key gaps stay POST 0", () => {
    const pack = fixturePack();
    const dataDir = mkdtempSync(path.join(tmpdir(), "rpq-preassembly-db-"));
    writeSyntheticProductionDb(dataDir);
    const journalDir = mkdtempSync(path.join(tmpdir(), "rpq-preassembly-journal-"));
    const artifactDir = mkdtempSync(path.join(tmpdir(), "rpq-preassembly-artifact-"));
    const readyArgs = [
      "--user-cost-approved",
      "--accept-paid-execution",
      "--expected-production-sha",
      MAIN_SHA,
      "--approved-manifest-fingerprint",
      pack.manifest.manifestFingerprint,
      "--expected-identity-hash",
      pack.manifest.identityHash,
      "--journal-dir",
      journalDir,
      "--artifact-dir",
      artifactDir,
    ];
    const readyEnv = {
      RP_QUALITY_PAID_LIVE_EXECUTE: "1",
      RP_QUALITY_PAID_OPENROUTER_KEY: KEYS.openRouterKey,
      RP_QUALITY_PAID_CHEAPERINFERENCE_KEY: KEYS.cheaperInferenceKey,
      RP_QUALITY_PAID_EXPERIMENT_SECRET: SECRET,
      RAILWAY_GIT_COMMIT_SHA: MAIN_SHA,
      DATA_DIR: dataDir,
    };

    const missingSecret = runLiveCli(readyArgs, { ...readyEnv, RP_QUALITY_PAID_EXPERIMENT_SECRET: "" });
    assert.equal(missingSecret.report.denialReason, "MISSING_EXPERIMENT_SECRET");
    assert.equal(missingSecret.report.sealedCallsPresent, false);
    assert.equal(missingSecret.report.providerPosts, 0);
    assert.equal(missingSecret.report.dbWrites, 0);
    assert.doesNotMatch(missingSecret.stdout, /창가에 서서|exchangeRate/);

    const missingKey = runLiveCli(readyArgs, { ...readyEnv, RP_QUALITY_PAID_OPENROUTER_KEY: "" });
    assert.equal(missingKey.report.denialReason, "MISSING_INFERENCE_KEY");
    assert.equal(missingKey.report.sealedCallsPresent, false);
    assert.equal(missingKey.report.providerPosts, 0);

    const staleSha = runLiveCli(readyArgs, { ...readyEnv, RAILWAY_GIT_COMMIT_SHA: OTHER_SHA });
    assert.equal(staleSha.report.denialReason, "RUNTIME_SHA_MISMATCH");
    assert.equal(staleSha.report.sealedCallsPresent, false);
    assert.equal(staleSha.report.providerPosts, 0);

    const missingJournal = runLiveCli(
      readyArgs.filter((value, index, all) => value !== "--journal-dir" && all[index - 1] !== "--journal-dir"),
      readyEnv
    );
    assert.equal(missingJournal.report.denialReason, "JOURNAL_STORE_UNAVAILABLE");
    assert.equal(missingJournal.report.sealedCallsPresent, false);
    assert.equal(missingJournal.report.providerPosts, 0);

    const staleFingerprint = runLiveCli(
      [
        "--user-cost-approved",
        "--accept-paid-execution",
        "--expected-production-sha",
        MAIN_SHA,
        "--approved-manifest-fingerprint",
        "aa".repeat(32),
        "--expected-identity-hash",
        pack.manifest.identityHash,
        "--journal-dir",
        journalDir,
        "--artifact-dir",
        artifactDir,
        "--manifest-json",
        JSON.stringify(pack.manifest),
      ],
      readyEnv
    );
    assert.equal(staleFingerprint.report.denialReason, "MANIFEST_FINGERPRINT_MISMATCH");
    assert.equal(staleFingerprint.report.sealedCallsPresent, false);
    assert.equal(staleFingerprint.report.providerPosts, 0);

    const grant = evaluatePaidRunnerLiveAssemblyGrant({
      authorization: auth(pack.manifest, { experimentSecret: null }),
      keys: KEYS,
      journalDir,
      artifactDir,
    });
    assert.equal(grant.ok, false);
    if (!grant.ok) assert.equal(grant.reason, "MISSING_EXPERIMENT_SECRET");
    const prereq = evaluatePaidRunnerAuthorizationPrerequisites(
      auth(pack.manifest, { approvedManifestFingerprint: "" }),
      "AUTHORIZED"
    );
    assert.equal(prereq.authorized, false);
    if (!prereq.authorized) assert.equal(prereq.reason, "MANIFEST_FINGERPRINT_MISMATCH");
  });
});

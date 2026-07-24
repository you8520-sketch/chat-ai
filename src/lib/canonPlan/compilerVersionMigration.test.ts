import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import Database from "better-sqlite3";

import { compileCanonPlanV1 } from "@/lib/canonPlan/compiler";
import { buildCanonPlanForSave } from "@/lib/canonPlan/compileForSave";
import { hashCanonSource } from "@/lib/canonPlan/hash";
import {
  ensureCanonPlanOnAccess,
  resetLazyCompileInFlightForTests,
} from "@/lib/canonPlan/lazyCompile";
import { parseCanonPlanV1 } from "@/lib/canonPlan/serialize";
import {
  CANON_COMPILER_VERSION,
  CANON_PLAN_VERSION,
  type CanonPlanV1,
} from "@/lib/canonPlan/types";

const FUNDAMENTAL_LAW_RAW = `[이름]
리안 · 27세 · 남성 · 탐사대원

[성격]
침착하고 규칙을 지킨다.

[세계관]
코어 근처에서 총성을 내면 동조체가 몰려든다.

[세계관 — 마법]
마법을 사용할수록 사용자의 수명이 줄어든다.

[세계관 — 센티넬]
가이드와 장시간 접촉하지 못한 센티넬은 결국 폭주한다.

[세계관 — 부활]
죽은 사람은 어떤 마법으로도 되살릴 수 없다.

[세계관 — 북쪽 관문]
북쪽 관문 너머의 안개는 낮에도 시야를 10m 이하로 줄인다.`;

const HAZARD_LAW = "코어 근처에서 총성을 내면 동조체가 몰려든다.";
const TEST_CHAR_ID = 9_900_002;
const NOW = "2026-07-24T00:00:00.000Z";

/** Phase 2B recovered laws that were DORMANT under compiler v1 semantics. */
const V1_DORMANT_CORE_LAWS = [
  HAZARD_LAW,
  "마법을 사용할수록 사용자의 수명이 줄어든다.",
  "죽은 사람은 어떤 마법으로도 되살릴 수 없다.",
];

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      system_prompt TEXT NOT NULL DEFAULT '',
      world TEXT NOT NULL DEFAULT '',
      creator_raw_description TEXT NOT NULL DEFAULT '',
      creator_canon_plan_json TEXT
    )
  `);
  return db;
}

function insertCharacter(
  db: Database.Database,
  opts: {
    raw: string;
    planJson?: string | null;
    world?: string;
    systemPrompt?: string;
  }
): void {
  db.prepare("DELETE FROM characters WHERE id = ?").run(TEST_CHAR_ID);
  db.prepare(
    `INSERT INTO characters (id, name, creator_raw_description, creator_canon_plan_json, world, system_prompt)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    TEST_CHAR_ID,
    "리안",
    opts.raw,
    opts.planJson ?? null,
    opts.world ?? "",
    opts.systemPrompt ?? ""
  );
}

function readCharacterRow(db: Database.Database) {
  return db
    .prepare(
      "SELECT creator_raw_description, creator_canon_plan_json, world, system_prompt FROM characters WHERE id = ?"
    )
    .get(TEST_CHAR_ID) as {
    creator_raw_description: string;
    creator_canon_plan_json: string | null;
    world: string;
    system_prompt: string;
  };
}

function readPlanJson(db: Database.Database): string | null {
  const row = readCharacterRow(db);
  return row.creator_canon_plan_json?.trim() || null;
}

/** Realistic stored v1 plan: valid JSON shape, v1 hash, Phase-2A-era salience on recovered laws. */
function buildStoredCompilerV1Plan(raw: string): { json: string; plan: CanonPlanV1 } {
  const compiled = compileCanonPlanV1({ creatorRawDescription: raw, now: NOW });
  assert.equal(compiled.ok, true);
  if (!compiled.ok) throw new Error("compile failed");

  const v1Chunks = compiled.plan.chunks.map((chunk) => {
    if (V1_DORMANT_CORE_LAWS.includes(chunk.text)) {
      return { ...chunk, salience: "dormant" as const };
    }
    return chunk;
  });

  const v1CoreIds = v1Chunks.filter((c) => c.salience === "core").map((c) => c.id);

  const v1PlanForStorage = {
    ...compiled.plan,
    compilerVersion: 1,
    sourceHash: hashCanonSource(raw, 1),
    chunks: v1Chunks,
    coreIds: v1CoreIds,
  };

  return { json: JSON.stringify(v1PlanForStorage), plan: v1PlanForStorage as CanonPlanV1 };
}

function hazardChunkSalience(plan: CanonPlanV1): CanonPlanV1["chunks"][number]["salience"] | undefined {
  return plan.chunks.find((c) => c.text === HAZARD_LAW)?.salience;
}

afterEach(() => {
  resetLazyCompileInFlightForTests();
});

describe("Canon compiler version migration — invalidation", () => {
  it("A: parseCanonPlanV1 rejects stored compilerVersion=1 JSON under runtime v2", () => {
    const { json } = buildStoredCompilerV1Plan(FUNDAMENTAL_LAW_RAW);
    assert.equal(parseCanonPlanV1(json), null);
  });

  it("B: hashCanonSource changes when compiler version changes", () => {
    const hashV1 = hashCanonSource(FUNDAMENTAL_LAW_RAW, 1);
    const hashV2 = hashCanonSource(FUNDAMENTAL_LAW_RAW, 2);
    assert.notEqual(hashV1, hashV2);
  });

  it("C: unchanged raw is stale under v2 (hash mismatch vs stored v1 plan)", () => {
    const { json, plan } = buildStoredCompilerV1Plan(FUNDAMENTAL_LAW_RAW);
    assert.equal(parseCanonPlanV1(json), null);
    assert.notEqual(plan.sourceHash, hashCanonSource(FUNDAMENTAL_LAW_RAW));
  });

  it("schema version unchanged — CANON_PLAN_VERSION stays 1", () => {
    assert.equal(CANON_PLAN_VERSION, 1);
    assert.equal(CANON_COMPILER_VERSION, 2);
    const compiled = compileCanonPlanV1({ creatorRawDescription: FUNDAMENTAL_LAW_RAW, now: NOW });
    assert.equal(compiled.ok, true);
    if (!compiled.ok) return;
    assert.equal(compiled.plan.version, 1);
    assert.equal(compiled.plan.compilerVersion, 2);
  });
});

describe("Canon compiler version migration — buildCanonPlanForSave", () => {
  it("recompiles stale v1 stored plan to v2 with Phase 2B salience", () => {
    const { json, plan: v1Plan } = buildStoredCompilerV1Plan(FUNDAMENTAL_LAW_RAW);
    assert.equal(hazardChunkSalience(v1Plan), "dormant");

    const saved = buildCanonPlanForSave({
      creatorRawDescription: FUNDAMENTAL_LAW_RAW,
      existingPlanJson: json,
      now: NOW,
    });

    assert.equal(saved.reusedExisting, false);
    assert.equal(saved.compiled, true);
    assert.ok(saved.plan);
    assert.equal(saved.plan.compilerVersion, 2);
    assert.equal(saved.plan.sourceHash, hashCanonSource(FUNDAMENTAL_LAW_RAW));
    assert.equal(hazardChunkSalience(saved.plan), "core");
    assert.ok(saved.plan.coreIds.some((id) => saved.plan!.chunks.find((c) => c.id === id)?.text === HAZARD_LAW));
  });

  it("new canon compile stores compilerVersion=2", () => {
    const saved = buildCanonPlanForSave({
      creatorRawDescription: FUNDAMENTAL_LAW_RAW,
      now: NOW,
    });
    assert.equal(saved.compiled, true);
    assert.equal(saved.plan?.compilerVersion, 2);
  });

  it("reuses current v2 plan when source hash unchanged", () => {
    const first = buildCanonPlanForSave({
      creatorRawDescription: FUNDAMENTAL_LAW_RAW,
      now: NOW,
    });
    assert.ok(first.planJson);

    const second = buildCanonPlanForSave({
      creatorRawDescription: FUNDAMENTAL_LAW_RAW,
      existingPlanJson: first.planJson,
      now: NOW,
    });
    assert.equal(second.reusedExisting, true);
    assert.equal(second.compiled, false);
    assert.equal(second.plan?.compilerVersion, 2);
    assert.equal(second.plan?.sourceHash, hashCanonSource(FUNDAMENTAL_LAW_RAW));
  });
});

describe("Canon compiler version migration — lazy recompile", () => {
  it("first access migrates v1 stored plan to v2 and persists", () => {
    const db = createTestDb();
    const { json: v1Json, plan: v1Plan } = buildStoredCompilerV1Plan(FUNDAMENTAL_LAW_RAW);
    assert.equal(hazardChunkSalience(v1Plan), "dormant");

    insertCharacter(db, { raw: FUNDAMENTAL_LAW_RAW, planJson: v1Json });
    const before = readCharacterRow(db);

    const first = ensureCanonPlanOnAccess(db, TEST_CHAR_ID, {
      creator_raw_description: FUNDAMENTAL_LAW_RAW,
      creator_canon_plan_json: v1Json,
    });

    assert.equal(first.compileSource, "lazy");
    assert.equal(first.reusedExisting, false);
    assert.equal(first.compiled, true);
    assert.equal(first.persisted, true);
    assert.equal(first.plan?.compilerVersion, 2);
    assert.equal(first.plan?.sourceHash, hashCanonSource(FUNDAMENTAL_LAW_RAW));
    assert.equal(hazardChunkSalience(first.plan!), "core");

    const storedJson = readPlanJson(db);
    assert.ok(storedJson);
    assert.notEqual(storedJson, v1Json);
    const storedPlan = parseCanonPlanV1(storedJson);
    assert.ok(storedPlan);
    assert.equal(storedPlan.compilerVersion, 2);
    assert.equal(hazardChunkSalience(storedPlan), "core");

    const after = readCharacterRow(db);
    assert.equal(after.creator_raw_description, before.creator_raw_description);
    assert.equal(after.world, before.world);
    assert.equal(after.system_prompt, before.system_prompt);

    db.close();
  });

  it("second access reuses persisted v2 without recompile", () => {
    const db = createTestDb();
    const { json: v1Json } = buildStoredCompilerV1Plan(FUNDAMENTAL_LAW_RAW);
    insertCharacter(db, { raw: FUNDAMENTAL_LAW_RAW, planJson: v1Json });

    const first = ensureCanonPlanOnAccess(db, TEST_CHAR_ID, {
      creator_raw_description: FUNDAMENTAL_LAW_RAW,
      creator_canon_plan_json: v1Json,
    });
    assert.equal(first.persisted, true);
    const storedJson = readPlanJson(db);
    assert.ok(storedJson);

    const second = ensureCanonPlanOnAccess(db, TEST_CHAR_ID, {
      creator_raw_description: FUNDAMENTAL_LAW_RAW,
      creator_canon_plan_json: storedJson,
    });

    assert.equal(second.compileSource, "existing");
    assert.equal(second.reusedExisting, true);
    assert.equal(second.compiled, false);
    assert.equal(second.persisted, false);
    assert.equal(second.sourceHashStatus, "match");
    assert.equal(readPlanJson(db), storedJson);

    db.close();
  });
});

describe("Canon compiler version migration — CAS race safety", () => {
  it("loser does not overwrite valid v2 written by concurrent winner", () => {
    const db = createTestDb();
    const { json: v1Json } = buildStoredCompilerV1Plan(FUNDAMENTAL_LAW_RAW);
    insertCharacter(db, { raw: FUNDAMENTAL_LAW_RAW, planJson: v1Json });

    const winnerSave = buildCanonPlanForSave({
      creatorRawDescription: FUNDAMENTAL_LAW_RAW,
      now: NOW,
    });
    assert.ok(winnerSave.planJson);

    db.prepare(
      `UPDATE characters SET creator_canon_plan_json = ? WHERE id = ? AND creator_canon_plan_json = ?`
    ).run(winnerSave.planJson, TEST_CHAR_ID, v1Json);

    const loser = ensureCanonPlanOnAccess(db, TEST_CHAR_ID, {
      creator_raw_description: FUNDAMENTAL_LAW_RAW,
      creator_canon_plan_json: v1Json,
    });

    assert.equal(loser.plan?.compilerVersion, 2);
    assert.equal(loser.plan?.sourceHash, hashCanonSource(FUNDAMENTAL_LAW_RAW));
    assert.equal(readPlanJson(db), winnerSave.planJson);
    assert.equal(parseCanonPlanV1(readPlanJson(db)!)?.compilerVersion, 2);

    db.close();
  });
});

describe("Canon compiler version migration — missing raw fallback", () => {
  it("preserves stored v1 JSON when raw is empty and does not crash-loop", () => {
    const db = createTestDb();
    const { json: v1Json } = buildStoredCompilerV1Plan(FUNDAMENTAL_LAW_RAW);
    insertCharacter(db, { raw: "", planJson: v1Json });

    const result = ensureCanonPlanOnAccess(db, TEST_CHAR_ID, {
      creator_raw_description: "",
      creator_canon_plan_json: v1Json,
    });

    assert.equal(result.sourceHashStatus, "missing_raw");
    assert.equal(result.compiled, false);
    assert.equal(result.persisted, false);
    assert.equal(result.plan, null);
    assert.equal(readPlanJson(db), v1Json);

    const again = ensureCanonPlanOnAccess(db, TEST_CHAR_ID, {
      creator_raw_description: "",
      creator_canon_plan_json: v1Json,
    });
    assert.equal(again.compiled, false);
    assert.equal(again.plan, null);
    assert.equal(readPlanJson(db), v1Json);

    db.close();
  });
});

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
const TEST_CHAR_ID = 9_900_003;
const NOW = "2026-07-24T00:00:00.000Z";

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
  opts: { raw: string; planJson?: string | null; world?: string; systemPrompt?: string }
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

/** Stored compiler v2 plan shape (pre-visibility). */
function buildStoredCompilerV2Plan(raw: string): { json: string; plan: CanonPlanV1 } {
  const compiled = compileCanonPlanV1({ creatorRawDescription: raw, now: NOW });
  assert.equal(compiled.ok, true);
  if (!compiled.ok) throw new Error("compile failed");

  const v2Chunks = compiled.plan.chunks.map(({ visibility: _v, ...chunk }) => chunk) as CanonPlanV1["chunks"];

  const v2PlanForStorage = {
    ...compiled.plan,
    version: 1,
    compilerVersion: 2,
    sourceHash: hashCanonSource(raw, 2),
    chunks: v2Chunks,
  };

  return { json: JSON.stringify(v2PlanForStorage), plan: v2PlanForStorage as CanonPlanV1 };
}

function hazardChunkVisibility(plan: CanonPlanV1): string | undefined {
  return plan.chunks.find((c) => c.text === HAZARD_LAW)?.visibility;
}

afterEach(() => {
  resetLazyCompileInFlightForTests();
});

describe("Canon compiler version migration — PR-C v2→v3", () => {
  it("A: parseCanonPlanV1 rejects stored compilerVersion=2 JSON under runtime v3", () => {
    const { json } = buildStoredCompilerV2Plan(FUNDAMENTAL_LAW_RAW);
    assert.equal(parseCanonPlanV1(json), null);
  });

  it("B: hashCanonSource changes when compiler version changes (v2 vs v3)", () => {
    const hashV2 = hashCanonSource(FUNDAMENTAL_LAW_RAW, 2);
    const hashV3 = hashCanonSource(FUNDAMENTAL_LAW_RAW, 3);
    assert.notEqual(hashV2, hashV3);
  });

  it("schema version bumped — CANON_PLAN_VERSION=2, CANON_COMPILER_VERSION=3", () => {
    assert.equal(CANON_PLAN_VERSION, 2);
    assert.equal(CANON_COMPILER_VERSION, 3);
    const compiled = compileCanonPlanV1({ creatorRawDescription: FUNDAMENTAL_LAW_RAW, now: NOW });
    assert.equal(compiled.ok, true);
    if (!compiled.ok) return;
    assert.equal(compiled.plan.version, 2);
    assert.equal(compiled.plan.compilerVersion, 3);
    assert.ok(compiled.plan.chunks.every((c) => c.visibility === "PUBLIC" || c.visibility === "CONDITIONAL"));
  });

  it("recompiles stale v2 stored plan to v3 with visibility on access", () => {
    const { json } = buildStoredCompilerV2Plan(FUNDAMENTAL_LAW_RAW);
    const saved = buildCanonPlanForSave({
      creatorRawDescription: FUNDAMENTAL_LAW_RAW,
      existingPlanJson: json,
      now: NOW,
    });
    assert.equal(saved.reusedExisting, false);
    assert.equal(saved.plan?.compilerVersion, 3);
    assert.equal(saved.plan?.version, 2);
    assert.equal(hazardChunkVisibility(saved.plan!), "PUBLIC");
  });

  it("lazy first access migrates v2 to v3; second access reuses", () => {
    const db = createTestDb();
    const { json: v2Json } = buildStoredCompilerV2Plan(FUNDAMENTAL_LAW_RAW);
    insertCharacter(db, { raw: FUNDAMENTAL_LAW_RAW, planJson: v2Json });
    const before = readCharacterRow(db);

    const first = ensureCanonPlanOnAccess(db, TEST_CHAR_ID, {
      creator_raw_description: FUNDAMENTAL_LAW_RAW,
      creator_canon_plan_json: v2Json,
    });
    assert.equal(first.compileSource, "lazy");
    assert.equal(first.plan?.compilerVersion, 3);
    assert.equal(first.persisted, true);

    const storedJson = readPlanJson(db);
    assert.ok(storedJson);
    assert.notEqual(storedJson, v2Json);

    const second = ensureCanonPlanOnAccess(db, TEST_CHAR_ID, {
      creator_raw_description: FUNDAMENTAL_LAW_RAW,
      creator_canon_plan_json: storedJson,
    });
    assert.equal(second.reusedExisting, true);
    assert.equal(second.compiled, false);

    const after = readCharacterRow(db);
    assert.equal(after.creator_raw_description, before.creator_raw_description);
    db.close();
  });

  it("missing raw preserves stored v2 JSON without deletion", () => {
    const db = createTestDb();
    const { json: v2Json } = buildStoredCompilerV2Plan(FUNDAMENTAL_LAW_RAW);
    insertCharacter(db, { raw: "", planJson: v2Json });

    const result = ensureCanonPlanOnAccess(db, TEST_CHAR_ID, {
      creator_raw_description: "",
      creator_canon_plan_json: v2Json,
    });
    assert.equal(result.sourceHashStatus, "missing_raw");
    assert.equal(result.plan, null);
    assert.equal(readPlanJson(db), v2Json);
    db.close();
  });
});

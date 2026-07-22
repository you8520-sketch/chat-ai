import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { selectActiveCanonChunks, isActiveSelectionEmpty } from "@/lib/canonPlan/activeSelector";
import { compileCanonPlanV1, canonCoreInflationMetrics } from "@/lib/canonPlan/compiler";
import { buildCanonPlanForSave } from "@/lib/canonPlan/compileForSave";
import { renderCoreCanonBlock } from "@/lib/canonPlan/coreRenderer";
import { hashCanonSource } from "@/lib/canonPlan/hash";
import { parseCanonPlanV1, serializeCanonPlanV1 } from "@/lib/canonPlan/serialize";

const FIXTURE_RAW = [
  "[이름]",
  "레온 · 28세 · 남성 · 귀족",
  "",
  "[성격]",
  "냉정하고 계산적이다. 겉으로는 무심해 보인다.",
  "",
  "[세계관]",
  "마법이 존재하는 판타지 왕국.",
  "불변 규칙: 마법 사용 시 반드시 대가를 치른다.",
  "",
  "[비밀]",
  "호감도 80 이상이 되면 고백 트리거가 발생한다. 캐릭터는 이 사실을 모른다.",
  "",
  "유저만 알고 있는 회귀 설정이다. 캐릭터는 모른다.",
].join("\n");

describe("compileCanonPlanV1 determinism", () => {
  it("same raw + compiler version => same chunks, ids, ordering, core selection", () => {
    const first = compileCanonPlanV1({
      creatorRawDescription: FIXTURE_RAW,
      now: "2026-01-01T00:00:00.000Z",
    });
    const second = compileCanonPlanV1({
      creatorRawDescription: FIXTURE_RAW,
      now: "2026-01-02T00:00:00.000Z",
    });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) return;

    assert.equal(first.plan.sourceHash, second.plan.sourceHash);
    assert.deepEqual(
      first.plan.chunks.map((c) => ({ id: c.id, order: c.order, salience: c.salience, text: c.text })),
      second.plan.chunks.map((c) => ({ id: c.id, order: c.order, salience: c.salience, text: c.text }))
    );
    assert.deepEqual(first.plan.coreIds, second.plan.coreIds);
  });

  it("importance/plot hooks stay dormant — not auto CORE", () => {
    const compiled = compileCanonPlanV1({ creatorRawDescription: FIXTURE_RAW, now: "2026-01-01T00:00:00.000Z" });
    assert.equal(compiled.ok, true);
    if (!compiled.ok) return;

    const secretChunks = compiled.plan.chunks.filter((c) => /고백|회귀/.test(c.text));
    assert.ok(secretChunks.length >= 2);
    for (const chunk of secretChunks) {
      assert.equal(chunk.salience, "dormant");
      assert.equal(compiled.plan.coreIds.includes(chunk.id), false);
    }
  });

  it("identity/personality sections promote CORE", () => {
    const compiled = compileCanonPlanV1({ creatorRawDescription: FIXTURE_RAW, now: "2026-01-01T00:00:00.000Z" });
    assert.equal(compiled.ok, true);
    if (!compiled.ok) return;

    const coreText = compiled.plan.chunks
      .filter((c) => compiled.plan.coreIds.includes(c.id))
      .map((c) => c.text)
      .join("\n");
    assert.match(coreText, /레온 · 28세/);
    assert.match(coreText, /냉정하고 계산적/);
    assert.match(coreText, /불변 규칙/);
  });
});

describe("canonCoreInflationMetrics", () => {
  it("reports core ratio below full canon", () => {
    const compiled = compileCanonPlanV1({ creatorRawDescription: FIXTURE_RAW, now: "2026-01-01T00:00:00.000Z" });
    assert.equal(compiled.ok, true);
    if (!compiled.ok) return;

    const metrics = canonCoreInflationMetrics(compiled.plan);
    assert.ok(metrics.coreChunks > 0);
    assert.ok(metrics.dormantChunks > 0);
    assert.ok(metrics.coreRatio < 1);
    assert.ok(metrics.coreChars < metrics.totalChars);
  });
});

describe("renderCoreCanonBlock determinism", () => {
  it("same plan + same model path => identical serialized CORE block", () => {
    const compiled = compileCanonPlanV1({ creatorRawDescription: FIXTURE_RAW, now: "2026-01-01T00:00:00.000Z" });
    assert.equal(compiled.ok, true);
    if (!compiled.ok) return;

    const a = renderCoreCanonBlock(compiled.plan, { charName: "레온", serializationPath: "legacy_structured" });
    const b = renderCoreCanonBlock(compiled.plan, { charName: "레온", serializationPath: "legacy_structured" });
    assert.equal(a, b);
    assert.match(a, /\[CHARACTER CANON — 레온 MAY KNOW & ROLEPLAY\]/);
    assert.doesNotMatch(a, /고백 트리거/);
  });
});

describe("selectActiveCanonChunks", () => {
  it("ACTIVE=0 when no relevance keywords — must not imply FULL fallback", () => {
    const compiled = compileCanonPlanV1({ creatorRawDescription: FIXTURE_RAW, now: "2026-01-01T00:00:00.000Z" });
    assert.equal(compiled.ok, true);
    if (!compiled.ok) return;

    const selection = selectActiveCanonChunks({
      plan: compiled.plan,
      userMessage: "안녕",
      budgetChars: 1200,
    });
    assert.equal(isActiveSelectionEmpty(selection), true);
    assert.equal(selection.activeChunks.length, 0);
    assert.equal(selection.activeChars, 0);
  });

  it("selects dormant chunks when keywords match", () => {
    const compiled = compileCanonPlanV1({ creatorRawDescription: FIXTURE_RAW, now: "2026-01-01T00:00:00.000Z" });
    assert.equal(compiled.ok, true);
    if (!compiled.ok) return;

    // B1: only allowed-bucket (character/world) dormant chunks are surfacable by ACTIVE.
    // "마법 왕국" matches the world/dormant chunk "마법이 존재하는 판타지 왕국." (order 3).
    const selection = selectActiveCanonChunks({
      plan: compiled.plan,
      userMessage: "마법 왕국 이야기",
      budgetChars: 1200,
    });
    assert.ok(selection.activeChunks.length > 0);
    const activeText = selection.activeChunks.map((c) => c.text).join("\n");
    assert.match(activeText, /마법|왕국/);
  });

  it("B1: player/scenario_meta dormant secrets are NOT surfaced by ACTIVE even when cue matches", () => {
    const compiled = compileCanonPlanV1({ creatorRawDescription: FIXTURE_RAW, now: "2026-01-01T00:00:00.000Z" });
    assert.equal(compiled.ok, true);
    if (!compiled.ok) return;

    // "회귀" lives in a player-bucket chunk; "고백" lives in a scenario_meta-bucket chunk.
    // B1 excludes both from ACTIVE eligibility -> nothing selected.
    const selection = selectActiveCanonChunks({
      plan: compiled.plan,
      userMessage: "회귀 고백 이야기",
      budgetChars: 1200,
    });
    assert.equal(selection.activeChunks.length, 0);
    for (const c of selection.activeChunks) {
      assert.notEqual(c.bucket, "player", "player chunk leaked: " + c.id);
      assert.notEqual(c.bucket, "scenario_meta", "scenario_meta chunk leaked: " + c.id);
    }
  });
});

describe("buildCanonPlanForSave", () => {
  it("reuses existing valid plan on compile failure", () => {
    const good = compileCanonPlanV1({ creatorRawDescription: FIXTURE_RAW, now: "2026-01-01T00:00:00.000Z" });
    assert.equal(good.ok, true);
    if (!good.ok) return;

    const existingJson = serializeCanonPlanV1(good.plan);
    const saved = buildCanonPlanForSave({
      creatorRawDescription: "   ",
      existingPlanJson: existingJson,
    });
    assert.equal(saved.reusedExisting, true);
    assert.equal(saved.plan?.sourceHash, good.plan.sourceHash);
  });

  it("skips recompile when source hash unchanged", () => {
    const saved = buildCanonPlanForSave({
      creatorRawDescription: FIXTURE_RAW,
      compilerDescription: FIXTURE_RAW,
    });
    assert.equal(saved.compiled, true);
    assert.ok(saved.planJson);

    const again = buildCanonPlanForSave({
      creatorRawDescription: FIXTURE_RAW,
      compilerDescription: FIXTURE_RAW,
      existingPlanJson: saved.planJson,
    });
    assert.equal(again.reusedExisting, true);
    assert.equal(again.compiled, false);
    assert.equal(again.plan?.sourceHash, hashCanonSource(FIXTURE_RAW));
  });
});

describe("parseCanonPlanV1", () => {
  it("round-trips serialized plan", () => {
    const compiled = compileCanonPlanV1({ creatorRawDescription: FIXTURE_RAW, now: "2026-01-01T00:00:00.000Z" });
    assert.equal(compiled.ok, true);
    if (!compiled.ok) return;

    const json = serializeCanonPlanV1(compiled.plan);
    const parsed = parseCanonPlanV1(json);
    assert.ok(parsed);
    assert.deepEqual(parsed?.coreIds, compiled.plan.coreIds);
    assert.equal(parsed?.chunks.length, compiled.plan.chunks.length);
  });
});

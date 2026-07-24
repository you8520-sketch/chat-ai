import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compileCanonPlanV1 } from "@/lib/canonPlan/compiler";
import { selectActiveCanonChunks } from "@/lib/canonPlan/activeSelector";
import { renderCoreCanonBlock, renderCanonChunksBlock } from "@/lib/canonPlan/coreRenderer";
import {
  AUTHOR_MARKER_CHARACTER_KNOWN,
  isPublicVisibleChunk,
  resolveChunkVisibility,
  resolveSectionAuthorVisibility,
} from "@/lib/canonPlan/canonVisibility";
import {
  PRIVATE_CHARACTER_SECRET_MAX_CHARS,
  renderPrivateCharacterSecretBlock,
} from "@/lib/canonPlan/privateCharacterSecretRenderer";
import { parseCanonPlanV1, serializeCanonPlanV1 } from "@/lib/canonPlan/serialize";
import { compileCreatorDescriptionTriggers } from "@/lib/creatorDescriptionTriggerCompiler";
import {
  CANON_COMPILER_VERSION,
  CANON_PLAN_VERSION,
  type CanonPlanV1,
} from "@/lib/canonPlan/types";
import { ATOMIC_FACTS } from "../../../data/canon-core-audit/manifests";
import { AUDIT_FIXTURES } from "../../../data/canon-core-audit/fixtures";
import { ACTIVE_CUE_TESTS } from "../../../data/canon-core-audit/manifests";
import { compilePlan, matchFactChunks } from "../../../data/canon-core-audit/reconcile-harness";

const NOW = "2026-07-24T12:00:00.000Z";

const POL_C1_MARKED = `[이름]
카일 · 35세 · 남성 · 대사관 수석 비서

[성격]
온화한 미소 뒤에 계산이 있다.

[비밀 — 캐릭터는 앎]
카일은 검은 깃발의 정보원이다.`;

const ENO_C1_MARKED = `[이름]
에녹 · 30세 · 남성 · 저격수

[성격]
냉정하다.

[비밀 — 캐릭터는 앎]
시타델은 인형 정부로 운영된다.`;

const SEC_C1_MARKED = `[이름]
이안 · 29세 · 남성 · 사립탐정

[비밀 — 캐릭터는 앎]
이안은 5년 전 사라진 연쇄살인범의 동생이다.`;

const SEC_C2_ORIGINAL = `[비밀]
호감 70 이상이면 과거 고백 트리거. 캐릭터는 모른다.`;

const POL_C1_LEGACY = AUDIT_FIXTURES.find((f) => f.id === "political-faction")!.creatorRawDescription;

function compile(raw: string): CanonPlanV1 {
  const result = compileCanonPlanV1({ creatorRawDescription: raw, now: NOW });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("compile failed");
  return result.plan;
}

function activeCount(plan: CanonPlanV1, userMessage: string): number {
  return selectActiveCanonChunks({ plan, userMessage }).activeChunks.length;
}

function corePublicText(plan: CanonPlanV1): string {
  return renderCoreCanonBlock(plan, { charName: "Test" });
}

function s2Text(plan: CanonPlanV1): string | null {
  return renderPrivateCharacterSecretBlock(plan).block;
}

function chunkForHint(plan: CanonPlanV1, hint: string) {
  return plan.chunks.find((c) => c.text.includes(hint) || c.sectionTitle.includes(hint));
}

function classifyLegacyAmbiguous(factId: string, raw: string): "LEGACY_UNMARKED_UNRESOLVED" | "EXPLICIT_MARKER_SAFE" {
  if (/비밀\s*[—\-–]\s*캐릭터(?:는|이)\s*앎/.test(raw)) return "EXPLICIT_MARKER_SAFE";
  if (factId === "pol-C1" && /\[배경\]/.test(raw) && !AUTHOR_MARKER_CHARACTER_KNOWN.test(raw)) {
    return "LEGACY_UNMARKED_UNRESOLVED";
  }
  if (/^\[비밀\]/m.test(raw) && !/캐릭터(?:는|이)\s*앎/.test(raw)) {
    return "LEGACY_UNMARKED_UNRESOLVED";
  }
  return "EXPLICIT_MARKER_SAFE";
}

describe("PR-C canon visibility — versioning", () => {
  it("Plan V2 / Compiler V3 constants", () => {
    assert.equal(CANON_PLAN_VERSION, 2);
    assert.equal(CANON_COMPILER_VERSION, 3);
    const plan = compile(`[이름]\n테스트`);
    assert.equal(plan.version, 2);
    assert.equal(plan.compilerVersion, 3);
    assert.ok(plan.chunks.every((c) => c.visibility));
  });
});

describe("PR-C author marker contract", () => {
  it("resolveSectionAuthorVisibility markers", () => {
    assert.equal(resolveSectionAuthorVisibility("[비밀 — 캐릭터는 앎]"), "LOCKED_SECRET");
    assert.equal(resolveSectionAuthorVisibility("[비밀 — 캐릭터도 모름]"), "CONDITIONAL");
    assert.equal(resolveSectionAuthorVisibility("[조건부 공개]"), "CONDITIONAL");
    assert.equal(resolveSectionAuthorVisibility("[비밀]"), "CONDITIONAL");
    assert.equal(resolveSectionAuthorVisibility("[성격]"), null);
  });

  it("legacy [비밀] without marker is CONDITIONAL not LOCKED_SECRET", () => {
    const plan = compile(`[비밀]\n숨겨진 과거가 있다.`);
    const chunk = plan.chunks[0];
    assert.equal(chunk?.visibility, "CONDITIONAL");
    assert.equal(s2Text(plan), null);
  });

  it("ambiguous [배경] spy sentence stays LEGACY_UNMARKED without broad regex", () => {
    assert.equal(classifyLegacyAmbiguous("pol-C1", POL_C1_LEGACY), "LEGACY_UNMARKED_UNRESOLVED");
    const plan = compile(POL_C1_LEGACY);
    const spy = chunkForHint(plan, "정보원");
    assert.ok(spy);
    assert.notEqual(spy!.visibility, "LOCKED_SECRET");
    assert.equal(s2Text(plan)?.includes("정보원") ?? false, false);
  });
});

describe("PR-C sec-C2 trigger parity", () => {
  it("호감 equivalent to 호감도 for trigger inference", () => {
    const compiled = compileCreatorDescriptionTriggers({
      description: "호감 70 이상이면 과거 고백 트리거. 캐릭터는 모른다.",
    });
    assert.equal(compiled.trigger_candidates.length, 1);
    assert.equal(compiled.trigger_candidates[0]?.status_key, "affection");
    assert.equal(compiled.trigger_candidates[0]?.value, 70);
    assert.ok(compiled.hidden_event_notes.length >= 1);
  });

  it("sec-C2 original routes scenario_meta CONDITIONAL with no S2", () => {
    const plan = compile(`[이름]\n이안\n\n${SEC_C2_ORIGINAL}`);
    const triggerChunk = plan.chunks.find((c) => /고백|70/.test(c.text));
    assert.ok(triggerChunk);
    assert.equal(triggerChunk!.bucket, "scenario_meta");
    assert.equal(triggerChunk!.visibility, "CONDITIONAL");
    assert.equal(activeCount(plan, "호감 70 고백"), 0);
    assert.equal(s2Text(plan), null);
  });
});

describe("PR-C marked C regressions", () => {
  it("pol-C1 marked: LOCKED_SECRET, ACTIVE=0, CORE=0, S2=yes", () => {
    const plan = compile(POL_C1_MARKED);
    const chunk = chunkForHint(plan, "정보원");
    assert.equal(chunk?.bucket, "character");
    assert.equal(chunk?.visibility, "LOCKED_SECRET");
    assert.equal(activeCount(plan, "검은 깃발 정보원"), 0);
    assert.equal(activeCount(plan, "카일 신분"), 0);
    assert.equal(corePublicText(plan).includes("정보원"), false);
    assert.match(s2Text(plan) ?? "", /PRIVATE CHARACTER SECRET/);
    assert.match(s2Text(plan) ?? "", /정보원/);
  });

  it("eno-C1 marked: CHARACTER_KNOWN LOCKED_SECRET ACTIVE=0 S2=yes", () => {
    const plan = compile(ENO_C1_MARKED);
    const chunk = chunkForHint(plan, "인형");
    assert.equal(chunk?.bucket, "character");
    assert.equal(chunk?.visibility, "LOCKED_SECRET");
    assert.equal(activeCount(plan, "인형 정부"), 0);
    assert.match(s2Text(plan) ?? "", /인형/);
  });

  it("sec-C1 marked: LOCKED_SECRET ACTIVE=0 S2=yes", () => {
    const plan = compile(SEC_C1_MARKED);
    const chunk = chunkForHint(plan, "연쇄살인");
    assert.equal(chunk?.visibility, "LOCKED_SECRET");
    assert.equal(activeCount(plan, "연쇄살인 동생"), 0);
    assert.match(s2Text(plan) ?? "", /연쇄살인/);
  });
});

describe("PR-C public B recall non-regression", () => {
  it("PUBLIC world facts remain ACTIVE-eligible on direct cue", () => {
    const enoch = AUDIT_FIXTURES.find((f) => f.id === "enoch")!.creatorRawDescription;
    const plan = compile(enoch);
    const direct = ACTIVE_CUE_TESTS.find((t) => t.id === "eno-act-B1-direct")!;
    const active = selectActiveCanonChunks({ plan, userMessage: direct.userMessage });
    assert.ok(active.activeChunks.length > 0);
    assert.ok(active.activeChunks.some((c) => c.visibility === "PUBLIC"));
  });

  it("quiet cue does not retrieve PUBLIC B facts beyond existing gate behavior", () => {
    const enoch = AUDIT_FIXTURES.find((f) => f.id === "enoch")!.creatorRawDescription;
    const plan = compile(enoch);
    const quiet = ACTIVE_CUE_TESTS.find((t) => t.id === "eno-act-B1-quiet")!;
    const active = selectActiveCanonChunks({ plan, userMessage: quiet.userMessage });
    assert.equal(active.activeChunks.length, 0);
  });
});

describe("PR-C restricted C audit matrix", () => {
  const cFacts = ATOMIC_FACTS.filter((f) => f.class === "C");

  for (const fact of cFacts) {
    it(`${fact.id}: structural classification`, () => {
      const fixture = AUDIT_FIXTURES.find((f) => f.id === fact.fixtureId)!;
      const plan = compilePlan(fixture.creatorRawDescription);
      const { chunks } = matchFactChunks(fact, plan);
      const legacyClass = classifyLegacyAmbiguous(fact.id, fixture.creatorRawDescription);

      if (legacyClass === "LEGACY_UNMARKED_UNRESOLVED") {
        assert.notEqual(chunks[0]?.visibility, "LOCKED_SECRET");
        return;
      }

      if (fact.id === "sec-C2" || fact.id === "leon-C1" || fact.id === "sg-C1") {
        assert.equal(chunks.some((c) => c.bucket === "scenario_meta"), true);
        assert.equal(activeCount(plan, fact.matchHints[0] ?? "trigger"), 0);
        assert.equal(s2Text(plan), null);
        return;
      }

      if (fact.id === "sec-C3" || fact.id === "leon-C2" || fact.id === "mini-C1") {
        assert.equal(chunks.some((c) => c.bucket === "player"), true);
        assert.equal(s2Text(plan), null);
        return;
      }

      // Legacy ambiguous narrative secrets — not auto S2
      assert.notEqual(chunks[0]?.visibility, "LOCKED_SECRET");
    });
  }
});

describe("PR-C S2 body budget (header outside 1200)", () => {
  it("A: no locked secrets → body=0, block=null", () => {
    const plan = compile(`[성격]\n차분하다.`);
    const s2 = renderPrivateCharacterSecretBlock(plan);
    assert.equal(s2.block, null);
    assert.equal(s2.s2BodyChars, 0);
    assert.equal(s2.s2BlockChars, 0);
    assert.equal(s2.s2IncludedCount, 0);
  });

  it("B: ~900-char secret body fits even when header makes total block >1200", () => {
    const secretBody = "비밀본문".padEnd(900, "가");
    const plan = compile(`[이름]\n테스트\n\n[비밀 — 캐릭터는 앎]\n${secretBody}`);
    const locked = plan.chunks.find((c) => c.visibility === "LOCKED_SECRET");
    assert.ok(locked);
    const s2 = renderPrivateCharacterSecretBlock(plan);
    assert.ok(s2.block);
    assert.equal(s2.s2IncludedCount, 1);
    assert.equal(s2.s2OmittedCount, 0);
    assert.ok(s2.s2BodyChars <= PRIVATE_CHARACTER_SECRET_MAX_CHARS);
    assert.ok(s2.s2BodyChars >= 900);
    assert.ok(
      s2.s2BlockChars > PRIVATE_CHARACTER_SECRET_MAX_CHARS,
      "header must push total block above body budget"
    );
    assert.ok(s2.s2BlockChars > s2.s2BodyChars);
  });

  it("C: multiple secrets with combined body <=1200 all included", () => {
    const plan = compile(
      `[이름]\n테스트\n\n[비밀 — 캐릭터는 앎]\n짧은비밀하나\n\n[비밀 — 캐릭터는 앎]\n짧은비밀둘`
    );
    const s2 = renderPrivateCharacterSecretBlock(plan);
    assert.equal(s2.s2IncludedCount, 2);
    assert.equal(s2.s2OmittedCount, 0);
    assert.ok(s2.s2BodyChars <= PRIVATE_CHARACTER_SECRET_MAX_CHARS);
    assert.match(s2.block ?? "", /짧은비밀하나/);
    assert.match(s2.block ?? "", /짧은비밀둘/);
  });

  it("D/E: next full secret exceeding body 1200 is omitted with accurate omittedCount", () => {
    const lines = Array.from({ length: 20 }, (_, i) =>
      `[비밀 — 캐릭터는 앎]\n비밀항목${i} `.padEnd(120, "x")
    ).join("\n\n");
    const plan = compile(lines);
    const eligible = plan.chunks.filter((c) => c.visibility === "LOCKED_SECRET").length;
    const s2 = renderPrivateCharacterSecretBlock(plan);
    assert.ok(s2.s2BodyChars <= PRIVATE_CHARACTER_SECRET_MAX_CHARS);
    assert.ok(s2.s2IncludedCount > 0);
    assert.ok(s2.s2OmittedCount > 0);
    assert.equal(s2.s2IncludedCount + s2.s2OmittedCount, eligible);
  });

  it("player-only facts remain structurally excluded from ACTIVE and S2", () => {
    const plan = compile(`[비밀 — 캐릭터도 모름]\n유저만 알고 있는 회귀 설정이다.`);
    assert.equal(activeCount(plan, "회귀"), 0);
    assert.equal(s2Text(plan), null);
  });

  it("normal PUBLIC character facts keep CORE/ACTIVE path", () => {
    const plan = compile(`[성격]\n차분하고 규칙을 지킨다.\n\n[세계관]\n북쪽 관문 안개.`);
    const world = plan.chunks.find((c) => c.bucket === "world");
    assert.equal(world?.visibility, "PUBLIC");
    assert.ok(renderCanonChunksBlock(plan.chunks.filter((c) => c.bucket === "world")).includes("북쪽"));
  });
});

describe("PR-C visibility fail-closed parse", () => {
  function mutateStoredPlan(mutator: (plan: CanonPlanV1) => unknown): string {
    const plan = compile(`[성격]\n차분하다.\n\n[세계관]\n북쪽 안개.`);
    const cloned = JSON.parse(serializeCanonPlanV1(plan)) as CanonPlanV1;
    return JSON.stringify(mutator(cloned));
  }

  it("A: missing chunk.visibility → parse rejects (not PUBLIC)", () => {
    const json = mutateStoredPlan((plan) => {
      const { visibility: _v, ...rest } = plan.chunks[0]!;
      plan.chunks[0] = rest as CanonPlanV1["chunks"][number];
      return plan;
    });
    assert.equal(parseCanonPlanV1(json), null);
    assert.equal(isPublicVisibleChunk(undefined), false);
  });

  it('B: visibility="UNKNOWN" → parse rejects (not PUBLIC)', () => {
    const json = mutateStoredPlan((plan) => {
      (plan.chunks[0] as { visibility: string }).visibility = "UNKNOWN";
      return plan;
    });
    assert.equal(parseCanonPlanV1(json), null);
  });

  it("C: valid PUBLIC → parse + CORE/ACTIVE preserved", () => {
    const plan = compile(`[성격]\n차분하다.\n\n[세계관 — 북쪽]\n북쪽 관문 안개.`);
    const roundTrip = parseCanonPlanV1(serializeCanonPlanV1(plan));
    assert.ok(roundTrip);
    assert.ok(roundTrip!.chunks.every((c) => c.visibility === "PUBLIC" || c.visibility === "CONDITIONAL"));
    assert.ok(corePublicText(roundTrip!).length > 0);
    const active = selectActiveCanonChunks({ plan: roundTrip!, userMessage: "북쪽 관문 안개" });
    assert.ok(active.activeChunks.every((c) => c.visibility === "PUBLIC"));
  });

  it("D: valid LOCKED_SECRET → CORE=0 ACTIVE=0 S2 eligible", () => {
    const plan = compile(POL_C1_MARKED);
    const roundTrip = parseCanonPlanV1(serializeCanonPlanV1(plan));
    assert.ok(roundTrip);
    assert.equal(corePublicText(roundTrip!).includes("정보원"), false);
    assert.equal(activeCount(roundTrip!, "검은 깃발 정보원"), 0);
    assert.match(s2Text(roundTrip!) ?? "", /정보원/);
  });

  it("E: valid CONDITIONAL → CORE=0 ACTIVE=0 S2=0", () => {
    const plan = compile(`[비밀]\n숨겨진 과거가 있다.`);
    const roundTrip = parseCanonPlanV1(serializeCanonPlanV1(plan));
    assert.ok(roundTrip);
    const cond = roundTrip!.chunks.find((c) => c.visibility === "CONDITIONAL");
    assert.ok(cond);
    assert.equal(isPublicVisibleChunk(cond!.visibility), false);
    assert.equal(activeCount(roundTrip!, "숨겨진 과거"), 0);
    assert.equal(s2Text(roundTrip!), null);
  });
});

describe("PR-C visibility resolution helpers", () => {
  it("resolveChunkVisibility defaults", () => {
    assert.equal(resolveChunkVisibility({ sectionTitle: "[성격]", bucket: "character" }), "PUBLIC");
    assert.equal(resolveChunkVisibility({ sectionTitle: "hidden_event_note", bucket: "scenario_meta" }), "CONDITIONAL");
    assert.equal(
      resolveChunkVisibility({ sectionTitle: "[비밀 — 캐릭터는 앎]", bucket: "character" }),
      "LOCKED_SECRET"
    );
  });

  it("isPublicVisibleChunk is fail-closed for undefined", () => {
    assert.equal(isPublicVisibleChunk("PUBLIC"), true);
    assert.equal(isPublicVisibleChunk("LOCKED_SECRET"), false);
    assert.equal(isPublicVisibleChunk("CONDITIONAL"), false);
    assert.equal(isPublicVisibleChunk(undefined), false);
  });
});

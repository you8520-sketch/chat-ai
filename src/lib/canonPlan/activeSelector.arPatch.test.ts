import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  selectActiveCanonChunks,
  isActiveSelectionEmpty,
} from "@/lib/canonPlan/activeSelector";
import { compileCanonPlanV1 } from "@/lib/canonPlan/compiler";
import {
  resolveCanonInjectionPolicy,
  isLayeredCanonActive,
} from "@/lib/canonInjectionPolicy";
import { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";

// AR0 audited harness — the production selector MUST match this exactly.
import { selArA3Patch } from "../../../data/ar0/candidates";
import { FIXTURES_AR0 } from "../../../data/ar0/fixtures";

function compile(raw: string) {
  const r = compileCanonPlanV1({
    creatorRawDescription: raw,
    now: "2026-01-01T00:00:00.000Z",
  });
  if (!r.ok) throw new Error("compile failed: " + r.error);
  return r.plan;
}

function recentCtx(fx: (typeof FIXTURES_AR0)[number]) {
  const recentContext = fx.history
    .slice(-4)
    .map((m) => m.content.trim())
    .filter(Boolean)
    .join("\n");
  const recentTurns = fx.history
    .slice(-4)
    .map((m) => ({ role: m.role, content: m.content.trim() }))
    .filter((m) => m.content.length > 0);
  return { recentContext, recentTurns };
}

function requiredHitIds(plan: ReturnType<typeof compile>, frags: string[]) {
  return new Set(
    plan.chunks.filter((c) => frags.some((f) => c.text.includes(f))).map((c) => c.id)
  );
}

// Inline canon exercising every bucket + salience path.
const MINI_CANON = [
  "[이름]",
  "테스트 캐릭터 · 30세",
  "",
  "[외형]",
  "검은 머리. 키가 크다.",
  "",
  "[세계관]",
  "기생종은 브레인 포드 안에서 번식한다.",
  "백야단은 유골상회를 감시하고 기록한다.",
  "",
  "[비밀]",
  "유저만 알고 있는 회귀 설정이다. 캐릭터는 모른다. 민감한 열쇠.",
  "",
  "[시스템 명령]",
  "상태 표시 창은 매 턴 갱신된다. 루프 트리거 조건.",
].join("\n");

describe("AR-A3 patch — A. Enoch-active baseline replay (production == audited)", () => {
  it("matches AR0 selArA3Patch exactly and reproduces predicted recall/precision", () => {
    const fx = FIXTURES_AR0[0];
    const plan = compile(fx.creatorRawDescription);
    const { recentContext, recentTurns } = recentCtx(fx);

    const prod = selectActiveCanonChunks({
      plan,
      userMessage: fx.currentUserMessage,
      recentContext,
      recentTurns,
    });
    const harness = selArA3Patch(plan, fx);

    const prodIds = prod.activeChunks.map((c) => c.id).sort();
    const harnessIds = harness.map((c) => c.id).sort();
    assert.deepEqual(prodIds, harnessIds, "production must match audited algorithm");

    const req = requiredHitIds(plan, fx.requiredLore);
    const selectedSet = new Set(prodIds);
    const requiredSelected = [...req].filter((id) => selectedSet.has(id)).length;
    const recall = req.size ? requiredSelected / req.size : 1;
    const precision = prodIds.length ? requiredSelected / prodIds.length : 1;

    // AR0-predicted: selected=24, requiredSelected=10, recall~=0.71, precision~=0.42.
    assert.equal(prodIds.length, 24);
    assert.equal(requiredSelected, 10);
    assert.ok(Math.abs(recall - 0.714) < 0.001, "recall=" + recall);
    assert.ok(Math.abs(precision - 0.4167) < 0.001, "precision=" + precision);
    assert.equal(prod.selectedChars, 863);
    assert.equal(prod.recentContextUsed, true);
    assert.equal(prod.recentContextGateReason, "CURRENT_CANON_MATCH");
    assert.ok(prod.selectedChars <= 1200, "budget ceiling respected");
  });

  it("marks the 1 CORE-covered required chunk as not ACTIVE's responsibility", () => {
    const fx = FIXTURES_AR0[0];
    const plan = compile(fx.creatorRawDescription);
    const coreSet = new Set(plan.coreIds);
    const req = requiredHitIds(plan, fx.requiredLore);
    const coreRequired = [...req].filter((id) => coreSet.has(id));
    // Exactly one required chunk is CORE-covered: ee399939833ce695 ([외형] "목 뒤에
    // 실패한 브레인 포드 접촉 흔적..."). The other 13 required are ACTIVE-responsibility.
    // (AR0 report initially mis-counted 2 CORE-covered; db07a9e9f30c8ab3 is actually
    // dormant world "총성은 죽음을 부른다" — a genuine vocab-miss, NOT CORE.)
    assert.equal(coreRequired.length, 1, "coreRequired=" + coreRequired.length);
    assert.ok(coreRequired.includes("ee399939833ce695"));
  });
});

describe("AR-A3 patch — B. Indirect recent-context bridge", () => {
  it("current cue has no canon keyword + open question -> recent bridge selects lore", () => {
    const plan = compile(MINI_CANON);
    const recentContext =
      "포드 흔적이 최근까지 보고됐어. 코어 인근 기생종 밀도가 올라간다.";
    const recentTurns = [
      { role: "user", content: "포드 흔적이 보고됐어." },
      { role: "assistant", content: "기생종 밀도가 올라간다." },
    ];
    // Current cue: no exact canon keyword, ends with a question.
    const res = selectActiveCanonChunks({
      plan,
      userMessage: "저 앞 자국이 이상해. 우리 지금 뭘 주의해야 하지?",
      recentContext,
      recentTurns,
    });
    assert.equal(res.recentContextGateReason, "OPEN_QUESTION");
    assert.ok(res.activeChunks.length > 0, "bridge must select relevant lore");
    const text = res.activeChunks.map((c) => c.text).join("\n");
    assert.match(text, /기생종|브레인 포드/, "bridged lore present");
    assert.equal(res.recentContextUsed, true);
  });
});

describe("AR-A3 patch — C. Entity-driven continuity", () => {
  it("current cue names an entity -> relevant canon selected", () => {
    const plan = compile(MINI_CANON);
    const res = selectActiveCanonChunks({
      plan,
      userMessage: "그 백야단 사람이 성채 출신인 것 같아. 유골상회 출처도 의심스러워.",
      recentContext: "",
      recentTurns: [],
    });
    assert.ok(res.activeChunks.length > 0);
    const text = res.activeChunks.map((c) => c.text).join("\n");
    assert.match(text, /백야단|유골상회/);
    assert.equal(res.recentContextGateReason, "CURRENT_CANON_MATCH");
  });
});

describe("AR-A3 patch — D. Modern quiet (ACTIVE=0)", () => {
  it("clean quiet cue -> ACTIVE=0, no fallback", () => {
    const fx = FIXTURES_AR0[1]; // modern quiet
    const plan = compile(fx.creatorRawDescription);
    const { recentContext, recentTurns } = recentCtx(fx);
    const res = selectActiveCanonChunks({
      plan,
      userMessage: fx.currentUserMessage,
      recentContext,
      recentTurns,
    });
    assert.equal(res.activeChunks.length, 0);
    assert.equal(isActiveSelectionEmpty(res), true);
    assert.equal(res.recentContextGateReason, "NONE");
    assert.equal(res.recentContextUsed, false);
    assert.equal(res.selectedChars, 0);
  });
});

describe("AR-A3 patch — E. Enoch-clean quiet (ACTIVE=0)", () => {
  it("clean enoch quiet cue (no 안개/목/캔커피, no question, no action) -> ACTIVE=0", () => {
    const plan = compile(FIXTURES_AR0[0].creatorRawDescription); // Enoch canon
    const recentContext = "오늘 하루 수고했어. 이제 일찍 쉬자. 내일 일정도 없고.";
    const recentTurns = [
      { role: "user", content: "오늘 하루 수고했어." },
      { role: "assistant", content: "이제 일찍 쉬자. 내일 일정도 없고." },
    ];
    const res = selectActiveCanonChunks({
      plan,
      userMessage: "그냥 둘이서 아무것도 안 하고 있어도 될 것 같아.",
      recentContext,
      recentTurns,
    });
    assert.equal(res.activeChunks.length, 0);
    assert.equal(res.recentContextGateReason, "NONE");
    assert.equal(res.recentContextUsed, false);
  });
});

describe("AR-A3 patch — F. True unrelated quiet (ACTIVE=0)", () => {
  it("fully unrelated cue -> ACTIVE=0", () => {
    const plan = compile(FIXTURES_AR0[0].creatorRawDescription);
    const res = selectActiveCanonChunks({
      plan,
      userMessage: "밥 먹을래? 라면 끓여줄까. 날씨도 그렇고 그냥 집 안에 있자.",
      recentContext: "오늘은 정말 아무 일도 없었으면 좋겠다.\n동의한다. 잠이나 자.",
      recentTurns: [
        { role: "user", content: "오늘은 정말 아무 일도 없었으면 좋겠다." },
        { role: "assistant", content: "동의한다. 잠이나 자." },
      ],
    });
    // The cue ends with a soft question marker, so the gate may be OPEN_QUESTION,
    // but nothing in recent context bridges a dormant chunk above threshold -> ACTIVE=0
    // and recent context did NOT contribute to any selection.
    assert.equal(res.activeChunks.length, 0);
    assert.equal(isActiveSelectionEmpty(res), true);
    assert.equal(res.recentContextUsed, false);
  });
});

describe("AR-A3 patch — G. Old-history noise (must not be worse than baseline)", () => {
  it("old 기원종 keyword in early history + quiet current cue -> ACTIVE=0", () => {
    const plan = compile(FIXTURES_AR0[0].creatorRawDescription);
    // History: 기원종/공간 왜곡 were relevant in the PAST (turns 1-2), now quiet rest.
    // Last 4 turns include the old 기원종 mention but the current cue is quiet rest.
    const recentContext =
      "지난달에 기원종 만났던 구역 기억나? 그때 공간 왜곡 심했지.\n" +
      "기억한다. 그때는 철수했지. 이미 끝난 일이다.\n" +
      "그래, 그건 지난달이고. 이제 다른 얘기 하자.\n" +
      "좋아. 오늘은 Safe Zone 안이니까 쉬어.";
    const recentTurns = [
      { role: "user", content: "지난달에 기원종 만났던 구역 기억나?" },
      { role: "assistant", content: "기억한다. 이미 끝난 일이다." },
      { role: "user", content: "그래, 그건 지난달이고. 이제 다른 얘기 하자." },
      { role: "assistant", content: "좋아. 오늘은 Safe Zone 안이니까 쉬어." },
    ];
    // Current cue: quiet rest. After B2, "하고" is dropped so no canon match -> gate NONE.
    const res = selectActiveCanonChunks({
      plan,
      userMessage: "오늘은 정말 아무것도 안 하고 쉬고 싶어. 라면이나 끓여.",
      recentContext,
      recentTurns,
    });
    // Must NOT broadly reactivate dormant 기원종/Level lore. Baseline (current-only) is 0
    // after B2; the patch must not be worse.
    assert.equal(res.activeChunks.length, 0, "no dormant reactivation");
    assert.equal(res.recentContextGateReason, "NONE");
  });
});

describe("AR-A3 patch — H. Bucket boundary (B1)", () => {
  it("player bucket chunk with exact lexical match -> NOT selected", () => {
    const plan = compile(MINI_CANON);
    const playerChunks = plan.chunks.filter((c) => c.bucket === "player");
    assert.ok(playerChunks.length > 0, "fixture must have a player chunk");
    // Cue matches ONLY the player chunk ("회귀 설정" is in the player paragraph).
    // Without B1 this would select the player chunk; with B1 it must select nothing.
    const res = selectActiveCanonChunks({
      plan,
      userMessage: "회귀 설정 좀 알려줘.",
      recentContext: "",
      recentTurns: [],
    });
    assert.equal(res.activeChunks.length, 0, "player chunk must be excluded by B1");
    for (const c of res.activeChunks) {
      assert.notEqual(c.bucket, "player", "player chunk leaked: " + c.id);
    }
    assert.equal(
      res.eligibleAfterBoundaryCount,
      plan.chunks.filter(
        (c) =>
          !plan.coreIds.includes(c.id) &&
          c.salience !== "core" &&
          c.bucket !== "player" &&
          c.bucket !== "scenario_meta"
      ).length
    );
  });

  it("scenario_meta bucket chunk with exact lexical match -> NOT selected", () => {
    const plan = compile(MINI_CANON);
    const metaChunks = plan.chunks.filter((c) => c.bucket === "scenario_meta");
    assert.ok(metaChunks.length > 0, "fixture must have a scenario_meta chunk");
    // Cue matches ONLY the scenario_meta chunks (상태 표시 창 / 루프 트리거 조건).
    const res = selectActiveCanonChunks({
      plan,
      userMessage: "상태 표시 창 루프 트리거 조건 알려줘.",
      recentContext: "",
      recentTurns: [],
    });
    assert.equal(res.activeChunks.length, 0, "scenario_meta chunks must be excluded by B1");
    for (const c of res.activeChunks) {
      assert.notEqual(c.bucket, "scenario_meta", "scenario_meta chunk leaked: " + c.id);
    }
  });
});

describe("AR-A3 patch — I. Allowed bucket selected normally", () => {
  it("world/character chunk with matching keyword -> selected", () => {
    const plan = compile(MINI_CANON);
    const res = selectActiveCanonChunks({
      plan,
      userMessage: "기생종 밀도가 어떻게 돼?",
      recentContext: "",
      recentTurns: [],
    });
    assert.ok(res.activeChunks.length > 0);
    const text = res.activeChunks.map((c) => c.text).join("\n");
    assert.match(text, /기생종/);
    for (const c of res.activeChunks) {
      assert.ok(c.bucket === "world" || c.bucket === "character", "only allowed buckets");
    }
  });
});

describe("AR-A3 patch — J. Generic stopword guard (B2)", () => {
  it('"이름" alone MUST NOT select the title-only [이름] chunk', () => {
    const plan = compile(MINI_CANON);
    const nameOnlyChunks = plan.chunks.filter((c) => c.text.trim() === "[이름]");
    assert.ok(nameOnlyChunks.length > 0, "fixture must have a title-only [이름] chunk");
    // Without B2, "이름" would match the title-only "[이름]" chunk (body +2).
    // With B2, "이름" is dropped -> nothing selected.
    const res = selectActiveCanonChunks({
      plan,
      userMessage: "이름 좀 다시 알려줄래?",
      recentContext: "",
      recentTurns: [],
    });
    assert.equal(res.activeChunks.length, 0, "[이름] title-only chunk must not be selected via 이름");
    for (const c of res.activeChunks) {
      assert.notEqual(c.text.trim(), "[이름]", "[이름] chunk leaked");
    }
  });

  it('"하고" alone MUST NOT select chunks matched only via the generic token', () => {
    const plan = compile(MINI_CANON);
    const res = selectActiveCanonChunks({
      plan,
      userMessage: "아무것도 안 하고 있어.",
      recentContext: "",
      recentTurns: [],
    });
    // No chunk should be selected purely because "하고" matches a verb ending in canon text.
    assert.equal(res.activeChunks.length, 0, "하고 must not inflate selection");
  });
});

describe("AR-A3 patch — K. ACTIVE=0 implies no fallback", () => {
  it("empty selection returns [] with no dormant top-N / FULL canon", () => {
    const plan = compile(MINI_CANON);
    const res = selectActiveCanonChunks({
      plan,
      userMessage: "완전히 관련 없는 날씨 이야기다. 비가 온다.",
      recentContext: "",
      recentTurns: [],
    });
    assert.equal(res.activeChunks.length, 0);
    assert.equal(isActiveSelectionEmpty(res), true);
    assert.equal(res.selectedCount, 0);
    assert.equal(res.selectedIds.length, 0);
    // No fallback signals: candidateCount is the full plan, but selectedCount is 0.
    assert.ok(res.candidateCount > 0);
    assert.equal(res.selectedCount, 0);
  });
});

describe("AR-A3 patch — L. Muse/Gemini/HY3 provider payload unchanged", () => {
  it("non-DeepSeek unvalidated models stay FULL_LEGACY (AR-A3 not invoked)", () => {
    const muse = resolveCanonInjectionPolicy(
      "openrouter/muse/muse-spark-11"
    );
    const gemini = resolveCanonInjectionPolicy(
      "openrouter/google/gemini-2.5-pro"
    );
    const hy3 = resolveCanonInjectionPolicy("openrouter/tencent/hy3");
    for (const p of [muse, gemini, hy3]) {
      assert.equal(p.actualCanonMode, "FULL_LEGACY");
      assert.equal(p.actualArchiveMode, "FULL_ALWAYS");
      assert.equal(isLayeredCanonActive(p), false, "LAYERED must not activate");
    }
  });

  it("activeSelector is provider-agnostic (same selection regardless of model)", () => {
    const plan = compile(MINI_CANON);
    const a = selectActiveCanonChunks({
      plan,
      userMessage: "기생종 밀도 알려줘.",
      recentContext: "",
      recentTurns: [],
    });
    // The selector takes no modelId; selection is independent of provider.
    assert.ok(a.activeChunks.length > 0);
    assert.equal(a.activeChunks.length, a.selectedCount);
  });
});

describe("AR-A3 patch — M. Master kill switch (exact rollback)", () => {
  it("CANON_INJECTION_KILL_SWITCH=1 -> FULL_LEGACY canon + FULL_ALWAYS archive, no LAYERED", () => {
    const prevKill = process.env.CANON_INJECTION_KILL_SWITCH;
    const prevForce = process.env.CANON_INJECTION_FORCE_FULL_LEGACY;
    process.env.CANON_INJECTION_KILL_SWITCH = "1";
    try {
      const p = resolveCanonInjectionPolicy(OPENROUTER_DEEPSEEK_V4_PRO_MODEL);
      assert.equal(p.forceFullLegacy, true);
      assert.equal(p.actualCanonMode, "FULL_LEGACY");
      assert.equal(p.actualArchiveMode, "FULL_ALWAYS");
      assert.equal(isLayeredCanonActive(p), false, "kill switch disables LAYERED ACTIVE");
    } finally {
      if (prevKill === undefined) delete process.env.CANON_INJECTION_KILL_SWITCH;
      else process.env.CANON_INJECTION_KILL_SWITCH = prevKill;
      if (prevForce === undefined) delete process.env.CANON_INJECTION_FORCE_FULL_LEGACY;
      else process.env.CANON_INJECTION_FORCE_FULL_LEGACY = prevForce;
    }
  });
});




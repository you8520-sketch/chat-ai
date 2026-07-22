/**
 * Scene Momentum Activation Predicate (P2) — permanent self-contained tests.
 *
 * Calls the REAL production helpers from @/lib/sceneMomentum/predicate and
 * ./extractor (isThinSceneHistory, countAlternatingExchanges,
 * structurallyMatureByAlternatingExchange, momentumEligible,
 * resolveMomentumActivation). Fixtures are inline (no _tmp imports).
 *
 * P2 contract: momentumEligible = isThinSceneHistory(h)
 *   AND NOT structurallyMatureByAlternatingExchange(h)
 *   where structurallyMature = countAlternatingExchanges(h) > MOMENTUM_BOOTSTRAP_MAX_EXCHANGES(=3).
 */
import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { isThinSceneHistory } from "@/lib/sceneMomentum/extractor";
import {
  MOMENTUM_BOOTSTRAP_MAX_EXCHANGES,
  countAlternatingExchanges,
  structurallyMatureByAlternatingExchange,
  momentumEligible,
  resolveMomentumActivation,
} from "@/lib/sceneMomentum/predicate";

type Msg = { role: "user" | "assistant"; content: string };
const u = (content: string): Msg => ({ role: "user", content });
const a = (content: string): Msg => ({ role: "assistant", content });

// Inline fixture builders (self-contained; no _tmp imports).
function shortExchanges(n: number): Msg[] {
  const h: Msg[] = [];
  for (let i = 0; i < n; i++) {
    h.push(u("무엇을 할까 " + (i + 1)));
    h.push(a("이렇게 하자 " + (i + 1)));
  }
  return h;
}
// Assistant turn guaranteed to have >= minNoWs non-whitespace chars (exceeds the 2200 threshold).
function longAssistantTurn(minNoWs: number): string {
  const unit = "그는 피아노 앞에 앉아 건반을 눌렀다 방 안에 오래된 멜로디가 가늘게 흘렀다 ";
  let s = "";
  while ([...s.replace(/\s+/g, "")].length < minNoWs) s += unit;
  return s;
}
const LONG = longAssistantTurn(2500);

// A. cold start / one-user; B. THIN 4-turn (3 worlds)
const COLD: Msg[] = [];
const ONE_USER: Msg[] = [u("오늘 약초밭에 꽃 좀 피었어?")];
const THIN_MODERN: Msg[] = [u("오늘 약초밭에 꽃 좀 피었어?"), a("...피었어. 신경 쓸 거 없어."), u("물 마셔."), a("마셨어. 별거 아니야.")];
const THIN_FANTASY: Msg[] = [u("오두막 안은 따뜻해?"), a("...그래. 화로가 아직 꺼지지 않았어."), u("이슬풀 좀 더 줄게."), a("고맙긴. 약초밭이나 봐.")];
const THIN_ENOCH: Msg[] = [u("방독면 벗어도 돼?"), a("...한 시간만. 그 뒤엔 다시 써."), u("이명은?"), a("평소. 기분 탓이겠지.")];
// C. MATURE 12-turn (6 exchanges, short); D. many-short 20-turn (10 exchanges)
const MATURE_12 = shortExchanges(6);
const MANY_SHORT_20 = shortExchanges(10);
// E. terse 5 exchanges
const TERSE: Msg[] = [
  u("캔커피."), a("...받지. 고맞다는 말은 안 해."),
  u("잤어?"), a("잤어. 충분히. 신경 쓸 거 없어."),
  u("목 뒤는?"), a("덜 당겨. 별거 아니야. 물 마셔."),
  u("옆에 있을게."), a("...남아. 한 시간만 방독면 벗을 거니까."),
  u("이명은?"), a("평소. 기분 탓이겠지. 물, 마셔."),
];
// F. one long opening (2 exchanges, long assistant turns -> NOT_THIN)
const LONG_OPENING: Msg[] = [u("연주 들려줘."), a(LONG), u("또 한 곡."), a(LONG)];

describe("Scene Momentum P2 — altExchanges counting contract (G, H, I)", () => {
  it("G. alternatingExchanges boundary: <=3 bootstrap-possible; >3 structurally mature", () => {
    assert.equal(countAlternatingExchanges(shortExchanges(3)), 3);
    assert.ok(!structurallyMatureByAlternatingExchange(shortExchanges(3)));
    assert.equal(countAlternatingExchanges(shortExchanges(4)), 4);
    assert.ok(structurallyMatureByAlternatingExchange(shortExchanges(4)));
    assert.equal(MOMENTUM_BOOTSTRAP_MAX_EXCHANGES, 3);
  });

  it("H. malformed consecutive same-role messages -> no exchange overcount", () => {
    assert.equal(countAlternatingExchanges([u("a"), u("b"), a("c")]), 1);
    assert.equal(countAlternatingExchanges([u("a"), a("b"), a("c")]), 1);
    assert.equal(countAlternatingExchanges([a("a"), a("b")]), 0);
    assert.equal(countAlternatingExchanges([u("a"), u("b")]), 0);
  });

  it("I. system/meta/empty messages -> exchange count unaffected", () => {
    assert.equal(countAlternatingExchanges([{ role: "user", content: "   " }, a("c")]), 0);
    assert.equal(countAlternatingExchanges([u("a"), { role: "assistant", content: "" }]), 0);
    assert.equal(countAlternatingExchanges([u("a"), { role: "system", content: "s" }, { role: "tool", content: "t" }, a("c")]), 1);
    assert.equal(countAlternatingExchanges([u("a"), a("b"), { role: "system", content: "n" }, u("c"), a("d")]), 2);
    assert.equal(countAlternatingExchanges([]), 0);
    assert.equal(countAlternatingExchanges([u("hi")]), 0);
  });
});

describe("Scene Momentum P2 — activation cases (A, B, C, D, E, F, J)", () => {
  const cases: { id: string; h: Msg[]; expected: boolean; reason: string }[] = [
    { id: "A-cold-start", h: COLD, expected: true, reason: "THIN_LENGTH_AND_LOW_EXCHANGES" },
    { id: "A2-one-user", h: ONE_USER, expected: true, reason: "THIN_LENGTH_AND_LOW_EXCHANGES" },
    { id: "B-modern", h: THIN_MODERN, expected: true, reason: "THIN_LENGTH_AND_LOW_EXCHANGES" },
    { id: "B-fantasy", h: THIN_FANTASY, expected: true, reason: "THIN_LENGTH_AND_LOW_EXCHANGES" },
    { id: "B-enoch", h: THIN_ENOCH, expected: true, reason: "THIN_LENGTH_AND_LOW_EXCHANGES" },
    { id: "C-mature-12", h: MATURE_12, expected: false, reason: "MATURE_EXCHANGE_GUARD" },
    { id: "D-many-short-20", h: MANY_SHORT_20, expected: false, reason: "MATURE_EXCHANGE_GUARD" },
    { id: "E-terse", h: TERSE, expected: false, reason: "MATURE_EXCHANGE_GUARD" },
    { id: "F-long-opening", h: LONG_OPENING, expected: false, reason: "NOT_THIN" },
  ];
  for (const c of cases) {
    it(c.id + ": momentumEligible=" + (c.expected ? "ON" : "OFF") + " (reason=" + c.reason + ")", () => {
      const act = resolveMomentumActivation(c.h);
      assert.equal(act.momentumEligible, c.expected, c.id + " altEx=" + act.alternatingExchanges + " thin=" + act.existingThinHistory + " mature=" + act.structuralMature);
      assert.equal(act.activationReason, c.reason, c.id + " reason");
      assert.equal(act.momentumEligible, momentumEligible(c.h), c.id + " matches formula");
      assert.equal(act.structuralMature, structurallyMatureByAlternatingExchange(c.h), c.id + " guard");
    });
  }

  it("A. zero/near-zero history -> ON (cold-start bootstrap)", () => {
    assert.equal(momentumEligible([]), true);
    assert.equal(momentumEligible(ONE_USER), true);
    assert.equal(resolveMomentumActivation([]).activationReason, "THIN_LENGTH_AND_LOW_EXCHANGES");
  });

  it("B. THIN 4-turn fixtures -> ON; altExchanges <= 3", () => {
    for (const h of [THIN_MODERN, THIN_FANTASY, THIN_ENOCH]) {
      assert.equal(momentumEligible(h), true);
      assert.ok(countAlternatingExchanges(h) <= MOMENTUM_BOOTSTRAP_MAX_EXCHANGES);
    }
  });

  it("C. MATURE 12-turn -> OFF; altExchanges > 3; still thin by length", () => {
    assert.equal(momentumEligible(MATURE_12), false);
    assert.ok(countAlternatingExchanges(MATURE_12) > MOMENTUM_BOOTSTRAP_MAX_EXCHANGES);
    assert.equal(isThinSceneHistory(MATURE_12), true);
  });

  it("D. many-short mature -> OFF (P0 thin TRUE, structural guard OFF)", () => {
    assert.equal(isThinSceneHistory(MANY_SHORT_20), true);
    assert.equal(momentumEligible(MANY_SHORT_20), false);
    assert.ok(countAlternatingExchanges(MANY_SHORT_20) > MOMENTUM_BOOTSTRAP_MAX_EXCHANGES);
  });

  it("E. terse mature -> OFF (terse/thin but 5 real exchanges)", () => {
    assert.equal(isThinSceneHistory(TERSE), true);
    assert.equal(momentumEligible(TERSE), false);
    assert.equal(resolveMomentumActivation(TERSE).activationReason, "MATURE_EXCHANGE_GUARD");
  });

  it("F. one-long-opening -> OFF (NOT_THIN; guard NOT fooled by volume)", () => {
    assert.equal(isThinSceneHistory(LONG_OPENING), false);
    assert.equal(momentumEligible(LONG_OPENING), false);
    assert.equal(resolveMomentumActivation(LONG_OPENING).activationReason, "NOT_THIN");
    assert.ok(!structurallyMatureByAlternatingExchange(LONG_OPENING));
  });

  it("J. existingThinHistory=false -> OFF regardless of exchange count", () => {
    const fewLong: Msg[] = [u("연주 들려줘."), a(LONG), u("또 한 곡."), a(LONG)]; // 2 exchanges, not thin
    const manyLong: Msg[] = [];
    for (let i = 0; i < 5; i++) { manyLong.push(u("cue " + i)); manyLong.push(a(LONG)); } // 5 exchanges, not thin
    assert.equal(isThinSceneHistory(fewLong), false);
    assert.equal(isThinSceneHistory(manyLong), false);
    assert.equal(momentumEligible(fewLong), false);
    assert.equal(momentumEligible(manyLong), false);
    assert.equal(resolveMomentumActivation(fewLong).activationReason, "NOT_THIN");
    assert.equal(resolveMomentumActivation(manyLong).activationReason, "NOT_THIN");
  });
});
// ───── Wiring invariants via buildContext + observability (model policy / kill switch / canary) ─────
describe("Scene Momentum P2 — wiring invariants (model policy, kill switch, canary)", () => {
  let buildContext: any;
  let DEEPSEEK: string;
  let MUSE: string;
  let HY3: string;
  let GEMINI: string;
  let QWEN: string;
  let compilePlan: () => any;
  const CREATOR_RAW = "[이름]\n이준서\n[성격]\n차분하고 과묵하다.\n[세계관]\n현대 서울. 음악학원과 자취방.";
  const chunk: any = {
    id: "c1", characterId: "1",
    content: "[이름]\n이준서\n[세계관]\n현대 서울. 자취방.",
    category: "identity", importance: "CRITICAL", tokenCount: 20, keywords: ["이준서"],
  };
  const D2_CANARY_ON_POLICY: any = {
    modelId: "deepseek", injectionEnabled: true, shadowOnly: false,
    canonMode: "LAYERED", archiveMode: "SELECTIVE", rolloutStage: "D2",
    forceFullLegacy: false, canaryActualInjection: true,
    actualCanonMode: "LAYERED", actualArchiveMode: "SELECTIVE",
  };
  const CONTROL_POLICY: any = {
    modelId: "deepseek", injectionEnabled: true, shadowOnly: true,
    canonMode: "FULL_LEGACY", archiveMode: "FULL_ALWAYS", rolloutStage: "D0",
    forceFullLegacy: false, canaryActualInjection: false,
    actualCanonMode: "FULL_LEGACY", actualArchiveMode: "FULL_ALWAYS",
  };
  function momentumInputFor(history: Msg[], cue = "오늘 하루 좀 수고했어. 이제 쉬자.") {
    return {
      recentHistory: history.slice(-4),
      currentUserMessage: cue,
      currentLocation: "준서의 자취방",
      promises: [] as string[],
      openingGreeting: null as string | null,
    };
  }
  before(async () => {
    ({ buildContext } = await import("@/services/contextBuilder"));
    const cm = await import("@/lib/chatModels");
    DEEPSEEK = cm.OPENROUTER_DEEPSEEK_V4_PRO_MODEL;
    MUSE = cm.OPENROUTER_MUSE_SPARK_11_MODEL;
    HY3 = cm.OPENROUTER_TENCENT_HY3_MODEL;
    GEMINI = cm.OPENROUTER_GEMINI_25_PRO_MODEL;
    QWEN = cm.OPENROUTER_QWEN_37_MAX_MODEL;
    const cfs = await import("@/lib/canonPlan/compileForSave");
    compilePlan = () => {
      const res = cfs.buildCanonPlanForSave({ creatorRawDescription: CREATOR_RAW });
      if (!res.plan) throw new Error("plan compile failed: " + res.error);
      return res.plan;
    };
  });

  it("Muse/Gemini/HY3/Qwen (non-DeepSeek) -> payload unchanged + MODEL_POLICY_OFF", () => {
    const plan = compilePlan();
    const nonDeepSeek = [
      { id: "Muse", modelId: MUSE, provider: "openrouter" },
      { id: "HY3", modelId: HY3, provider: "openrouter" },
      { id: "Qwen", modelId: QWEN, provider: "openrouter" },
      { id: "Gemini", modelId: GEMINI, provider: "gemini" },
    ];
    for (const m of nonDeepSeek) {
      const built = buildContext({
        charName: "이준서", chunks: [chunk], userNickname: "user",
        shortTermHistory: [...THIN_MODERN],
        currentUserMessage: "오늘 하루 좀 수고했어. 이제 쉬자.",
        nsfw: false, modelId: m.modelId, provider: m.provider,
        canonInjectionPolicy: D2_CANARY_ON_POLICY, canonPlan: plan,
        sceneMomentumInput: momentumInputFor(THIN_MODERN),
      });
      const sys = built.systemPrompt ?? "";
      let payload = sys;
      if (m.provider === "gemini") {
        const c = built.contents;
        if (Array.isArray(c)) for (const turn of c) for (const p of (turn.parts ?? [])) payload += p.text ?? "";
      } else {
        payload += built.history.map((h: any) => h.content).join("\n");
      }
      assert.doesNotMatch(payload, /CURRENT SCENE CONTINUITY/, m.id + ": momentum must not leak");
      assert.ok(built.meta.momentumActivation, m.id + ": observability present");
      assert.equal(built.meta.momentumActivation.momentumActive, false, m.id + ": not active");
      assert.equal(built.meta.momentumActivation.activationReason, "MODEL_POLICY_OFF", m.id + ": MODEL_POLICY_OFF");
      assert.equal(built.meta.momentumActivation.existingThinHistory, true, m.id + ": thin still computed");
    }
  });

  it("kill switch / canary off -> Momentum OFF + MODEL_POLICY_OFF (rollback exact)", () => {
    const plan = compilePlan();
    const built = buildContext({
      charName: "이준서", chunks: [chunk], userNickname: "user",
      shortTermHistory: [...THIN_MODERN],
      currentUserMessage: "오늘 하루 좀 수고했어. 이제 쉬자.",
      nsfw: false, modelId: DEEPSEEK, provider: "openrouter",
      canonInjectionPolicy: CONTROL_POLICY, canonPlan: plan,
      sceneMomentumInput: momentumInputFor(THIN_MODERN),
    });
    const lastUser = built.history.at(-1);
    assert.doesNotMatch(lastUser.content, /CURRENT SCENE CONTINUITY/);
    assert.match(lastUser.content, /SHORT HISTORY/);
    assert.equal(built.meta.momentumActivation.momentumActive, false);
    assert.equal(built.meta.momentumActivation.activationReason, "MODEL_POLICY_OFF");
  });

  it("D2 canary ON + THIN -> Momentum ON (positive gate + observability)", () => {
    const plan = compilePlan();
    const built = buildContext({
      charName: "이준서", chunks: [chunk], userNickname: "user",
      shortTermHistory: [...THIN_MODERN],
      currentUserMessage: "오늘 하루 좀 수고했어. 이제 쉬자.",
      nsfw: false, modelId: DEEPSEEK, provider: "openrouter",
      canonInjectionPolicy: D2_CANARY_ON_POLICY, canonPlan: plan,
      sceneMomentumInput: momentumInputFor(THIN_MODERN),
    });
    const lastUser = built.history.at(-1);
    assert.match(lastUser.content, /CURRENT SCENE CONTINUITY/);
    assert.equal(built.meta.momentumActivation.momentumActive, true);
    assert.equal(built.meta.momentumActivation.activationReason, "THIN_LENGTH_AND_LOW_EXCHANGES");
    assert.equal(built.meta.momentumActivation.alternatingExchanges, 2);
    assert.equal(built.meta.momentumActivation.structuralMature, false);
  });

  it("D2 canary ON + many-short mature -> Momentum auto-off (MATURE_EXCHANGE_GUARD)", () => {
    const plan = compilePlan();
    const built = buildContext({
      charName: "이준서", chunks: [chunk], userNickname: "user",
      shortTermHistory: [...MANY_SHORT_20],
      currentUserMessage: "오늘 하루 좀 수고했어. 이제 쉬자.",
      nsfw: false, modelId: DEEPSEEK, provider: "openrouter",
      canonInjectionPolicy: D2_CANARY_ON_POLICY, canonPlan: plan,
      sceneMomentumInput: momentumInputFor(MANY_SHORT_20),
    });
    const lastUser = built.history.at(-1);
    assert.doesNotMatch(lastUser.content, /CURRENT SCENE CONTINUITY/);
    assert.equal(built.meta.momentumActivation.momentumActive, false);
    assert.equal(built.meta.momentumActivation.activationReason, "MATURE_EXCHANGE_GUARD");
    assert.equal(built.meta.momentumActivation.existingThinHistory, true);
    assert.equal(built.meta.momentumActivation.structuralMature, true);
    assert.ok(built.meta.momentumActivation.alternatingExchanges > MOMENTUM_BOOTSTRAP_MAX_EXCHANGES);
  });
});

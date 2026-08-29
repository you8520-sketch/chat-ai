import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL } from "@/lib/chatModels";
import { callTrpgGm } from "./gmCall";
import { buildTrpgGmUserBlock, TRPG_GM_SYSTEM } from "./gmPrompt";
import { probeGmResolutionQuality } from "./gmResolutionProbe";
import { mockReadableStreamFromText, buildMockOpenRouterStreamChunks } from "@/lib/mockApiMode";
import { TRPG_GM_MODEL } from "./types";

const previousFetch = globalThis.fetch;
const previousKey = process.env.CHEAPER_INFERENCE_API_KEY;
const previousMock = process.env.MOCK_MODE;

afterEach(() => {
  globalThis.fetch = previousFetch;
  if (previousKey === undefined) delete process.env.CHEAPER_INFERENCE_API_KEY;
  else process.env.CHEAPER_INFERENCE_API_KEY = previousKey;
  if (previousMock === undefined) delete process.env.MOCK_MODE;
  else process.env.MOCK_MODE = previousMock;
});

function gmSceneCraftBlock(): string {
  const start = TRPG_GM_SYSTEM.indexOf("[GM SCENE CRAFT — ADAPTIVE NARRATION]");
  const end = TRPG_GM_SYSTEM.indexOf("[LENGTH — SCENE RESPONSIVE]");
  return start >= 0 && end > start ? TRPG_GM_SYSTEM.slice(start, end) : "";
}

function countOwnerMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

describe("TRPG GM resolution quality — prompt owners", () => {
  it("keeps single replay and failure realization owners", () => {
    const craft = gmSceneCraftBlock();
    assert.equal(countOwnerMatches(craft, /Do not replay, re-quote, closely paraphrase, or re-stage/g), 1);
    assert.equal(countOwnerMatches(craft, /Failure: intended result does not fully land/g), 1);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /Across concurrent and nearby failures, vary source and consequence/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /Failure keeps technique credible/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /RICH prose is visible/);
    assert.match(TRPG_GM_SYSTEM, /Do not narrate raw stat values, modifiers, d20, DC, or tier/);
    assert.match(craft, /Earlier SUCCESS in \[RESOLUTION ORDER\] stays canon/);
    assert.match(craft, /fold them into one coherent setback/);
  });
});

describe("TRPG GM resolution quality — probe scorer", () => {
  it("detects dialogue replay and raw stat prose", () => {
    const bad = probeGmResolutionQuality({
      narration: `렌: "포자층 쪽으로 간다."\n힘 10의 완력으로 문을 밀었다.`,
      actions: [{ participantId: 1, name: "렌", body: '「포자층 쪽으로 간다.」' }],
    });
    assert.equal(bad.pcDialogueVerbatimReplayCount, 1);
    assert.equal(bad.pcSpeakerLineInventionCount, 1);
    assert.ok(bad.rawStatValueNarrationCount >= 1);

    const good = probeGmResolutionQuality({
      narration: "문틈에서 새어 나온 냄새가 코를 찔렀다. 경비의 발소리가 한 층 위에서 멎었다.",
      actions: [{ participantId: 1, name: "렌", body: '「포자층 쪽으로 간다.」' }],
    });
    assert.equal(good.pcDialogueVerbatimReplayCount, 0);
    assert.equal(good.pcSpeakerLineInventionCount, 0);
    assert.equal(good.rawStatValueNarrationCount, 0);
  });
});

const FIXTURES = [
  {
    name: "three_pc_dialogue_mixed",
    actions: [
      { participantId: 1, name: "렌", body: '*검을 들어 올린다.* 「앞장 서.」', tier: "SUCCESS" },
      { participantId: 2, name: "강이현", body: '*포자층을 가리킨다.* 「저쪽 흐름이 이상해.」', tier: "FAILURE" },
      { participantId: 3, name: "권태현", body: '*방패를 세운다.* 「뒤는 내가 막을게.」', tier: "PARTIAL_SUCCESS" },
    ],
  },
  {
    name: "success_failure_mix",
    actions: [
      { participantId: 1, name: "알파", body: "잠긴 문을 연다.", tier: "SUCCESS" },
      { participantId: 2, name: "베타", body: "복도를 조사한다.", tier: "FAILURE" },
    ],
  },
  {
    name: "clustered_failures",
    actions: [
      { participantId: 1, name: "알파", body: "포자 낭을 깨뜨린다.", tier: "FAILURE" },
      { participantId: 2, name: "베타", body: "동료를 끌어당긴다.", tier: "FAILURE" },
      { participantId: 3, name: "감마", body: "후퇴로를 확보한다.", tier: "FAILURE" },
    ],
    earlierSuccessNames: [],
  },
  {
    name: "relationship_non_combat",
    actions: [
      { participantId: 1, name: "솔", body: '「오늘은 무리하지 말자.」', tier: null, needsCheck: false },
      { participantId: 2, name: "로코", body: "벽에 기대 선다.", tier: null, needsCheck: false },
    ],
  },
] as const;

describe("TRPG GM resolution quality — frozen fixtures (mock path)", () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.name} mock GM obeys probe contract`, async () => {
      delete process.env.MOCK_MODE;
      process.env.CHEAPER_INFERENCE_API_KEY = "test-gm-resolution-probe";
      const user = buildTrpgGmUserBlock({
        worldBrief: "지하 시설",
        memoryBlock: "[TRPG STRUCTURED STATE]",
        opening: false,
        actions: fixture.actions.map((a) => ({
          participantId: a.participantId,
          name: a.name,
          body: a.body,
          statKey: "str",
          d20: a.tier ? 10 : null,
          finalScore: a.tier ? 10 : null,
          dc: 9,
          tier: a.tier,
          needsCheck: "needsCheck" in a ? a.needsCheck : a.tier != null,
        })),
      });
      assert.match(TRPG_GM_SYSTEM, /already visible/);

      const mockNarration = `<<<NARRATION>>>
공기가 무거워지자 경보등이 한 번 깜빡였다. 복도 끝에서 금속 문이 살짝 흔들렸고, 누군가의 숨소리가 멎었다.
GM: 다음 행동을 정하기 전에, 위층에서 무언가 빠른 발소리가 다가오고 있다.
<<<DELTA>>>
{"players":[],"location":"복도","next_round_context":"위 혹은 아래","campaign_finished":false}`;

      globalThis.fetch = (async () => {
        const chunks = [
          ...buildMockOpenRouterStreamChunks(mockNarration, TRPG_GM_MODEL).slice(0, 1),
          `data: ${JSON.stringify({
            choices: [{ delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 20, completion_tokens: 12 },
          })}\n\n`,
          "data: [DONE]\n\n",
        ];
        return new Response(mockReadableStreamFromText(chunks), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }) as typeof fetch;

      const result = await callTrpgGm({ system: TRPG_GM_SYSTEM, user, timeoutMs: 5_000 });
      assert.equal(TRPG_GM_MODEL, CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL);

      const probe = probeGmResolutionQuality({
        narration: result.text,
        actions: fixture.actions,
        earlierSuccessNames: "earlierSuccessNames" in fixture ? fixture.earlierSuccessNames : ["알파"],
        rollOutcomes: fixture.actions.map((a) => ({ name: a.name, tier: a.tier ?? "SUCCESS" })),
      });
      assert.equal(probe.pcDialogueVerbatimReplayCount, 0);
      assert.equal(probe.pcSpeakerLineInventionCount, 0);
      assert.equal(probe.rawStatValueNarrationCount, 0);
      assert.equal(probe.rawD20DcNarrationCount, 0);
      assert.equal(probe.newConsequenceStart, true);
    });
  }
});

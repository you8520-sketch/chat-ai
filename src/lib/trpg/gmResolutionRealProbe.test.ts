import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";
import { CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL } from "@/lib/chatModels";
import { callTrpgGm } from "./gmCall";
import {
  buildTrpgGmUserBlock,
  formatTrpgSheetCanon,
  TRPG_GM_SYSTEM,
} from "./gmPrompt";
import {
  probeGmResolutionQuality,
  reviewGmForwardMotionQuality,
  summarizeGmForwardMotionReviews,
  summarizeGmResolutionProbe,
  type GmForwardMotionReview,
  type GmResolutionProbeResult,
} from "./gmResolutionProbe";
import { DEFAULT_TRPG_STAT_DEFS } from "./stats";
import { TRPG_GM_MODEL } from "./types";

type RealFixture = {
  id: string;
  name: string;
  worldBrief: string;
  resolutionOrderBlock?: string;
  sheetCanon?: string;
  earlierSuccessNames?: string[];
  allowQuietBeat?: boolean;
  actions: Array<{
    participantId: number;
    name: string;
    body: string;
    intent?: string;
    statKey: string;
    statValue?: number;
    d20: number | null;
    finalScore: number | null;
    dc: number | null;
    tier: string | null;
    needsCheck?: boolean;
  }>;
};

const REAL_FIXTURES: RealFixture[] = [
  {
    id: "F1",
    name: "combat_three_visible_actions",
    worldBrief: "포자가 번진 지하 통로. 세 명의 PC가 전진 중.",
    actions: [
      {
        participantId: 1,
        name: "렌",
        body: '*검을 들어 올리며 포자막을 가른다.* 「앞장 서.」',
        statKey: "str",
        d20: 14,
        finalScore: 16,
        dc: 11,
        tier: "SUCCESS",
      },
      {
        participantId: 2,
        name: "강이현",
        body: '*포자층의 흐름을 가리킨다.* 「저쪽 기류가 이상해.」',
        statKey: "int",
        d20: 8,
        finalScore: 10,
        dc: 9,
        tier: "FAILURE",
      },
      {
        participantId: 3,
        name: "권태현",
        body: '*방패를 세우며 후방을 막는다.* 「뒤는 내가 맡을게.」',
        statKey: "con",
        d20: 10,
        finalScore: 11,
        dc: 9,
        tier: "PARTIAL_SUCCESS",
      },
    ],
  },
  {
    id: "F2",
    name: "investigation_success",
    worldBrief: "연구동 복도. 잠긴 격벽 문.",
    sheetCanon: formatTrpgSheetCanon({
      defs: DEFAULT_TRPG_STAT_DEFS,
      sheets: [{ name: "렌", stats: { str: 10, dex: 8, int: 8, wis: 7, cha: 6, con: 6 } }],
    }),
    actions: [
      {
        participantId: 1,
        name: "렌",
        body: '*잠긴 문의 패널과 틈새를 조사한다.*',
        statKey: "int",
        statValue: 8,
        d20: 11,
        finalScore: 12,
        dc: 9,
        tier: "SUCCESS",
      },
    ],
  },
  {
    id: "F3",
    name: "mixed_success_support_failure",
    worldBrief: "균사가 통로를 메운 폐쇄 구역. 렌이 틈을 만들고 태현이 추가 절단을 시도한다.",
    resolutionOrderBlock: "[RESOLUTION ORDER]\n1. 렌\n2. 태현",
    earlierSuccessNames: ["렌"],
    actions: [
      {
        participantId: 1,
        name: "렌",
        body: '*마체테를 크게 휘두르며 균사 덩어리를 파쇄한다.* 「틈을 만들었어!」',
        statKey: "str",
        d20: 14,
        finalScore: 16,
        dc: 11,
        tier: "SUCCESS",
      },
      {
        participantId: 2,
        name: "태현",
        body: '*렌이 만든 틈 옆에서 연결부를 마체테로 추가 절단하려 한다.* 「내가 마무리할게!」',
        statKey: "str",
        d20: 6,
        finalScore: 8,
        dc: 9,
        tier: "FAILURE",
      },
    ],
  },
  {
    id: "F4",
    name: "relationship_non_combat",
    worldBrief: "안전한 야영지.",
    actions: [
      {
        participantId: 1,
        name: "솔",
        body: '「오늘은 무리하지 말자.」',
        statKey: "cha",
        d20: null,
        finalScore: null,
        dc: null,
        tier: null,
        needsCheck: false,
      },
      {
        participantId: 2,
        name: "로코",
        body: "벽에 기대 선다.",
        statKey: "wis",
        d20: null,
        finalScore: null,
        dc: null,
        tier: null,
        needsCheck: false,
      },
    ],
  },
  {
    id: "F5",
    name: "exhausted_immediate_purpose",
    worldBrief: "좁은 배수 통로 끝. 포자 구름이 뒤에서 밀려온다.",
    actions: [
      {
        participantId: 1,
        name: "렌",
        body: '*막힌 배수구 앞에서 석재 더미를 치운다.*',
        statKey: "str",
        d20: 12,
        finalScore: 14,
        dc: 11,
        tier: "SUCCESS",
      },
    ],
  },
  {
    id: "F6",
    name: "quiet_beat_control",
    worldBrief: "전투 직후, 잠시 숨을 고를 수 있는 작은 alcove.",
    allowQuietBeat: true,
    actions: [
      {
        participantId: 1,
        name: "솔",
        body: '「잠깐만 쉬자.」',
        statKey: "wis",
        d20: null,
        finalScore: null,
        dc: null,
        tier: null,
        needsCheck: false,
      },
    ],
  },
];

function hasRealProviderKey(): boolean {
  return Boolean(process.env.CHEAPER_INFERENCE_API_KEY?.trim());
}

describe("TRPG GM resolution quality — real Gemini 3.7 frozen probe", { timeout: 900_000 }, () => {
  it("REAL_PROVIDER: frozen fixtures via production callTrpgGm path", async (t) => {
    if (!hasRealProviderKey()) {
      t.skip("CHEAPER_INFERENCE_API_KEY not configured");
      return;
    }
    delete process.env.MOCK_MODE;
    assert.equal(TRPG_GM_MODEL, CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL);

    const probeResults: GmResolutionProbeResult[] = [];
    const forwardReviews: GmForwardMotionReview[] = [];
    const transcripts: Array<{
      id: string;
      name: string;
      narration: string;
      probe: GmResolutionProbeResult;
      forwardMotion: GmForwardMotionReview;
    }> = [];

    for (const fixture of REAL_FIXTURES) {
      const user = buildTrpgGmUserBlock({
        worldBrief: fixture.worldBrief,
        memoryBlock: "[TRPG STRUCTURED STATE]\nlocation=복도",
        opening: false,
        sheetCanon: fixture.sheetCanon,
        resolutionOrderBlock: fixture.resolutionOrderBlock,
        actions: fixture.actions.map((a) => ({
          participantId: a.participantId,
          name: a.name,
          body: a.body,
          intent: a.intent,
          statKey: a.statKey,
          statValue: a.statValue ?? null,
          d20: a.d20,
          finalScore: a.finalScore,
          dc: a.dc,
          tier: a.tier,
          needsCheck: a.needsCheck ?? a.tier != null,
        })),
      });

      const result = await callTrpgGm({
        system: TRPG_GM_SYSTEM,
        user,
        timeoutMs: 90_000,
      });

      const probeInput = {
        narration: result.text,
        actions: fixture.actions,
        earlierSuccessNames: fixture.earlierSuccessNames,
        rollOutcomes: fixture.actions.map((a) => ({ name: a.name, tier: a.tier ?? "SUCCESS" })),
        profile: { allowQuietBeat: fixture.allowQuietBeat },
      };
      const probe = probeGmResolutionQuality(probeInput);
      const forwardMotion = reviewGmForwardMotionQuality(probeInput);
      probeResults.push(probe);
      forwardReviews.push(forwardMotion);
      transcripts.push({
        id: fixture.id,
        name: fixture.name,
        narration: result.text,
        probe,
        forwardMotion,
      });
    }

    const summary = summarizeGmResolutionProbe(probeResults);
    const forwardSummary = summarizeGmForwardMotionReviews(forwardReviews);
    mkdirSync("/opt/cursor/artifacts", { recursive: true });
    writeFileSync(
      "/opt/cursor/artifacts/gm-resolution-real-probe.json",
      JSON.stringify({ summary, forwardSummary, transcripts }, null, 2),
      "utf8"
    );

    assert.equal(summary.REAL_PROVIDER_CALLS, REAL_FIXTURES.length);
    assert.equal(summary.PC_DIALOGUE_EXACT_REPLAY, 0, JSON.stringify(summary));
    assert.equal(summary.INVENTED_PC_DIALOGUE, 0, JSON.stringify(summary));
    assert.equal(summary.RAW_STAT_NUMBER_PROSE, 0, JSON.stringify(summary));
    assert.equal(summary.RAW_D20_DC_TIER_PROSE, 0, JSON.stringify(summary));
    assert.equal(summary.EARLIER_SUCCESS_ERASURE, 0, JSON.stringify(summary));

    const nonQuiet = forwardReviews.filter((_, i) => !REAL_FIXTURES[i]?.allowQuietBeat);
    assert.equal(
      nonQuiet.filter((r) => r.ACTION_REPLAY === "MAJOR").length,
      0,
      JSON.stringify(forwardSummary)
    );
    assert.equal(
      nonQuiet.filter((r) => r.RESOLUTION_BLOAT === "MAJOR").length,
      0,
      JSON.stringify(forwardSummary)
    );
    assert.equal(
      nonQuiet.filter((r) => r.PLAYER_AGENCY_VIOLATION).length,
      0,
      JSON.stringify(forwardSummary)
    );
    assert.equal(
      nonQuiet.filter((r) => r.NEW_MATERIAL === "LOW").length,
      0,
      JSON.stringify(forwardSummary)
    );
    assert.equal(
      nonQuiet.filter((r) => r.SCENE_STATE_ADVANCED === "NO").length,
      0,
      JSON.stringify(forwardSummary)
    );
  });
});

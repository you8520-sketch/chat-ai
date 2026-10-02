import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL } from "@/lib/chatModels";
import { buildContinueNarrativeCommand } from "@/lib/continueNarrative";
import type { CurrentTurnAuthoringDelegation } from "@/lib/currentTurnUserAuthoringDelegation";
import { COMMON_PROSE_BLOCK } from "@/lib/advancedProseNsfwGuidelines";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "@/lib/responseLength";
import {
  buildSceneDirective,
  renderSceneDirectiveForPrompt,
  type SceneDirective,
} from "@/lib/sceneDirective";
import { buildContext } from "@/services/contextBuilder";

const NORMAL: CurrentTurnAuthoringDelegation = {
  active: true,
  allowDialogue: true,
  allowMajorActions: true,
  allowInnerPov: false,
  allowIrreversibleFate: false,
  allowAiCastIrreversibleExpansion: false,
  source: "chat_setting",
  duration: "persistent",
};

const QUIET_HISTORY = [
  { role: "user" as const, content: "창문 쪽에 같이 서 있자." },
  {
    role: "assistant" as const,
    content: "라이크는 유리에 이마를 기대며 하품했다.\n\n졸려. 너는 그대로 있어.",
  },
];

const NPC_ADVANCE_ORDER = "적극적으로 진행한다";
const ENSEMBLE_UNLOCK = "중심 인물 하나에 고정되지 않는다";
const CONTINUE_NPC_ORDER = "Advance through [AI_CAST], NPCs";
const CONTINUE_MULTI_SPEAK = "Multiple AI-controlled characters may speak";

function quietAutoDirective(): SceneDirective {
  return buildSceneDirective({
    mode: "auto_progression",
    contentKind: "character",
    primaryCharacterName: "라이크",
    chatId: 18,
    currentTurn: 2,
    recentMessages: QUIET_HISTORY,
    currentUserMessage: "자동진행",
  });
}

describe("auto progression scene contract owner", () => {
  it("quiet 1:1 auto contract does not sit next to a general NPC advance order", () => {
    const directive = quietAutoDirective();
    assert.equal(directive.motionDecision, "MICRO_MOTION");
    assert.deepEqual(directive.progressionTypes, ["environment"]);
    assert.equal(directive.castFocus.sceneCastMode, "single_primary");
    assert.equal(directive.npcGrounding.existingNpcEligible, false);
    assert.equal(directive.npcGrounding.newNpcAllowed, false);

    const block = renderSceneDirectiveForPrompt(directive);
    const again = renderSceneDirectiveForPrompt(quietAutoDirective());
    assert.equal(again, block);
    assert.match(block, /전개 필요: MICRO/);
    assert.match(block, /허용된 변화: 환경 변화/);
    assert.match(block, /기존 NPC 행동: 없음/);
    assert.match(block, /새 인물 도입: 없음/);
    assert.match(block, /직접 발화 중심: 라이크\./);
    assert.match(block, /유저 조종: .*USER AUTHORING owner/);
    assert.doesNotMatch(block, new RegExp(NPC_ADVANCE_ORDER));
    assert.doesNotMatch(block, new RegExp(ENSEMBLE_UNLOCK));
    assert.match(block, /트리거된 사건 지시가 있으면 이번 턴 장면 지시보다 우선한다/);
  });

  it("single_primary SCENE_ADVANCE keeps an allowed existing NPC inside the contract", () => {
    const allowed = renderSceneDirectiveForPrompt({
      ...quietAutoDirective(),
      motionDecision: "SCENE_ADVANCE",
      motionReasons: ["trigger"],
      progressionTypes: ["npc_action"],
      npcGrounding: {
        existingNpcEligible: true,
        newNpcAllowed: false,
        eligibleActorNames: ["테스트조연"],
        sources: ["active_speaking_cast"],
      },
    });
    assert.match(allowed, /전개 필요: ADVANCE/);
    assert.match(allowed, /기존 NPC \(테스트조연\)의 행동만/);
    assert.match(allowed, /새 인물 도입: 없음/);
    assert.match(allowed, /현재 인과에 맞는 장면 전개를 진행한다/);
    assert.doesNotMatch(allowed, new RegExp(ENSEMBLE_UNLOCK));
    assert.doesNotMatch(allowed, new RegExp(NPC_ADVANCE_ORDER));
  });

  it("a triggered arrival stays allowed without the blanket NPC order", () => {
    const directive = buildSceneDirective({
      mode: "auto_progression",
      contentKind: "character",
      primaryCharacterName: "테스트주인공",
      knownSupportingCastNames: ["테스트조연"],
      triggeredEventText: "[TRIGGER] 테스트조연이 지원으로 도착했다.",
      currentUserMessage: "자동진행",
      chatId: 42,
      currentTurn: 3,
      recentMessages: [{ role: "assistant", content: "작전 중이다." }],
    });
    assert.equal(directive.npcGrounding.newNpcAllowed, true);
    assert.ok(
      directive.motionDecision === "SCENE_ADVANCE" || directive.motionDecision === "ESCALATE"
    );
    const block = renderSceneDirectiveForPrompt(directive);
    assert.match(block, /새 인물 도입: 트리거·명시적 도착만/);
    assert.match(block, /트리거된 사건 지시가 있으면 이번 턴 장면 지시보다 우선한다/);
    assert.doesNotMatch(block, new RegExp(NPC_ADVANCE_ORDER));
    assert.doesNotMatch(block, new RegExp(ENSEMBLE_UNLOCK));
  });

  it("simulation and party auto keep the ensemble line", () => {
    const simulation = buildSceneDirective({
      mode: "auto_progression",
      contentKind: "simulation",
      primaryCharacterName: "테스트시뮬",
      establishedActiveCastNames: ["테스트시뮬", "테스트조연"],
      currentUserMessage: "자동진행",
      chatId: 7,
      currentTurn: 2,
      recentMessages: [
        { role: "user", content: "경보가 울렸다." },
        { role: "assistant", content: "사이렌이 복도를 채웠다." },
      ],
    });
    assert.equal(simulation.castFocus.sceneCastMode, "simulation");
    const simulationBlock = renderSceneDirectiveForPrompt(simulation);
    assert.match(simulationBlock, new RegExp(ENSEMBLE_UNLOCK));
    assert.match(simulationBlock, /여러 AI 캐릭터·NPC의 대화/);
    assert.doesNotMatch(simulationBlock, /직접 발화 중심:/);
    assert.doesNotMatch(simulationBlock, new RegExp(NPC_ADVANCE_ORDER));

    const party = buildSceneDirective({
      mode: "auto_progression",
      contentKind: "character",
      party: true,
      primaryCharacterName: "테스트리더",
      establishedActiveCastNames: ["테스트리더", "테스트부관"],
      currentUserMessage: "자동진행",
      chatId: 8,
      currentTurn: 2,
      recentMessages: [{ role: "assistant", content: "작전실에서 지도를 펼쳤다." }],
    });
    assert.equal(party.castFocus.sceneCastMode, "ensemble");
    const partyBlock = renderSceneDirectiveForPrompt(party);
    assert.match(partyBlock, new RegExp(ENSEMBLE_UNLOCK));
    assert.doesNotMatch(partyBlock, new RegExp(NPC_ADVANCE_ORDER));
  });

  it("interactive dialogue does not take the auto ensemble line", () => {
    const directive = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: "라이크",
      currentUserMessage: "창문 쪽에 같이 서 있자.",
      recentMessages: QUIET_HISTORY,
    });
    const block = renderSceneDirectiveForPrompt(directive);
    assert.match(block, /모드: 일반 RP/);
    assert.match(block, /유저의 의도적 행동\/대사\/감정 결론은 쓰지 않는다/);
    assert.doesNotMatch(block, new RegExp(ENSEMBLE_UNLOCK));
    assert.doesNotMatch(block, new RegExp(NPC_ADVANCE_ORDER));
  });

  it("continue and regenerate commands do not order an NPC advance", () => {
    const command = buildContinueNarrativeCommand({
      personaName: "렌",
      charName: "라이크",
    });
    assert.match(command, /Continue from the exact in-scene moment/);
    assert.match(command, /EFFECTIVE USER AUTHORING policy/);
    assert.match(command, /STRICT ANTI-REPETITION RULE/);
    assert.doesNotMatch(command, new RegExp(CONTINUE_NPC_ORDER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(command, new RegExp(CONTINUE_MULTI_SPEAK));

    const regenerated = buildContinueNarrativeCommand({
      personaName: "렌",
      charName: "라이크",
      regenerate: true,
    });
    assert.match(regenerated, /Regenerate:/);
    assert.doesNotMatch(regenerated, /Multiple AI-controlled characters may speak/);
    assert.doesNotMatch(regenerated, /Advance \[AI_CAST\]\/NPC\/environment\/world proactively/);
  });

  it("assembled quiet auto prompt keeps length, prose, and [B] scope without the NPC order", () => {
    const directive = quietAutoDirective();
    const sceneDirectiveBlock = renderSceneDirectiveForPrompt(directive);
    const command = buildContinueNarrativeCommand({
      personaName: "렌",
      charName: "라이크",
    });
    const built = buildContext({
      charName: "라이크",
      contentKind: "character",
      chunks: [],
      userNickname: "렌",
      personaDisplayName: "렌",
      userPersona: "이름/호칭: 렌",
      shortTermHistory: QUIET_HISTORY,
      currentUserMessage: command,
      currentTurnAuthoringDelegation: NORMAL,
      nsfw: false,
      provider: "openrouter",
      isContinue: true,
      runtimeMode: "auto_progression",
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      targetResponseChars: 3200,
      completedTurns: 1,
      longTermMemory: "",
      sceneDirectiveBlock,
    });
    const userTurn = built.history.at(-1)?.content ?? "";
    const assembled = `${built.systemPrompt}\n${userTurn}`;
    assert.equal((built.systemPrompt.match(/\[COMMON PROSE\]/g) ?? []).length, 1);
    assert.ok(built.systemPrompt.includes(COMMON_PROSE_BLOCK.slice(0, 24)));
    assert.ok(userTurn.includes(USER_TAIL_LENGTH_OWNER_SENTENCE));
    assert.equal((userTurn.match(/3,200자 이상/g) ?? []).length, 1);
    assert.ok(assembled.includes(sceneDirectiveBlock));
    assert.equal((assembled.match(/\[이번 턴 장면 지시 - 비공개\]/g) ?? []).length, 1);
    assert.doesNotMatch(assembled, /적극적으로 진행한다/);
    assert.doesNotMatch(assembled, /중심 인물 하나에 고정되지 않는다/);
    assert.doesNotMatch(assembled, /Multiple AI-controlled characters may speak/);
    assert.doesNotMatch(assembled, /Advance through \[AI_CAST\], NPCs/);
    assert.doesNotMatch(assembled, /Advance \[AI_CAST\]\/NPC\/environment\/world proactively/);
    assert.match(assembled, /현재 장면에 적합한 AI 담당 인물과 세계가 능동적으로 진행한다/);
    assert.match(userTurn, /do not widen it here/);
  });
});

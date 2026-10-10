import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { CharacterChunk } from "@/types";
import { CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL } from "@/lib/chatModels";
import { buildCoreMasterPrompt } from "@/lib/corePrompt";
import {
  buildContinueNarrativeCommand,
  buildRegenerateSystemDirective,
} from "@/lib/continueNarrative";
import { buildAutoProgressionUserControlBlock } from "@/lib/autoProgressionRules";
import type { CurrentTurnAuthoringDelegation } from "@/lib/currentTurnUserAuthoringDelegation";
import { buildSceneDirective, renderSceneDirectiveForPrompt } from "@/lib/sceneDirective";
import { auditAssembledPrompt } from "@/services/promptAudit";
import { buildContext } from "@/services/contextBuilder";

const PRIOR_USER = "창문 쪽에 같이 서 있자.";
const PRIOR_ASSISTANT = "라이크는 유리에 이마를 기대며 하품했다.\n\n졸려. 너는 그대로 있어.";
const PRIOR = `${PRIOR_USER}\n${PRIOR_ASSISTANT}`;
const OPENING_CHARS = 1200;
const PERSONA = /(?<!오)렌/;

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

/** Reduced delivery card. Not the deployed 라이크 canon. */
const canonChunk: CharacterChunk = {
  id: "canon",
  characterId: "18",
  content: "현재 거처는 숙소 창가 쪽 방이다. 격리 프로토콜은 별도 시설의 규칙이다.",
  category: "identity",
  importance: "CRITICAL",
  tokenCount: 24,
  keywords: ["숙소"],
};

type ContinuityAssessment = {
  /** Prior beat names no room. A later place name is an observation, not an error. */
  openingNamesAPlace: boolean;
  /** The name 렌 is absent. Distinct from the persona leaving the scene. */
  personaNameAbsent: boolean;
  /** The text says the already-present persona vanished. */
  personaPhysicallyRemoved: boolean;
  /** Already-present 렌 is written as a new arrival, with no move in between. */
  reintroducedAsNewArrival: boolean;
};

function isDefinitiveContinuityError(assessment: ContinuityAssessment): boolean {
  return assessment.personaPhysicallyRemoved || assessment.reintroducedAsNewArrival;
}

/**
 * Classifies recorded auto-continue samples. Not a production rewriter.
 * The prior beat names no room, so isolation, a dorm, or a corridor is not
 * an error by itself. A missing name is not physical disappearance.
 * 오렌지 does not count as the persona 렌. An explicit move and a new NPC
 * stay outside the two error flags.
 */
function assessAutoSceneContinuation(prior: string, output: string): ContinuityAssessment {
  const opening = output.slice(0, OPENING_CHARS);
  const place = /격리실|코드 블랙|숙소|복도|챔버/;
  const arrivalAt = output.search(/오늘이 배치 첫날|배치 첫날입니다|처음 들어왔|막 도착했/);
  const beforeArrival = arrivalAt >= 0 ? output.slice(0, arrivalAt) : output;
  return {
    openingNamesAPlace: !place.test(prior) && place.test(opening),
    personaNameAbsent: !PERSONA.test(output),
    personaPhysicallyRemoved:
      /(?<!오)렌(?:이|은|를)?[^\n]{0,24}(?:사라졌|없었다|보이지 않|자취가 없)/.test(output),
    reintroducedAsNewArrival:
      PERSONA.test(output) &&
      arrivalAt >= 0 &&
      !/이동했|걸어 나|다른 방|다음 장소/.test(beforeArrival),
  };
}

function raw(name: string): string {
  return readFileSync(`docs/reviews/phase3d/raw/${name}.txt`, "utf8");
}

function quietHistory() {
  return [
    { role: "user" as const, content: PRIOR_USER },
    { role: "assistant" as const, content: PRIOR_ASSISTANT },
  ];
}

function assemble(includeDirective: boolean, extra?: { longTermMemory?: string; history?: typeof quietHistory extends () => infer T ? T : never }) {
  const history = extra?.history ?? quietHistory();
  const directive = buildSceneDirective({
    mode: "auto_progression",
    recentMessages: history,
    currentUserMessage: "자동진행",
    contentKind: "character",
    primaryCharacterName: "라이크",
    chatId: 18,
    currentTurn: 2,
  });
  const sceneDirectiveBlock = renderSceneDirectiveForPrompt(directive);
  const currentUserMessage = buildContinueNarrativeCommand({
    personaName: "렌",
    charName: "라이크",
    regenerate: false,
  });
  const built = buildContext({
    charName: "라이크",
    chunks: [canonChunk],
    userNickname: "렌",
    personaDisplayName: "렌",
    userPersona: "이름/호칭: 렌",
    userPersonaGender: "male",
    gender: "male",
    shortTermHistory: history,
    currentUserMessage,
    currentTurnAuthoringDelegation: NORMAL,
    isContinue: true,
    runtimeMode: "auto_progression",
    modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
    provider: "openrouter",
    targetResponseChars: 3200,
    completedTurns: 1,
    nsfw: false,
    longTermMemory: extra?.longTermMemory ?? "",
    sceneDirectiveBlock: includeDirective ? sceneDirectiveBlock : "",
  });
  return { built, directive, sceneDirectiveBlock, currentUserMessage };
}

describe("auto scene continuation delivery", () => {
  it("keeps the window beat, the stay line, and the persona name in the final history", () => {
    const { built, currentUserMessage } = assemble(true);
    const historyText = built.history
      .slice(0, -1)
      .map((message) => message.content)
      .join("\n");
    const current = built.history.at(-1)?.content ?? "";
    assert.match(historyText, /창문 쪽에 같이 서 있자\./);
    assert.match(historyText, /너는 그대로 있어\./);
    assert.doesNotMatch(historyText, /격리실|코드 블랙|숙소/);
    assert.match(current, /Continue from the exact in-scene moment where the previous RP ended\./);
    assert.equal(current.includes("자동진행"), false);
    assert.match(currentUserMessage, /exact in-scene moment/);
    const reference = (built.meta.trackedSections ?? []).find((section) => section.id === "user-persona-reference-owner");
    assert.ok(reference);
    assert.match(reference.text, /이름\/호칭: 렌/);
    const canon = (built.meta.trackedSections ?? []).find((section) => section.id === "character-core-identity");
    assert.ok(canon);
    assert.match(canon.text, /숙소 창가/);
  });

  it("uses micro-motion for this quiet auto turn and does not grow tokens across identical builds", () => {
    const first = assemble(true);
    const second = assemble(true);
    assert.equal(first.directive.motionDecision, "MICRO_MOTION");
    assert.match(first.sceneDirectiveBlock, /새 인물 도입: 없음/);
    assert.match(first.sceneDirectiveBlock, /새 인물·별도 사건은 만들지 않는다/);
    const auditA = auditAssembledPrompt({
      systemSections: first.built.meta.trackedSections ?? [],
      systemPrompt: first.built.systemPrompt,
      history: first.built.history,
    });
    const auditB = auditAssembledPrompt({
      systemSections: second.built.meta.trackedSections ?? [],
      systemPrompt: second.built.systemPrompt,
      history: second.built.history,
    });
    assert.equal(auditA.totalAssembledTokens, auditB.totalAssembledTokens);
    assert.equal(auditA.breakdown.memory, 0);
    assert.ok(auditA.breakdown.characterSetting > 0);
    assert.ok(auditA.breakdown.recentConversation > 0);
    const omitted = assemble(false);
    const auditOmitted = auditAssembledPrompt({
      systemSections: omitted.built.meta.trackedSections ?? [],
      systemPrompt: omitted.built.systemPrompt,
      history: omitted.built.history,
    });
    assert.equal(auditA.breakdown.characterSetting, auditOmitted.breakdown.characterSetting);
    assert.equal(auditA.breakdown.persona, auditOmitted.breakdown.persona);
    assert.equal(auditA.breakdown.memory, auditOmitted.breakdown.memory);
    assert.equal(auditA.breakdown.recentConversation, auditOmitted.breakdown.recentConversation);
    assert.ok(auditA.breakdown.systemRules > auditOmitted.breakdown.systemRules);
    const directiveSections = auditA.sections.filter((section) => section.id === "scene-directive");
    assert.equal(directiveSections.length, 1);
    const directiveSection = directiveSections[0];
    assert.equal(
      auditA.breakdown.systemRules - auditOmitted.breakdown.systemRules,
      directiveSection.tokens
    );
    assert.equal((omitted.built.meta.trackedSections ?? []).some((section) => section.id === "scene-directive"), false);
  });

  it("keeps canon and the window beat when memory is present and when history is longer", () => {
    const withMemory = assemble(true, { longTermMemory: "둘은 창가에 함께 서 있었다." });
    const memory = (withMemory.built.meta.trackedSections ?? []).find((section) => section.id === "current-memory");
    assert.ok(memory);
    assert.match(memory.text, /창가에 함께 서 있었다/);
    const canon = (withMemory.built.meta.trackedSections ?? []).find((section) => section.id === "character-core-identity");
    assert.match(canon?.text ?? "", /숙소 창가/);
    const longer = assemble(true, {
      history: [
        { role: "user", content: "로비에서 처음 봤다." },
        { role: "assistant", content: "라이크는 고개만 까닥했다." },
        { role: "user", content: "밥 먹자." },
        { role: "assistant", content: "식판을 내려놓았다." },
        ...quietHistory(),
      ],
    });
    const historyText = longer.built.history.map((message) => message.content).join("\n");
    assert.match(historyText, /창문 쪽에 같이 서 있자\./);
    assert.match(historyText, /너는 그대로 있어\./);
    assert.match(
      (longer.built.meta.trackedSections ?? []).find((section) => section.id === "character-core-identity")?.text ?? "",
      /숙소 창가/
    );
  });
});

describe("continuation scope owners stay distinct", () => {
  it("auto, regenerate, interactive, and NORMAL authoring do not share one relocation instruction", () => {
    const auto = buildContinueNarrativeCommand({
      personaName: "렌",
      charName: "라이크",
      regenerate: false,
    });
    assert.match(auto, /exact in-scene moment/);
    assert.match(auto, /STRICT ANTI-REPETITION RULE/);
    assert.doesNotMatch(auto, /격리실|코드 블랙/);

    const regen = buildRegenerateSystemDirective({ charName: "라이크" });
    assert.match(regen, /Same scene, not a new scene/);
    assert.doesNotMatch(regen, /CONTINUE THE NARRATIVE/);

    const interactive = buildCoreMasterPrompt({
      charName: "라이크",
      userName: "렌",
      charGender: "male",
      userGender: "male",
      nsfwEnabled: false,
      impersonationOn: false,
      autoProgressionEnabled: false,
      completedTurns: 1,
      hasMindReading: false,
    });
    const autoCore = buildCoreMasterPrompt({
      charName: "라이크",
      userName: "렌",
      charGender: "male",
      userGender: "male",
      nsfwEnabled: false,
      impersonationOn: false,
      autoProgressionEnabled: true,
      completedTurns: 1,
      hasMindReading: false,
    });
    assert.match(interactive, /같은 장면을 이어간다/);
    assert.match(autoCore, /현재 장면과 기존 인과를 이어간다/);
    assert.doesNotMatch(interactive, /CONTINUE THE NARRATIVE/);

    const normal = buildAutoProgressionUserControlBlock(NORMAL);
    assert.match(normal, /외부에서 관찰 가능한 행동/);
    assert.doesNotMatch(normal, /격리실|장면을 초기화|새로 도착/);
  });
});

describe("recorded Q7 outputs", () => {
  const prior = PRIOR;

  it("does not treat a named dorm, with 렌 already present and later NPCs, as an error", () => {
    const assessment = assessAutoSceneContinuation(prior, raw("Q7-auto"));
    assert.equal(assessment.openingNamesAPlace, true);
    assert.equal(assessment.personaNameAbsent, false);
    assert.equal(isDefinitiveContinuityError(assessment), false);
  });

  it("records isolation and a missing name without calling either a continuity error", () => {
    const isolation = assessAutoSceneContinuation(prior, raw("CONTROL-1"));
    assert.equal(isolation.openingNamesAPlace, true);
    assert.equal(isolation.personaNameAbsent, false);
    assert.equal(isolation.reintroducedAsNewArrival, false);
    assert.equal(isDefinitiveContinuityError(isolation), false);

    const unnamed = assessAutoSceneContinuation(prior, raw("CANDIDATE-1"));
    assert.equal(unnamed.personaNameAbsent, true);
    assert.equal(unnamed.personaPhysicallyRemoved, false);
    assert.equal(isDefinitiveContinuityError(unnamed), false);

    const window = assessAutoSceneContinuation(prior, raw("CANDIDATE-2"));
    assert.equal(window.personaNameAbsent, false);
    assert.equal(window.reintroducedAsNewArrival, false);
    assert.equal(isDefinitiveContinuityError(window), false);
  });

  it("flags 렌 being brought in as a new arrival when the prior beat already had them there", () => {
    const arrival = assessAutoSceneContinuation(prior, raw("CONTROL-2"));
    assert.equal(arrival.openingNamesAPlace, true);
    assert.equal(arrival.reintroducedAsNewArrival, true);
    assert.equal(isDefinitiveContinuityError(arrival), true);
  });

  it("allows an explicit move and a new NPC, and separates a missing name from vanishing", () => {
    const moved = "숙소 창가에 있던 렌과 라이크는 복도를 걸어 다른 방 문으로 이동했다. 조아인이 노크했다.";
    const stayed = "렌이 창가에 서 있는 동안 윤태건이 문을 열고 들어왔다. 라이크는 유리에서 고개만 돌렸다.";
    const unnamed = "라이크는 유리에 이마를 기댄 채 하품했다. 복도는 조용했다.";
    const vanished = "렌이 흔적도 없이 사라졌다. 라이크만 창가에 남았다.";
    assert.equal(isDefinitiveContinuityError(assessAutoSceneContinuation(prior, moved)), false);
    assert.equal(isDefinitiveContinuityError(assessAutoSceneContinuation(prior, stayed)), false);
    const missingName = assessAutoSceneContinuation(prior, unnamed);
    assert.equal(missingName.personaNameAbsent, true);
    assert.equal(missingName.personaPhysicallyRemoved, false);
    assert.equal(assessAutoSceneContinuation(prior, vanished).personaPhysicallyRemoved, true);
  });
});

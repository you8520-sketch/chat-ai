/**
 * Luna Prompt Consolidation — ownership invariants (API=0).
 */
import Module from "module";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import { buildContext } from "@/services/contextBuilder";
import {
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  resolveSelectedAI,
} from "@/lib/chatModels";
import { formatUserPersonaForPrompt } from "@/lib/persona";
import { loadCharacterChunksForPrompt } from "@/lib/characterChunks";
import { messagesToTurns, rawRecentTurnsToHistory, countPlayableTurns } from "@/lib/hybridMemory";
import {
  buildSceneDirective,
  renderSceneDirectiveForPrompt,
} from "@/lib/sceneDirective";
import {
  USER_TAIL_LENGTH_OWNER_SENTENCE,
  buildLengthInstruction,
  buildCompactTerminalLengthAbsoluteTail,
  appendCompactTerminalLengthToUserTurn,
} from "@/lib/responseLength";
import { buildCompactNoGodmoddingStandardBlock, INTERACTIVE_USER_CONTROL_BLOCK } from "@/lib/noGodmodding";
import { IMMERSIVE_PROSE_BLOCK } from "@/lib/advancedProseNsfwGuidelines";
import { DIALOGUE_NARRATION_STRUCTURE_RULE } from "@/lib/webnovelOutputFormat";
import {
  LUNA_TERMINAL_OUTPUT_CONTRACT,
  resolveLunaSinglePrimaryLine,
  resolveLunaTerminalOutputContract,
} from "@/lib/lunaSinglePrimaryAdapter";

function forceTestEnv() {
  for (const k of [
    "LIVING_NOVEL_SIMULATION_V3_ENABLED",
    "LIVING_SCENE_DIRECTIVE_V2_ENABLED",
    "LIVING_SCENE_DIRECTIVE_V2_USER_IDS",
    "SHARED_NOVEL_PROSE_V2_ENABLED",
    "PROSE_VNEXT_ENABLED",
  ]) {
    delete process.env[k];
  }
  process.env.SCENE_DIRECTIVE_V2_MODE = "off";
}

const STABLE_CANON =
  "등장인물 (성인 가상 인물)\n태형(라이크): 본부 센티넬. 말이 많고 장난기가 있다.\n윤태건: 기존 동료.\n장소: 본부 구내식당. 태형과 유저(렌)가 식사 중.";

function buildE1Wire(systemPrompt: string) {
  forceTestEnv();
  const history = [
    {
      role: "assistant" as const,
      model: "greeting" as const,
      content:
        "구내식당 창가. 태형은 갈비찜과 애플 크럼블 앞에서 포크를 돌렸다. 윤태건은 아직 나타나지 않았다.",
    },
    { role: "user" as const, content: "페어는 어떻게 정해져?" },
    {
      role: "assistant" as const,
      content:
        "태형은 웃으며 페어 매칭이 소개팅처럼 끝나지 않는다고 설명했다. 식당에는 두 사람의 식판만 가까이 놓여 있었다.",
    },
  ];
  const currentUserMessage = "응. 여기서 조금 쉬자.";
  const memory =
    "렌은 신규 S급 가이드. 태형이 안내를 맡았다. 윤태건은 기존 동료다. 현재는 식당에서 태형과 렌만 대화 중이다.";
  const factsBlock =
    "[CURRENT SCENE FACTS]\n태형과 렌이 식당에서 식사 중이다.\n윤태건은 기존 동료이지만 지금 식탁에 앉아 있지 않다.\n사용자는 다른 인물을 부르지 않았다.";
  const world = "센티넬/가이드 본부. 구내식당. 등록·오리엔테이션 절차가 있다.";
  const dialogueTurns = messagesToTurns(
    history.map((h) => ({ role: h.role, content: h.content, model: h.model }))
  );
  const shortTermHistory = rawRecentTurnsToHistory(dialogueTurns);
  const playableTurnCount = countPlayableTurns(dialogueTurns);
  // Luna remains a valid runtime model id even while temporarily hidden from the picker.
  const resolved = CHEAPER_INFERENCE_GPT_56_LUNA_MODEL;
  const { chunks, usedEnglish } = loadCharacterChunksForPrompt(
    {
      id: 95001,
      name: "태형",
      gender: "male",
      system_prompt: systemPrompt,
      world,
      example_dialog: null,
      setting_chunks: null,
      setting_chunks_en: null,
      speech_profile: null,
      creator_compiled_description_json: null,
      appearance_raw: null,
      appearance_compiled: null,
      content_kind: "character",
      simulation_cast: null,
    } as never,
    "렌",
    "렌"
  );
  const directive = buildSceneDirective({
    mode: "interactive",
    recentMessages: shortTermHistory.slice(-8),
    currentUserMessage,
    memoryText: `${memory}\n\n${factsBlock}`,
    lorebookText: "본부 구내식당 가이드 지원국 오리엔테이션",
    chatId: 95101,
    currentTurn: 4,
    progressionHistory: [],
    contentKind: "character",
    primaryCharacterName: "태형",
  });
  const sceneDirectiveBlock = renderSceneDirectiveForPrompt(directive);
  const built = buildContext({
    charName: "태형",
    chunks,
    userNickname: "렌",
    userPersona: formatUserPersonaForPrompt("렌", "테스트 페르소나", "렌"),
    userNote: "",
    longTermMemory: `${memory}\n\n${factsBlock}`,
    archiveMemory: null,
    shortTermHistory,
    currentUserMessage,
    nsfw: false,
    gender: "male",
    userId: 90011,
    chatId: 95101,
    targetResponseChars: 3200,
    completedTurns: playableTurnCount,
    modelId: resolved,
    provider: "openrouter",
    personaDisplayName: "렌",
    userPersonaGender: null,
    useEnglishCharacterPrompt: usedEnglish,
    contentKind: "character",
    sceneDirectiveBlock,
  });
  return { built, directive, systemPrompt: built.systemPrompt ?? "" };
}

describe("luna prompt consolidation ownership", () => {
  it("Luna terminal contract on user-tail last; system length/adapter absent", () => {
    assert.equal(buildLengthInstruction(3200), "");
    assert.equal(
      resolveLunaTerminalOutputContract(CHEAPER_INFERENCE_GPT_56_LUNA_MODEL, "character", false),
      LUNA_TERMINAL_OUTPUT_CONTRACT
    );
    assert.equal(
      resolveLunaSinglePrimaryLine(CHEAPER_INFERENCE_GPT_56_LUNA_MODEL, "character", false),
      null
    );
    assert.match(LUNA_TERMINAL_OUTPUT_CONTRACT, /한국어 RP 본문만 3,200~4,200자/);
    assert.match(LUNA_TERMINAL_OUTPUT_CONTRACT, /하나의 충분한 발화로 묶고/);
    assert.doesNotMatch(LUNA_TERMINAL_OUTPUT_CONTRACT, /반드시 3~6/);
    assert.doesNotMatch(LUNA_TERMINAL_OUTPUT_CONTRACT, /최초로 확인 가능한 결과/);
    assert.equal(buildCompactTerminalLengthAbsoluteTail(3200), "");

    const userTail = appendCompactTerminalLengthToUserTurn("응. 여기서 조금 쉬자.", 3200, {
      modelId: CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
      contentKind: "character",
      party: false,
    });
    assert.match(userTail, /레이아웃:/);
    assert.ok(userTail.trimEnd().endsWith(LUNA_TERMINAL_OUTPUT_CONTRACT));
    assert.ok(userTail.indexOf("레이아웃:") < userTail.indexOf(LUNA_TERMINAL_OUTPUT_CONTRACT));
    assert.doesNotMatch(userTail, /TARGET_LENGTH|MINIMUM_FLOOR|미달 조기 종료/);

    const { systemPrompt, built } = buildE1Wire(STABLE_CANON);
    assert.doesNotMatch(systemPrompt, /3,200~4,200/);
    assert.doesNotMatch(systemPrompt, /충분한 발화로 묶어/);
    assert.doesNotMatch(systemPrompt, /luna-single-primary|LUNA_TERMINAL/);
    assert.ok(!(built.meta.trackedSections ?? []).some((s) => s.id === "luna-single-primary-adapter"));
    const lastUser = built.history[built.history.length - 1];
    assert.equal(lastUser?.role, "user");
    assert.equal((lastUser!.content.split(LUNA_TERMINAL_OUTPUT_CONTRACT).length - 1), 1);
    assert.ok(lastUser!.content.trimEnd().endsWith(LUNA_TERMINAL_OUTPUT_CONTRACT));
    assert.ok(!lastUser!.content.includes(USER_TAIL_LENGTH_OWNER_SENTENCE));
  });

  it("single-primary activeSpeakingCast line exactly once", () => {
    const { systemPrompt } = buildE1Wire(STABLE_CANON);
    assert.equal((systemPrompt.match(/직접 발화 중심:/g) ?? []).length, 1);
    assert.match(systemPrompt, /직접 발화 중심: 태형\./);
  });

  it("agency block contains no NPC/world expansion instruction", () => {
    const agency = buildCompactNoGodmoddingStandardBlock();
    assert.doesNotMatch(agency, /NPC, 환경/);
    assert.doesNotMatch(agency, /자연스럽게 움직일 수 있다/);
    assert.doesNotMatch(INTERACTIVE_USER_CONTROL_BLOCK, /NPC, 환경, 사건의 여파/);
    assert.match(INTERACTIVE_USER_CONTROL_BLOCK, /유저의 새 대사·선택·동의·주도 행동/);
  });

  it("style block does not designate other characters as filler", () => {
    assert.doesNotMatch(IMMERSIVE_PROSE_BLOCK, /선택적 환경·다른 인물/);
    assert.doesNotMatch(IMMERSIVE_PROSE_BLOCK, /다른 인물·업무·주변 활동/);
    assert.match(IMMERSIVE_PROSE_BLOCK, /내면·행동·환경·관계의 변화가 서로 인과적으로 이어지게 쓴다/);
  });

  it("dialogue concentration + length once via Luna terminal contract only", () => {
    assert.doesNotMatch(DIALOGUE_NARRATION_STRUCTURE_RULE, /충분한 길이의 하나의 발화/);
    assert.doesNotMatch(DIALOGUE_NARRATION_STRUCTURE_RULE, /주요 대화 몇 차례에 집중/);
    assert.match(DIALOGUE_NARRATION_STRUCTURE_RULE, /대사는 독립 문단으로 표시한다/);

    const { systemPrompt, built } = buildE1Wire(STABLE_CANON);
    assert.equal((systemPrompt.match(/하나의 충분한 발화로 묶고/g) ?? []).length, 0);
    assert.equal((systemPrompt.match(/3,200~4,200/g) ?? []).length, 0);
    const lastUser = built.history[built.history.length - 1]!;
    assert.equal((lastUser.content.match(/하나의 충분한 발화로 묶고/g) ?? []).length, 1);
    assert.equal((lastUser.content.match(/3,200~4,200/g) ?? []).length, 1);

    // Non-Luna / simulation: no terminal contract.
    assert.equal(
      resolveLunaTerminalOutputContract(OPENROUTER_DEEPSEEK_V4_PRO_MODEL, "character", false),
      null
    );
    assert.equal(
      resolveLunaTerminalOutputContract(CHEAPER_INFERENCE_GPT_56_LUNA_MODEL, "simulation", false),
      null
    );
    const nonLunaTail = appendCompactTerminalLengthToUserTurn("안녕", 3200, {
      modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      contentKind: "character",
      party: false,
    });
    assert.ok(nonLunaTail.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE));
    assert.doesNotMatch(nonLunaTail, /하나의 충분한 발화로 묶고/);
  });

  it("fixture character canon contains no current-location cue", () => {
    const { systemPrompt } = buildE1Wire(STABLE_CANON);
    assert.doesNotMatch(systemPrompt, /현재 장면 밖 복도에 있을 수 있다/);
    assert.match(systemPrompt, /윤태건: 기존 동료/);
  });

  it("system section count drops after consolidation", () => {
    const { built } = buildE1Wire(STABLE_CANON);
    const sections = built.meta.trackedSections ?? [];
    assert.ok(sections.length <= 11, `expected <=11 sections, got ${sections.length}`);
    assert.ok(
      !sections.some((s) => s.id === "rule-terminal-length-override"),
      "terminal length section must be absent"
    );
    assert.ok(
      !sections.some((s) => s.id === "openrouter-co-narration-rule"),
      "co-narration OFF section must be absent for interactive E1"
    );
  });
});

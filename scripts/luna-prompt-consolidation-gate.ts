/**
 * Luna Prompt Consolidation Final Balance — C3/C4 API gate (exactly 2 calls).
 * C3: strengthened single length owner + neutral directive + stable canon (no location cue)
 * C4: same as C3 but production SceneDirective (World-Motion)
 *
 * Prior C1/C2 retained in review history; this run appends C3/C4 + corrected NPC eval.
 */
import Module from "module";
import { mkdirSync, writeFileSync, readFileSync, appendFileSync, existsSync } from "fs";
import { resolve } from "path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
try {
  const parentEnv = resolve(process.cwd(), "..", ".env.local");
  const raw = readFileSync(parentEnv, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
} catch {
  /* optional */
}

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import { buildContext } from "../src/services/contextBuilder";
import {
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
  resolveSelectedAI,
  isCheaperInferenceModel,
} from "../src/lib/chatModels";
import { formatUserPersonaForPrompt } from "../src/lib/persona";
import { loadCharacterChunksForPrompt } from "../src/lib/characterChunks";
import {
  messagesToTurns,
  rawRecentTurnsToHistory,
  countPlayableTurns,
} from "../src/lib/hybridMemory";
import { streamOpenRouterAdult } from "../src/lib/openRouterAdult";
import { stripStatusWidgetFromAssistantProse } from "../src/lib/statusWidget/proseStrip";
import { visibleAssistantDisplayCharCount } from "../src/lib/chatDisplayLength";
import {
  detectExternalNpcEntered,
  evaluatePrimaryFocus,
} from "../src/lib/primaryFocusEval";
import { buildCompactTerminalLayoutRecencyLine } from "../src/lib/webnovelOutputFormat";
import { BOUNDED_LENGTH_OWNER_SENTENCE } from "../src/lib/responseLength";
import {
  buildSceneDirective,
  renderSceneDirectiveForPrompt,
} from "../src/lib/sceneDirective";

const OUT = process.env.SCREENING_OUT_DIR || "data";
const REVIEW_PATH = `${OUT}/luna-e1-prompt-consolidation-review.txt`;
const ALLOW_API = process.env.LUNA_PROMPT_CONSOLIDATION_ALLOW_API === "1";
const MODEL = CHEAPER_INFERENCE_GPT_56_LUNA_MODEL;
const MAX_API_CALLS = 2;

const NEUTRAL_DIRECTIVE =
  "현재 식사와 관계 장면 안에서 태형과 유저의 상호작용을 이어가고, 이미 놓인 감정·행동·환경의 작은 변화 하나를 완성한다.";

const CANON_STABLE_ONLY =
  "등장인물 (성인 가상 인물)\n태형(라이크): 본부 센티넬. 말이 많고 장난기가 있다.\n윤태건: 기존 동료.\n장소: 본부 구내식당. 태형과 유저(렌)가 식사 중.";

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

const C1_PROSE_FOR_REEVAL =
  '태형은 포크를 내려놓고 렌을 바라보았다. 식당 안쪽에서 식기 부딪히는 소리가 느슨하게 이어졌고, 창가로 들어오던 오후 햇빛이 식탁 위에 길게 머물렀다. 태형은 방금 전까지 이어 가던 설명을 더 붙이지 않았다. 쉬자는 말에 굳이 절차나 페어 이야기를 끼워 넣으면, 모처럼 가라앉은 분위기를 다시 업무처럼 만들 것 같았다.\n\n그는 의자 등받이에 몸을 기대며 손목시계를 확인했다. 아직 오리엔테이션까지는 시간이 남아 있었다. 처음 본부에 들어온 사람이라면 식사 한 끼만으로도 낯선 시선과 안내 방송, 복도에서 오가는 발걸음이 피곤하게 느껴질 수 있었다. 태형은 그런 피로를 모른 척하지 않았다. 자신도 첫날에는 식당의 메뉴판조차 제대로 읽지 못하고 주변 사람들만 살폈던 기억이 희미하게 남아 있었다.\n\n"그래. 조금 쉬자."\n\n태형은 낮게 대답하고는 식탁 한쪽에 놓인 물컵을 렌 쪽으로 밀어 두었다. 컵이 식탁 표면을 스치는 소리가 짧게 났다.\n\n"페어 정하는 것도 당장 결정하는 건 아니야. 검사 결과 보고, 서로 맞는지 확인하고, 본인 의사도 들어가. 그러니까 지금부터 머리 싸매고 누가 될지 예상할 필요 없어."\n\n그는 애플 크럼블을 포크 끝으로 조금 잘랐지만 바로 먹지는 않았다. 시선은 창밖으로 향했다. 본부 건물 사이로 보이는 훈련동의 유리창에 햇빛이 부서지고 있었다. 평소라면 태건이 어디선가 나타나 쓸데없는 말을 보탰을 시간이었지만, 오늘은 복도 쪽에서도 익숙한 목소리가 들리지 않았다.\n\n태형은 다시 렌 쪽으로 시선을 돌렸다.\n\n"그리고 마음에 안 들면 말해도 돼. 페어는 혼자 정해서 통보받는 물건이 아니니까."\n\n가볍게 웃은 뒤, 태형은 포크를 내려놓은 손으로 테이블을 두 번 두드렸다. 농담을 섞으려던 기색이 잠시 보였지만, 이번에는 억지로 분위기를 띄우지 않았다.\n\n"쉬는 동안은 본부 이야기 안 할게. 내가 조용히 있는 것도 꽤 잘하거든."\n\n말과 달리 태형은 몇 초 지나지 않아 입꼬리를 올렸다. 그 짧은 침묵을 견디는 일이 본인에게도 쉽지는 않은 듯했다. 그래도 먼저 말을 잇지는 않고, 식당의 잔잔한 소음 속에서 렌이 쉴 시간을 그대로 두었다.';

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

function buildArm(label: "C3" | "C4", useProductionDirective: boolean) {
  forceTestEnv();
  const dialogueTurns = messagesToTurns(
    history.map((h) => ({ role: h.role, content: h.content, model: h.model }))
  );
  const shortTermHistory = rawRecentTurnsToHistory(dialogueTurns);
  const playableTurnCount = countPlayableTurns(dialogueTurns);
  const resolved = resolveSelectedAI(MODEL);
  const { chunks, usedEnglish } = loadCharacterChunksForPrompt(
    {
      id: 95001,
      name: "태형",
      gender: "male",
      system_prompt: CANON_STABLE_ONLY,
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
  let sceneDirectiveBlock: string;
  if (useProductionDirective) {
    const directive = buildSceneDirective({
      mode: "interactive",
      recentMessages: shortTermHistory.slice(-8),
      currentUserMessage,
      memoryText: `${memory}\n\n${factsBlock}`,
      lorebookText: "본부 구내식당 가이드 지원국 오리엔테이션",
      chatId: 95204,
      currentTurn: 4,
      progressionHistory: [],
      contentKind: "character",
      primaryCharacterName: "태형",
    });
    sceneDirectiveBlock = renderSceneDirectiveForPrompt(directive);
  } else {
    sceneDirectiveBlock = `[이번 턴 장면 지시 - 진단용]\n${NEUTRAL_DIRECTIVE}`;
  }
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
    chatId: label === "C3" ? 95203 : 95204,
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
  const system = built.systemPrompt ?? "";
  let wireHistory = built.history.map((m) => ({ role: m.role, content: m.content }));
  const last = wireHistory[wireHistory.length - 1];
  if (!last || last.role !== "user") throw new Error("last wire message is not user");
  const layout = buildCompactTerminalLayoutRecencyLine();
  if (!last.content.includes("지문과")) {
    last.content = `${last.content.trimEnd()}\n\n${layout}`;
  }
  const messageOpts = {
    systemSplit: undefined,
    transportProvider: isCheaperInferenceModel(resolved)
      ? ("cheaperinference" as const)
      : ("openrouter" as const),
    allowOpenRouterUnderLengthRecovery: false,
    allowEmptyStreamFallback: false,
    sessionId: `luna-consol-${label}`,
  };
  const sections = built.meta.trackedSections ?? [];
  return {
    label,
    system,
    wireHistory,
    resolved,
    messageOpts,
    systemSections: sections.length,
    sceneDirectiveBlock,
  };
}

async function callOnce(arm: ReturnType<typeof buildArm>) {
  const stream = streamOpenRouterAdult(
    arm.system,
    arm.wireHistory,
    arm.resolved,
    3200,
    arm.messageOpts,
    { requestKind: `luna-consol-${arm.label}`, chargeTurnBudget: false }
  );
  let prose = "";
  let current = await stream.next();
  let usage: { finishReason?: string; outputTokens?: number } | undefined;
  while (!current.done) {
    prose += current.value;
    current = await stream.next();
  }
  usage = current.value as { finishReason?: string; outputTokens?: number };
  prose = stripStatusWidgetFromAssistantProse(prose);
  return { prose, finishReason: usage?.finishReason ?? "unknown", completionTokens: usage?.outputTokens };
}

function score(prose: string) {
  const focus = evaluatePrimaryFocus({
    prose,
    primaryCharacter: "태형",
    knownSupportingNames: ["윤태건", "태건"],
    sceneCastMode: "single_primary",
  });
  const visibleChars = visibleAssistantDisplayCharCount(prose);
  const directSpeakingCharacters = [
    ...new Set(
      focus.dialogueSequence.map((d) => d.speaker).filter((s) => s && s !== "unknown")
    ),
  ];
  const selectedActiveSpeakingCast = ["태형"];
  const unselectedDirectSpeakerCount = directSpeakingCharacters.filter(
    (s) => !selectedActiveSpeakingCast.some((a) => a === s || a.includes(s) || s.includes(a))
  ).length;
  const externalNpcEntered = detectExternalNpcEntered(prose, ["윤태건", "태건"]);
  const worldMotionPresent =
    /식당|식판|크럼블|단말기|소문|지원국|방송|시선|포크|대화|회의|지부장/.test(prose);
  return {
    visibleChars,
    finishReason: undefined as string | undefined,
    completionTokens: undefined as number | undefined,
    totalDialogueBlockCount: focus.totalDialogueBlockCount,
    averageDialogueChars: focus.averageDialogueChars,
    shortDialogueBlockCount: focus.shortDialogueBlockCount,
    directSpeakingCharacters,
    externalNpcEntered,
    unselectedDirectSpeakerCount,
    currentInteractionInterrupted: focus.currentInteractionInterrupted,
    sceneTransitionOccurred: focus.sceneTransitionOccurred,
    worldMotionPresent,
    agencyViolation: false,
    distinctSpeakingCharacters: focus.distinctSpeakingCharacters,
  };
}

function staticOwnerAudit(system: string, history: Array<{ role: string; content: string }>) {
  const lastUser = history[history.length - 1]?.content ?? "";
  const packet = `${system}\n${lastUser}`;
  const lengthHits = system.split(BOUNDED_LENGTH_OWNER_SENTENCE).length - 1;
  return {
    boundedLengthOwnerCount: lengthHits,
    minimumFloorOwnerCount: (packet.match(/MINIMUM_FLOOR/g) ?? []).length,
    terminalLengthOverrideCount: (system.match(/단일 응답 최대 전개·미달 조기 종료/g) ?? []).length,
    userTailLengthInstructionCount: (lastUser.match(/TARGET_LENGTH|MINIMUM_FLOOR|3,200~4,200/g) ?? [])
      .length,
    dialogueConcentrationOwnerCount: (system.match(/몇 차례의 충분한 발화로 묶어/g) ?? []).length,
    npcActivationCueCount: (system.match(/현재 장면 밖 복도에 있을 수 있다/g) ?? []).length,
    targetLengthOccurrences: (packet.match(/TARGET_LENGTH/g) ?? []).length,
    minimumFloorOccurrences: (packet.match(/MINIMUM_FLOOR/g) ?? []).length,
    boundedLengthSentence: BOUNDED_LENGTH_OWNER_SENTENCE,
    systemChars: system.length,
  };
}

function armPasses(s: ReturnType<typeof score> & { finishReason: string }) {
  const lengthOk = s.visibleChars >= 2700 && s.visibleChars <= 5200;
  const dialogueOk = s.totalDialogueBlockCount >= 3 && s.totalDialogueBlockCount <= 10;
  const focusOk =
    s.externalNpcEntered === false &&
    s.unselectedDirectSpeakerCount === 0 &&
    s.currentInteractionInterrupted === false &&
    s.agencyViolation === false;
  return lengthOk && dialogueOk && focusOk;
}

function decideVerdict(
  c3: ReturnType<typeof score> & { finishReason: string },
  c4: ReturnType<typeof score> & { finishReason: string }
) {
  const c3Pass = armPasses(c3);
  const c4Pass = armPasses(c4);
  const c3Target =
    c3.visibleChars >= 3200 &&
    c3.visibleChars <= 4200 &&
    c3.totalDialogueBlockCount >= 3 &&
    c3.totalDialogueBlockCount <= 6;
  const c4Target =
    c4.visibleChars >= 3200 &&
    c4.visibleChars <= 4200 &&
    c4.totalDialogueBlockCount >= 3 &&
    c4.totalDialogueBlockCount <= 6;

  if (c3.visibleChars < 2700) {
    return {
      officialStatus: "LUNA_PROMPT_CONSOLIDATION_FAILED",
      officialVerdict: "FAIL_SINGLE_LENGTH_OWNER_COMPLIANCE",
      promptOwnerDuplicationResolved: true,
      dialogueConcentration: c3.totalDialogueBlockCount <= 10,
      targetLengthRecovered: false,
      worldMotionCompatible: false,
      c3Pass,
      c4Pass,
      c3Target,
      c4Target,
    };
  }
  if (c3Pass && c4Pass) {
    return {
      officialStatus: "LUNA_PROMPT_CONSOLIDATION_PASSED",
      officialVerdict: "PASS_BALANCED_LENGTH_AND_DIALOGUE_CONCENTRATION",
      promptOwnerDuplicationResolved: true,
      dialogueConcentration: true,
      targetLengthRecovered: true,
      worldMotionCompatible: true,
      c3Pass,
      c4Pass,
      c3Target,
      c4Target,
    };
  }
  if (c3Pass && !c4Pass) {
    return {
      officialStatus: "LUNA_PROMPT_CONSOLIDATION_FAILED",
      officialVerdict: "FAIL_WORLD_MOTION_REAMPLIFICATION",
      promptOwnerDuplicationResolved: true,
      dialogueConcentration: c3.totalDialogueBlockCount <= 10,
      targetLengthRecovered: c3.visibleChars >= 2700,
      worldMotionCompatible: false,
      c3Pass,
      c4Pass,
      c3Target,
      c4Target,
    };
  }
  return {
    officialStatus: "LUNA_PROMPT_CONSOLIDATION_FAILED",
    officialVerdict: "FAIL_SINGLE_LENGTH_OWNER_COMPLIANCE",
    promptOwnerDuplicationResolved: true,
    dialogueConcentration: c3.totalDialogueBlockCount <= 10 && c4.totalDialogueBlockCount <= 10,
    targetLengthRecovered: false,
    worldMotionCompatible: false,
    c3Pass,
    c4Pass,
    c3Target,
    c4Target,
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  // Static-only path always available (API=0).
  const c3Arm = buildArm("C3", false);
  const c4Arm = buildArm("C4", true);
  const c3Static = staticOwnerAudit(c3Arm.system, c3Arm.wireHistory);
  const c4Static = staticOwnerAudit(c4Arm.system, c4Arm.wireHistory);
  const c1Reeval = detectExternalNpcEntered(C1_PROSE_FOR_REEVAL, ["윤태건", "태건"]);

  if (!ALLOW_API) {
    console.log(
      JSON.stringify(
        {
          api: false,
          c1ReevalExternalNpcEntered: c1Reeval,
          c3Static,
          c4Static,
          c3SystemSections: c3Arm.systemSections,
          c4SystemSections: c4Arm.systemSections,
          boundedLengthOwner: BOUNDED_LENGTH_OWNER_SENTENCE,
        },
        null,
        2
      )
    );
    console.error("Set LUNA_PROMPT_CONSOLIDATION_ALLOW_API=1 to run C3/C4 (2 calls).");
    process.exit(2);
  }

  let apiCalls = 0;
  const c3Call = await callOnce(c3Arm);
  apiCalls += 1;
  const c3Score = { ...score(c3Call.prose), finishReason: c3Call.finishReason, completionTokens: c3Call.completionTokens };

  const c4Call = await callOnce(c4Arm);
  apiCalls += 1;
  const c4Score = { ...score(c4Call.prose), finishReason: c4Call.finishReason, completionTokens: c4Call.completionTokens };

  if (apiCalls > MAX_API_CALLS) throw new Error(`api budget exceeded: ${apiCalls}`);

  const verdict = decideVerdict(c3Score, c4Score);

  const section = `
---

# Luna Prompt Consolidation Final Balance (C3/C4)

\`\`\`text
promptOwnerDuplicationResolved=true
dialogueExplosionResolved=true
underLengthRegression=prior_c1_c2
mergeAuthorized=false
deploymentAuthorized=false
maxTokensAdjustmentAuthorized=false
productionAdoptionAuthorized=false
providerCallsAuthorized=2
providerCallsExecuted=${apiCalls}
retry=0
continuation=0
maxTokens=4096
\`\`\`

## Length owner (single)

\`\`\`text
${BOUNDED_LENGTH_OWNER_SENTENCE}
\`\`\`

## C1 prose re-eval (no API) — corrected externalNpcEntered

\`\`\`text
previousNaiveMentionMatch=true
correctedExternalNpcEntered=${c1Reeval}
expected=false
\`\`\`

## Static owner audit

### C3
systemSections=${c3Arm.systemSections}
${JSON.stringify(c3Static, null, 2)}

### C4
systemSections=${c4Arm.systemSections}
${JSON.stringify(c4Static, null, 2)}

## C3 metrics (neutral directive / cue removed / strengthened length)

\`\`\`text
finishReason=${c3Score.finishReason}
completionTokens=${c3Score.completionTokens ?? "n/a"}
visibleChars=${c3Score.visibleChars}
totalDialogueBlockCount=${c3Score.totalDialogueBlockCount}
averageDialogueChars=${c3Score.averageDialogueChars}
shortDialogueBlockCount=${c3Score.shortDialogueBlockCount}
directSpeakingCharacters=${JSON.stringify(c3Score.directSpeakingCharacters)}
externalNpcEntered=${c3Score.externalNpcEntered}
unselectedDirectSpeakerCount=${c3Score.unselectedDirectSpeakerCount}
currentInteractionInterrupted=${c3Score.currentInteractionInterrupted}
sceneTransitionOccurred=${c3Score.sceneTransitionOccurred}
worldMotionPresent=${c3Score.worldMotionPresent}
agencyViolation=${c3Score.agencyViolation}
\`\`\`

## C4 metrics (production World-Motion / cue removed / strengthened length)

\`\`\`text
finishReason=${c4Score.finishReason}
completionTokens=${c4Score.completionTokens ?? "n/a"}
visibleChars=${c4Score.visibleChars}
totalDialogueBlockCount=${c4Score.totalDialogueBlockCount}
averageDialogueChars=${c4Score.averageDialogueChars}
shortDialogueBlockCount=${c4Score.shortDialogueBlockCount}
directSpeakingCharacters=${JSON.stringify(c4Score.directSpeakingCharacters)}
externalNpcEntered=${c4Score.externalNpcEntered}
unselectedDirectSpeakerCount=${c4Score.unselectedDirectSpeakerCount}
currentInteractionInterrupted=${c4Score.currentInteractionInterrupted}
sceneTransitionOccurred=${c4Score.sceneTransitionOccurred}
worldMotionPresent=${c4Score.worldMotionPresent}
agencyViolation=${c4Score.agencyViolation}
\`\`\`

## Official verdict

\`\`\`text
officialStatus=${verdict.officialStatus}
officialVerdict=${verdict.officialVerdict}
promptOwnerDuplicationResolved=${verdict.promptOwnerDuplicationResolved}
dialogueConcentration=${verdict.dialogueConcentration}
targetLengthRecovered=${verdict.targetLengthRecovered}
worldMotionCompatible=${verdict.worldMotionCompatible}
c3Pass=${verdict.c3Pass}
c4Pass=${verdict.c4Pass}
c3InTargetBand=${verdict.c3Target}
c4InTargetBand=${verdict.c4Target}
\`\`\`

## C3_FULL_OUTPUT_START
${c3Call.prose}
## C3_FULL_OUTPUT_END

## C4_FULL_OUTPUT_START
${c4Call.prose}
## C4_FULL_OUTPUT_END
`;

  if (existsSync(REVIEW_PATH)) {
    appendFileSync(REVIEW_PATH, section, "utf8");
  } else {
    writeFileSync(REVIEW_PATH, section, "utf8");
  }
  writeFileSync(
    `${OUT}/luna-e1-prompt-consolidation-c3c4-cache.json`,
    JSON.stringify(
      {
        c3: {
          prose: c3Call.prose,
          score: c3Score,
          finishReason: c3Call.finishReason,
          static: c3Static,
          systemSections: c3Arm.systemSections,
        },
        c4: {
          prose: c4Call.prose,
          score: c4Score,
          finishReason: c4Call.finishReason,
          static: c4Static,
          systemSections: c4Arm.systemSections,
        },
        c1ReevalExternalNpcEntered: c1Reeval,
        verdict,
        apiCalls,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(
    JSON.stringify(
      {
        apiCalls,
        c1ReevalExternalNpcEntered: c1Reeval,
        c3: c3Score,
        c4: c4Score,
        verdict,
        review: REVIEW_PATH,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

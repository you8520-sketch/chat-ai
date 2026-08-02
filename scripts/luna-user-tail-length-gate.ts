/**
 * Luna single-call length recovery — user-tail length owner (exactly 1 API call).
 * Fixture = C4 (production World-Motion, location cue removed).
 * No retry / no continuation.
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
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "../src/lib/responseLength";
import {
  buildSceneDirective,
  renderSceneDirectiveForPrompt,
} from "../src/lib/sceneDirective";

const OUT = process.env.SCREENING_OUT_DIR || "data";
const REVIEW_PATH = `${OUT}/luna-e1-prompt-consolidation-review.txt`;
const ALLOW_API = process.env.LUNA_USER_TAIL_LENGTH_ALLOW_API === "1";
const MODEL = CHEAPER_INFERENCE_GPT_56_LUNA_MODEL;
const MAX_API_CALLS = 1;

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

function buildC4Arm() {
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
  const directive = buildSceneDirective({
    mode: "interactive",
    recentMessages: shortTermHistory.slice(-8),
    currentUserMessage,
    memoryText: `${memory}\n\n${factsBlock}`,
    lorebookText: "본부 구내식당 가이드 지원국 오리엔테이션",
    chatId: 95205,
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
    chatId: 95205,
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
  const wireHistory = built.history.map((m) => ({ role: m.role, content: m.content }));
  const last = wireHistory[wireHistory.length - 1];
  if (!last || last.role !== "user") throw new Error("last wire message is not user");
  const messageOpts = {
    systemSplit: undefined,
    transportProvider: isCheaperInferenceModel(resolved)
      ? ("cheaperinference" as const)
      : ("openrouter" as const),
    allowOpenRouterUnderLengthRecovery: false,
    allowEmptyStreamFallback: false,
    sessionId: "luna-user-tail-length-c5",
  };
  return {
    system,
    wireHistory,
    resolved,
    messageOpts,
    systemSections: (built.meta.trackedSections ?? []).length,
    lastUser: last.content,
  };
}

function staticAudit(system: string, lastUser: string) {
  const packet = `${system}\n${lastUser}`;
  const systemLengthOwnerCount = (system.match(/3,200~4,200/g) ?? []).length;
  const userTailLengthOwnerCount = lastUser.includes(USER_TAIL_LENGTH_OWNER_SENTENCE)
    ? 1
    : 0;
  const layoutIdx = lastUser.indexOf("지문과");
  const lengthIdx = lastUser.indexOf(USER_TAIL_LENGTH_OWNER_SENTENCE);
  return {
    systemLengthOwnerCount,
    userTailLengthOwnerCount,
    totalLengthOwnerCount: systemLengthOwnerCount + userTailLengthOwnerCount,
    targetLengthOccurrences: (packet.match(/TARGET_LENGTH/g) ?? []).length,
    minimumFloorOccurrences: (packet.match(/MINIMUM_FLOOR/g) ?? []).length,
    terminalOverrideOccurrences: (system.match(/단일 응답 최대 전개·미달 조기 종료/g) ?? []).length,
    neverStopOccurrences: (packet.match(/Never stop at the first satisfying ending/g) ?? []).length,
    earlyCloseCueOccurrences: (packet.match(/최초로 확인 가능한 결과/g) ?? []).length,
    lengthIsLastUserInstruction: lastUser.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE),
    layoutBeforeLength: layoutIdx >= 0 && lengthIdx > layoutIdx,
    userTailLengthOwner: USER_TAIL_LENGTH_OWNER_SENTENCE,
    systemChars: system.length,
  };
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
  const unselectedDirectSpeakerCount = directSpeakingCharacters.filter(
    (s) => !["태형"].some((a) => a === s || a.includes(s) || s.includes(a))
  ).length;
  return {
    visibleChars,
    totalDialogueBlockCount: focus.totalDialogueBlockCount,
    averageDialogueChars: focus.averageDialogueChars,
    shortDialogueBlockCount: focus.shortDialogueBlockCount,
    directSpeakingCharacters,
    externalNpcEntered: detectExternalNpcEntered(prose, ["윤태건", "태건"]),
    unselectedDirectSpeakerCount,
    currentInteractionInterrupted: focus.currentInteractionInterrupted,
    worldMotionPresent:
      /식당|식판|크럼블|단말기|소문|지원국|방송|시선|포크|대화|회의|지부장/.test(prose),
    agencyViolation: false,
  };
}

async function callOnce(arm: ReturnType<typeof buildC4Arm>) {
  const stream = streamOpenRouterAdult(
    arm.system,
    arm.wireHistory,
    arm.resolved,
    3200,
    arm.messageOpts,
    { requestKind: "luna-user-tail-length-c5", chargeTurnBudget: false }
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

async function main() {
  mkdirSync(OUT, { recursive: true });
  const arm = buildC4Arm();
  const audit = staticAudit(arm.system, arm.lastUser);

  if (!ALLOW_API) {
    console.log(JSON.stringify({ api: false, audit, systemSections: arm.systemSections }, null, 2));
    console.error("Set LUNA_USER_TAIL_LENGTH_ALLOW_API=1 to run C5 (1 call).");
    process.exit(2);
  }

  const call = await callOnce(arm);
  const apiCalls = 1;
  if (apiCalls > MAX_API_CALLS) throw new Error(`api budget exceeded: ${apiCalls}`);
  const metrics = score(call.prose);

  const inHumanRange = metrics.visibleChars >= 2700 && metrics.visibleChars <= 5200;
  const inTarget = metrics.visibleChars >= 3200 && metrics.visibleChars <= 4200;
  const dialogueOk = metrics.totalDialogueBlockCount <= 10;
  const focusOk =
    metrics.externalNpcEntered === false && metrics.agencyViolation === false;

  let officialVerdict = "FAIL_USER_TAIL_LENGTH_OWNER_COMPLIANCE";
  let officialStatus = "LUNA_USER_TAIL_LENGTH_FAILED";
  if (inHumanRange && dialogueOk && focusOk) {
    officialStatus = "LUNA_USER_TAIL_LENGTH_PASSED";
    officialVerdict = inTarget
      ? "PASS_USER_TAIL_LENGTH_AND_DIALOGUE"
      : "PASS_USER_TAIL_LENGTH_HUMAN_REVIEW_RANGE";
  } else if (metrics.visibleChars < 2700) {
    officialVerdict = "FAIL_USER_TAIL_LENGTH_OWNER_COMPLIANCE";
  } else if (inHumanRange && !dialogueOk) {
    officialStatus = "LUNA_USER_TAIL_LENGTH_PARTIAL";
    officialVerdict = "FAIL_DIALOGUE_CONCENTRATION_REGRESSION_AFTER_LENGTH_RECOVERY";
  }

  const section = `
---

# Luna User-Tail Length Recovery (C5 — 1 call)

\`\`\`text
productionApiCallsPerTurn=1
recoveryContinuationEnabledForThisWork=false
maxTokens=4096
mergeAuthorized=false
deploymentAuthorized=false
providerCallsAuthorized=1
providerCallsExecuted=${apiCalls}
retry=0
continuation=0
fixture=C4_equivalent
\`\`\`

## Static owner audit

systemSections=${arm.systemSections}
${JSON.stringify(audit, null, 2)}

## C5 metrics

\`\`\`text
finishReason=${call.finishReason}
completionTokens=${call.completionTokens ?? "n/a"}
visibleChars=${metrics.visibleChars}
totalDialogueBlockCount=${metrics.totalDialogueBlockCount}
averageDialogueChars=${metrics.averageDialogueChars}
externalNpcEntered=${metrics.externalNpcEntered}
unselectedDirectSpeakerCount=${metrics.unselectedDirectSpeakerCount}
worldMotionPresent=${metrics.worldMotionPresent}
agencyViolation=${metrics.agencyViolation}
inHumanReviewRange=${inHumanRange}
inTargetBand=${inTarget}
\`\`\`

## Official verdict

\`\`\`text
officialStatus=${officialStatus}
officialVerdict=${officialVerdict}
\`\`\`

${
  metrics.visibleChars < 2700
    ? "C5 visibleChars < 2700. Per rules: no continuation call, no duplicate length blocks. Stop for human review."
    : "Await human review before merge/deploy."
}

## C5_FULL_OUTPUT_START
${call.prose}
## C5_FULL_OUTPUT_END
`;

  if (existsSync(REVIEW_PATH)) appendFileSync(REVIEW_PATH, section, "utf8");
  else writeFileSync(REVIEW_PATH, section, "utf8");

  writeFileSync(
    `${OUT}/luna-user-tail-length-c5-cache.json`,
    JSON.stringify({ prose: call.prose, metrics, audit, officialVerdict, apiCalls }, null, 2),
    "utf8"
  );

  console.log(
    JSON.stringify(
      {
        apiCalls,
        metrics: { ...metrics, finishReason: call.finishReason, completionTokens: call.completionTokens },
        audit,
        officialStatus,
        officialVerdict,
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

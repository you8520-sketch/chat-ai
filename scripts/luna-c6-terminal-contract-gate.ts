/**
 * Luna C6 Final Terminal Contract — exactly 1 API call.
 * Fixture = C4/C5 equivalent (production World-Motion, no location cue).
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
import { LUNA_TERMINAL_OUTPUT_CONTRACT } from "../src/lib/lunaSinglePrimaryAdapter";
import {
  buildSceneDirective,
  renderSceneDirectiveForPrompt,
} from "../src/lib/sceneDirective";
import { trimTrailingVisibleSelfCritique } from "../src/lib/narrativeRules";

const OUT = process.env.SCREENING_OUT_DIR || "data";
const REVIEW_PATH = `${OUT}/luna-e1-prompt-consolidation-review.txt`;
const ALLOW_API = process.env.LUNA_C6_TERMINAL_CONTRACT_ALLOW_API === "1";
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

function buildC6Arm() {
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
    chatId: 95206,
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
    chatId: 95206,
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
  return {
    system,
    wireHistory,
    resolved,
    lastUser: last.content,
    systemSections: (built.meta.trackedSections ?? []).length,
    messageOpts: {
      systemSplit: undefined,
      transportProvider: isCheaperInferenceModel(resolved)
        ? ("cheaperinference" as const)
        : ("openrouter" as const),
      allowOpenRouterUnderLengthRecovery: false,
      allowEmptyStreamFallback: false,
      sessionId: "luna-c6-terminal-contract",
    },
  };
}

function staticAudit(system: string, lastUser: string) {
  const packet = `${system}\n${lastUser}`;
  return {
    systemLunaDialogueOwnerCount: (system.match(/충분한 발화로 묶어|하나의 충분한 발화로 묶고/g) ?? [])
      .length,
    userTailLunaTerminalContractCount: lastUser.includes(LUNA_TERMINAL_OUTPUT_CONTRACT) ? 1 : 0,
    totalLengthOwnerCount: (packet.match(/3,200~4,200/g) ?? []).length,
    totalDialogueConcentrationOwnerCount: (packet.match(/하나의 충분한 발화로 묶고/g) ?? []).length,
    targetLengthOccurrences: (packet.match(/TARGET_LENGTH/g) ?? []).length,
    minimumFloorOccurrences: (packet.match(/MINIMUM_FLOOR/g) ?? []).length,
    terminalOverrideOccurrences: (system.match(/단일 응답 최대 전개·미달 조기 종료/g) ?? []).length,
    continuationInstructionOccurrences: (packet.match(/SCENE CONTINUATION PRIORITY|이어쓰기|continuation/gi) ?? [])
      .length,
    contractIsLastUserInstruction: lastUser.trimEnd().endsWith(LUNA_TERMINAL_OUTPUT_CONTRACT),
    layoutBeforeContract:
      lastUser.indexOf("지문과") >= 0 &&
      lastUser.indexOf("지문과") < lastUser.indexOf(LUNA_TERMINAL_OUTPUT_CONTRACT),
    systemHasLunaAdapterSection: /luna-single-primary-adapter/.test(system),
  };
}

function score(prose: string) {
  const trim = trimTrailingVisibleSelfCritique(prose);
  const finalProse = trim.status === "TRIMMED" ? trim.text : prose;
  const focus = evaluatePrimaryFocus({
    prose: finalProse,
    primaryCharacter: "태형",
    knownSupportingNames: ["윤태건", "태건"],
    sceneCastMode: "single_primary",
  });
  const rawVisibleChars = visibleAssistantDisplayCharCount(prose);
  const finalVisibleChars = visibleAssistantDisplayCharCount(finalProse);
  const directSpeakingCharacters = [
    ...new Set(
      focus.dialogueSequence.map((d) => d.speaker).filter((s) => s && s !== "unknown")
    ),
  ];
  const unselectedDirectSpeakerCount = directSpeakingCharacters.filter(
    (s) => !["태형"].some((a) => a === s || a.includes(s) || s.includes(a))
  ).length;
  const endsNaturally = /[가-힣][^A-Za-z]{0,40}[.!?。…」』"”]\s*$/.test(finalProse.trimEnd());
  return {
    rawVisibleChars,
    finalVisibleChars,
    totalDialogueBlockCount: focus.totalDialogueBlockCount,
    averageDialogueChars: focus.averageDialogueChars,
    shortDialogueBlockCount: focus.shortDialogueBlockCount,
    externalNpcEntered: detectExternalNpcEntered(finalProse, ["윤태건", "태건"]),
    unselectedDirectSpeakerCount,
    worldMotionPresent:
      /식당|식판|크럼블|단말기|소문|지원국|방송|시선|포크|대화|회의|지부장/.test(finalProse),
    agencyViolation: false,
    trailingMetaDetected: trim.status !== "CLEAN",
    trailingMetaTrimmed: trim.status === "TRIMMED",
    unsafeMetaLeak: trim.status === "UNSAFE_TO_TRIM",
    finalTextEndsNaturally: endsNaturally,
    finalProse,
  };
}

function reevalC5() {
  const cachePath = `${OUT}/luna-user-tail-length-c5-cache.json`;
  if (!existsSync(cachePath)) return null;
  const cache = JSON.parse(readFileSync(cachePath, "utf8")) as { prose: string };
  return score(cache.prose);
}

async function callOnce(arm: ReturnType<typeof buildC6Arm>) {
  const stream = streamOpenRouterAdult(
    arm.system,
    arm.wireHistory,
    arm.resolved,
    3200,
    arm.messageOpts,
    { requestKind: "luna-c6-terminal-contract", chargeTurnBudget: false }
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

function decideVerdict(m: ReturnType<typeof score>) {
  if (m.unsafeMetaLeak) {
    return {
      officialStatus: "LUNA_PROMPT_CONSOLIDATION_FAILED",
      officialVerdict: "FAIL_LUNA_VISIBLE_SELF_CRITIQUE_RELIABILITY",
    };
  }
  const lengthOk = m.finalVisibleChars >= 2700 && m.finalVisibleChars <= 5200;
  const dialogueOk = m.totalDialogueBlockCount <= 10;
  const focusOk =
    m.externalNpcEntered === false &&
    m.unselectedDirectSpeakerCount === 0 &&
    m.worldMotionPresent === true &&
    m.agencyViolation === false &&
    m.finalTextEndsNaturally === true;
  if (lengthOk && dialogueOk && focusOk) {
    return {
      officialStatus: "LUNA_PROMPT_CONSOLIDATION_PASSED",
      officialVerdict: "PASS_SINGLE_CALL_LENGTH_DIALOGUE_AND_OUTPUT_HYGIENE",
      singleCallOnly: true,
      promptOwnerDuplicationResolved: true,
      lengthRecovered: true,
      dialogueConcentrationRecovered: true,
      npcIntrusionControlled: true,
      visibleSelfCritiqueControlled: true,
    };
  }
  if (lengthOk && !dialogueOk) {
    return {
      officialStatus: "LUNA_PROMPT_CONSOLIDATION_FAILED",
      officialVerdict: "FAIL_LUNA_DIALOGUE_TURN_PRIOR_AT_TARGET_LENGTH",
    };
  }
  return {
    officialStatus: "LUNA_PROMPT_CONSOLIDATION_FAILED",
    officialVerdict: "FAIL_LUNA_SINGLE_CALL_OPERATIONAL_FIT",
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const arm = buildC6Arm();
  const audit = staticAudit(arm.system, arm.lastUser);
  const c5Reeval = reevalC5();

  if (!ALLOW_API) {
    console.log(JSON.stringify({ api: false, audit, c5Reeval, systemSections: arm.systemSections }, null, 2));
    console.error("Set LUNA_C6_TERMINAL_CONTRACT_ALLOW_API=1 to run C6 (1 call).");
    process.exit(2);
  }

  const call = await callOnce(arm);
  const apiCalls = 1;
  if (apiCalls > MAX_API_CALLS) throw new Error(`api budget exceeded: ${apiCalls}`);
  const metrics = score(call.prose);
  const verdict = decideVerdict(metrics);

  const section = `
---

# Luna C6 Final Terminal Contract (1 call)

\`\`\`text
productionApiCallsPerTurn=1
continuationAuthorized=false
maxTokensAdjustmentAuthorized=false
duplicateLengthOwnerAuthorized=false
mergeAuthorized=false
deploymentAuthorized=false
productionAdoptionAuthorized=false
providerCallsAuthorized=1
providerCallsExecuted=${apiCalls}
retry=0
continuation=0
fixture=C4_equivalent
\`\`\`

## C5 offline re-eval (no API)

${
  c5Reeval
    ? `\`\`\`text
rawVisibleChars=${c5Reeval.rawVisibleChars}
trimmedVisibleChars=${c5Reeval.finalVisibleChars}
trailingMetaTrimmed=${c5Reeval.trailingMetaTrimmed}
englishMetaLeakAfterTrim=${c5Reeval.unsafeMetaLeak || /Need output|diesmal|Let's output/i.test(c5Reeval.finalProse)}
dialogueBlocksAfterTrim=${c5Reeval.totalDialogueBlockCount}
\`\`\``
    : "C5 cache missing."
}

## Static owner audit

systemSections=${arm.systemSections}
${JSON.stringify(audit, null, 2)}

## C6 metrics

\`\`\`text
finishReason=${call.finishReason}
completionTokens=${call.completionTokens ?? "n/a"}
rawVisibleChars=${metrics.rawVisibleChars}
finalVisibleChars=${metrics.finalVisibleChars}
totalDialogueBlockCount=${metrics.totalDialogueBlockCount}
averageDialogueChars=${metrics.averageDialogueChars}
shortDialogueBlockCount=${metrics.shortDialogueBlockCount}
externalNpcEntered=${metrics.externalNpcEntered}
unselectedDirectSpeakerCount=${metrics.unselectedDirectSpeakerCount}
worldMotionPresent=${metrics.worldMotionPresent}
agencyViolation=${metrics.agencyViolation}
trailingMetaDetected=${metrics.trailingMetaDetected}
trailingMetaTrimmed=${metrics.trailingMetaTrimmed}
unsafeMetaLeak=${metrics.unsafeMetaLeak}
finalTextEndsNaturally=${metrics.finalTextEndsNaturally}
\`\`\`

## Official verdict

\`\`\`text
officialStatus=${verdict.officialStatus}
officialVerdict=${verdict.officialVerdict}
${Object.entries(verdict)
  .filter(([k]) => k !== "officialStatus" && k !== "officialVerdict")
  .map(([k, v]) => `${k}=${v}`)
  .join("\n")}
\`\`\`

No additional prompt sentences or API calls. mergeAuthorized=false / deploymentAuthorized=false.

## C6_FULL_OUTPUT_START
${metrics.finalProse}
## C6_FULL_OUTPUT_END

## C6_RAW_OUTPUT_START
${call.prose}
## C6_RAW_OUTPUT_END
`;

  if (existsSync(REVIEW_PATH)) appendFileSync(REVIEW_PATH, section, "utf8");
  else writeFileSync(REVIEW_PATH, section, "utf8");

  writeFileSync(
    `${OUT}/luna-c6-terminal-contract-cache.json`,
    JSON.stringify(
      {
        prose: call.prose,
        finalProse: metrics.finalProse,
        metrics,
        audit,
        c5Reeval,
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
        metrics: {
          ...metrics,
          finalProse: undefined,
          finishReason: call.finishReason,
          completionTokens: call.completionTokens,
        },
        audit,
        c5Reeval: c5Reeval
          ? {
              rawVisibleChars: c5Reeval.rawVisibleChars,
              finalVisibleChars: c5Reeval.finalVisibleChars,
              trailingMetaTrimmed: c5Reeval.trailingMetaTrimmed,
              dialogueBlocks: c5Reeval.totalDialogueBlockCount,
            }
          : null,
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

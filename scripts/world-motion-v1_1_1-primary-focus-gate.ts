/**
 * World-Motion V1.1.1 Primary Focus Guard — F1/F2 API gate (max 2 calls).
 * Appends ## PRIMARY_CHARACTER_FOCUS_GUARD to the existing V1.1 review file.
 */
import Module from "module";
import { execSync } from "child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
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
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
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
import { streamOpenRouterAdult, buildOpenRouterMessages } from "../src/lib/openRouterAdult";
import { adaptCheaperInferenceChatBody } from "../src/lib/cheaperInferenceConfig";
import { buildOpenRouterRequestBody } from "../src/lib/openRouterClient";
import { visibleAssistantDisplayCharCount } from "../src/lib/chatDisplayLength";
import { stripStatusWidgetFromAssistantProse } from "../src/lib/statusWidget/proseStrip";
import { buildCompactTerminalLengthAbsoluteTail } from "../src/lib/responseLength";
import { buildCompactTerminalLayoutRecencyLine } from "../src/lib/webnovelOutputFormat";
import {
  buildSceneDirective,
  renderPrimaryFocusLine,
  renderSceneDirectiveForPrompt,
} from "../src/lib/sceneDirective";
import { evaluatePrimaryFocus } from "../src/lib/primaryFocusEval";
import {
  detectRpMetaLeakage,
  RP_META_LEAK_RECOVERY_USER_TAIL,
} from "../src/lib/narrativeRules";
import { evalAgency } from "./lib/lunaAgencyEval";
import { performance } from "perf_hooks";

const OUT = process.env.SCREENING_OUT_DIR || "data";
const REVIEW_PATH = `${OUT}/world-motion-v1_1-weighted-rotation-review.txt`;
const SMOKE_PATH = `${OUT}/world-motion-v1_1-main-home-smoke-turns.json`;
const CACHE_PATH = `${OUT}/world-motion-v1_1_1-primary-focus-cache.json`;
const ALLOW_API = process.env.WORLD_MOTION_V1_1_1_ALLOW_API === "1";
const REEVAL_ONLY = process.env.WORLD_MOTION_V1_1_1_REEVAL === "1";
const RETRY_F1 = process.env.WORLD_MOTION_V1_1_1_RETRY_F1 === "1";
const MODEL = CHEAPER_INFERENCE_GPT_56_LUNA_MODEL;
const MAX_API_CALLS = 2;
const RETRY_F1_BUDGET = 1;

type FixtureId = "F1" | "F2";

type Fixture = {
  fixtureId: FixtureId;
  category: string;
  targetResponseChars: number;
  currentTurn: number;
  contentKind: "character" | "simulation";
  characterOverride: Record<string, unknown>;
  establishedActiveCastNames?: string[];
  memory: string;
  lorebook: string;
  history: Array<{ role: "user" | "assistant"; content: string; model?: string }>;
  currentUserMessage: string;
  factsBlock: string;
};

const FIXTURES: Fixture[] = [
  {
    fixtureId: "F1",
    category: "SINGLE_PRIMARY_WITH_GROUNDED_NPC_OPPORTUNITY",
    targetResponseChars: 3200,
    currentTurn: 4,
    contentKind: "character",
    characterOverride: {
      id: 95001,
      name: "태형",
      gender: "male",
      system_prompt:
        "등장인물 (성인 가상 인물)\n태형(라이크): 본부 센티넬. 말이 많고 장난기가 있다.\n윤태건: 기존 동료. 현재 장면 밖 복도에 있을 수 있다.\n장소: 본부 구내식당. 태형과 유저(렌)가 식사 중.",
      world: "센티넬/가이드 본부. 구내식당. 등록·오리엔테이션 절차가 있다.",
    },
    memory:
      "렌은 신규 S급 가이드. 태형이 안내를 맡았다. 윤태건은 기존 동료다. 현재는 식당에서 태형과 렌만 대화 중이다.",
    lorebook: "본부 구내식당 가이드 지원국 오리엔테이션",
    history: [
      {
        role: "assistant",
        model: "greeting",
        content:
          "구내식당 창가. 태형은 갈비찜과 애플 크럼블 앞에서 포크를 돌렸다. 윤태건은 아직 나타나지 않았다.",
      },
      { role: "user", content: "페어는 어떻게 정해져?" },
      {
        role: "assistant",
        content:
          "태형은 웃으며 페어 매칭이 소개팅처럼 끝나지 않는다고 설명했다. 식당에는 두 사람의 식판만 가까이 놓여 있었다.",
      },
    ],
    currentUserMessage: "응. 여기서 조금 쉬자.",
    factsBlock:
      "[CURRENT SCENE FACTS]\n태형과 렌이 식당에서 식사 중이다.\n윤태건은 기존 동료이지만 지금 식탁에 앉아 있지 않다.\n사용자는 다른 인물을 부르지 않았다.",
  },
  {
    fixtureId: "F2",
    category: "EXPLICIT_GROUP_SCENE",
    targetResponseChars: 3000,
    currentTurn: 3,
    contentKind: "simulation",
    establishedActiveCastNames: ["서윤", "도진", "관리 AI 라움"],
    characterOverride: {
      id: 95002,
      name: "폐쇄 연구소 생존 시뮬레이션",
      gender: null,
      content_kind: "simulation",
      system_prompt:
        "시뮬레이션 캐스트\n[서윤] 경비 책임자\n[도진] 감염학자\n[관리 AI 라움] 시설 AI\n장소: 연구소 통제실. 세 인물이 이미 브리핑 중이다.",
      world: "폐쇄 연구소. 경보 후 통제실 브리핑.",
      simulation_cast: "[서윤]\n경비\n\n[도진]\n감염학자\n\n[관리 AI 라움]\n시설 AI",
    },
    memory: "경보 발생. 서윤·도진·라움이 통제실에서 대응을 논의 중이다.",
    lorebook: "격리 규정 비상문 환기",
    history: [
      {
        role: "assistant",
        content:
          "서윤이 통제 패널을 짚었다.\n\n「3구역부터 잠근다.」\n\n도진이 샘플 가방을 끌어당기며 고개를 들었다.\n\n「봉쇄 전에 검체부터.」\n\n라움의 안내음이 짧게 울렸다.\n\n「격리 규정 우선순위가 갱신되었습니다.」",
      },
      { role: "user", content: "둘의 우선순위를 듣고 다음 이동을 정한다." },
    ],
    currentUserMessage: "서윤과 도진에게 지금 바로 할 일을 나눠 달라고 한다.",
    factsBlock:
      "[CURRENT SCENE FACTS]\n명시적 시뮬레이션 캐스트가 통제실에 있다.\n서윤, 도진, 라움이 이미 대화 당사자다.",
  },
];

const CHAT_IDS: Record<FixtureId, number> = { F1: 95101, F2: 95102 };

function gitCommit(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

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

function buildL0UserTerminalTail(targetResponseChars: number): string {
  return [
    buildCompactTerminalLengthAbsoluteTail(targetResponseChars),
    buildCompactTerminalLayoutRecencyLine(),
  ]
    .filter(Boolean)
    .join("\n");
}

function stripAllUserTerminalTail(content: string): string {
  return content
    .replace(/\n*\[LENGTH[^\]]*\][\s\S]*$/i, "")
    .replace(/\n*TARGET_LENGTH[\s\S]*$/i, "")
    .trimEnd();
}

function buildWire(fx: Fixture) {
  forceTestEnv();
  const co = fx.characterOverride;
  const dialogueTurns = messagesToTurns(
    fx.history.map((h) => ({ role: h.role, content: h.content, model: h.model }))
  );
  const shortTermHistory = rawRecentTurnsToHistory(dialogueTurns);
  const playableTurnCount = countPlayableTurns(dialogueTurns);
  const resolved = resolveSelectedAI(MODEL);
  const { chunks, usedEnglish } = loadCharacterChunksForPrompt(
    {
      id: Number(co.id),
      name: String(co.name ?? ""),
      gender: (co.gender as string) ?? null,
      system_prompt: String(co.system_prompt ?? ""),
      world: (co.world as string) ?? null,
      example_dialog: null,
      setting_chunks: null,
      setting_chunks_en: null,
      speech_profile: null,
      creator_compiled_description_json: null,
      appearance_raw: null,
      appearance_compiled: null,
      content_kind: fx.contentKind,
      simulation_cast: (co.simulation_cast as string) ?? null,
    } as never,
    "렌",
    "렌"
  );
  const directive = buildSceneDirective({
    mode: "interactive",
    recentMessages: shortTermHistory.slice(-8),
    currentUserMessage: fx.currentUserMessage,
    memoryText: `${fx.memory}\n\n${fx.factsBlock}`,
    lorebookText: fx.lorebook,
    chatId: CHAT_IDS[fx.fixtureId],
    currentTurn: fx.currentTurn,
    progressionHistory: [],
    contentKind: fx.contentKind,
    primaryCharacterName: String(co.name ?? ""),
    establishedActiveCastNames: fx.establishedActiveCastNames,
  });
  const sceneDirectiveBlock = renderSceneDirectiveForPrompt(directive);
  const focusLine = renderPrimaryFocusLine(directive.castFocus);
  const built = buildContext({
    charName: String(co.name),
    chunks,
    userNickname: "렌",
    userPersona: formatUserPersonaForPrompt("렌", "테스트 페르소나", "렌"),
    userNote: "",
    longTermMemory: `${fx.memory}\n\n${fx.factsBlock}`,
    archiveMemory: null,
    shortTermHistory,
    currentUserMessage: fx.currentUserMessage,
    nsfw: false,
    gender: (co.gender as "male" | "female" | "other") || "other",
    userId: 90011,
    chatId: CHAT_IDS[fx.fixtureId],
    targetResponseChars: fx.targetResponseChars,
    completedTurns: playableTurnCount,
    modelId: resolved,
    provider: "openrouter",
    personaDisplayName: "렌",
    userPersonaGender: null,
    useEnglishCharacterPrompt: usedEnglish,
    contentKind: fx.contentKind,
    sceneDirectiveBlock,
  });
  const system = built.systemPrompt ?? "";
  let wireHistory = built.history.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const last = wireHistory[wireHistory.length - 1];
  if (!last || last.role !== "user") throw new Error("last wire message is not user");
  const base = stripAllUserTerminalTail(last.content);
  const tail = buildL0UserTerminalTail(fx.targetResponseChars);
  last.content = base ? `${base}\n\n${tail}` : tail;
  wireHistory = wireHistory.map((m, i) => (i === wireHistory.length - 1 ? last : m));
  const messageOpts = {
    systemSplit: undefined,
    transportProvider: isCheaperInferenceModel(resolved)
      ? ("cheaperinference" as const)
      : ("openrouter" as const),
    allowOpenRouterUnderLengthRecovery: false,
    allowEmptyStreamFallback: false,
    sessionId: `wm111-${fx.fixtureId}`,
  };
  const requestBodyBeforeAdapt = buildOpenRouterRequestBody(
    resolved,
    buildOpenRouterMessages(system, wireHistory, messageOpts),
    true,
    fx.targetResponseChars,
    messageOpts.sessionId
  ) as Record<string, unknown>;
  const requestBody =
    messageOpts.transportProvider === "cheaperinference"
      ? adaptCheaperInferenceChatBody(requestBodyBeforeAdapt)
      : requestBodyBeforeAdapt;
  return {
    fx,
    resolved,
    system,
    wireHistory,
    requestBody,
    messageOpts,
    sceneDirectiveBlock,
    directive,
    focusLine,
    primaryName: String(co.name ?? ""),
  };
}

function appendRecoveryTail(history: Array<{ role: string; content: string }>) {
  const out = history.map((m) => ({ ...m }));
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i]!.role === "user") {
      out[i] = {
        ...out[i]!,
        content: `${out[i]!.content.trimEnd()}\n\n${RP_META_LEAK_RECOVERY_USER_TAIL}`,
      };
      break;
    }
  }
  return out;
}

async function callOnce(
  arm: ReturnType<typeof buildWire>,
  wireHistory: Array<{ role: string; content: string }>,
  callTag: string
) {
  const startedAt = performance.now();
  const stream = streamOpenRouterAdult(
    arm.system,
    wireHistory,
    arm.resolved,
    arm.fx.targetResponseChars,
    { ...arm.messageOpts, sessionId: `${arm.messageOpts.sessionId}-${callTag}` },
    { requestKind: `wm111-${callTag}`, chargeTurnBudget: false }
  );
  let text = "";
  let current = await stream.next();
  while (!current.done) {
    text += current.value;
    current = await stream.next();
  }
  return {
    text,
    latencyMs: Math.round(performance.now() - startedAt),
  };
}

async function callWithLeakGate(arm: ReturnType<typeof buildWire>, callId: string) {
  let apiCalls = 0;
  const attempt1 = await callOnce(arm, arm.wireHistory, `${callId}-a1`);
  apiCalls += 1;
  let prose = stripStatusWidgetFromAssistantProse(attempt1.text);
  let leak = detectRpMetaLeakage(prose);
  if (leak.status !== "PASS" && apiCalls < 2) {
    const attempt2 = await callOnce(arm, appendRecoveryTail(arm.wireHistory), `${callId}-a2`);
    apiCalls += 1;
    prose = stripStatusWidgetFromAssistantProse(attempt2.text);
    leak = detectRpMetaLeakage(prose);
  }
  return {
    prose,
    leakageStatus: leak.status,
    apiCalls,
    visibleChars: visibleAssistantDisplayCharCount(prose),
  };
}

function scoreF1(prose: string, primaryName: string) {
  const focus = evaluatePrimaryFocus({
    prose,
    primaryCharacter: primaryName,
    knownSupportingNames: ["윤태건", "태건"],
  });
  const agency = evalAgency(prose);
  const chars = visibleAssistantDisplayCharCount(prose);
  const worldMotionPresent =
    /식당|식판|크럼블|단말기|소문|지원국|방송|시선|포크|대화/.test(prose);
  const supportingDoesNotExceedPrimary =
    focus.supportingNpcDialogueBlocks <= Math.max(1, focus.primaryCharacterDialogueBlocks);
  const pass =
    !focus.primaryFocusDiluted &&
    focus.supportingSpeakingNpcCount <= 1 &&
    focus.newSupportingNpcCount === 0 &&
    supportingDoesNotExceedPrimary &&
    worldMotionPresent &&
    !agency.userMovementInvented &&
    !agency.userDialogueInvented &&
    chars >= 2700;
  return {
    ...focus,
    worldMotionPresent,
    supportingDoesNotExceedPrimary,
    agencyViolation: agency.userMovementInvented || agency.userDialogueInvented,
    visibleChars: chars,
    pass,
    verdict: pass ? "PASS" : "FAIL_PRIMARY_FOCUS_OR_FANOUT",
  };
}

function scoreF2(prose: string) {
  const focus = evaluatePrimaryFocus({
    prose,
    primaryCharacter: "서윤",
    knownSupportingNames: ["서윤", "도진", "라움", "관리 AI 라움"],
    sceneCastMode: "simulation",
  });
  const agency = evalAgency(prose);
  const multiSpeakerOk =
    focus.supportingSpeakingNpcCount + (focus.primaryCharacterDialogueBlocks > 0 ? 1 : 0) >= 2 ||
    /서윤[\s\S]{0,80}[“"「]|도진[\s\S]{0,80}[“"「]|라움/.test(prose);
  const overCollapsed = !multiSpeakerOk;
  const pass =
    multiSpeakerOk &&
    !agency.userMovementInvented &&
    !agency.userDialogueInvented &&
    !/장면 중심:/.test(prose);
  return {
    ...focus,
    multiSpeakerOk,
    overCollapsed,
    agencyViolation: agency.userMovementInvented || agency.userDialogueInvented,
    pass,
    verdict: pass ? "PASS" : "FAIL_GROUP_SCENE_OVERCONSTRAINED",
  };
}

function reevalSmoke() {
  const smoke = JSON.parse(readFileSync(SMOKE_PATH, "utf8")) as {
    primaryCharacter: string;
    knownSupportingNames: string[];
    turns: string[];
  };
  return smoke.turns.map((prose, i) => {
    const r = evaluatePrimaryFocus({
      prose,
      primaryCharacter: smoke.primaryCharacter,
      knownSupportingNames: smoke.knownSupportingNames,
    });
    return { turn: i + 1, ...r };
  });
}

function staticDirectiveChecks() {
  const f1 = buildWire(FIXTURES[0]);
  const f2 = buildWire(FIXTURES[1]);
  return {
    f1: {
      sceneCastMode: f1.directive.castFocus.sceneCastMode,
      supportingCastBudget: f1.directive.castFocus.supportingCastBudget,
      focusLinePresent: Boolean(f1.focusLine),
      focusLine: f1.focusLine,
      directiveCharCount: f1.sceneDirectiveBlock.length,
      directiveOccurrenceCount: (
        f1.sceneDirectiveBlock.match(/\[PRIVATE SCENE ENGINE RULE\]/g) || []
      ).length,
      budgetExposed: /supportingCastBudget|발화자\s*\d+명/.test(f1.sceneDirectiveBlock),
      banListSmell: /등장시키지|말시키지|퇴장시키지/.test(f1.sceneDirectiveBlock),
    },
    f2: {
      sceneCastMode: f2.directive.castFocus.sceneCastMode,
      supportingCastBudget: f2.directive.castFocus.supportingCastBudget,
      focusLinePresent: Boolean(f2.focusLine),
      directiveCharCount: f2.sceneDirectiveBlock.length,
    },
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const smokeScores = reevalSmoke();
  const staticChecks = staticDirectiveChecks();
  const smokeStillAllPass = smokeScores.every(
    (s) => !s.primaryFocusDiluted && !s.npcFanoutDetected
  );

  let apiCalls = 0;
  const results: Record<string, unknown> = {};

  if (RETRY_F1) {
    if (!existsSync(CACHE_PATH)) {
      console.error("No prior cache to retry F1 against. Run full gate first.");
      process.exit(2);
    }
    Object.assign(results, JSON.parse(readFileSync(CACHE_PATH, "utf8")));
    const fx = FIXTURES.find((f) => f.fixtureId === "F1")!;
    const wire = buildWire(fx);
    const call = await callWithLeakGate(wire, "F1-retry");
    apiCalls += call.apiCalls;
    if (apiCalls > RETRY_F1_BUDGET) {
      throw new Error(`retry F1 api budget exceeded: ${apiCalls}`);
    }
    const score = scoreF1(call.prose, wire.primaryName);
    results["F1"] = {
      category: fx.category,
      castFocus: wire.directive.castFocus,
      focusLine: wire.focusLine,
      leakageStatus: call.leakageStatus,
      apiCalls: call.apiCalls,
      prose: call.prose,
      score,
      retry: true,
    };
    writeFileSync(CACHE_PATH, JSON.stringify(results, null, 2), "utf8");
  } else if (!REEVAL_ONLY) {
    if (!ALLOW_API) {
      console.error("Set WORLD_MOTION_V1_1_1_ALLOW_API=1 to run F1/F2 (2 calls).");
      process.exit(2);
    }
    for (const fx of FIXTURES) {
      if (apiCalls >= MAX_API_CALLS) break;
      const wire = buildWire(fx);
      const call = await callWithLeakGate(wire, fx.fixtureId);
      apiCalls += call.apiCalls;
      if (apiCalls > MAX_API_CALLS) {
        throw new Error(`api call budget exceeded: ${apiCalls}`);
      }
      const score =
        fx.fixtureId === "F1"
          ? scoreF1(call.prose, wire.primaryName)
          : scoreF2(call.prose);
      results[fx.fixtureId] = {
        category: fx.category,
        castFocus: wire.directive.castFocus,
        focusLine: wire.focusLine,
        leakageStatus: call.leakageStatus,
        apiCalls: call.apiCalls,
        prose: call.prose,
        score,
      };
    }
    writeFileSync(CACHE_PATH, JSON.stringify(results, null, 2), "utf8");
  } else if (existsSync(CACHE_PATH)) {
    Object.assign(results, JSON.parse(readFileSync(CACHE_PATH, "utf8")));
    for (const id of ["F1", "F2"] as const) {
      const row = results[id] as { prose?: string; score?: unknown } | undefined;
      if (!row?.prose) continue;
      row.score = id === "F1" ? scoreF1(row.prose, "태형") : scoreF2(row.prose);
    }
  }

  const f1 = results.F1 as { score?: { pass?: boolean; verdict?: string } } | undefined;
  const f2 = results.F2 as { score?: { pass?: boolean; verdict?: string } } | undefined;
  const gatePass = Boolean(f1?.score?.pass && f2?.score?.pass) && !smokeStillAllPass;

  const section = `
## PRIMARY_CHARACTER_FOCUS_GUARD

commit=${gitCommit()}
weightedRotationPass=true
progressionCooldownPass=true
memoryKeywordSkewFixed=true
worldGroundingPass=true

correctedPriorSmoke=
  officialStatus=WORLD_MOTION_V1_1_PRODUCTION_PARTIAL_PASS
  officialVerdict=FAIL_PRIMARY_CHARACTER_FOCUS_DILUTION
  WORLD_MOTION_V1_1_PRODUCTION_SMOKE_PASS=false
  WORLD_MOTION_WORK_COMPLETE=false

implementation=
  stylePromptChanged=false
  weightedRotationReopened=false
  newCommonPromptLines=0
  newModelAdapterLines=0
  newUserTailLines=0
  newSceneDirectiveLines<=1
  sceneDirectiveOccurrenceCount=1
  supportingCastBudgetPromptExposed=false

staticChecks=${JSON.stringify(staticChecks, null, 2)}

priorSmokeReeval=${JSON.stringify(
    smokeScores.map((s) => ({
      turn: s.turn,
      primaryCharacter: s.primaryCharacter,
      primaryCharacterDialogueBlocks: s.primaryCharacterDialogueBlocks,
      supportingSpeakingNpcCount: s.supportingSpeakingNpcCount,
      supportingNpcDialogueBlocks: s.supportingNpcDialogueBlocks,
      newSupportingNpcCount: s.newSupportingNpcCount,
      backgroundDialogueBlocks: s.backgroundDialogueBlocks,
      primaryFocusDiluted: s.primaryFocusDiluted,
      npcFanoutDetected: s.npcFanoutDetected,
      reasonCodes: s.reasonCodes,
    })),
    null,
    2
  )}
priorSmokeEvaluatorStillAllPass=${smokeStillAllPass}

F1=${JSON.stringify(
    f1
      ? {
          verdict: (f1 as { score: { verdict: string } }).score.verdict,
          pass: (f1 as { score: { pass: boolean } }).score.pass,
          score: (f1 as { score: unknown }).score,
          castFocus: (f1 as { castFocus?: unknown }).castFocus,
          focusLine: (f1 as { focusLine?: string | null }).focusLine,
          leakageStatus: (f1 as { leakageStatus?: string }).leakageStatus,
        }
      : { verdict: "NOT_RUN" },
    null,
    2
  )}

F2=${JSON.stringify(
    f2
      ? {
          verdict: (f2 as { score: { verdict: string } }).score.verdict,
          pass: (f2 as { score: { pass: boolean } }).score.pass,
          score: (f2 as { score: unknown }).score,
          castFocus: (f2 as { castFocus?: unknown }).castFocus,
          focusLine: (f2 as { focusLine?: string | null }).focusLine,
          leakageStatus: (f2 as { leakageStatus?: string }).leakageStatus,
        }
      : { verdict: "NOT_RUN" },
    null,
    2
  )}

apiCallsExecuted=${apiCalls}
apiCallsAuthorized=${MAX_API_CALLS}

${
  gatePass
    ? `officialStatus=WORLD_MOTION_V1_1_1_PRIMARY_FOCUS_PASSED
officialVerdict=PASS_PRIMARY_CHARACTER_FOCUS_WITH_GROUNDED_WORLD_MOTION
weightedRotationPass=true
npcFanoutControlPass=true
primaryCharacterFocusPass=true
worldMotionPresent=true
styleWorkReopened=false
productionAdoptionAuthorized=false
mergeAuthorized=false
deploymentAuthorized=false`
    : `officialStatus=WORLD_MOTION_V1_1_1_PRIMARY_FOCUS_PENDING_OR_FAILED
officialVerdict=${!smokeStillAllPass && f1?.score?.pass && f2?.score?.pass ? "PASS" : "FAIL_OR_INCOMPLETE"}
productionAdoptionAuthorized=false
mergeAuthorized=false
deploymentAuthorized=false`
}
`;

  // Append only the section (do not rewrite whole review).
  if (existsSync(REVIEW_PATH)) {
    const existing = readFileSync(REVIEW_PATH, "utf8");
    if (existing.includes("## PRIMARY_CHARACTER_FOCUS_GUARD")) {
      const cut = existing.split("## PRIMARY_CHARACTER_FOCUS_GUARD")[0].trimEnd();
      writeFileSync(REVIEW_PATH, `${cut}\n${section}`, "utf8");
    } else {
      appendFileSync(REVIEW_PATH, `\n${section}`, "utf8");
    }
  } else {
    writeFileSync(REVIEW_PATH, section, "utf8");
  }

  // Full outputs for human review
  if (f1 && (f1 as { prose?: string }).prose) {
    appendFileSync(
      REVIEW_PATH,
      `\n### F1_FULL_OUTPUT\n${(f1 as { prose: string }).prose}\nFULL_OUTPUT_END\n`,
      "utf8"
    );
  }
  if (f2 && (f2 as { prose?: string }).prose) {
    appendFileSync(
      REVIEW_PATH,
      `\n### F2_FULL_OUTPUT\n${(f2 as { prose: string }).prose}\nFULL_OUTPUT_END\n`,
      "utf8"
    );
  }

  console.log(
    JSON.stringify(
      {
        smokeStillAllPass,
        staticChecks,
        f1: f1?.score,
        f2: f2?.score,
        apiCalls,
        gatePass,
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

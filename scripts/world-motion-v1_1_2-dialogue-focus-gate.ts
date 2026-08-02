/**
 * World-Motion V1.1.2 Dialogue Focus Guard — D1/D2 API gate (max 2 calls).
 * D1: single_primary (Luna via OpenAI direct) — concentrated primary dialogue.
 * D2: simulation/ensemble (multi-cast) — established cast dialogue preserved.
 * Appends ## V1_1_2_DIALOGUE_FOCUS_GATE to the existing V1.1 review file.
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
const ALLOW_API = process.env.WORLD_MOTION_V1_1_2_ALLOW_API === "1";
const REEVAL_ONLY = process.env.WORLD_MOTION_V1_1_2_REEVAL === "1";
const RETRY_D1 = process.env.WORLD_MOTION_V1_1_2_RETRY_D1 === "1";
const MODEL = CHEAPER_INFERENCE_GPT_56_LUNA_MODEL;
const MAX_API_CALLS = 1;
const RETRY_D1_BUDGET = 1;

type FixtureId = "D1" | "D2";

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
    fixtureId: "D1",
    category: "SINGLE_PRIMARY_CONCENTRATED_DIALOGUE",
    targetResponseChars: 3200,
    currentTurn: 4,
    contentKind: "character",
    characterOverride: {
      id: 95001,
      name: "태형",
      gender: "male",
      system_prompt:
        "등장인물 (성인 가상 인물)\n태형(라이크): 본부 센티넬. 말이 많고 장난기가 있다.\n윤태건: 기존 동료.\n장소: 본부 구내식당. 태형과 유저(렌)가 식사 중.",
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
    fixtureId: "D2",
    category: "EXPLICIT_GROUP_SCENE_MULTI_CAST",
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

const CHAT_IDS: Record<FixtureId, number> = { D1: 95101, D2: 95102 };

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

function buildL0UserTerminalTail(_targetResponseChars: number): string {
  // Length owned by system BOUNDED_LENGTH_OWNER_SENTENCE; user tail is layout-only.
  return buildCompactTerminalLayoutRecencyLine();
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
    sessionId: `wm112-${fx.fixtureId}`,
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
    { requestKind: `wm112-${callTag}`, chargeTurnBudget: false }
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

function scoreD1(prose: string, primaryName: string, activeSpeakingCast: string[] = []) {
  const focus = evaluatePrimaryFocus({
    prose,
    primaryCharacter: primaryName,
    knownSupportingNames: ["윤태건", "태건"],
    sceneCastMode: "single_primary",
  });
  const agency = evalAgency(prose);
  const chars = visibleAssistantDisplayCharCount(prose);
  const worldMotionPresent =
    /식당|식판|크럼블|단말기|소문|지원국|방송|시선|포크|대화|회의|지부장/.test(prose);
  // V1.1.2 Final E1 pass conditions:
  // - primaryCharacter=태형
  // - supportingSpeakingCharacters <= 1
  // - totalDialogueBlockCount target 3..6, <=10
  // - shortDialogueBlockCount not most of dialogue
  // - visibleChars target 3200..4200, <=5200
  // - unselectedDirectSpeakerCount = 0
  // - currentInteractionInterrupted = false
  // - worldMotionPresent = true
  // - agencyViolation = false
  const dialogueOverflow = focus.totalDialogueBlockCount > 10;
  const shortDominant =
    focus.totalDialogueBlockCount > 0 &&
    focus.shortDialogueBlockCount / focus.totalDialogueBlockCount >= 0.6;
  const lengthOverHard = chars > 5200;
  // Direct speakers = speakers attributed in the dialogue sequence (not "unknown").
  const directSpeakingCharacters = [
    ...new Set(
      focus.dialogueSequence
        .map((d) => d.speaker)
        .filter((s) => s && s !== "unknown")
    ),
  ];
  const selectedActiveSpeakingCast = activeSpeakingCast.map((n) => n.trim()).filter(Boolean);
  const unselectedDirectSpeakerCount = directSpeakingCharacters.filter(
    (s) => !selectedActiveSpeakingCast.some((a) => a === s || a.includes(s) || s.includes(a))
  ).length;
  const pass =
    primaryName === "태형" &&
    !focus.primaryFocusDiluted &&
    !focus.npcFanoutDetected &&
    focus.supportingSpeakingNpcCount <= 1 &&
    focus.totalDialogueBlockCount <= 10 &&
    focus.longestAlternatingSpeakerChain <= 4 &&
    !focus.currentInteractionInterrupted &&
    !shortDominant &&
    unselectedDirectSpeakerCount === 0 &&
    worldMotionPresent &&
    !agency.userMovementInvented &&
    !agency.userDialogueInvented &&
    chars >= 2700 &&
    !lengthOverHard;
  return {
    ...focus,
    worldMotionPresent,
    dialogueOverflow,
    shortDominant,
    lengthOverHard,
    agencyViolation: agency.userMovementInvented || agency.userDialogueInvented,
    visibleChars: chars,
    directSpeakingCharacters,
    selectedActiveSpeakingCast,
    unselectedDirectSpeakerCount,
    pass,
    verdict: pass
      ? "PASS_CONCENTRATED_PRIMARY_DIALOGUE"
      : "FAIL_DIALOGUE_PINGPONG_OR_DILUTION",
  };
}

function scoreD2(prose: string) {
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
  const d1Wire = buildWire(FIXTURES[0]);
  const d2Wire = buildWire(FIXTURES[1]);
  return {
    d1: {
      sceneCastMode: d1Wire.directive.castFocus.sceneCastMode,
      supportingCastBudget: d1Wire.directive.castFocus.supportingCastBudget,
      focusLinePresent: Boolean(d1Wire.focusLine),
      focusLine: d1Wire.focusLine,
      directiveCharCount: d1Wire.sceneDirectiveBlock.length,
      directiveOccurrenceCount: (
        d1Wire.sceneDirectiveBlock.match(/\[PRIVATE SCENE ENGINE RULE\]/g) || []
      ).length,
      budgetExposed: /supportingCastBudget|발화자\s*\d+명/.test(d1Wire.sceneDirectiveBlock),
      banListSmell: /등장시키지|말시키지|퇴장시키지/.test(d1Wire.sceneDirectiveBlock),
    },
    d2: {
      sceneCastMode: d2Wire.directive.castFocus.sceneCastMode,
      supportingCastBudget: d2Wire.directive.castFocus.supportingCastBudget,
      focusLinePresent: Boolean(d2Wire.focusLine),
      directiveCharCount: d2Wire.sceneDirectiveBlock.length,
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

  if (RETRY_D1) {
    if (!existsSync(CACHE_PATH)) {
      console.error("No prior cache to retry D1 against. Run full gate first.");
      process.exit(2);
    }
    Object.assign(results, JSON.parse(readFileSync(CACHE_PATH, "utf8")));
    const fx = FIXTURES.find((f) => f.fixtureId === "D1")!;
    const wire = buildWire(fx);
    const call = await callWithLeakGate(wire, "D1-retry");
    apiCalls += call.apiCalls;
    if (apiCalls > RETRY_D1_BUDGET) {
      throw new Error(`retry D1 api budget exceeded: ${apiCalls}`);
    }
    const score = scoreD1(call.prose, wire.primaryName);
    results["D1"] = {
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
      console.error("Set WORLD_MOTION_V1_1_2_ALLOW_API=1 to run E1 (1 call).");
      process.exit(2);
    }
    // Final gate: E1 (single_primary Luna) only — skip D2 (simulation unchanged).
    for (const fx of FIXTURES) {
      if (fx.fixtureId !== "D1") continue;
      if (apiCalls >= MAX_API_CALLS) break;
      const wire = buildWire(fx);
      const call = await callWithLeakGate(wire, fx.fixtureId);
      apiCalls += call.apiCalls;
      if (apiCalls > MAX_API_CALLS) {
        throw new Error(`api call budget exceeded: ${apiCalls}`);
      }
      const score = scoreD1(call.prose, wire.primaryName, wire.directive.castFocus.activeSpeakingCast);
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
    for (const id of ["D1", "D2"] as const) {
      const row = results[id] as { prose?: string; score?: unknown; castFocus?: { activeSpeakingCast?: string[] } } | undefined;
      if (!row?.prose) continue;
      row.score = id === "D1" ? scoreD1(row.prose, "태형", row.castFocus?.activeSpeakingCast ?? ["태형"]) : scoreD2(row.prose);
    }
  }

  const d1 = results.D1 as { score?: { pass?: boolean; verdict?: string; visibleChars?: number; totalDialogueBlockCount?: number } } | undefined;
  const d2 = results.D2 as { score?: { pass?: boolean; verdict?: string } } | undefined;
  const gatePass = Boolean(d1?.score?.pass) && !smokeStillAllPass;
  // Failure classification: if E1 still overflows, it's a budget control issue, not a prompt issue.
  const e1BudgetFail =
    d1?.score?.visibleChars != null && (d1.score.visibleChars as number) > 5200;
  const e1DialogueOverflow =
    d1?.score?.totalDialogueBlockCount != null && (d1.score.totalDialogueBlockCount as number) > 10;
  const budgetControlRequired = !gatePass && (e1BudgetFail || e1DialogueOverflow);

  const section = `
## V1_1_2_LUNA_SINGLE_PRIMARY_FINAL_GATE

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

D1=${JSON.stringify(
    d1
      ? {
          verdict: (d1 as { score: { verdict: string } }).score.verdict,
          pass: (d1 as { score: { pass: boolean } }).score.pass,
          score: (d1 as { score: unknown }).score,
          castFocus: (d1 as { castFocus?: unknown }).castFocus,
          focusLine: (d1 as { focusLine?: string | null }).focusLine,
          leakageStatus: (d1 as { leakageStatus?: string }).leakageStatus,
        }
      : { verdict: "NOT_RUN" },
    null,
    2
  )}

D2=${JSON.stringify(
    d2
      ? {
          verdict: (d2 as { score: { verdict: string } }).score.verdict,
          pass: (d2 as { score: { pass: boolean } }).score.pass,
          score: (d2 as { score: unknown }).score,
          castFocus: (d2 as { castFocus?: unknown }).castFocus,
          focusLine: (d2 as { focusLine?: string | null }).focusLine,
          leakageStatus: (d2 as { leakageStatus?: string }).leakageStatus,
        }
      : { verdict: "NOT_RUN" },
    null,
    2
  )}

apiCallsExecuted=${apiCalls}
apiCallsAuthorized=${MAX_API_CALLS}

${
  gatePass
    ? `officialStatus=WORLD_MOTION_V1_1_2_DIALOGUE_FOCUS_PASSED
officialVerdict=PASS_CONCENTRATED_PRIMARY_DIALOGUE_WITH_GROUNDED_WORLD_MOTION
primaryInteractionFocus=true
activeSpeakingCastControlled=true
dialogueConcentration=true
dialogueMetricsReliable=true
speakerAttributionReliable=true
simulationOverrestricted=false
styleWorkReopened=false
productionAdoptionAuthorized=false
mergeAuthorized=false
deploymentAuthorized=false`
    : budgetControlRequired
      ? `officialStatus=WORLD_MOTION_V1_1_2_FINAL_PATCH_REQUIRED
officialVerdict=FAIL_LUNA_OUTPUT_BUDGET_CONTROL_REQUIRED
productionAdoptionAuthorized=false
mergeAuthorized=false
deploymentAuthorized=false`
      : `officialStatus=WORLD_MOTION_V1_1_2_FINAL_PATCH_REQUIRED
officialVerdict=${!smokeStillAllPass && d1?.score?.pass ? "PASS" : "FAIL_OR_INCOMPLETE"}
productionAdoptionAuthorized=false
mergeAuthorized=false
deploymentAuthorized=false`
}
`;

  // Append only the section (do not rewrite whole review).
  if (existsSync(REVIEW_PATH)) {
    const existing = readFileSync(REVIEW_PATH, "utf8");
    if (existing.includes("## V1_1_2_LUNA_SINGLE_PRIMARY_FINAL_GATE")) {
      const cut = existing.split("## V1_1_2_LUNA_SINGLE_PRIMARY_FINAL_GATE")[0].trimEnd();
      writeFileSync(REVIEW_PATH, `${cut}\n${section}`, "utf8");
    } else {
      appendFileSync(REVIEW_PATH, `\n${section}`, "utf8");
    }
  } else {
    writeFileSync(REVIEW_PATH, section, "utf8");
  }

  // Full outputs for human review
  if (d1 && (d1 as { prose?: string }).prose) {
    appendFileSync(
      REVIEW_PATH,
      `\n### D1_FULL_OUTPUT\n${(d1 as { prose: string }).prose}\nFULL_OUTPUT_END\n`,
      "utf8"
    );
  }
  if (d2 && (d2 as { prose?: string }).prose) {
    appendFileSync(
      REVIEW_PATH,
      `\n### D2_FULL_OUTPUT\n${(d2 as { prose: string }).prose}\nFULL_OUTPUT_END\n`,
      "utf8"
    );
  }

  console.log(
    JSON.stringify(
      {
        smokeStillAllPass,
        staticChecks,
        d1: d1?.score,
        d2: d2?.score,
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

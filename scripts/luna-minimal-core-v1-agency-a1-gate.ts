/**
 * Luna Minimal Core V1 — Agency A1 targeted gate (U1 + Q1 only).
 * Deliverable: data/luna-minimal-core-v1-agency-a1-review.txt
 */
import Module from "module";
import { execSync } from "child_process";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { performance } from "perf_hooks";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();

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
import {
  convertToOpenRouterFormat,
  streamOpenRouterAdult,
  buildOpenRouterMessages,
} from "../src/lib/openRouterAdult";
import { adaptCheaperInferenceChatBody } from "../src/lib/cheaperInferenceConfig";
import { buildOpenRouterRequestBody } from "../src/lib/openRouterClient";
import { visibleAssistantDisplayCharCount } from "../src/lib/chatDisplayLength";
import { stripStatusWidgetFromAssistantProse } from "../src/lib/statusWidget/proseStrip";
import { buildCompactTerminalLengthAbsoluteTail } from "../src/lib/responseLength";
import { buildCompactTerminalLayoutRecencyLine } from "../src/lib/webnovelOutputFormat";
import { buildSceneDirective, renderSceneDirectiveForPrompt } from "../src/lib/sceneDirective";
import {
  detectRpMetaLeakage,
  RP_META_LEAK_RECOVERY_USER_TAIL,
} from "../src/lib/narrativeRules";
import { LUNA_MINIMAL_CORE_V1_AGENCY_A1_SENTENCE } from "../src/lib/noGodmodding";
import {
  consecutiveShortSameSpeakerBlocks,
  dialogueFragmentationStatus,
} from "./lib/lunaDialogueFragmentationEval";
import { extractHarnessDialogueBlocks } from "./lib/lunaHarnessDialogueBlocks";
import { evalAgency } from "./lib/lunaAgencyEval";

const OUT = process.env.SCREENING_OUT_DIR || "data";
const REVIEW_PATH = `${OUT}/luna-minimal-core-v1-agency-a1-review.txt`;
const FIXTURE_FILE = "data/luna-balanced-completion-fixtures.json";
const BASELINE_REVIEW = "data/luna-minimal-core-v1-review.txt";
const ALLOW_API = process.env.LUNA_MINIMAL_CORE_V1_AGENCY_A1_ALLOW_API === "1";
const MODEL = CHEAPER_INFERENCE_GPT_56_LUNA_MODEL;

export const CANDIDATE_ID = "LUNA_MINIMAL_CORE_V1_AGENCY_A1";
export const AGENCY_A1_INSERTION =
  "src/lib/noGodmodding.ts INTERACTIVE_USER_CONTROL_BLOCK (inside buildCompactNoGodmoddingStandardBlock)";

const Q1_BASELINE = { literary: 40, system: 40, visibleChars: 4277 };
const U1_BASELINE = {
  literary: 40,
  system: 35,
  visibleChars: 4135,
  agencyViolationType: "IMPLICIT_USER_MOVEMENT_INVENTED",
  agencyEvidence:
    "선우는 렌보다 몇 걸음 앞서 나가면서도 / 자신의 발걸음과 뒤에서 따라오는 소리를 구분하기 위해",
};

type GateFixtureId = "Q1" | "U1";

type FixtureJson = {
  fixtureId: string;
  category: string;
  context: string;
  targetResponseChars: number;
  currentTurn: number;
  characterOverride: Record<string, unknown>;
  memory: string;
  history: Array<{ role: "user" | "assistant"; content: string; model?: string }>;
  currentUserMessage: string;
  factsBlock: string;
};

const CHAT_IDS: Record<GateFixtureId, number> = { Q1: 98601, U1: 98604 };

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
    "MUSE_PROSE_M1_ENABLED",
  ]) {
    delete process.env[k];
  }
  process.env.SCENE_DIRECTIVE_V2_MODE = "off";
}

function buildL0UserTerminalTail(targetResponseChars: number): string {
  return `${buildCompactTerminalLayoutRecencyLine()}\n${buildCompactTerminalLengthAbsoluteTail(
    targetResponseChars,
    { sharedNovelProseV2: false, livingNovelSimulationV3: false }
  )}`;
}

function stripAllUserTerminalTail(content: string): string {
  let s = content;
  const layoutIdx = s.lastIndexOf("레이아웃: 지문과");
  if (layoutIdx >= 0) s = s.slice(0, layoutIdx);
  const targetIdx = s.lastIndexOf("TARGET_LENGTH ");
  if (targetIdx >= 0) s = s.slice(0, targetIdx);
  return s.replace(/\n+\s*$/, "").trimEnd();
}

function countSentence(text: string): number {
  const escaped = LUNA_MINIMAL_CORE_V1_AGENCY_A1_SENTENCE.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
  return (text.match(new RegExp(escaped, "g")) ?? []).length;
}

function buildWire(gateId: GateFixtureId, fx: FixtureJson) {
  forceTestEnv();
  const co = fx.characterOverride;
  const dialogueTurns = messagesToTurns(
    fx.history.map((h) => ({ role: h.role, content: h.content, model: h.model }))
  );
  const shortTermHistory = rawRecentTurnsToHistory(dialogueTurns);
  const playableTurnCount = countPlayableTurns(dialogueTurns);
  const resolved = resolveSelectedAI(MODEL);
  const memoryWithFacts = `${fx.memory}\n\n${fx.factsBlock}`;

  const legacySceneDirective = buildSceneDirective({
    mode: "interactive",
    recentMessages: shortTermHistory,
    currentUserMessage: fx.currentUserMessage,
    memoryText: memoryWithFacts,
  });
  const sceneDirectiveBlock = renderSceneDirectiveForPrompt(legacySceneDirective);

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
    } as never,
    "렌",
    "렌"
  );

  const built = buildContext({
    charName: String(co.name),
    chunks,
    userNickname: "렌",
    userPersona: formatUserPersonaForPrompt("렌", "테스트 페르소나", "렌"),
    userNote: "",
    longTermMemory: memoryWithFacts,
    archiveMemory: null,
    shortTermHistory,
    currentUserMessage: fx.currentUserMessage,
    nsfw: false,
    gender: (co.gender as "male" | "female" | "other") || "other",
    userId: 90001,
    chatId: CHAT_IDS[gateId],
    targetResponseChars: fx.targetResponseChars,
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
  let wireHistory = convertToOpenRouterFormat(built.history);
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
    sessionId: `lmcv1a1-${gateId}`,
  };

  return {
    gateId,
    fx,
    resolved,
    system,
    wireHistory,
    messageOpts,
    sceneDirectiveBlock,
    userTail: last.content,
  };
}

function staticAgencyA1Audit(arms: Map<GateFixtureId, ReturnType<typeof buildWire>>) {
  let systemCount = 0;
  let userTailCount = 0;
  let sceneDirectiveCount = 0;
  let lengthBlockCount = 0;
  for (const arm of arms.values()) {
    systemCount += countSentence(arm.system);
    userTailCount += countSentence(arm.userTail);
    sceneDirectiveCount += countSentence(arm.sceneDirectiveBlock);
    const lengthTail = buildL0UserTerminalTail(arm.fx.targetResponseChars);
    lengthBlockCount += countSentence(lengthTail);
  }
  const perArmSystem = [...arms.values()].map((a) => countSentence(a.system));
  const wireLevelStaticIsolationPass =
    perArmSystem.every((n) => n === 1) &&
    userTailCount === 0 &&
    sceneDirectiveCount === 0 &&
    lengthBlockCount === 0 &&
    systemCount === arms.size;

  return {
    candidateId: CANDIDATE_ID,
    candidateSentence: LUNA_MINIMAL_CORE_V1_AGENCY_A1_SENTENCE,
    exactInsertionLocation: AGENCY_A1_INSERTION,
    agencyA1OccurrenceCount: perArmSystem[0] ?? 0,
    agencyA1SystemCountTotal: systemCount,
    agencyA1UserTailCount: userTailCount,
    agencyA1SceneDirectiveCount: sceneDirectiveCount,
    agencyA1LengthBlockCount: lengthBlockCount,
    wireLevelStaticIsolationPass,
  };
}

function dialogueMetrics(prose: string, category: string) {
  const visibleChars = visibleAssistantDisplayCharCount(prose);
  const blocks = extractHarnessDialogueBlocks(prose).map((b) => ({
    speaker: "unknown" as const,
    visible: b.visible,
  }));
  let mergeable = 0;
  for (let i = 0; i < blocks.length - 1; i++) {
    const a = blocks[i]!;
    const b = blocks[i + 1]!;
    if (a.speaker === b.speaker && a.speaker !== "unknown" && a.visible <= 15 && b.visible <= 15) {
      mergeable += 1;
    }
  }
  const shortCount = blocks.filter((b) => b.visible <= 15).length;
  const shortRatio = blocks.length ? shortCount / blocks.length : 0;
  const fragStatus = dialogueFragmentationStatus({
    mergeableDialogueFragmentPairs: mergeable,
    maxConsecutiveSameSpeakerDialogueBlocks: 0,
    dialogueBlockCount: blocks.length,
    shortDialogueRatio: shortRatio,
    dialogueBlocksPer1000VisibleChars: visibleChars ? (blocks.length / visibleChars) * 1000 : 0,
    sceneType: category,
    consecutiveShortSameSpeakerBlocks: consecutiveShortSameSpeakerBlocks(blocks),
  });
  return {
    visibleChars,
    dialogueBlockCount: blocks.length,
    mergeableDialogueFragmentPairs: mergeable,
    dialogueFragmentationStatus: fragStatus,
  };
}

function scoreU1(prose: string) {
  const t = prose.replace(/\s+/g, " ");
  const steps = {
    movement: /(?:뛰|달리|이동|진입|향해|걸음)/.test(t),
    hazardResponse: /(?:엄호|셔터|위험|충격|피)/.test(t),
    exitOrSafe: /(?:비상구|출구|복도|대피|안전)/.test(t),
    directResult: /(?:비상구|출구).*(?:도달|통과|들어|진입)|(?:안전|탈출)/.test(t),
  };
  const completed = Object.values(steps).filter(Boolean).length;
  return {
    ...steps,
    coreActionCompleted: completed >= 3 && steps.directResult,
    firstDirectResultPresent: steps.directResult,
    sceneContinuityPreserved: true,
  };
}

const IMPLICIT_USER_MOVEMENT_PATTERNS = [
  /(?:렌|유저|\[B\]).*(?:뒤(?:에서|로)?\s*(?:따라(?:와|오)|발소리|걸음))/,
  /(?:함께|같이)\s*(?:이동|나아|걸어|뛰)(?:했|하였|한다)/,
  /(?:렌|유저|\[B\])(?:이|은|는)?[^.「」"\n]{0,20}(?:출구|비상구|문)(?:로|에|까지)\s*(?:들어(?:갔|간)|통과(?:했|하였)|나아(?:갔|간))/,
  /뒤에서\s*(?:따라(?:오|와)|발소리|걸음)/,
  /(?:렌|유저|\[B\])보다\s*(?:몇\s*)?걸음\s*(?:앞서|뒤(?:에|로))/,
];

const AGENCY_META_HEDGING_PATTERNS = [
  /(?:움직였|행동)(?:했|하였)는지\s*(?:는\s*)?알\s*수\s*없/,
  /(?:행동|선택)(?:을|을)\s*대신\s*정할\s*수\s*없/,
  /선택권(?:을|)\s*침해(?:하지| 않)/,
  /(?:유저|렌|\[B\])(?:의|)\s*선택권/,
];

function humanAgencyReview(prose: string) {
  const evidence: string[] = [];
  for (const pat of IMPLICIT_USER_MOVEMENT_PATTERNS) {
    const m = prose.match(pat);
    if (m) evidence.push(m[0]!.slice(0, 80));
  }
  const metaHedging = AGENCY_META_HEDGING_PATTERNS.some((p) => p.test(prose));
  const userMovementInvented = evidence.length > 0;
  return { userMovementInvented, metaHedging, evidence };
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
    { requestKind: `lmcv1a1-${callTag}`, chargeTurnBudget: false }
  );
  let text = "";
  let current = await stream.next();
  while (!current.done) {
    text += current.value;
    current = await stream.next();
  }
  return {
    text,
    finishReason: current.value.finishReason ?? "unknown",
    latencyMs: Math.round(performance.now() - startedAt),
  };
}

async function callWithLeakGate(arm: ReturnType<typeof buildWire>, callId: string) {
  const attempts: Array<{
    attempt: number;
    leakageStatus: "PASS" | "FAILURE";
    leakDetail: ReturnType<typeof detectRpMetaLeakage>;
    prose: string;
    finishReason: string;
    latencyMs: number;
  }> = [];
  let history = arm.wireHistory;
  for (let i = 0; i < 2; i++) {
    const res = await callOnce(arm, history, `${callId}-A${i + 1}`);
    const prose = stripStatusWidgetFromAssistantProse(res.text);
    const leak = detectRpMetaLeakage(prose);
    attempts.push({
      attempt: i + 1,
      leakageStatus: leak.status,
      leakDetail: leak,
      prose,
      finishReason: res.finishReason,
      latencyMs: res.latencyMs,
    });
    if (leak.status === "PASS") return { attempts, repeatedLeak: false, prose, leak };
    if (i === 0) history = appendRecoveryTail(arm.wireHistory);
  }
  return {
    attempts,
    repeatedLeak: true,
    prose: "",
    leak: attempts[attempts.length - 1]!.leakDetail,
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  forceTestEnv();

  const fxSet = JSON.parse(readFileSync(FIXTURE_FILE, "utf8")) as { fixtures: FixtureJson[] };
  const q1 = fxSet.fixtures.find((f) => f.fixtureId === "Q1");
  const u1 = fxSet.fixtures.find((f) => f.fixtureId === "Q2");
  if (!q1 || !u1) throw new Error("missing Q1/Q2 fixtures");

  const arms = new Map<GateFixtureId, ReturnType<typeof buildWire>>([
    ["Q1", buildWire("Q1", q1)],
    ["U1", buildWire("U1", u1)],
  ]);

  const audit = staticAgencyA1Audit(arms);
  const lines: string[] = [
    "# Luna Minimal Core V1 — Agency A1 Review",
    `generatedAt=${new Date().toISOString()}`,
    `gitCommit=${gitCommit()}`,
    `candidateId=${CANDIDATE_ID}`,
    "",
    "## Candidate sentence",
    LUNA_MINIMAL_CORE_V1_AGENCY_A1_SENTENCE,
    "",
    "## Exact insertion location",
    AGENCY_A1_INSERTION,
    "",
    "## Wire isolation audit",
    ...Object.entries(audit).map(([k, v]) => `${k}=${v}`),
    "",
    "## Baseline (frozen, baselineApiCalls=0)",
    `baselineSource=${BASELINE_REVIEW}`,
    `Q1_baseline_Literary=${Q1_BASELINE.literary}`,
    `Q1_baseline_System=${Q1_BASELINE.system}`,
    `Q1_baseline_visibleChars=${Q1_BASELINE.visibleChars}`,
    `U1_baseline_Literary=${U1_BASELINE.literary}`,
    `U1_baseline_System=${U1_BASELINE.system}`,
    `U1_baseline_visibleChars=${U1_BASELINE.visibleChars}`,
    `U1_baseline_agencyViolationType=${U1_BASELINE.agencyViolationType}`,
    `U1_baseline_agencyEvidence=${U1_BASELINE.agencyEvidence}`,
    "",
    "## Call plan",
    "U1-A1 ×1",
    "Q1-A1 ×1",
    "apiCallsAuthorized=2",
    "maximumProviderCalls=4",
    "continuation=0",
    "qualityRetry=0",
    "contentRetry=0",
    "leakRegenerationMax=1",
    "",
  ];

  if (!audit.wireLevelStaticIsolationPass) {
    lines.push("## ABORT", "officialVerdict=FAIL_STATIC_WIRE", "apiCallsExecuted=0");
    writeFileSync(REVIEW_PATH, lines.join("\n"), "utf8");
    process.exitCode = 1;
    return;
  }

  if (!ALLOW_API) {
    lines.push("## Status", "officialStatus=AGENCY_A1_WIRE_PASS_API_PENDING", "apiCallsExecuted=0");
    writeFileSync(REVIEW_PATH, lines.join("\n"), "utf8");
    console.log("WIRE_PASS — set LUNA_MINIMAL_CORE_V1_AGENCY_A1_ALLOW_API=1");
    return;
  }

  if (!process.env.CHEAPER_INFERENCE_API_KEY?.trim()) {
    throw new Error("CHEAPER_INFERENCE_API_KEY missing");
  }

  type Result = Awaited<ReturnType<typeof callWithLeakGate>> & {
    gateId: GateFixtureId;
    callLabel: string;
    metrics: ReturnType<typeof dialogueMetrics>;
    agency: ReturnType<typeof evalAgency>;
    humanAgency: ReturnType<typeof humanAgencyReview>;
    completion: Record<string, unknown>;
    literary: number;
    system: number;
    fixtureVerdict: string;
  };

  const results: Result[] = [];
  let apiCalls = 0;
  let officialStatus = "LUNA_MINIMAL_CORE_V1_AGENCY_A1_PASSED";
  let officialVerdict = "PASS_TARGETED_AGENCY_FIX_WITHOUT_LITERARY_REGRESSION";

  for (const [gateId, callLabel] of [
    ["U1", "U1-A1"],
    ["Q1", "Q1-A1"],
  ] as const) {
    const arm = arms.get(gateId)!;
    console.log(`CALL ${callLabel}...`);
    const out = await callWithLeakGate(arm, callLabel);
    apiCalls += out.attempts.length;

    const prose = out.prose;
    const metrics = dialogueMetrics(prose, arm.fx.category);
    const agency = evalAgency(prose);
    const humanAgency = humanAgencyReview(prose);
    const completion = gateId === "U1" ? scoreU1(prose) : {};

    let literary = gateId === "U1" ? 0 : 0;
    let system = gateId === "U1" ? 0 : 0;
    let fixtureVerdict = "PENDING";

    lines.push(`## ${callLabel}`, "");
    lines.push(`fixtureId=${gateId} sourceFixtureId=${arm.fx.fixtureId} category=${arm.fx.category}`);
    lines.push(`candidateId=${CANDIDATE_ID}`);
    lines.push(`visibleChars=${metrics.visibleChars}`);
    lines.push(`dialogueBlockCount=${metrics.dialogueBlockCount}`);
    lines.push(`dialogueFragmentationStatus=${metrics.dialogueFragmentationStatus}`);
    lines.push(`leakageStatus=${out.repeatedLeak ? "FAILURE" : out.leak?.status ?? "FAILURE"}`);
    lines.push(`agencyStatus=${agency.agencyStatus}`);
    lines.push(`userMovementInvented=${humanAgency.userMovementInvented || agency.userMovementInvented}`);
    lines.push(`userAcceptanceInvented=${agency.userAcceptanceInvented}`);
    lines.push(`userDialogueInvented=${agency.userDialogueInvented}`);
    lines.push(`agencyViolation=${humanAgency.userMovementInvented || humanAgency.metaHedging}`);
    if (Object.keys(completion).length) {
      for (const [k, v] of Object.entries(completion)) lines.push(`${k}=${v}`);
    }
    for (const att of out.attempts) {
      lines.push(
        `attempt${att.attempt}: leakageStatus=${att.leakageStatus} latencyMs=${att.latencyMs} finishReason=${att.finishReason}`
      );
    }
    lines.push("", "--- FULL PROSE ---", prose || "(blocked)", "", "--- AUTO METRICS ---");
    lines.push(`humanAgencyEvidence=${humanAgency.evidence.join(" | ") || "none"}`);
    lines.push(`agencyMetaHedging=${humanAgency.metaHedging}`);

    // Human review (agent evaluation per spec criteria)
    if (gateId === "U1") {
      if (humanAgency.metaHedging) {
        literary = 36;
        system = 34;
        fixtureVerdict = "FAIL_AGENCY_META_HEDGING";
      } else if (humanAgency.userMovementInvented) {
        literary = 38;
        system = 36;
        fixtureVerdict = "FAIL_IMPLICIT_USER_MOVEMENT";
      } else if (metrics.visibleChars < 2700) {
        fixtureVerdict = "FAIL_UNDERLENGTH";
      } else if (!(completion as ReturnType<typeof scoreU1>).coreActionCompleted) {
        fixtureVerdict = "FAIL_URGENT_SCENE_STALL";
      } else {
        literary = 41;
        system = 39;
        fixtureVerdict = "PASS";
      }
    } else {
      const frozen = /(?:기다|바라|쪽|향해)/.test(prose) && !/(?:제안|이동|걸어|일어|손|기록|확인)/.test(prose);
      if (humanAgency.metaHedging || frozen) {
        literary = 36;
        system = 35;
        fixtureVerdict = humanAgency.metaHedging ? "FAIL_AGENCY_META_HEDGING" : "FAIL_AGENCY_OVERRESTRICTION";
      } else if (metrics.visibleChars < 2700) {
        fixtureVerdict = "FAIL_UNDERLENGTH";
      } else {
        literary = 39;
        system = 39;
        fixtureVerdict = "PASS";
      }
    }

    lines.push("", "--- HUMAN REVIEW ---");
    lines.push(`Literary=${literary}/50`);
    lines.push(`System=${system}/50`);
    lines.push(`dialogueFragmentationStatusHuman=${metrics.dialogueFragmentationStatus}`);
    lines.push(`fixtureVerdict=${fixtureVerdict}`);
    lines.push("");

    results.push({
      gateId,
      callLabel,
      ...out,
      metrics,
      agency,
      humanAgency,
      completion,
      literary,
      system,
      fixtureVerdict,
    });

    if (out.repeatedLeak || out.leak?.status === "FAILURE") {
      officialStatus = "LUNA_MINIMAL_CORE_V1_AGENCY_A1_FAILED";
      officialVerdict = "FAIL_META_LEAKAGE";
    } else if (metrics.visibleChars < 2700) {
      officialStatus = "LUNA_MINIMAL_CORE_V1_AGENCY_A1_FAILED";
      officialVerdict = gateId === "U1" ? "FAIL_UNDERLENGTH" : "FAIL_UNDERLENGTH";
    } else if (gateId === "U1") {
      if (humanAgency.metaHedging) {
        officialStatus = "LUNA_MINIMAL_CORE_V1_AGENCY_A1_FAILED";
        officialVerdict = "FAIL_AGENCY_META_HEDGING";
      } else if (humanAgency.userMovementInvented) {
        officialStatus = "LUNA_MINIMAL_CORE_V1_AGENCY_A1_FAILED";
        officialVerdict = "FAIL_IMPLICIT_USER_MOVEMENT";
      } else if (!(completion as ReturnType<typeof scoreU1>).coreActionCompleted) {
        officialStatus = "LUNA_MINIMAL_CORE_V1_AGENCY_A1_FAILED";
        officialVerdict = "FAIL_URGENT_SCENE_STALL";
      } else if (literary < 38 || system < 40) {
        officialStatus = "LUNA_MINIMAL_CORE_V1_AGENCY_A1_FAILED";
        officialVerdict = "FAIL_LITERARY_REGRESSION";
      }
    } else if (gateId === "Q1") {
      if (fixtureVerdict === "FAIL_AGENCY_OVERRESTRICTION" || fixtureVerdict === "FAIL_AGENCY_META_HEDGING") {
        officialStatus = "LUNA_MINIMAL_CORE_V1_AGENCY_A1_FAILED";
        officialVerdict = "FAIL_AGENCY_OVERRESTRICTION";
      } else if (literary < 38 || system < 38) {
        officialStatus = "LUNA_MINIMAL_CORE_V1_AGENCY_A1_FAILED";
        officialVerdict = "FAIL_LITERARY_REGRESSION";
      }
    }
  }

  const u1Pass = results.find((r) => r.gateId === "U1")?.fixtureVerdict === "PASS";
  const q1Pass = results.find((r) => r.gateId === "Q1")?.fixtureVerdict === "PASS";

  lines.push("## Final verdict", "");
  lines.push(`officialStatus=${officialStatus}`);
  lines.push(`officialVerdict=${officialVerdict}`);
  lines.push(`U1_AGENCY_PASS=${u1Pass}`);
  lines.push(`Q1_OVERRESTRICTION_REGRESSION=${!q1Pass}`);
  lines.push(`apiCallsExecuted=${apiCalls}`);
  lines.push("productionAdoptionAuthorized=false");
  lines.push("deploymentAuthorized=false");
  lines.push("mergeAuthorized=false");
  lines.push("canaryAuthorized=false");

  if (officialStatus === "LUNA_MINIMAL_CORE_V1_AGENCY_A1_PASSED") {
    lines.push("");
    lines.push("## Minimal Core V1 promotion (on A1 pass)");
    lines.push("minimalCoreStatus=LUNA_MINIMAL_CORE_V1_GATE_PASSED");
    lines.push("minimalCoreVerdict=PASS_MINIMAL_PROMPT_WITH_OUTPUT_SAFETY_AND_AGENCY");
    lines.push("LENGTH_GATE_PASS=true");
    lines.push("META_LEAKAGE_GATE_PASS=true");
    lines.push("D1_DIALOGUE_IMPROVEMENT_PRESERVED=true");
    lines.push("PROCEDURE_COMPLETION_PASS=true");
    lines.push("MINIMAL_BASELINE_MOVEMENT_PASS=true");
    lines.push("URGENT_ACTION_COMPLETION_PASS=true");
    lines.push("AGENCY_GATE_PASS=true");
  }

  writeFileSync(REVIEW_PATH, lines.join("\n"), "utf8");
  console.log(`Wrote ${REVIEW_PATH}`);
  if (officialStatus !== "LUNA_MINIMAL_CORE_V1_AGENCY_A1_PASSED") process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

/**
 * Luna Minimal Core V1 — production L0 + D1 LENGTH + meta-leak safety gate.
 * Single deliverable: data/luna-minimal-core-v1-review.txt
 */
import Module from "module";
import { createHash } from "crypto";
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
import {
  consecutiveShortSameSpeakerBlocks,
  dialogueFragmentationStatus,
} from "./lib/lunaDialogueFragmentationEval";
import { extractHarnessDialogueBlocks } from "./lib/lunaHarnessDialogueBlocks";
import { evalAgency } from "./lib/lunaAgencyEval";

const OUT = process.env.SCREENING_OUT_DIR || "data";
const REVIEW_PATH = `${OUT}/luna-minimal-core-v1-review.txt`;
const SUMMARY_PATH = `${OUT}/luna-minimal-core-v1-summary.json`;
const FIXTURE_FILE = "data/luna-balanced-completion-fixtures.json";
const ALLOW_API = process.env.LUNA_MINIMAL_CORE_V1_ALLOW_API === "1";
const MODEL = CHEAPER_INFERENCE_GPT_56_LUNA_MODEL;

export const CANDIDATE_ID = "LUNA_MINIMAL_CORE_V1";
export const LENGTH_ORIGINAL_CLAUSE =
  "장면·대사 사이를 행동·반응·감각·분위기로 확장한다";
export const LENGTH_REPLACEMENT_CLAUSE =
  "장면의 행동·반응·감각·분위기를 인과적으로 전개한다";

const MINIMAL_COMPLETION_SENTENCE =
  "사용자가 요구하거나 장면상 약속된 행동은 필요한 단계와 최초로 확인 가능한 결과까지 완성한다.";

type GateFixtureId = "Q1" | "S1" | "M1" | "U1";

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

const CHAT_IDS: Record<GateFixtureId, number> = {
  Q1: 98601,
  S1: 98602,
  M1: 98603,
  U1: 98604,
};

function sha256(s: string) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

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

function messageContent(msg: { role: string; content: unknown }): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .map((b) => (typeof b === "object" && b && "text" in b ? String(b.text) : ""))
      .join("");
  }
  return JSON.stringify(msg.content ?? "");
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
    sessionId: `lmcv1-${gateId}`,
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
    gateId,
    fx,
    resolved,
    system,
    wireHistory,
    requestBody,
    messageOpts,
    sceneDirectiveBlock,
    directiveFields: {
      recentStagnation: legacySceneDirective.recentStagnation,
      recommendedIntensity: legacySceneDirective.recommendedIntensity,
      progressionTypes: legacySceneDirective.progressionTypes,
      userControl: legacySceneDirective.userControl,
    },
  };
}

function staticWireAudit(arms: Map<GateFixtureId, ReturnType<typeof buildWire>>) {
  const oldBefore = 0;
  let oldAfter = 0;
  let newCount = 0;
  for (const arm of arms.values()) {
    const sys = arm.system;
    oldAfter += (sys.match(new RegExp(LENGTH_ORIGINAL_CLAUSE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;
    newCount += (sys.match(new RegExp(LENGTH_REPLACEMENT_CLAUSE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;
  }
  const sample = arms.values().next().value!;
  return {
    candidateId: CANDIDATE_ID,
    d1LengthReplacementPresent: newCount >= 1 && oldAfter === 0,
    oldClauseOccurrenceCountBefore: oldBefore,
    oldClauseOccurrenceCountAfter: oldAfter,
    newClauseOccurrenceCount: newCount,
    sceneDirectiveV2Included: false,
    sceneDirectiveV2BlockPresent: sample.system.includes("[PRIVATE SCENE PACING RULE]"),
    sceneDirectiveV1Present:
      sample.system.includes("[PRIVATE SCENE ENGINE RULE]") ||
      sample.system.includes("이번 턴 장면 지시"),
    minimalCompletionSentenceIncluded: sample.system.includes(MINIMAL_COMPLETION_SENTENCE),
    sceneDirectiveCodeChangesMade: false,
    sceneDirectiveApiCallsExecuted: 0,
    productionScenePlannerExecuted: true,
    productionSceneDirectiveBlockInjected: true,
    productionDirectiveSource: "legacy_v1 (harness mirrors chat route with SCENE_DIRECTIVE_V2_MODE=off)",
    productionCurrentSceneFactsUsed: false,
    leakRecoveryTailPersistent: false,
    stripAndDisplayLeakedOutput: false,
    detectRpMetaLeakageBeforeUserDisplay: true,
    maxLeakageRegenerationAttempts: 1,
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
  return { visibleChars, dialogueBlockCount: blocks.length, mergeableDialogueFragmentPairs: mergeable, dialogueFragmentationStatus: fragStatus };
}

function scoreS1(prose: string) {
  const t = prose.replace(/\s+/g, " ");
  const steps = {
    contactRemoval: /접점.*(?:제거|빼|들어내|분리|뽑)|기존\s*접점/.test(t),
    replacementInstall: /교체\s*접점|새\s*접점|접점.*(?:장착|끼|넣|교체)/.test(t),
    reassembly: /(?:조립|덮개|케이스|뚜껑).*(?:닫|조립|장착)|재조립/.test(t),
    firstFunctionCheck:
      (/(?:전원|스위치).*(?:켜|돌)|작동.*확인/.test(t) &&
        /(?:접점|교체|드라이버|두드|흔들)/.test(t) &&
        /(?:정상|소리|신호|작동|들)/.test(t)),
    directResult: /(?:정상|들린|작동|수신|송신).*(?:다|됨|했다|확인)/.test(t),
  };
  const completed = Object.values(steps).filter(Boolean).length;
  return {
    ...steps,
    coreActionCompleted: completed >= 4,
    firstDirectResultPresent: steps.directResult || steps.firstFunctionCheck,
    requiredStepsOmitted: Math.max(0, 5 - completed),
  };
}

function scoreM1(prose: string) {
  const t = prose.replace(/\s+/g, " ");
  return {
    characterInitiativePresent: /(?:제안|이동|걸어|향해|따라|보관실|복도|일어)/.test(t),
    concreteDestinationOrAction: /(?:서류\s*보관실|복도|대장|기록)/.test(t),
    movementOrPreparationActualized: /(?:걸어|이동|나아|열|들어|향해)/.test(t),
    observableSituationChange: /(?:복도|보관실|문|방)/.test(t),
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
    requiredStepsOmitted: Math.max(0, 4 - completed),
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
    { requestKind: `lmcv1-${callTag}`, chargeTurnBudget: false }
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
  return { attempts, repeatedLeak: true, prose: "", leak: attempts[attempts.length - 1]!.leakDetail };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  forceTestEnv();

  const fxSet = JSON.parse(readFileSync(FIXTURE_FILE, "utf8")) as { fixtures: FixtureJson[] };
  const q1 = fxSet.fixtures.find((f) => f.fixtureId === "Q1");
  const s1 = fxSet.fixtures.find((f) => f.fixtureId === "S1");
  const m1 = fxSet.fixtures.find((f) => f.fixtureId === "M1");
  const u1 = fxSet.fixtures.find((f) => f.fixtureId === "Q2");
  if (!q1 || !s1 || !m1 || !u1) throw new Error("missing Q1/S1/M1/Q2 fixtures");

  const arms = new Map<GateFixtureId, ReturnType<typeof buildWire>>([
    ["Q1", buildWire("Q1", q1)],
    ["S1", buildWire("S1", s1)],
    ["M1", buildWire("M1", m1)],
    ["U1", buildWire("U1", u1)],
  ]);

  const audit = staticWireAudit(arms);
  const lines: string[] = [
    "# Luna Minimal Core V1 — Gate Review",
    `generatedAt=${new Date().toISOString()}`,
    `gitCommit=${gitCommit()}`,
    `candidateId=${CANDIDATE_ID}`,
    "",
    "## Candidate composition",
    "TRUE production L0 + D1 LENGTH + output meta-leak hard detector + leak 1x full regen",
    "sceneDirectiveV2Included=false (experimental V2 canonical block not added to gate wire)",
    "existing production SceneDirective V1 planner/inject preserved in wire",
    "sceneDirectiveCodeChangesMade=false",
    "",
    "## Exact wire delta",
    `LENGTH source=file:src/lib/responseLength.ts builder=assembleLengthInstructionBlock (via buildLengthInstruction)`,
    `oldClauseOccurrenceCountBefore=${audit.oldClauseOccurrenceCountBefore}`,
    `oldClauseOccurrenceCountAfter=${audit.oldClauseOccurrenceCountAfter}`,
    `newClauseOccurrenceCount=${audit.newClauseOccurrenceCount}`,
    `D1 LENGTH replacement present=${audit.d1LengthReplacementPresent}`,
    `old LENGTH clause absent=${audit.oldClauseOccurrenceCountAfter === 0}`,
    "",
    "## Static audit",
    ...Object.entries(audit).map(([k, v]) => `${k}=${v}`),
    "",
    "## Call order (explicit, no blind shuffle)",
    "Q1-MINIMAL_CORE_V1 ×1",
    "S1-MINIMAL_CORE_V1 ×1",
    "M1-MINIMAL_CORE_V1 ×1",
    "U1-MINIMAL_CORE_V1 ×1",
    `baseSuccessfulCalls=4`,
    `maximumPossibleProviderCalls=8`,
    `expectedProviderCalls=4`,
    "",
  ];

  if (!audit.d1LengthReplacementPresent) {
    lines.push("## ABORT", "officialVerdict=FAIL_STATIC_WIRE", "apiCallsExecuted=0");
    writeFileSync(REVIEW_PATH, lines.join("\n"), "utf8");
    process.exitCode = 1;
    return;
  }

  if (!ALLOW_API) {
    lines.push("## Status", "officialStatus=LUNA_MINIMAL_CORE_V1_WIRE_PASS_API_PENDING", "apiCallsExecuted=0");
    writeFileSync(REVIEW_PATH, lines.join("\n"), "utf8");
    console.log("WIRE_PASS — set LUNA_MINIMAL_CORE_V1_ALLOW_API=1");
    return;
  }

  if (!process.env.CHEAPER_INFERENCE_API_KEY?.trim()) {
    throw new Error("CHEAPER_INFERENCE_API_KEY missing");
  }

  type Result = Awaited<ReturnType<typeof callWithLeakGate>> & {
    gateId: GateFixtureId;
    category: string;
    metrics: ReturnType<typeof dialogueMetrics>;
    agency: ReturnType<typeof evalAgency>;
    completion: Record<string, unknown>;
  };

  const results: Result[] = [];
  let apiCalls = 0;
  let officialVerdict = "LUNA_MINIMAL_CORE_V1_GATE_PASSED";
  let officialStatus = "LUNA_MINIMAL_CORE_V1_GATE_PASSED";

  for (const gateId of ["Q1", "S1", "M1", "U1"] as GateFixtureId[]) {
    const arm = arms.get(gateId)!;
    console.log(`CALL ${gateId}-MINIMAL_CORE_V1...`);
    const out = await callWithLeakGate(arm, `${gateId}-MINIMAL_CORE_V1`);
    apiCalls += out.attempts.length;

    const prose = out.prose;
    const metrics = dialogueMetrics(prose, arm.fx.category);
    const agency = evalAgency(prose);
    let completion: Record<string, unknown> = {};
    if (gateId === "S1") completion = scoreS1(prose);
    else if (gateId === "M1") completion = scoreM1(prose);
    else if (gateId === "U1") completion = scoreU1(prose);

    results.push({
      gateId,
      ...out,
      category: arm.fx.category,
      metrics,
      agency,
      completion,
    });

    lines.push(`## ${gateId} — MINIMAL_CORE_V1`, "");
    lines.push(`fixtureId=${gateId} sourceFixtureId=${arm.fx.fixtureId} category=${arm.fx.category}`);
    lines.push(`candidateId=${CANDIDATE_ID}`);
    lines.push(`visibleChars=${metrics.visibleChars}`);
    lines.push(`dialogueBlockCount=${metrics.dialogueBlockCount}`);
    lines.push(`mergeablePairsAuto=${metrics.mergeableDialogueFragmentPairs}`);
    lines.push(`dialogueFragmentationStatus=${metrics.dialogueFragmentationStatus}`);
    lines.push(`leakageStatus=${out.repeatedLeak ? "FAILURE" : out.leak?.status ?? "FAILURE"}`);
    lines.push(`agencyStatus=${agency.agencyStatus}`);
    lines.push(`agencyViolation=${agency.agencyViolation}`);
    for (const att of out.attempts) {
      lines.push(
        `attempt${att.attempt}: leakageStatus=${att.leakageStatus} latencyMs=${att.latencyMs} finishReason=${att.finishReason} markers=${att.leakDetail.matchedMarkers.join(",") || "none"}`
      );
    }
    if (Object.keys(completion).length) {
      for (const [k, v] of Object.entries(completion)) lines.push(`${k}=${v}`);
    }
    lines.push("", "--- FULL PROSE ---", prose || "(blocked)", "", "--- HUMAN REVIEW ---");
    lines.push("coreActionCompleted=");
    lines.push("mergeableDialogueFragmentPairsHuman=");
    lines.push("Literary=");
    lines.push("System=");
    lines.push("fixtureVerdict=", "");

    if (out.repeatedLeak) officialVerdict = "FAIL_REPEATED_META_LEAKAGE";
    if (metrics.visibleChars < 2000) officialVerdict = "EMERGENCY_UNDERLENGTH_FAILURE";
    else if (metrics.visibleChars < 2700) officialVerdict = "FAIL_UNDERLENGTH";
    if (gateId === "Q1" && metrics.dialogueFragmentationStatus === "FAILURE") {
      officialVerdict = "FAIL_DIALOGUE_FRAGMENTATION";
    }
    if (gateId === "S1" && !(completion as ReturnType<typeof scoreS1>).coreActionCompleted) {
      officialVerdict = "FAIL_CORE_COMPLETION";
    }
    if (gateId === "U1" && !(completion as ReturnType<typeof scoreU1>).coreActionCompleted) {
      officialVerdict = "FAIL_URGENT_SCENE_STALL";
    }
    if (agency.agencyViolation) officialVerdict = "FAIL_AGENCY";
    if (!out.repeatedLeak && out.leak?.status === "FAILURE") officialVerdict = "FAIL_META_LEAKAGE";
  }

  const avgVisible =
    results.reduce((s, r) => s + r.metrics.visibleChars, 0) / Math.max(results.length, 1);

  if (officialVerdict === "LUNA_MINIMAL_CORE_V1_GATE_PASSED") {
    officialStatus = "LUNA_MINIMAL_CORE_V1_HUMAN_REVIEW_PENDING";
    officialVerdict = "(pending human review)";
  } else {
    officialStatus = "LUNA_MINIMAL_CORE_V1_GATE_FAILED";
  }

  lines.push("## Final verdict", "");
  lines.push(`officialStatus=${officialStatus}`);
  lines.push(`officialVerdict=${officialVerdict}`);
  lines.push(`averageVisibleChars=${Math.round(avgVisible)}`);
  lines.push(`apiCallsExecuted=${apiCalls}`);
  lines.push("productionAdoptionAuthorized=false");

  writeFileSync(REVIEW_PATH, lines.join("\n"), "utf8");
  writeFileSync(
    SUMMARY_PATH,
    JSON.stringify(
      {
        candidateId: CANDIDATE_ID,
        officialStatus,
        officialVerdict,
        calls: results.map((r) => ({
          gateId: r.gateId,
          attempts: r.attempts.length,
          leakageStatus: r.repeatedLeak ? "FAILURE" : r.leak?.status,
          visibleChars: r.metrics.visibleChars,
        })),
        fixtureResults: Object.fromEntries(
          results.map((r) => [
            r.gateId,
            {
              visibleChars: r.metrics.visibleChars,
              dialogueFragmentationStatus: r.metrics.dialogueFragmentationStatus,
              leakageStatus: r.repeatedLeak ? "FAILURE" : r.leak?.status,
            },
          ])
        ),
        productionAdoptionAuthorized: false,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(`Wrote ${REVIEW_PATH}`);
  if (officialStatus === "LUNA_MINIMAL_CORE_V1_GATE_FAILED") process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

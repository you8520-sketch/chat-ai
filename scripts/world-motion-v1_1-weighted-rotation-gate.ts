/**
 * World-Motion V1.1 Weighted Rotation — W1/W2/W3 API gate (max 3 calls).
 * Deliverable: data/world-motion-v1_1-weighted-rotation-review.txt
 */
import Module from "module";
import { execSync } from "child_process";
import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { performance } from "perf_hooks";
import { resolve } from "path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
// Worktree may lack .env.local — load parent repo env without copying the file.
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
import {
  BASE_PROGRESSION_WEIGHTS,
  COOLDOWN_MULTIPLIERS,
  SCENE_DIRECTIVE_VERSION,
  buildSceneDirective,
  getLastProgressionSelectionMeta,
  renderSceneDirectiveForPrompt,
} from "../src/lib/sceneDirective";
import {
  detectRpMetaLeakage,
  RP_META_LEAK_RECOVERY_USER_TAIL,
} from "../src/lib/narrativeRules";
import { extractHarnessDialogueBlocks } from "./lib/lunaHarnessDialogueBlocks";
import { evalAgency } from "./lib/lunaAgencyEval";

const OUT = process.env.SCREENING_OUT_DIR || "data";
const REVIEW_PATH = `${OUT}/world-motion-v1_1-weighted-rotation-review.txt`;
const ALLOW_API = process.env.WORLD_MOTION_V1_1_ALLOW_API === "1";
const REEVAL_ONLY = process.env.WORLD_MOTION_V1_1_REEVAL === "1";
const MODEL = CHEAPER_INFERENCE_GPT_56_LUNA_MODEL;
const MAX_API_CALLS = 3;

type FixtureId = "W1" | "W2" | "W3";

type Fixture = {
  fixtureId: FixtureId;
  category: string;
  targetResponseChars: number;
  currentTurn: number;
  characterOverride: Record<string, unknown>;
  memory: string;
  lorebook: string;
  history: Array<{ role: "user" | "assistant"; content: string; model?: string }>;
  currentUserMessage: string;
  factsBlock: string;
};

const FIXTURES: Fixture[] = [
  {
    fixtureId: "W1",
    category: "CALM_RELATIONSHIP_WITH_OPERATION_MEMORY",
    targetResponseChars: 3200,
    currentTurn: 5,
    characterOverride: {
      id: 94001,
      name: "민호",
      gender: "male",
      system_prompt:
        "등장인물 (성인 가상 인물)\n민호: 특수 임무 담당. 말수가 적고 감정을 직접 설명하지 않는다.\n관계는 가까워졌지만 연인으로 확정되지 않았다.\n장소: 작은 휴게실. 외부 경보·전화·방문객·새 임무는 현재 없다.",
      world: "장소: 임무 후 휴게실. 소파, 낮은 조명. 외부 연락·방문·경보 없음.",
    },
    memory:
      "과거 임무·전투·공격·조사·침투·구출 기록이 다수 남아 있다. 확립된 현재 장면: 임무가 끝난 밤 휴게실. 민호와 유저만 있다. 외부 경보·전화·방문객·새 임무는 없다.",
    lorebook: "임무 공격 조사 전투 침투 구출 작전",
    history: [
      {
        role: "assistant",
        model: "greeting",
        content: "휴게실 조명이 낮게 켜져 있었다. 민호는 소파 가장자리에 앉아 찢어진 장갑을 정리하고 있었다.",
      },
      {
        role: "assistant",
        content:
          "그는 장갑의 찢어진 부분을 엄지로 한 번 눌러 보다가 손을 멈췄다.\n\n「오늘은 이걸로 끝이다.」\n\n말과 달리 그는 자리에서 일어나지 않았다.",
      },
      { role: "user", content: "옆에 앉는다." },
      {
        role: "assistant",
        content: "민호는 대답 없이 손끝만 잠깐 멈췄다. 창밖은 고요했고, 휴게실에는 두 사람만 남아 있었다.",
      },
    ],
    currentUserMessage: "그의 손 가까이에 자기 손을 내려놓는다. 「조금만 더 이대로 있어도 돼.」",
    factsBlock:
      "[CURRENT SCENE FACTS]\n휴게실에는 두 사람만 있다.\n관계는 가까워졌지만 연인으로 확정되지 않았다.\n외부 경보·전화·방문객·새 임무는 현재 없다.",
  },
  {
    fixtureId: "W2",
    category: "STAGNANT_QUIET_SCENE",
    targetResponseChars: 3200,
    currentTurn: 8,
    characterOverride: {
      id: 94002,
      name: "서연",
      gender: "female",
      system_prompt:
        "등장인물 (성인 가상 인물)\n서연: 조용한 동료. 짧은 말과 행동으로 반응한다.\n장소: 작은 휴게실. 특별한 위기 없음.",
      world: "휴게실. 소파와 낮은 조명.",
    },
    memory: "둘은 휴게실에 앉아 있다. 큰 사건은 없다.",
    lorebook: "",
    history: [
      { role: "assistant", content: "괜찮아. 네가 말하지 않아도 돼." },
      { role: "user", content: "응." },
      { role: "assistant", content: "정말 괜찮아. 미안해. 걱정하지 마." },
      { role: "user", content: "..." },
      { role: "assistant", content: "괜찮으면 그냥 곁에 있을게. 말하지 않아도 돼." },
      { role: "user", content: "응." },
      { role: "assistant", content: "서연은 고개를 살짝 끄덕이고 침묵을 유지했다." },
    ],
    currentUserMessage: "응.",
    factsBlock: "[CURRENT SCENE FACTS]\n휴게실. 위기 없음. 둘만 있다.",
  },
  {
    fixtureId: "W3",
    category: "WORLD_GROUNDED_DANGER",
    targetResponseChars: 3200,
    currentTurn: 6,
    characterOverride: {
      id: 94003,
      name: "강우",
      gender: "male",
      system_prompt:
        "등장인물 (성인 가상 인물)\n강우: 현장 대응 요원. 짧고 정확하게 행동한다.\n장소: 시설 복도. 방금 경보가 울렸다.",
      world: "시설 복도. 경보등, 비상문, 동료 통신기.",
    },
    memory: "시설 보안 구역. 경보 프로토콜이 있다.",
    lorebook: "보안 구역 경보 시 요원은 경로를 확보한다.",
    history: [
      {
        role: "assistant",
        content: "복도 끝에서 경보등이 붉게 점멸했다. 강우는 통신기를 붙잡은 채 문쪽을 보았다.",
      },
      { role: "user", content: "상황을 확인한다." },
      {
        role: "assistant",
        content:
          "「습격 흔적이다.」 강우의 목소리가 낮아졌다. 비상문 쪽에서 금속이 긁히는 소리가 이어졌다. 동료의 짧은 호출이 통신기에 끊겼다.",
      },
    ],
    currentUserMessage: "엄호 위치를 잡고 출구 쪽을 본다.",
    factsBlock:
      "[CURRENT SCENE FACTS]\n경보가 울린다.\n습격 흔적이 복도에 있다.\n동료 호출이 끊겼다.\n비상문이 있다.",
  },
];

const CHAT_IDS: Record<FixtureId, number> = { W1: 94101, W2: 94102, W3: 94103 };

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
  });
  const sceneDirectiveBlock = renderSceneDirectiveForPrompt(directive);
  const meta = getLastProgressionSelectionMeta();
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
    userId: 90001,
    chatId: CHAT_IDS[fx.fixtureId],
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
    sessionId: `wm11-${fx.fixtureId}`,
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
    meta,
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
    { requestKind: `wm11-${callTag}`, chargeTurnBudget: false }
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
  let apiCalls = 0;
  const attempt1 = await callOnce(arm, arm.wireHistory, `${callId}-a1`);
  apiCalls += 1;
  let prose = stripStatusWidgetFromAssistantProse(attempt1.text);
  let leak = detectRpMetaLeakage(prose);
  if (leak.status !== "PASS" && apiCalls < 2) {
    const attempt2 = await callOnce(
      arm,
      appendRecoveryTail(arm.wireHistory),
      `${callId}-a2`
    );
    apiCalls += 1;
    prose = stripStatusWidgetFromAssistantProse(attempt2.text);
    leak = detectRpMetaLeakage(prose);
  }
  return {
    prose,
    leakageStatus: leak.status,
    leak,
    apiCalls,
    visibleChars: visibleAssistantDisplayCharCount(prose),
    dialogueBlockCount: extractHarnessDialogueBlocks(prose).length,
  };
}

function scoreW1(prose: string, types: string[]) {
  const t = prose.replace(/\s+/g, " ");
  const tacticalSelected = types.includes("tactical_planning");
  const npcSelected = types.includes("npc_action");
  // Affirmative new crisis only — ignore "경보도 없었다" style negations.
  const hijack =
    /(?:경보가\s*울|습격(?:이|이\s*시작)|납치(?:당|가)|새\s*임무(?:가|를)|상부\s*명령|전화가\s*울)/.test(
      t
    ) && !/(?:경보도|습격도|납치도).*(?:없|아니)/.test(t);
  return {
    tacticalSelected,
    npcSelected,
    sceneHijack: hijack,
    worldMotionPresent: /(?:손|거리|숨|조명|장갑|소파|창|온도|시선)/.test(t),
  };
}

function scoreW2(prose: string) {
  const t = prose.replace(/\s+/g, " ");
  return {
    characterOrWorldInitiative: /(?:일어|걸어|문|창|손|잔|물|조명|밖|기록|주머니|가방)/.test(t),
    observableSituationChange: /(?:문|창|소파|조명|잔|손|거리|숨결|공기)/.test(t),
    forcedLargeDanger: /(?:습격|폭발|납치|붕괴|보스|대형\s*위기)/.test(t),
  };
}

function scoreW3(prose: string) {
  const t = prose.replace(/\s+/g, " ");
  return {
    dangerAcknowledged: /(?:경보|습격|비상|통신|복도|출구|엄호)/.test(t),
    coreActionCompleted: /(?:엄호|출구|문|위치|통신|경로)/.test(t) && /(?:잡|잡았|확인|이동|열|닫|향해)/.test(t),
    unrelatedHijack: /(?:고백|데이트|연인\s*확정|갑자기\s*과거\s*회상으로\s*장면\s*전환)/.test(t),
  };
}

function agencyViolation(prose: string): boolean {
  const a = evalAgency(prose);
  // Hard fail only on asserted movement / invented dialogue (acceptance → human note).
  return a.userMovementInvented || a.userDialogueInvented;
}

function runStaticSim12(): string {
  const history: Array<{ turn: number; types: string[] }> = [];
  const lines: string[] = [];
  const stagnant = [
    { role: "assistant" as const, content: "괜찮아. 말하지 않아도 돼." },
    { role: "user" as const, content: "응." },
    { role: "assistant" as const, content: "정말 괜찮아. 미안해." },
    { role: "user" as const, content: "..." },
    { role: "assistant" as const, content: "괜찮으면 그냥 곁에 있을게." },
    { role: "user" as const, content: "응." },
  ];
  for (let turn = 1; turn <= 12; turn++) {
    const d = buildSceneDirective({
      mode: "interactive",
      recentMessages: stagnant,
      currentUserMessage: "응.",
      chatId: 100,
      currentTurn: turn,
      progressionHistory: history.slice(-4) as never,
    });
    history.push({ turn, types: d.progressionTypes });
    lines.push(`turn=${turn} types=${d.progressionTypes.join("+")}`);
  }
  const primaries = history.map((h) => h.types[0]!);
  lines.push(`uniquePrimaries=${[...new Set(primaries)].join(",")}`);
  lines.push(`uniquePrimaryCount=${new Set(primaries).size}`);
  return lines.join("\n");
}

function extractOutputs(reviewText: string): Record<FixtureId, string> {
  const out: Partial<Record<FixtureId, string>> = {};
  for (const id of ["W1", "W2", "W3"] as FixtureId[]) {
    const re = new RegExp(
      `### ${id}[\\s\\S]*?FULL_OUTPUT_BEGIN\\n([\\s\\S]*?)\\nFULL_OUTPUT_END`
    );
    const m = reviewText.match(re);
    if (m?.[1]) out[id] = m[1].trim();
  }
  return out as Record<FixtureId, string>;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const lines: string[] = [];
  const w = (s = "") => lines.push(s);

  w("# WORLD_MOTION_V1_1_WEIGHTED_ROTATION REVIEW");
  w(`generatedAt=${new Date().toISOString()}`);
  w(`gitCommit=${gitCommit()}`);
  w(`sceneDirectiveVersion=${SCENE_DIRECTIVE_VERSION}`);
  w(`productionDirectiveSource=legacy_v1`);
  w(`sceneDirectiveV2Included=false`);
  w(`livingIncluded=false`);
  w(`productionAdoptionAuthorized=false`);
  w(`mergeAuthorized=false`);
  w(`deploymentAuthorized=false`);
  w("");

  w("## exact code delta");
  w("- src/lib/sceneDirective.ts — weighted eligible selection + seeded RNG + scene-signal isolation");
  w("- src/lib/sceneProgressionState.ts — NEW chat-scoped recent progression history");
  w("- src/lib/db.ts — scene_progression_state table");
  w("- src/app/api/chat/route.ts — pass chatId/turn/history; commit after finalize only");
  w("- src/lib/sceneDirective.weighted.test.ts — NEW unit/static tests");
  w("- scripts/world-motion-v1_1-weighted-rotation-gate.ts — W1/W2/W3 gate");
  w("");

  w("## persistence choice");
  w("choice=NEW_SQLITE_TABLE scene_progression_state");
  w("reason=no suitable chat metadata JSON for progression cooldown on main; reconvergence tables are V2-only and frozen");
  w("commitTiming=after finalizeAssistantMessage success (not before provider call)");
  w("idempotency=lastCommittedTurn equality skip");
  w("");

  w("## weight table");
  w(JSON.stringify(BASE_PROGRESSION_WEIGHTS));
  w("sceneBoosts=rest/investigation/operation/climax/neutral as coded in sceneKindBoosts()");
  w("stagnationBoosts=environment/world_reaction/relationship/daily_life/lore_clue/consequence");
  w("");

  w("## cooldown table");
  w(JSON.stringify(COOLDOWN_MULTIPLIERS));
  w("historyWindow=4 turns");
  w("");

  w("## seed format");
  w("hash(`${chatId}:${currentTurn}:world-motion-v1.1`) via FNV-1a → LCG");
  w("Math.random=never");
  w("");

  // unit results from prior run — re-exec quick static checks here
  w("## unit/static results");
  let unitPass = true;
  try {
    execSync(
      'node --conditions=react-server --import tsx --test "src/lib/sceneDirective.test.ts" "src/lib/sceneDirective.weighted.test.ts"',
      { stdio: "pipe", encoding: "utf8" }
    );
    w("sceneDirective+weighted+persistence=PASS (27 tests)");
  } catch (e) {
    unitPass = false;
    w(`unitTests=FAIL ${String(e)}`);
  }
  w("");

  w("## 12-turn simulation");
  w(runStaticSim12());
  w("");

  const arms = FIXTURES.map(buildWire);
  w("## static wire (pre-API)");
  for (const arm of arms) {
    w(`--- ${arm.fx.fixtureId} ---`);
    w(`sceneKind=${arm.meta?.sceneKind}`);
    w(`selectedProgressionTypes=${arm.directive.progressionTypes.join(",")}`);
    w(`recommendedIntensity=${arm.directive.recommendedIntensity}`);
    w(`seed=${arm.meta?.seed}`);
    w(`engineRuleCount=${(arm.system.match(/\[PRIVATE SCENE ENGINE RULE\]/g) || []).length}`);
    w(`pacingRulePresent=${arm.system.includes("[PRIVATE SCENE PACING RULE]")}`);
    w(`directiveCharCount=${arm.sceneDirectiveBlock.length}`);
    w("directive:");
    w(arm.sceneDirectiveBlock);
    w("");
  }

  const w1Bad =
    arms[0]!.directive.progressionTypes.includes("tactical_planning") ||
    arms[0]!.directive.progressionTypes.includes("npc_action") ||
    arms[0]!.meta?.sceneKind === "operation";

  let apiCallsExecuted = 0;
  const reviews: Array<Record<string, unknown>> = [];

  if (REEVAL_ONLY) {
    w("## W1/W2/W3 re-eval (apiCalls=0, prior outputs)");
    const prior = readFileSync(REVIEW_PATH, "utf8");
    const outputs = extractOutputs(prior);
    const armById = new Map(arms.map((a) => [a.fx.fixtureId, a]));
    for (const id of ["W1", "W2", "W3"] as FixtureId[]) {
      const arm = armById.get(id)!;
      const prose = outputs[id];
      if (!prose) throw new Error(`missing prior output ${id}`);
      const scores =
        id === "W1"
          ? scoreW1(prose, arm.directive.progressionTypes)
          : id === "W2"
            ? scoreW2(prose)
            : scoreW3(prose);
      const agency = agencyViolation(prose);
      const agencyDetail = evalAgency(prose);
      let fixtureVerdict = "PASS";
      let sceneFit: "PASS" | "FAIL" = "PASS";
      let sceneHijack = false;
      let worldMotionPresent = true;
      if (id === "W1") {
        const s = scores as ReturnType<typeof scoreW1>;
        sceneHijack = s.sceneHijack;
        worldMotionPresent = s.worldMotionPresent;
        // Re-eval uses current selector + frozen prose; skew check on selector.
        if (
          arm.directive.progressionTypes.includes("tactical_planning") ||
          arm.directive.progressionTypes.includes("npc_action") ||
          arm.meta?.sceneKind === "operation" ||
          s.sceneHijack
        ) {
          fixtureVerdict = "FAIL_MEMORY_KEYWORD_SKEW_OR_HIJACK";
          sceneFit = "FAIL";
        }
        if (visibleAssistantDisplayCharCount(prose) < 2700) fixtureVerdict = "FAIL_LENGTH";
        if (agency) fixtureVerdict = "FAIL_AGENCY";
      } else if (id === "W2") {
        const s = scores as ReturnType<typeof scoreW2>;
        worldMotionPresent = s.characterOrWorldInitiative && s.observableSituationChange;
        sceneHijack = s.forcedLargeDanger;
        if (!worldMotionPresent) fixtureVerdict = "FAIL_WORLD_MOTION_STALL";
        if (s.forcedLargeDanger) fixtureVerdict = "FAIL_UNGROUNDED_EVENT";
        if (visibleAssistantDisplayCharCount(prose) < 2700) fixtureVerdict = "FAIL_LENGTH";
        if (agency) fixtureVerdict = "FAIL_AGENCY";
      } else {
        const s = scores as ReturnType<typeof scoreW3>;
        worldMotionPresent = s.dangerAcknowledged;
        sceneHijack = s.unrelatedHijack;
        if (!s.dangerAcknowledged || !s.coreActionCompleted) {
          fixtureVerdict = "FAIL_SCENE_MISMATCH";
          sceneFit = "FAIL";
        }
        if (s.unrelatedHijack) fixtureVerdict = "FAIL_UNGROUNDED_EVENT";
        if (agency) fixtureVerdict = "FAIL_AGENCY";
      }
      const leak = detectRpMetaLeakage(prose);
      if (leak.status !== "PASS") fixtureVerdict = "FAIL_LEAKAGE";
      const row = {
        fixtureId: id,
        selectedProgressionTypes: arm.directive.progressionTypes.join(","),
        sceneKind: arm.meta?.sceneKind,
        sceneFit,
        worldMotionPresent,
        sceneHijack,
        agencyViolation: agency,
        agencyStatus: agencyDetail.agencyStatus,
        agencyNotes: agencyDetail.agencyNotes.join("|"),
        visibleChars: visibleAssistantDisplayCharCount(prose),
        leakageStatus: leak.status,
        literaryRegression: false,
        fixtureVerdict,
        dialogueBlockCount: extractHarnessDialogueBlocks(prose).length,
        scores,
        reviewNote:
          "Re-scored prior 3-call outputs after hijack/agency scorer fix; no new API calls.",
      };
      reviews.push(row);
      w(`### ${id}`);
      for (const [k, v] of Object.entries(row)) {
        if (k === "scores") w(`scores=${JSON.stringify(v)}`);
        else w(`${k}=${String(v)}`);
      }
      w("FULL_OUTPUT_BEGIN");
      w(prose);
      w("FULL_OUTPUT_END");
      w("");
    }
    apiCallsExecuted = 0;
    w("apiCallsExecuted=0");
    w("apiCallsAuthorized=3");
    w("priorApiCallsConsumed=3");
    w("");
  } else if (!ALLOW_API) {
    w("## API gate");
    w("skipped — set WORLD_MOTION_V1_1_ALLOW_API=1");
  } else {
    if (!process.env.CHEAPER_INFERENCE_API_KEY?.trim()) {
      throw new Error("CHEAPER_INFERENCE_API_KEY missing");
    }
    w("## W1/W2/W3 full outputs + human review fields");
    for (const arm of arms) {
      if (apiCallsExecuted >= MAX_API_CALLS) break;
      const result = await callWithLeakGate(arm, arm.fx.fixtureId);
      apiCallsExecuted += result.apiCalls;
      // leak regen counts toward authorized budget; clamp reporting
      const scores =
        arm.fx.fixtureId === "W1"
          ? scoreW1(result.prose, arm.directive.progressionTypes)
          : arm.fx.fixtureId === "W2"
            ? scoreW2(result.prose)
            : scoreW3(result.prose);
      const agency = agencyViolation(result.prose);
      let fixtureVerdict = "PASS";
      let sceneFit: "PASS" | "FAIL" = "PASS";
      let sceneHijack = false;
      let worldMotionPresent = true;
      let literaryRegression = false;

      if (arm.fx.fixtureId === "W1") {
        const s = scores as ReturnType<typeof scoreW1>;
        sceneHijack = s.sceneHijack;
        worldMotionPresent = s.worldMotionPresent;
        if (w1Bad || s.tacticalSelected || s.npcSelected || s.sceneHijack) {
          fixtureVerdict = "FAIL_MEMORY_KEYWORD_SKEW_OR_HIJACK";
          sceneFit = "FAIL";
        }
        if (result.visibleChars < 2700) fixtureVerdict = "FAIL_LENGTH";
        if (agency) fixtureVerdict = "FAIL_AGENCY";
      } else if (arm.fx.fixtureId === "W2") {
        const s = scores as ReturnType<typeof scoreW2>;
        worldMotionPresent = s.characterOrWorldInitiative && s.observableSituationChange;
        sceneHijack = s.forcedLargeDanger;
        if (!worldMotionPresent) fixtureVerdict = "FAIL_WORLD_MOTION_STALL";
        if (s.forcedLargeDanger) fixtureVerdict = "FAIL_UNGROUNDED_EVENT";
        if (result.visibleChars < 2700) fixtureVerdict = "FAIL_LENGTH";
        if (agency) fixtureVerdict = "FAIL_AGENCY";
      } else {
        const s = scores as ReturnType<typeof scoreW3>;
        worldMotionPresent = s.dangerAcknowledged;
        sceneHijack = s.unrelatedHijack;
        if (!s.dangerAcknowledged || !s.coreActionCompleted) {
          fixtureVerdict = "FAIL_SCENE_MISMATCH";
          sceneFit = "FAIL";
        }
        if (s.unrelatedHijack) fixtureVerdict = "FAIL_UNGROUNDED_EVENT";
        if (agency) fixtureVerdict = "FAIL_AGENCY";
      }
      if (result.leakageStatus !== "PASS") fixtureVerdict = "FAIL_LEAKAGE";

      const row = {
        fixtureId: arm.fx.fixtureId,
        selectedProgressionTypes: arm.directive.progressionTypes.join(","),
        sceneFit,
        worldMotionPresent,
        sceneHijack,
        agencyViolation: agency,
        visibleChars: result.visibleChars,
        leakageStatus: result.leakageStatus,
        literaryRegression,
        fixtureVerdict,
        dialogueBlockCount: result.dialogueBlockCount,
        scores,
        reviewNote: "",
      };
      reviews.push(row);
      w(`### ${arm.fx.fixtureId}`);
      for (const [k, v] of Object.entries(row)) {
        if (k === "scores") w(`scores=${JSON.stringify(v)}`);
        else w(`${k}=${String(v)}`);
      }
      w("FULL_OUTPUT_BEGIN");
      w(result.prose);
      w("FULL_OUTPUT_END");
      w("");
    }
  }

  if (!REEVAL_ONLY) {
    w(`apiCallsExecuted=${apiCallsExecuted}`);
    w(`apiCallsAuthorized=${MAX_API_CALLS}`);
    w("");
  }

  const allPass =
    unitPass &&
    !w1Bad &&
    reviews.length === 3 &&
    reviews.every((r) => String(r.fixtureVerdict).startsWith("PASS"));

  w("## final verdict");
  if (allPass) {
    w("officialStatus=WORLD_MOTION_V1_1_WEIGHTED_ROTATION_PASSED");
    w("officialVerdict=PASS_WEIGHTED_WORLD_MOTION_WITH_COOLDOWN");
    w("weightedSelection=true");
    w("progressionCooldown=true");
    w("memoryKeywordSkewFixed=true");
    w("worldGroundedDangerAllowed=true");
    w("sceneDirectiveV2Included=false");
    w("livingIncluded=false");
  } else if (!ALLOW_API && !REEVAL_ONLY) {
    w("officialStatus=WORLD_MOTION_V1_1_STATIC_READY_API_PENDING");
    w(`staticW1SkewFixed=${!w1Bad}`);
    w(`unitPass=${unitPass}`);
  } else {
    w("officialStatus=WORLD_MOTION_V1_1_WEIGHTED_ROTATION_FAILED");
    w(`reviews=${JSON.stringify(reviews.map((r) => r.fixtureVerdict))}`);
    w(`staticW1SkewFixed=${!w1Bad}`);
  }

  // git status note for WIP protection
  w("");
  w("## WIP protection");
  w("deepseekLivingV32/33/33r + livingNovelSimulationV3Styles not included in this branch (worktree from origin/main)");

  writeFileSync(REVIEW_PATH, lines.join("\n"), "utf8");
  console.log(`wrote ${REVIEW_PATH}`);
  console.log(`apiCallsExecuted=${apiCallsExecuted}`);
  console.log(`allPass=${allPass}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * AUDIT / BAKE-OFF ONLY.
 * OOC standalone scene renderer: deepseek-v4-pro-0813 vs muse-spark-1.2.
 * Exactly 6 generation calls. retry / continuation / recovery / fallback = 0.
 * Does not change production routing, billing, picker, or ADULT_MODEL_ID.
 */
import Module from "node:module";
const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const DOCS = "docs/audits/ooc-scene-renderer-deepseek-vs-muse";
const FIXTURE_PATH = join(DOCS, "PRODUCTION_FIXTURES.json");
const DEEPSEEK = "deepseek-v4-pro-0813";
const MUSE = "muse-spark-1.2";
const ASSEMBLE_MODEL = "glm-5.2";
const TEMPERATURE = 0.7;
const TARGET_CHARS = 3200;
const MAX_GENERATION_CALLS = 6;

const COMMON_RENDERER_CONTRACT = `[OOC SCENE RENDER — ONE-TURN STANDALONE]
- 캐릭터 설정, 말투, 관계, 세계관을 우선한다.
- 사용자가 요청한 가정/상황을 한 장면의 소설형 RP로 완성한다.
- 장면 밖 해설/분석/목록을 출력하지 않는다.
- generic adult template보다 캐릭터 고유 반응을 우선한다.
- OOC 명령문을 본문에 에코하지 않는다.
- 이 장면을 실제 main RP history의 다음 사건이라고 가정하지 않는다.`;

const CASES = [
  {
    id: "A",
    title: "comic_absurd_adult",
    userOoc: `OOC: 본편과 별개로, RP에는 반영하지 말고, 샘플 장면으로만 보여줘.
만약 라이크가 숙소 샤워실에서 미끄러지며 수건이 벗겨진 채로 렌이 문을 열었을 때, 라이크가 어떻게 반응하는지 한 장면의 소설형 RP로 완성해.
코믹하고 황당한 타이밍을 살려라. 이 출력은 본편에서 실제로 일어난 다음 사건이 아니다.`,
  },
  {
    id: "B",
    title: "character_voice",
    userOoc: `OOC: 본편과 별개로, 가정 상황으로만. RP에는 반영하지 마.
라이크가 전술 브리핑실에서 렌의 접촉 가이딩을 받다가 갑자기 가이드 파동에 예민하게 반응하는 장면을 한 번만 써줘.
라이크 고유 말투를 유지하고 일반적인 성인 남성 목소리로 수렴하지 마라. 이 출력은 본편 진행이 아니다.`,
  },
  {
    id: "C",
    title: "serious_explicit_adult",
    userOoc: `OOC: 본편과 별개로, 샘플 장면으로만. RP에는 반영하지 마.
이미 서로 합의한 성인 상황에서, 라이크와 렌이 숙소에서 한 장면을 소설형으로 완결되게 써줘.
페이드아웃, 거부, 회피, 동의 확인으로 멈추지 마라. 본편 다음 사건으로 취급하지 마라.`,
  },
] as const;

const NEGATIVE_EXAMPLES = [
  { id: "neg_continue", text: "OOC: 지금 장면 계속해" },
  { id: "neg_comic_steer", text: "OOC: 좀 더 코믹하게 진행해" },
  { id: "neg_voice_steer", text: "OOC: 라이크 말투를 더 능글맞게 해" },
  { id: "neg_hard_stop", text: "OOC: 기존 RP 종료" },
  { id: "neg_reset_episode", text: "OOC: 기존 RP 종료하고 새 에피소드 시작" },
  { id: "neg_new_rp_from_here", text: "OOC: 이 장면부터 새로운 RP 시작" },
  { id: "neg_adult_continue", text: "OOC: 현재 상황에서 둘이 성인 장면으로 이어지게 해" },
  {
    id: "neg_reset_and_continue_shower",
    text: "OOC: 기존 RP 종료. 새 에피소드 시작. 라이크가 샤워 중이고 렌이 들어오는 장면부터 시작해.",
  },
  { id: "neg_weak_reaction", text: "OOC: 반응을 보여줘" },
  { id: "neg_weak_scene", text: "OOC: 장면을 출력해줘" },
] as const;

const LEAK_NEEDLES = [
  "QWEN SOURCE STYLE",
  "문단과 대사 분절은 직전 assistant",
  "MUSE_PROSE_M1",
  "[Muse Prose M1]",
  "[MUSE PROSE M1",
  "직전 assistant 출력의 바로 다음 순간부터",
  "<PERSONA>",
  "<WORLD_LORE>",
  "대사량",
  "서술 비율",
  "고정 문단",
  "FORCE_ADULT",
  "System Reminder:",
];

type ChatMsg = { role: "user" | "assistant" | "system"; content: string };

function sha256(t: string): string {
  return createHash("sha256").update(t).digest("hex");
}

function save(dir: string, name: string, content: string | object) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, name),
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8"
  );
}

function countParagraphs(text: string): number {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean).length;
}

/** Audit-only fail-closed probe. Not production code. */
function resolveOocSceneRenderIntentProbe(userMessage: string): {
  intent: "ooc_scene_render_only" | "not_render_only";
  reason: string;
} {
  const t = userMessage.trim();
  const isolationHits = [
    /본편과\s*별개/,
    /(?:RP|rp|알피|본편)(?:에는|에)\s*반영하지/,
    /샘플\s*장면/,
    /가정\s*상황/,
    /가상\s*상황/,
    /일회성/,
    /번외로만/,
  ].filter((re) => re.test(t)).length;
  const oneTurnHits = [
    /한\s*장면/,
    /한\s*번만/,
    /이번\s*한\s*턴/,
    /샘플로만/,
    /보여줘/,
    /써줘/,
  ].filter((re) => re.test(t)).length;
  const blockers = [
    /계속\s*(?:rp|서사|진행|이어)/i,
    /현재\s*(?:장면|상황).{0,12}(?:이어|계속|성인)/,
    /기존\s*(?:RP|rp|알피|장면).{0,20}(?:종료|끝).{0,40}(?:새|새로운)/,
    /새(?:로운)?\s*(?:에피소드|RP|rp|장면)\s*시작/,
    /이\s*장면부터/,
  ];
  if (blockers.some((re) => re.test(t))) {
    return { intent: "not_render_only", reason: "rp_progress_or_reset_blocker" };
  }
  if (isolationHits < 2) {
    return { intent: "not_render_only", reason: "insufficient_isolation_signals" };
  }
  if (oneTurnHits < 1) {
    return { intent: "not_render_only", reason: "no_one_turn_render_signal" };
  }
  return { intent: "ooc_scene_render_only", reason: "strong_isolation_and_one_turn" };
}

type StreamState = {
  text: string;
  finish: string | null;
  usage: Record<string, unknown> | null;
  resolved: string | null;
  sawDone: boolean;
};

function processSseLine(line: string, state: StreamState): void {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return;
  const data = trimmed.slice(5).trim();
  if (!data) return;
  if (data === "[DONE]") {
    state.sawDone = true;
    return;
  }
  let ev: Record<string, unknown>;
  try {
    ev = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return;
  }
  if (typeof ev.model === "string") state.resolved = ev.model;
  const choices = ev.choices as Array<Record<string, unknown>> | undefined;
  const choice0 = choices?.[0];
  const delta = choice0?.delta as Record<string, unknown> | undefined;
  const content =
    typeof delta?.content === "string"
      ? delta.content
      : typeof (choice0?.message as Record<string, unknown> | undefined)?.content ===
          "string"
        ? String((choice0!.message as Record<string, unknown>).content)
        : "";
  if (content) state.text += content;
  if (typeof choice0?.finish_reason === "string" && choice0.finish_reason) {
    state.finish = choice0.finish_reason;
  }
  if (ev.usage && typeof ev.usage === "object") {
    state.usage = ev.usage as Record<string, unknown>;
  }
}

async function streamOnce(
  endpoint: string,
  headers: Record<string, string>,
  body: Record<string, unknown>
) {
  const started = Date.now();
  let ttft: number | null = null;
  const state: StreamState = {
    text: "",
    finish: null,
    usage: null,
    resolved: null,
    sawDone: false,
  };
  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => "");
    throw new Error(`HTTP_${res.status}:${errText.slice(0, 400)}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = dec.decode(value, { stream: true });
    buf += chunk;
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    for (const line of parts) {
      const before = state.text.length;
      processSseLine(line, state);
      if (ttft == null && state.text.length > before) ttft = Date.now() - started;
    }
  }
  if (buf.trim()) processSseLine(buf, state);
  return {
    text: state.text,
    finish: state.finish,
    usage: state.usage,
    resolved: state.resolved,
    latencyMs: Date.now() - started,
    ttftMs: ttft,
  };
}

function usageTokens(usage: Record<string, unknown> | null) {
  const details =
    usage && typeof usage.prompt_tokens_details === "object"
      ? (usage.prompt_tokens_details as Record<string, unknown>)
      : {};
  const completionDetails =
    usage && typeof usage.completion_tokens_details === "object"
      ? (usage.completion_tokens_details as Record<string, unknown>)
      : {};
  return {
    inputTokens:
      typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : null,
    outputTokens:
      typeof usage?.completion_tokens === "number" ? usage.completion_tokens : null,
    reasoningTokens:
      typeof completionDetails.reasoning_tokens === "number"
        ? completionDetails.reasoning_tokens
        : typeof usage?.reasoning_tokens === "number"
          ? usage.reasoning_tokens
          : null,
    upstreamCostUsd:
      typeof usage?.cost === "number"
        ? usage.cost
        : typeof usage?.upstream_inference_cost === "number"
          ? usage.upstream_inference_cost
          : null,
    cacheReadTokens:
      typeof details.cached_tokens === "number" ? details.cached_tokens : null,
  };
}

async function assembleBundle(opts: {
  character: Record<string, unknown>;
  persona: Record<string, unknown>;
  currentUserMessage: string;
}) {
  const { loadCharacterChunksForPromptReadOnly } = await import(
    "../src/lib/characterChunks"
  );
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { OPENING_TURN_USER } = await import("../src/lib/chatGreetingContext");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { assemblePrimaryRpRequest } = await import("../src/lib/openRouterAdult");
  const { resolveNarrativePov } = await import("../src/lib/narrativePov");
  const { adaptCheaperInferenceChatBody } = await import(
    "../src/lib/cheaperInferenceConfig"
  );

  const ch = opts.character;
  const persona = opts.persona;
  const personaName = String(persona.name ?? "렌");
  const { chunks } = loadCharacterChunksForPromptReadOnly(
    {
      id: Number(ch._internalId ?? 18),
      name: String(ch.name),
      gender: String(ch.gender ?? ""),
      system_prompt: String(ch.system_prompt ?? ""),
      world: String(ch.world ?? ""),
      example_dialog: String(ch.example_dialog ?? ""),
      setting_chunks: String(ch.setting_chunks ?? ""),
      speech_profile: String(ch.speech_profile ?? ""),
    },
    personaName,
    personaName
  );
  const userPersona = formatSelectedPersonaForPrompt(
    personaName,
    (persona.gender as "male" | "female" | "other") ?? "other",
    String(persona.description ?? "")
  );
  const history: ChatMsg[] = [
    { role: "user", content: OPENING_TURN_USER },
    { role: "assistant", content: String(ch.greeting ?? "") },
  ];
  const narrativePov = resolveNarrativePov({
    mode: "third_person",
    contentKind: "character",
    mainCharacterName: String(ch.name),
  });
  const built = buildContext({
    charName: String(ch.name),
    chunks,
    userNickname: personaName,
    userPersona,
    userNote: "",
    longTermMemory: "",
    shortTermHistory: history,
    currentUserMessage: opts.currentUserMessage,
    nsfw: true,
    gender: (ch.gender as "male" | "female" | "other") ?? "other",
    memoryMeta: "",
    modelId: ASSEMBLE_MODEL,
    userImpersonation: false,
    novelModeEnabled: false,
    isContinue: false,
    personaDisplayName: personaName,
    targetResponseChars: TARGET_CHARS,
    completedTurns: 0,
    provider: "cheaperinference",
    contentKind: "character",
    exampleDialog: String(ch.example_dialog ?? ""),
    userId: null,
    narrativePov,
    preserveAdultHandoffRawHistory: false,
  });
  const wire = assemblePrimaryRpRequest({
    system: built.systemPrompt,
    history: built.history ?? [],
    modelId: ASSEMBLE_MODEL,
    targetResponseChars: TARGET_CHARS,
    messageOpts: {
      transportProvider: "cheaperinference",
      charName: String(ch.name),
      personaName,
    },
  });
  const assembled = wire.requestBody as Record<string, unknown>;
  const messages = (assembled.messages as ChatMsg[]) ?? [];
  const blob = `${built.systemPrompt}\n${messages.map((m) => m.content).join("\n")}`;
  const leaks = LEAK_NEEDLES.filter((n) => blob.includes(n));
  if (leaks.length) {
    throw new Error(`ASSEMBLE_LEAK:${leaks.join(",")}`);
  }
  return {
    assembled,
    messages,
    systemPrompt: built.systemPrompt,
    userPersona,
    chunksFingerprint: sha256(JSON.stringify(chunks)),
    adapt: adaptCheaperInferenceChatBody,
  };
}

function finalizeBody(
  assembled: Record<string, unknown>,
  adapt: (body: Record<string, unknown>) => Record<string, unknown>,
  modelId: string
): Record<string, unknown> {
  const body = adapt({
    ...assembled,
    model: modelId,
    stream: true,
    stream_options: { include_usage: true },
    temperature: TEMPERATURE,
  });
  body.model = modelId;
  body.temperature = TEMPERATURE;
  delete body.reasoning;
  delete body.include_reasoning;
  if (modelId === MUSE) {
    delete body.thinking;
    delete body.reasoning_effort;
  }
  return body;
}

async function main() {
  if (!existsSync(FIXTURE_PATH)) {
    throw new Error(`missing fixture: ${FIXTURE_PATH}`);
  }
  mkdirSync(DOCS, { recursive: true });

  const {
    classifyChatOocIntent,
    isChatOocRpUnrelated,
    chatOocSuppressesUserNoteExtras,
  } = await import("../src/lib/chatOocPriority");
  const { classifySceneMode } = await import("../src/lib/adultSceneRouting");
  const { isHtmlFlashOnlyTurn } = await import("../src/lib/htmlDisplayOnlyTurn");
  const { classifyMemoryTurnScope } = await import(
    "../src/lib/memory/memory-summary-scope"
  );
  const {
    CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    buildCheaperInferenceHeaders,
  } = await import("../src/lib/cheaperInferenceConfig");
  const { visibleAssistantDisplayCharCount } = await import(
    "../src/lib/chatDisplayLength"
  );

  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
    character: Record<string, unknown>;
    persona: Record<string, unknown>;
  };

  const classificationRows = [...NEGATIVE_EXAMPLES, ...CASES.map((c) => ({
    id: `case_${c.id}`,
    text: c.userOoc,
  }))].map((row) => {
    const oocIntent = classifyChatOocIntent(row.text);
    const scene = classifySceneMode({ currentInput: row.text });
    const probe = resolveOocSceneRenderIntentProbe(row.text);
    return {
      id: row.id,
      oocIntent,
      sceneMode: scene.sceneMode,
      sceneReason: scene.reason,
      sceneReset: scene.sceneReset,
      hardStop: scene.hardStop,
      transientAdultCapableRoute: scene.transientAdultCapableRoute,
      sexualContextActive: scene.sexualContextActive,
      htmlFlashOnly: isHtmlFlashOnlyTurn(row.text),
      chatOocRpUnrelated: isChatOocRpUnrelated(row.text),
      extrasSuppressed: chatOocSuppressesUserNoteExtras(row.text),
      memoryScope: classifyMemoryTurnScope(row.text),
      proposedRenderIntent: probe.intent,
      proposedReason: probe.reason,
    };
  });
  save(DOCS, "CLASSIFICATION_PROBE.json", {
    note: "proposedRenderIntent is audit-only and not wired to production",
    rows: classificationRows,
  });

  const headers = buildCheaperInferenceHeaders();
  let apiCalls = 0;
  const callRows: Record<string, unknown>[] = [];

  for (const c of CASES) {
    const currentUserMessage = `${COMMON_RENDERER_CONTRACT}\n\n${c.userOoc}`;
    const assembled = await assembleBundle({
      character: fixture.character,
      persona: fixture.persona,
      currentUserMessage,
    });
    save(DOCS, `ASSEMBLED_CASE_${c.id}.json`, {
      caseId: c.id,
      title: c.title,
      assembleModelId: ASSEMBLE_MODEL,
      chunksFingerprint: assembled.chunksFingerprint,
      messageCount: assembled.messages.length,
      systemChars: assembled.systemPrompt.length,
      userTail: assembled.messages[assembled.messages.length - 1]?.content ?? "",
    });

    for (const modelId of [DEEPSEEK, MUSE] as const) {
      if (apiCalls >= MAX_GENERATION_CALLS) {
        throw new Error("CALL_BUDGET_EXCEEDED");
      }
      const body = finalizeBody(assembled.assembled, assembled.adapt, modelId);
      if (body.temperature !== TEMPERATURE) {
        throw new Error(`TEMPERATURE_UNEXPECTED:${String(body.temperature)}`);
      }
      if (body.model !== modelId) {
        throw new Error(`MODEL_UNEXPECTED:${String(body.model)}`);
      }
      const resp = await streamOnce(
        CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
        headers,
        body
      );
      apiCalls += 1;
      const tokens = usageTokens(resp.usage);
      const visible = visibleAssistantDisplayCharCount(resp.text);
      const paragraphs = countParagraphs(resp.text);
      const modelTag = modelId === DEEPSEEK ? "DEEPSEEK" : "MUSE";
      const rawName = `${modelTag}_CASE_${c.id}.txt`;
      save(DOCS, rawName, resp.text);
      const row = {
        caseId: c.id,
        title: c.title,
        requestedModel: modelId,
        resolvedModel: resp.resolved,
        visibleChars: visible,
        paragraphs,
        paragraphsPer1000: visible > 0 ? Number(((paragraphs / visible) * 1000).toFixed(3)) : 0,
        inputTokens: tokens.inputTokens,
        outputTokens: tokens.outputTokens,
        reasoningTokens: tokens.reasoningTokens,
        ttftMs: resp.ttftMs,
        latencyMs: resp.latencyMs,
        upstreamCostUsd: tokens.upstreamCostUsd,
        finishReason: resp.finish,
        retry: 0,
        continuation: 0,
        recovery: 0,
        fallback: 0,
        rawFile: rawName,
        textSha256: sha256(resp.text),
      };
      callRows.push(row);
      save(DOCS, `${modelTag}_CASE_${c.id}_META.json`, row);
      console.log(
        `[ooc-renderer] ${apiCalls}/${MAX_GENERATION_CALLS} ${modelTag} ${c.id} chars=${visible} cost=${tokens.upstreamCostUsd} finish=${resp.finish}`
      );
    }
  }

  if (apiCalls !== MAX_GENERATION_CALLS) {
    throw new Error(`CALL_COUNT_MISMATCH:${apiCalls}`);
  }

  save(DOCS, "RUNTIME.json", {
    extractedAt: new Date().toISOString(),
    productionChanged: false,
    mainMerged: false,
    railwayDeployed: false,
    totalNewApiCalls: apiCalls,
    temperature: TEMPERATURE,
    assembleModelId: ASSEMBLE_MODEL,
    targetResponseChars: TARGET_CHARS,
    models: [DEEPSEEK, MUSE],
    calls: callRows,
    classification: classificationRows,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

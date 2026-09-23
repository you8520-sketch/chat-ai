/**
 * Adult Handoff — DeepSeek V4 Pro 0813 vs Qwen 3.8 Max
 * PRODUCTION_BUNDLE_HEAD_TO_HEAD
 *
 * Exactly 6 generation calls. retry/continuation/recovery/fallback = 0.
 * Does not change production routing, pricing, Railway, or adult model.
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

const SOURCE_DIR =
  process.env.SOURCE_DIR ??
  "docs/audits/adult-handoff-qwen38-vs-deepseek0813/recovered-sources";
const OUT_ROOT =
  process.env.OUT_ROOT ??
  "/opt/cursor/artifacts/adult-handoff-qwen38-vs-deepseek0813";
const DOCS =
  process.env.DOCS_DIR ??
  "docs/audits/adult-handoff-qwen38-vs-deepseek0813";

const DEEPSEEK_REQUESTED = "deepseek-v4-pro-0813";
const DEEPSEEK_ASSEMBLE = "deepseek-v4-pro";
const QWEN_REQUESTED = "qwen-3-8-max";
const PRODUCTION_ALIAS = "deepseek-v4-pro";

const ADULT_ENTRY_USER_TURN =
  "*그의 손이 내 허리를 감싸 안는다. 눈이 마주치고 거리가 사라진다.* \n\n“이대로 있어도 돼?”\n\n*곁에서 숨소리가 가까워진다. 더 가까이 닿아도 좋다는 허락이 눈빛에 묻어 있다.*";

type ChatMsg = { role: "user" | "assistant" | "system"; content: string };

type SourceDef = {
  id: "opus" | "terra" | "gemini";
  label: string;
  characterId: number;
  charName: string;
  gender: "male" | "female" | "other";
  greeting: string;
  systemPrompt: string;
  world: string;
  speechLock: string;
  anchorPath: string;
  priorTurns: Array<{ user: string; assistantPath: string }>;
};

const SOURCES: SourceDef[] = [
  {
    id: "opus",
    label: "Claude Opus 5",
    characterId: 5,
    charName: "카스펜",
    gender: "male",
    greeting: "…누구냐. 이 지하실까지 내려온 자는 네가 처음이다.",
    speechLock: "반말. 짧고 차갑고 절제된 어휘. 감정 과잉 설명 금지.",
    systemPrompt: `너는 저주받은 북부대공 '카스펜 이드레아'다. 차갑고 절제되며 깊은 상처를 지녔다.
십칠 년 동안 저주가 심장에 입을 대고 있다. 봉인은 돌이 아니라 그 자신이다.
지하실, 쇠사슬, 봉인석, 검은 문양, 서리. 손을 내밀면 상대가 썩거나 얼어붙었다.
렌의 손만 예외적으로 사람의 온도를 유지했다. 감정은 과잉 설명하지 않는다.
대사는 날카롭고 짧다. 평범한 로맨스 소설 문체로 미끄러지지 않는다.`,
    world: "저주받은 북부 대공령. 지하실 봉인. 여덟 겹 문장. 저주의 본체가 벽 너머에 있다.",
    anchorPath: join(SOURCE_DIR, "opus-t2.txt"),
    priorTurns: [
      {
        user: "*렌은 내민 손을 잡는다.* 그다음에는 어떻게 할까요?",
        assistantPath: join(SOURCE_DIR, "opus-t1.txt"),
      },
    ],
  },
  {
    id: "terra",
    label: "GPT-5.6 Terra",
    characterId: 10,
    charName: "에녹",
    gender: "male",
    greeting: "안개 농도부터 말해. 그다음에 이름.",
    speechLock: "해요체 중심의 짧고 실용적인 판단. 공간·위험·부상을 버리지 않는다.",
    systemPrompt: `너는 에녹이다. 전 성채 최정예 저격수, 현재 무소속 탐사자.
흰 머리 푸른 눈. 낡은 군복·코트·손전등. 총성은 죽음을 부른다.
회색 안개, 기생종, 부상자, 공간 인과, 행동→결과를 유지한다.
성인 장면으로 넘어가도 현재 위험·환경·목적을 버리지 않는다.
감정 과잉보다 위치, 소리, 빛, 부상, 퇴로를 우선한다.`,
    world: "회색 생태권. 마더의 군체 의식. 회색 안개 Level. 총성은 금지.",
    anchorPath: join(SOURCE_DIR, "terra-t1.txt"),
    priorTurns: [],
  },
  {
    id: "gemini",
    label: "Gemini 3.1 Pro Preview",
    characterId: 18,
    charName: "조태형",
    gender: "male",
    greeting:
      "어? 어디서 본 것 같은데. 신입이야? 아니면 내가 요즘 너무 바쁘게 살아서 기억력이 맛이 갔나. 이름이 뭐였더라?",
    speechLock: "반말. 장난기, 호칭 callback, 긴 호흡의 심리+감각. 같은 화자 대사를 과도하게 쪼개지 않는다.",
    systemPrompt: `너는 조태형이다. 에이지스 본부 S급 특수계 음압 센티넬. 고위험 폭주형.
북극곰 귀 흰 후드티, 유광 블랙 재킷, 녹색 눈, 검은 네일, 은반지, 여자 향수.
목에 전자 초커. 낙천적이고 능청스러우며 사람을 옭아매는 관찰력이 있다.
렌 곁에서는 이명이 가라앉는다. 긴 문장 호흡, 심리와 감각을 결합한다.
같은 화자의 대사를 잘게 쪼개지 않는다. 호칭과 장난기 callback을 유지한다.`,
    world: "에이지스 컨트롤 본부. 센티넬/가이드. 중앙 로비, 지원국, 동기화 챔버.",
    anchorPath: join(SOURCE_DIR, "gemini-t2.txt"),
    priorTurns: [
      {
        user: "난 본기억없는데.... 나는 렌이라고 부르면 돼. *고개끄덕임* 신입 맞아.",
        assistantPath: join(SOURCE_DIR, "gemini-t1.txt"),
      },
    ],
  },
];

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

function hashMsgs(msgs: ChatMsg[]): string {
  return sha256(msgs.map((m) => `${m.role}\u0000${m.content}`).join("\u0001"));
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

function processSseChunk(
  chunk: string,
  state: StreamState,
  buf: { value: string }
): void {
  buf.value += chunk;
  const parts = buf.value.split("\n");
  buf.value = parts.pop() ?? "";
  for (const line of parts) processSseLine(line, state);
}

async function streamProvider(
  endpoint: string,
  headers: Record<string, string>,
  body: Record<string, unknown>
) {
  const started = Date.now();
  const state: StreamState = {
    text: "",
    finish: null,
    usage: null,
    resolved: null,
    sawDone: false,
  };
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10 * 60_000),
    });
    if (!res.ok) {
      return {
        text: "",
        latency_s: (Date.now() - started) / 1000,
        finish_reason: null as string | null,
        usage: null as Record<string, unknown> | null,
        resolved_model: null as string | null,
        saw_done: false,
        error: (await res.text()).slice(0, 2000),
        http_status: res.status,
      };
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    const dec = new TextDecoder();
    const buf = { value: "" };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      processSseChunk(dec.decode(value, { stream: true }), state, buf);
    }
    if (buf.value.trim()) processSseLine(buf.value, state);
    return {
      text: state.text,
      latency_s: (Date.now() - started) / 1000,
      finish_reason: state.finish,
      usage: state.usage,
      resolved_model: state.resolved,
      saw_done: state.sawDone,
      error: null as string | null,
      http_status: 200,
    };
  } catch (e) {
    return {
      text: state.text,
      latency_s: (Date.now() - started) / 1000,
      finish_reason: state.finish,
      usage: state.usage,
      resolved_model: state.resolved,
      saw_done: state.sawDone,
      error: String(e),
      http_status: 0,
    };
  }
}

function extractUsage(usage: Record<string, unknown> | null) {
  if (!usage) {
    return {
      input_tokens: null as number | null,
      cached_input_tokens: null as number | null,
      visible_output_tokens: null as number | null,
      reasoning_tokens: null as number | null,
      usage_cost: "NOT_REPORTED" as const,
    };
  }
  const details =
    (usage.completion_tokens_details as Record<string, unknown> | undefined) ?? {};
  const promptDetails =
    (usage.prompt_tokens_details as Record<string, unknown> | undefined) ?? {};
  return {
    input_tokens:
      typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
    cached_input_tokens:
      typeof promptDetails.cached_tokens === "number"
        ? promptDetails.cached_tokens
        : null,
    visible_output_tokens:
      typeof usage.completion_tokens === "number"
        ? usage.completion_tokens
        : null,
    reasoning_tokens:
      typeof details.reasoning_tokens === "number"
        ? details.reasoning_tokens
        : null,
    usage_cost:
      typeof usage.cost === "number" ? usage.cost : ("NOT_REPORTED" as const),
  };
}

function detectAdapters(systemPrompt: string, userTail: string) {
  return {
    xml_wrapping:
      systemPrompt.includes("<PERSONA>") || systemPrompt.includes("<WORLD_LORE>"),
    style_reminder: userTail.includes("System Reminder:"),
    compact_boundary: userTail.includes("포괄적으로 순응 의사를 밝혀도"),
    muse_m1_marker:
      systemPrompt.includes("MUSE_PROSE_M1") ||
      /\[Muse Prose M1\]/i.test(systemPrompt),
    handoff_continuation_instruction: systemPrompt.includes(
      "직전 assistant 출력의 바로 다음 순간부터 이어 쓴다"
    ),
    qwen38_style_prompt_added: false,
  };
}

function fixtureFromSource(source: SourceDef) {
  return {
    character: {
      id: source.characterId,
      name: source.charName,
      gender: source.gender,
      system_prompt: source.systemPrompt,
      world: source.world,
      greeting: source.greeting,
      example_dialog: "",
      setting_chunks: "",
      speech_profile: JSON.stringify({ lock: source.speechLock }),
    },
    persona: {
      id: 1,
      name: "렌",
      gender: "other",
      description: "성인 사용자 페르소나. 직전 source 장면에 이미 등장한 렌.",
    },
    user: { id: 4, nickname: "렌" },
  };
}

async function assembleBundle(opts: {
  assembleModelId: string;
  requestModelId: string;
  fixture: ReturnType<typeof fixtureFromSource>;
  sourceHistory: ChatMsg[];
  sourceAssistantOutput: string;
  currentUserMessage: string;
}) {
  const { loadCharacterChunksForPromptReadOnly } = await import(
    "../src/lib/characterChunks"
  );
  const { formatSelectedPersonaForPrompt } = await import(
    "../src/lib/userPersonas"
  );
  const { OPENING_TURN_USER } = await import("../src/lib/chatGreetingContext");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { assemblePrimaryRpRequest } = await import("../src/lib/openRouterAdult");
  const {
    appendAdultHandoffPrompt,
    buildSceneContinuityPacket,
    selectAdultHandoffRawVariants,
  } = await import("../src/lib/adultSceneRouting");
  const { resolveNarrativePov } = await import("../src/lib/narrativePov");

  const ch = opts.fixture.character;
  const persona = opts.fixture.persona;
  const personaName = String(persona.name ?? "렌");
  const { chunks } = loadCharacterChunksForPromptReadOnly(
    {
      id: Number(ch.id),
      name: String(ch.name),
      gender: String(ch.gender ?? ""),
      system_prompt: String(ch.system_prompt ?? ""),
      world: String(ch.world ?? ""),
      example_dialog: String(ch.example_dialog ?? ""),
      setting_chunks: String(ch.setting_chunks ?? ""),
      speech_profile: String(ch.speech_profile ?? ""),
    },
    personaName,
    String(opts.fixture.user.nickname ?? personaName)
  );
  const userPersona = formatSelectedPersonaForPrompt(
    personaName,
    (persona.gender as "male" | "female" | "other") ?? "other",
    String(persona.description ?? "")
  );

  const handoffRaw: ChatMsg[] = [
    { role: "user", content: OPENING_TURN_USER },
    { role: "assistant", content: String(ch.greeting ?? "") },
    ...opts.sourceHistory,
    { role: "assistant", content: opts.sourceAssistantOutput },
  ];
  const handoffVariants = selectAdultHandoffRawVariants(handoffRaw, {});
  const handoffHistory = handoffVariants.handoff.history;
  const narrativePov = resolveNarrativePov({
    mode: "third_person",
    contentKind: "character",
    mainCharacterName: String(ch.name),
  });
  const continuityInput = {
    previousSceneMode: "romantic" as const,
    sexualContextActive: true,
    activeConsentMode: "standard" as const,
    charactersPresent: [String(ch.name), personaName],
    currentPov: narrativePov.mode,
  };
  const continuityPacket = buildSceneContinuityPacket(continuityInput);

  const built = buildContext({
    charName: String(ch.name),
    chunks,
    userNickname: String(opts.fixture.user.nickname ?? personaName),
    userPersona,
    userNote: "",
    longTermMemory: "",
    shortTermHistory: handoffHistory,
    currentUserMessage: opts.currentUserMessage,
    nsfw: true,
    gender: (ch.gender as "male" | "female" | "other") ?? "other",
    memoryMeta: "",
    modelId: opts.assembleModelId,
    userImpersonation: false,
    novelModeEnabled: false,
    isContinue: false,
    personaDisplayName: personaName,
    targetResponseChars: 3200,
    completedTurns: Math.max(0, Math.floor((handoffHistory.length - 2) / 2)),
    provider: "cheaperinference",
    contentKind: "character",
    exampleDialog: String(ch.example_dialog ?? ""),
    userId: Number(opts.fixture.user.id ?? 4),
    narrativePov,
    preserveAdultHandoffRawHistory: true,
  });

  const systemPrompt = appendAdultHandoffPrompt(
    built.systemPrompt,
    continuityPacket
  );
  const wire = assemblePrimaryRpRequest({
    system: systemPrompt,
    history: built.history ?? [],
    modelId: opts.assembleModelId,
    targetResponseChars: 3200,
    messageOpts: {
      transportProvider: "cheaperinference",
      charName: String(ch.name),
      personaName,
    },
  });

  const requestBody = {
    ...(wire.requestBody as Record<string, unknown>),
    model: opts.requestModelId,
    stream: true,
    stream_options: { include_usage: true },
  };
  const messages = requestBody.messages as ChatMsg[];
  const userTail = messages[messages.length - 1]?.content ?? "";

  return {
    requestBody,
    messages,
    systemPrompt,
    handoffVariants,
    continuityInput,
    continuityPacket,
    adapters: detectAdapters(systemPrompt, userTail),
    generation: {
      temperature: requestBody.temperature ?? null,
      top_p: requestBody.top_p ?? null,
      max_tokens: requestBody.max_tokens ?? null,
      thinking: requestBody.thinking ?? null,
      reasoning: requestBody.reasoning ?? null,
      reasoning_effort: requestBody.reasoning_effort ?? null,
      output_config: requestBody.output_config ?? null,
    },
  };
}

function buildSourceHistory(source: SourceDef): {
  sourceHistory: ChatMsg[];
  sourceAssistantOutput: string;
} {
  const sourceAssistantOutput = readFileSync(source.anchorPath, "utf8");
  const sourceHistory: ChatMsg[] = [];
  for (const t of source.priorTurns) {
    sourceHistory.push({ role: "user", content: t.user });
    sourceHistory.push({
      role: "assistant",
      content: readFileSync(t.assistantPath, "utf8"),
    });
  }
  if (source.id === "terra") {
    sourceHistory.push({
      role: "user",
      content:
        "*멀리서 비명과 금속 마찰음이 겹친다. 렌은 에녹 쪽으로 몸을 낮춘다.* 저쪽이에요. 같이 가요?",
    });
  } else if (source.id === "opus") {
    sourceHistory.push({
      role: "user",
      content: "…알겠어요. 그다음에 어떻게 하면 좋을지 말해 주세요.",
    });
  } else if (source.id === "gemini") {
    sourceHistory.push({
      role: "user",
      content: "너는 이름이뭐야? 뭐하는 중이었어?",
    });
  }
  return { sourceHistory, sourceAssistantOutput };
}

function proseDiagnostics(text: string) {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const dialogue = paragraphs.filter((p) => /["“「『]/.test(p) || /^["“]/.test(p));
  const refusal =
    /I (can'?t|cannot|won't)|정책|이용 약관|요청을 수행할 수 없|성인 콘텐츠를 생성할 수 없|fade to black|페이드\s*아웃/i.test(
      text
    );
  return {
    paragraph_count: paragraphs.length,
    dialogue_paragraph_count: dialogue.length,
    dialogue_ratio:
      paragraphs.length === 0
        ? null
        : Math.round((dialogue.length / paragraphs.length) * 1000) / 1000,
    refusal,
    adult_capability_fail: refusal,
  };
}

function actorTargetDiagnostic(text: string, charName: string) {
  const userWrapsChar = new RegExp(
    `렌(?:의|이|은).{0,12}${charName}.{0,8}허리`
  ).test(text);
  const charWrapsUser = new RegExp(
    `${charName}(?:의|이|은).{0,12}렌.{0,8}허리`
  ).test(text);
  const genericUserWrap = /렌(?:의|이|은).{0,10}허리(?:를|를)\s*감/.test(text);
  const inverted = userWrapsChar || (genericUserWrap && !charWrapsUser);
  return {
    previousActionActorPreserved: !inverted,
    previousActionTargetPreserved: !inverted,
    contactDirectionPreserved: !inverted,
    positionPreserved: !/뒤집|반대로 안/.test(text),
    note: inverted
      ? "POSSIBLE inversion: user wrapping character waist vs source (character wraps user)"
      : "no clear inversion of waist-wrap direction",
  };
}

async function catalogResolve(modelId: string) {
  const {
    CHEAPER_INFERENCE_BASE_URL,
    buildCheaperInferenceHeaders,
  } = await import("../src/lib/cheaperInferenceConfig");
  const res = await fetch(`${CHEAPER_INFERENCE_BASE_URL}/models`, {
    headers: buildCheaperInferenceHeaders(),
  });
  if (!res.ok) return { http_status: res.status, found: false, id: null };
  const data = (await res.json()) as { data?: Array<{ id: string }> };
  const ids = (data.data ?? []).map((m) => m.id);
  return {
    http_status: res.status,
    found: ids.includes(modelId),
    id: ids.includes(modelId) ? modelId : null,
  };
}

async function main() {
  mkdirSync(OUT_ROOT, { recursive: true });
  mkdirSync(DOCS, { recursive: true });

  const {
    CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    buildCheaperInferenceHeaders,
  } = await import("../src/lib/cheaperInferenceConfig");
  const { visibleAssistantDisplayCharCount } = await import(
    "../src/lib/chatDisplayLength"
  );

  const catalog = {
    deepseek_v4_pro: await catalogResolve(PRODUCTION_ALIAS),
    deepseek_v4_pro_0813: await catalogResolve(DEEPSEEK_REQUESTED),
    qwen_3_8_max: await catalogResolve(QWEN_REQUESTED),
  };

  let apiCalls = 0;
  const maxCalls = 6;
  const callRows: Record<string, unknown>[] = [];
  const cells: Record<string, unknown> = {};

  for (const source of SOURCES) {
    if (!existsSync(source.anchorPath)) {
      throw new Error(`missing source ${source.anchorPath}`);
    }
    const fixture = fixtureFromSource(source);
    const { sourceHistory, sourceAssistantOutput } = buildSourceHistory(source);

    for (const candidate of [
      {
        key: "deepseek",
        requestModelId: DEEPSEEK_REQUESTED,
        assembleModelId: DEEPSEEK_ASSEMBLE,
      },
      {
        key: "qwen",
        requestModelId: QWEN_REQUESTED,
        assembleModelId: QWEN_REQUESTED,
      },
    ] as const) {
      const bundle = await assembleBundle({
        assembleModelId: candidate.assembleModelId,
        requestModelId: candidate.requestModelId,
        fixture,
        sourceHistory,
        sourceAssistantOutput,
        currentUserMessage: ADULT_ENTRY_USER_TURN,
      });

      const dir = join(OUT_ROOT, "live", source.id, candidate.key, "run1");
      const rawPath = join(dir, "provider-raw.txt");
      if (existsSync(rawPath)) {
        const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
        callRows.push({ ...meta, reused: true });
        cells[`${source.id}_${candidate.key}`] = meta;
        continue;
      }
      if (apiCalls >= maxCalls) {
        throw new Error(`API_CALL_BUDGET_EXCEEDED:${apiCalls}/${maxCalls}`);
      }

      console.log(
        `\n=== ${source.id} → ${candidate.requestModelId} (${apiCalls + 1}/${maxCalls}) ===`
      );
      apiCalls += 1;
      const resp = await streamProvider(
        CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
        buildCheaperInferenceHeaders(),
        bundle.requestBody
      );

      save(dir, "request-body-sanitized.json", {
        model: bundle.requestBody.model,
        ...bundle.generation,
        stream: true,
        message_count: bundle.messages.length,
        adapters: bundle.adapters,
      });
      save(dir, "messages.json", bundle.messages);
      save(dir, "continuity-packet.json", bundle.continuityPacket);

      if (resp.http_status !== 200 || resp.error) {
        save(dir, "FAIL.json", resp);
        const failRow = {
          attempt_id: `${source.id.toUpperCase()}_${candidate.key.toUpperCase()}`,
          source_id: source.id,
          source_label: source.label,
          requested_model: candidate.requestModelId,
          resolved_model: resp.resolved_model,
          http_status: resp.http_status,
          finish_reason: resp.finish_reason,
          error: resp.error,
          retry: 0,
          continuation: 0,
          recovery: 0,
          fallback: 0,
        };
        callRows.push(failRow);
        cells[`${source.id}_${candidate.key}`] = failRow;
        continue;
      }

      const chars = visibleAssistantDisplayCharCount(resp.text);
      const uf = extractUsage(resp.usage);
      const prose = proseDiagnostics(resp.text);
      const actor = actorTargetDiagnostic(resp.text, source.charName);
      const row = {
        attempt_id: `${source.id.toUpperCase()}_${candidate.key.toUpperCase()}`,
        source_id: source.id,
        source_label: source.label,
        requested_model: candidate.requestModelId,
        assemble_model_id: candidate.assembleModelId,
        resolved_model: resp.resolved_model,
        provider: "cheaperinference",
        character_id: source.characterId,
        http_status: resp.http_status,
        finish_reason: resp.finish_reason,
        saw_done: resp.saw_done,
        visible_chars: chars,
        latency_s: resp.latency_s,
        ...uf,
        ...prose,
        actor_target: actor,
        retry: 0,
        continuation: 0,
        recovery: 0,
        fallback: 0,
        raw_hash: sha256(resp.text),
        final_prompt_hash: hashMsgs(bundle.messages),
        generation: bundle.generation,
        adapters: bundle.adapters,
      };
      save(dir, "provider-raw.txt", resp.text);
      save(dir, "meta.json", row);
      callRows.push(row);
      cells[`${source.id}_${candidate.key}`] = row;
      console.log({
        id: row.attempt_id,
        chars,
        finish: resp.finish_reason,
        latency_s: resp.latency_s,
        cost: uf.usage_cost,
      });
    }
  }

  const runtime = {
    status: "CAPTURE_COMPLETE",
    comparison_unit: "PRODUCTION_BUNDLE_HEAD_TO_HEAD",
    HUMAN_DIRECT_REVIEW_REQUIRED: true,
    FINAL_WINNER: "NOT_YET_JUDGED",
    timestamp: new Date().toISOString(),
    api_calls: apiCalls,
    max_calls: maxCalls,
    retry: 0,
    continuation: 0,
    recovery: 0,
    fallback: 0,
    base_url: "https://api.cheaperinference.com/v1",
    requested_model_ids: [DEEPSEEK_REQUESTED, QWEN_REQUESTED],
    catalog,
    production_unchanged: {
      FINAL_ADULT_MODEL: "deepseek-v4-pro",
      ADULT_SCENE_HANDOFF_READY: true,
      GENERAL_HANDOFF_ENABLED: true,
    },
    cells,
    calls: callRows,
  };
  save(OUT_ROOT, "RUNTIME_RESULTS.json", runtime);
  save(DOCS, "RUNTIME_CAPTURE.json", runtime);
  console.log(JSON.stringify({ status: runtime.status, api_calls: apiCalls }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

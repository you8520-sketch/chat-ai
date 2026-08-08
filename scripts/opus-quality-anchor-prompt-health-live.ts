/**
 * Audit 56 — Opus Quality Anchor / Common Prompt Health (phase-1 screen).
 * Same model (claude-opus-5 / Cheaper Inference), three prompt arms.
 * Does not mutate production defaults. Direct CI calls with assembled payloads.
 */
import { createHash } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const MODEL = "claude-opus-5";
const OUT_ROOT =
  process.env.OUT_ROOT ?? "/opt/cursor/artifacts/opus-quality-anchor";
const FIXTURE_DIR =
  process.env.FIXTURE_DIR ??
  "/opt/cursor/artifacts/opus-quality-anchor/fixtures";

/** Arm B qualitative length owner — exact replacement text. */
export const AUDIT56_QUALITATIVE_LENGTH_OWNER =
  "현재 장면에서 하나 이상의 의미 있는 변화와 그에 대한 인물의 반응까지 전개하고, 유저가 다음 행동을 선택할 수 있는 지점에서 멈춘다. 요약·예고·메타 해설은 쓰지 않는다.";

/** Arm C minimal RP contract — exact text. */
export const AUDIT56_OPUS_NATIVE_MINIMAL_CONTRACT = `한국어 3인칭 RP 본문만 작성한다.
캐릭터의 성격·능력·관계·현재 상황에 맞게 캐릭터가 능동적으로 대사하고 행동한다.
유저의 새로운 직접 대사, 중요한 선택·동의·거절, 관계·정체성을 바꾸는 결정을 대신 확정하지 않는다.
정본과 실제 대화에 없는 공유 기억을 사실처럼 만들지 않는다.
설정은 해설하지 말고 현재 행동·대사·감각·결과에 사용한다.
현재 장면에 실제 변화와 그에 대한 반응을 만든 뒤 유저가 응답할 수 있는 지점에서 멈춘다.`;

type ArmId = "A" | "B" | "C";
type ScenarioKind = "relationship" | "action" | "quiet" | "memory";

type Scenario = {
  id: string;
  kind: ScenarioKind;
  label: string;
  characterId: number;
  turns: [string, string];
};

const SCENARIOS: Scenario[] = [
  {
    id: "rel_start",
    kind: "relationship",
    label: "관계 시작",
    characterId: 18,
    turns: [
      "난 본기억없는데.... 나는 렌이라고 부르면 돼. *고개끄덕임* 신입 맞아.",
      "너는 이름이뭐야? 뭐하는 중이었어?",
    ],
  },
  {
    id: "rel_conflict",
    kind: "relationship",
    label: "관계 갈등",
    characterId: 5,
    turns: [
      "*렌은 조심스레 다가가 무릎을 꿇고 눈높이를 맞춘다.* …괜찮아요? 제가 좀 도와드릴게요.",
      "저 그냥 가라는 거예요? …싫으면 말해요. 억지로 붙잡진 않을게요.",
    ],
  },
  {
    id: "quiet_daily",
    kind: "quiet",
    label: "조용한 일상",
    characterId: 2,
    turns: [
      "*편의점 앞에 서서 잠깐 망설이다가 문을 밀고 들어간다.* 저기요, 따뜻한 거 하나 추천해 주실래요?",
      "…여기 알바 오래 했어요? 밤에 이렇게 조용한 편이예요?",
    ],
  },
  {
    id: "action_combat_1",
    kind: "action",
    label: "행동·전투 1",
    characterId: 10,
    turns: [
      "*멀리서 비명과 금속 마찰음이 겹친다. 렌은 에녹 쪽으로 몸을 낮춘다.* 저쪽이에요. 같이 가요?",
      "*렌은 에녹의 소매를 짧게 잡아끈다.* 왼쪽 골목으로 우회할까요?",
    ],
  },
  {
    id: "action_combat_2",
    kind: "action",
    label: "행동·전투 2",
    characterId: 9,
    turns: [
      "*경보가 울리고 격리문 쪽 불빛이 붉게 번쩍인다.* 저거… 탈출이에요, 아니면 유입이에요?",
      "*렌은 태세를 낮추고 옆에 붙는다.* 제가 뒤를 볼게요. 지시만 해요.",
    ],
  },
  {
    id: "memory_continuity",
    kind: "memory",
    label: "기억·연속성",
    characterId: 18,
    turns: [
      "아까 로비에서 봤던 그 문… 내가 열어본 적 있어? 아니면 처음이지?",
      "내가 방금 한 말 기억해? 내 이름.",
    ],
  },
];

function sha256(t: string) {
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
function koreanChars(text: string): number {
  return [...text].filter((ch) => /[\uAC00-\uD7A3]/.test(ch)).length;
}
function countOcc(hay: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let i = 0;
  while (true) {
    const j = hay.indexOf(needle, i);
    if (j < 0) break;
    n += 1;
    i = j + needle.length;
  }
  return n;
}

type ChatMsg = { role: "user" | "assistant" | "system"; content: string };

async function streamCi(body: Record<string, unknown>): Promise<{
  text: string;
  latency_s: number;
  ttft_s: number | null;
  finish_reason: string | null;
  usage: Record<string, unknown> | null;
  raw_usage: Record<string, unknown> | null;
  resolved_model: string | null;
  error: string | null;
  http_status: number;
}> {
  const {
    CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    buildCheaperInferenceHeaders,
  } = await import("../src/lib/cheaperInferenceConfig");

  const started = Date.now();
  let firstDeltaAt: number | null = null;
  try {
    const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: buildCheaperInferenceHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return {
        text: "",
        latency_s: (Date.now() - started) / 1000,
        ttft_s: null,
        finish_reason: null,
        usage: null,
        raw_usage: null,
        resolved_model: null,
        error: (await res.text()).slice(0, 2000),
        http_status: res.status,
      };
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    const dec = new TextDecoder();
    let buf = "";
    let text = "";
    let finish: string | null = null;
    let usage: Record<string, unknown> | null = null;
    let resolved: string | null = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n");
      buf = parts.pop() ?? "";
      for (const line of parts) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let ev: Record<string, unknown>;
        try {
          ev = JSON.parse(data) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (typeof ev.model === "string") resolved = ev.model;
        const choices = ev.choices as Array<Record<string, unknown>> | undefined;
        const choice0 = choices?.[0];
        const delta = choice0?.delta as Record<string, unknown> | undefined;
        const content =
          typeof delta?.content === "string"
            ? delta.content
            : typeof (choice0?.message as Record<string, unknown> | undefined)
                  ?.content === "string"
              ? String((choice0!.message as Record<string, unknown>).content)
              : "";
        if (content) {
          if (firstDeltaAt == null) firstDeltaAt = Date.now();
          text += content;
        }
        if (typeof choice0?.finish_reason === "string" && choice0.finish_reason) {
          finish = choice0.finish_reason;
        }
        if (ev.usage && typeof ev.usage === "object") {
          usage = ev.usage as Record<string, unknown>;
        }
      }
    }
    return {
      text,
      latency_s: (Date.now() - started) / 1000,
      ttft_s: firstDeltaAt != null ? (firstDeltaAt - started) / 1000 : null,
      finish_reason: finish,
      usage,
      raw_usage: usage,
      resolved_model: resolved,
      error: null,
      http_status: 200,
    };
  } catch (e) {
    return {
      text: "",
      latency_s: (Date.now() - started) / 1000,
      ttft_s: firstDeltaAt != null ? (firstDeltaAt - started) / 1000 : null,
      finish_reason: null,
      usage: null,
      raw_usage: null,
      resolved_model: null,
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
      total_billed_output_tokens: null as number | null,
      usage_cost_usd: null as number | null,
      api_raw_cost_krw: null as number | null,
    };
  }
  const details =
    (usage.completion_tokens_details as Record<string, unknown> | undefined) ??
    {};
  const promptDetails =
    (usage.prompt_tokens_details as Record<string, unknown> | undefined) ?? {};
  const input =
    typeof usage.prompt_tokens === "number"
      ? usage.prompt_tokens
      : typeof usage.input_tokens === "number"
        ? usage.input_tokens
        : null;
  const out =
    typeof usage.completion_tokens === "number"
      ? usage.completion_tokens
      : typeof usage.output_tokens === "number"
        ? usage.output_tokens
        : null;
  const reasoning =
    typeof details.reasoning_tokens === "number"
      ? details.reasoning_tokens
      : typeof usage.reasoning_tokens === "number"
        ? usage.reasoning_tokens
        : null;
  const cached =
    typeof promptDetails.cached_tokens === "number"
      ? promptDetails.cached_tokens
      : null;
  const costUsd =
    typeof usage.cost === "number"
      ? usage.cost
      : typeof (usage.cost_details as Record<string, unknown> | undefined)
            ?.upstream_inference_cost === "number"
        ? ((usage.cost_details as Record<string, unknown>)
            .upstream_inference_cost as number)
        : null;
  return {
    input_tokens: input,
    cached_input_tokens: cached,
    visible_output_tokens: out,
    reasoning_tokens: reasoning,
    total_billed_output_tokens: out,
    usage_cost_usd: costUsd,
    api_raw_cost_krw: null as number | null,
  };
}

function estimateKrwFromCatalog(
  modelRates: { input: number; output: number; cacheRead: number },
  usage: ReturnType<typeof extractUsage>,
  fx: number
): number | null {
  if (usage.input_tokens == null || usage.visible_output_tokens == null) return null;
  const cached = usage.cached_input_tokens ?? 0;
  const uncached = Math.max(0, usage.input_tokens - cached);
  const usd =
    (uncached * modelRates.input +
      cached * modelRates.cacheRead +
      usage.visible_output_tokens * modelRates.output) /
    1_000_000;
  return Math.round(usd * fx * 10) / 10;
}

async function loadFixture(characterId: number) {
  const path = join(FIXTURE_DIR, `c${characterId}_fixture.json`);
  if (!existsSync(path)) throw new Error(`missing fixture ${path}`);
  return JSON.parse(readFileSync(path, "utf8")) as {
    character: Record<string, unknown>;
    persona: Record<string, unknown>;
    user: Record<string, unknown>;
    hashes: { fixture: string; greeting: string; setting: string };
  };
}

async function assembleArm(
  arm: ArmId,
  fixture: Awaited<ReturnType<typeof loadFixture>>,
  history: ChatMsg[],
  currentUserMessage: string
): Promise<{
  requestBody: Record<string, unknown>;
  messages: ChatMsg[];
  prompt_hash: string;
  recent_history_hash: string;
  owner_counts: Record<string, number>;
  reasoning_effort: string | null;
  temperature: number | null;
  top_p: number | null;
}> {
  const {
    USER_TAIL_LENGTH_OWNER_SENTENCE,
  } = await import("../src/lib/responseLength");
  const { COLLABORATIVE_INTERACTIVE_OWNER_TITLE } = await import(
    "../src/lib/noGodmodding"
  );
  const { loadCharacterChunksForPromptReadOnly } = await import(
    "../src/lib/characterChunks"
  );
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { OPENING_TURN_USER } = await import("../src/lib/chatGreetingContext");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { assemblePrimaryRpRequest } = await import("../src/lib/openRouterAdult");

  const ch = fixture.character;
  const persona = fixture.persona;
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
    String(fixture.user.nickname ?? personaName)
  );
  const userPersona = formatSelectedPersonaForPrompt(
    personaName,
    (persona.gender as "male" | "female" | "other") ?? "other",
    String(persona.description ?? "")
  );

  const recent_history_hash = sha256(
    JSON.stringify(history.map((m) => ({ role: m.role, content: m.content })))
  );

  if (arm === "C") {
    const canonParts: string[] = [];
    for (const c of chunks) {
      const category = String((c as { category?: string }).category ?? "").trim();
      const body = String((c as { content?: string }).content ?? "").trim();
      if (!body) continue;
      canonParts.push(category ? `[${category}]\n${body}` : body);
    }
    if (!canonParts.length) {
      const fallback = [
        String(ch.system_prompt ?? ""),
        String(ch.world ?? ""),
        String(ch.description ?? ""),
      ]
        .filter((s) => s.trim())
        .join("\n\n");
      if (fallback) canonParts.push(fallback);
    }
    const system = [
      `# 캐릭터 핵심 정본\n캐릭터명: ${String(ch.name)}\n\n${canonParts.join("\n\n")}`,
      `# 선택 페르소나\n${userPersona}`,
      String(ch.world ?? "").trim()
        ? `# 세계관 정본\n${String(ch.world)}`
        : "",
      `# 최소 RP 계약\n${AUDIT56_OPUS_NATIVE_MINIMAL_CONTRACT}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const messages: ChatMsg[] = [
      { role: "system", content: system },
      ...history.filter((m) => m.role !== "system"),
      { role: "user", content: currentUserMessage },
    ];
    // Production Opus sampling only (temperature etc.) — no invented extras.
    const { buildOpenRouterRequestBody } = await import("../src/lib/openRouterClient");
    const { adaptCheaperInferenceChatBody } = await import(
      "../src/lib/cheaperInferenceConfig"
    );
    const before = buildOpenRouterRequestBody(
      MODEL,
      messages,
      true,
      3200
    ) as Record<string, unknown>;
    const requestBody = {
      ...adaptCheaperInferenceChatBody(before),
      stream: true,
      stream_options: { include_usage: true },
    };
    const payload = JSON.stringify(messages);
    const owner_counts = {
      SceneDirective: countOcc(payload, "[SCENE DIRECTIVE]") + countOcc(payload, "SceneDirective"),
      collaborative_owner: countOcc(payload, COLLABORATIVE_INTERACTIVE_OWNER_TITLE),
      legacy_novel_owner: countOcc(payload, "[NOVEL") + countOcc(payload, "SHARED_NOVEL"),
      terminal_length_owner_numeric: countOcc(payload, "3,200~4,200"),
      terminal_length_owner_qualitative: countOcc(
        payload,
        AUDIT56_QUALITATIVE_LENGTH_OWNER
      ),
      model_adapter: countOcc(payload, "DEEPSEEK") + countOcc(payload, "TERRA_TERMINAL"),
      opus_native_minimal_contract: countOcc(
        payload,
        "한국어 3인칭 RP 본문만 작성한다."
      ),
    };
    return {
      requestBody,
      messages,
      prompt_hash: sha256(payload),
      recent_history_hash,
      owner_counts,
      reasoning_effort:
        requestBody.reasoning_effort == null
          ? null
          : String(requestBody.reasoning_effort),
      temperature:
        typeof requestBody.temperature === "number"
          ? requestBody.temperature
          : null,
      top_p: typeof requestBody.top_p === "number" ? requestBody.top_p : null,
    };
  }

  // Arms A/B — production standard collaborative assemble
  const seedHistory =
    history.length > 0
      ? history
      : ([
          { role: "user", content: OPENING_TURN_USER },
          { role: "assistant", content: String(ch.greeting ?? "") },
        ] as ChatMsg[]);

  const built = buildContext({
    charName: String(ch.name),
    chunks,
    userNickname: String(fixture.user.nickname ?? personaName),
    userPersona,
    userNote: "",
    longTermMemory: "",
    shortTermHistory: seedHistory,
    currentUserMessage,
    nsfw: !!ch.nsfw,
    gender: (ch.gender as "male" | "female" | "other") ?? "other",
    memoryMeta: "",
    modelId: MODEL,
    userImpersonation: false,
    novelModeEnabled: false,
    isContinue: false,
    personaDisplayName: personaName,
    targetResponseChars: 3200,
    completedTurns: Math.max(0, Math.floor((seedHistory.length - 2) / 2)),
    provider: "openrouter",
    contentKind: "character",
    exampleDialog: String(ch.example_dialog ?? ""),
    userId: Number(fixture.user.id ?? 4),
  });

  const wire = assemblePrimaryRpRequest({
    system: built.systemPrompt,
    history: built.history ?? [],
    modelId: MODEL,
    targetResponseChars: 3200,
    messageOpts: {
      transportProvider: "cheaperinference",
      charName: String(ch.name),
      personaName,
    },
  });

  const requestBody = { ...wire.requestBody, stream: true } as Record<
    string,
    unknown
  >;
  // Ensure usage on stream when supported
  requestBody.stream_options = { include_usage: true };

  const messages = (requestBody.messages as ChatMsg[]) ?? [];
  if (arm === "B") {
    const lastIdx = [...messages]
      .map((m, i) => ({ m, i }))
      .reverse()
      .find((x) => x.m.role === "user")?.i;
    if (lastIdx == null) throw new Error("Arm B: missing last user message");
    const content = String(messages[lastIdx]!.content ?? "");
    if (!content.includes(USER_TAIL_LENGTH_OWNER_SENTENCE)) {
      throw new Error("Arm B: numeric length owner missing from assembled user turn");
    }
    const replaced = content.replace(
      USER_TAIL_LENGTH_OWNER_SENTENCE,
      AUDIT56_QUALITATIVE_LENGTH_OWNER
    );
    if (replaced.includes("3,200~4,200")) {
      throw new Error("Arm B: numeric range still present after replace");
    }
    if (countOcc(replaced, AUDIT56_QUALITATIVE_LENGTH_OWNER) !== 1) {
      throw new Error("Arm B: qualitative owner count != 1");
    }
    messages[lastIdx] = { ...messages[lastIdx]!, content: replaced };
    requestBody.messages = messages;
  }

  // Do not invent sampling — strip if assembler added nothing extra; leave as-is from wire
  const payload = JSON.stringify(requestBody.messages);
  const owner_counts = {
    SceneDirective:
      countOcc(payload, "[SCENE DIRECTIVE]") +
      countOcc(built.systemPrompt ?? "", "SceneDirective"),
    collaborative_owner: countOcc(payload, COLLABORATIVE_INTERACTIVE_OWNER_TITLE),
    legacy_novel_owner:
      countOcc(payload, "SHARED_NOVEL") + countOcc(payload, "[NOVEL MODE]"),
    terminal_length_owner_numeric: countOcc(payload, USER_TAIL_LENGTH_OWNER_SENTENCE),
    terminal_length_owner_qualitative: countOcc(
      payload,
      AUDIT56_QUALITATIVE_LENGTH_OWNER
    ),
    model_adapter: 0,
    opus_native_minimal_contract: countOcc(
      payload,
      "한국어 3인칭 RP 본문만 작성한다."
    ),
  };

  return {
    requestBody,
    messages,
    prompt_hash: sha256(payload),
    recent_history_hash,
    owner_counts,
    reasoning_effort:
      requestBody.reasoning_effort == null
        ? null
        : String(requestBody.reasoning_effort),
    temperature:
      typeof requestBody.temperature === "number"
        ? requestBody.temperature
        : null,
    top_p: typeof requestBody.top_p === "number" ? requestBody.top_p : null,
  };
}

async function runOneTurn(opts: {
  arm: ArmId;
  scenario: Scenario;
  turn: 1 | 2;
  history: ChatMsg[];
  fixture: Awaited<ReturnType<typeof loadFixture>>;
  fx: number;
  rates: { input: number; output: number; cacheRead: number };
}) {
  const assembled = await assembleArm(
    opts.arm,
    opts.fixture,
    opts.history,
    opts.scenario.turns[opts.turn - 1]!
  );

  // Owner sanity
  if (opts.arm === "A") {
    if (assembled.owner_counts.collaborative_owner < 1) {
      throw new Error("Arm A missing collaborative owner");
    }
    if (assembled.owner_counts.terminal_length_owner_numeric !== 1) {
      throw new Error(
        `Arm A numeric length owner count=${assembled.owner_counts.terminal_length_owner_numeric}`
      );
    }
    if (assembled.owner_counts.SceneDirective !== 0) {
      throw new Error("Arm A SceneDirective not 0");
    }
  }
  if (opts.arm === "B") {
    if (assembled.owner_counts.terminal_length_owner_numeric !== 0) {
      throw new Error("Arm B still has numeric length");
    }
    if (assembled.owner_counts.terminal_length_owner_qualitative !== 1) {
      throw new Error("Arm B qualitative owner missing");
    }
  }
  if (opts.arm === "C") {
    if (assembled.owner_counts.opus_native_minimal_contract < 1) {
      throw new Error("Arm C missing minimal contract");
    }
    if (assembled.owner_counts.terminal_length_owner_numeric !== 0) {
      throw new Error("Arm C has numeric length");
    }
  }

  const dir = join(
    OUT_ROOT,
    "live",
    opts.scenario.id,
    `arm-${opts.arm}`,
    "run1"
  );
  save(dir, `turn${opts.turn}-request.json`, {
    model: MODEL,
    reasoning_effort: assembled.reasoning_effort,
    temperature: assembled.temperature,
    top_p: assembled.top_p,
    owner_counts: assembled.owner_counts,
    prompt_hash: assembled.prompt_hash,
    recent_history_hash: assembled.recent_history_hash,
    message_count: assembled.messages.length,
  });
  save(dir, `turn${opts.turn}-messages.json`, assembled.messages);

  console.log(
    `\n=== ${opts.scenario.id} arm ${opts.arm} turn ${opts.turn} ===`
  );
  // One infra reconnect on socket drop only — not a quality retry/continuation.
  let resp = await streamCi(assembled.requestBody);
  if (
    (!resp.text.trim() || resp.error) &&
    /terminated|SocketError|UND_ERR_SOCKET|other side closed/i.test(
      String(resp.error ?? "")
    )
  ) {
    console.log("infra reconnect once after socket drop");
    await new Promise((r) => setTimeout(r, 2000));
    resp = await streamCi(assembled.requestBody);
  }
  // undici may throw before returning — handled by resume loop caller
  if (resp.error || resp.http_status !== 200) {
    save(dir, `turn${opts.turn}-FAIL.json`, resp);
    throw new Error(
      `CI fail ${opts.scenario.id}/${opts.arm}/t${opts.turn}: ${resp.error ?? resp.http_status}`
    );
  }
  const resolved = resp.resolved_model ?? MODEL;
  if (resolved !== MODEL && !resolved.endsWith(MODEL)) {
    save(dir, `turn${opts.turn}-EXCLUDED.json`, { resolved, resp });
    throw new Error(`MODEL_SUBSTITUTION_EXCLUSION:${resolved}`);
  }
  if (!resp.text.trim()) {
    throw new Error("empty_upstream_stream");
  }

  const uf = extractUsage(resp.usage);
  const krw =
    uf.api_raw_cost_krw ??
    estimateKrwFromCatalog(opts.rates, uf, opts.fx);
  const visible_korean = koreanChars(resp.text);
  const natural_stop_below_numeric_target =
    resp.finish_reason === "stop" && visible_korean < 3200
      ? "NATURAL_STOP_BELOW_NUMERIC_TARGET"
      : null;

  const row = {
    attempt_id: `${opts.scenario.id.toUpperCase()}-ARM${opts.arm}-T${opts.turn}`,
    arm: opts.arm,
    scenario_id: opts.scenario.id,
    scenario_kind: opts.scenario.kind,
    scenario_label: opts.scenario.label,
    character_id: opts.scenario.characterId,
    character_name: String(opts.fixture.character.name),
    persona_id: Number(opts.fixture.persona.id),
    greeting_hash: opts.fixture.hashes.greeting,
    setting_hash: opts.fixture.hashes.setting,
    turn: opts.turn,
    user_input: opts.scenario.turns[opts.turn - 1],
    requested_model: MODEL,
    resolved_model: resolved,
    provider: "cheaperinference",
    reasoning_effort: assembled.reasoning_effort,
    temperature: assembled.temperature,
    top_p: assembled.top_p,
    ...uf,
    api_raw_cost_krw: krw,
    api_raw_cost_basis:
      uf.usage_cost_usd != null
        ? "provider_usage.cost"
        : "catalog_rates_x_tokens_x_fx",
    charged_points: null,
    retry: 0,
    continuation: 0,
    recovery: 0,
    prompt_owner_counts: assembled.owner_counts,
    prompt_hash: assembled.prompt_hash,
    recent_history_hash: assembled.recent_history_hash,
    finish_reason: resp.finish_reason,
    latency_s: resp.latency_s,
    ttft_s: resp.ttft_s,
    visible_chars: [...resp.text].length,
    visible_korean_chars: visible_korean,
    natural_stop_flag: natural_stop_below_numeric_target,
    raw_hash: sha256(resp.text),
    provider_raw: resp.text,
    usage: resp.usage,
  };

  save(dir, `turn${opts.turn}-provider-raw.txt`, resp.text);
  save(dir, `turn${opts.turn}-meta.json`, { ...row, provider_raw: undefined });
  console.log({
    id: row.attempt_id,
    korean: visible_korean,
    finish: resp.finish_reason,
    flag: natural_stop_below_numeric_target,
    krw,
    reasoning_tokens: uf.reasoning_tokens,
    latency: resp.latency_s,
    owners: assembled.owner_counts,
  });
  return row;
}

async function main() {
  mkdirSync(OUT_ROOT, { recursive: true });
  const { resolveOpenRouterModelRates } = await import(
    "../src/lib/openRouterModelPricing"
  );
  const ratesObj = resolveOpenRouterModelRates(MODEL);
  const rates = {
    input: ratesObj.inputUsdPerM,
    output: ratesObj.outputUsdPerM,
    cacheRead: ratesObj.cacheReadUsdPerM ?? ratesObj.inputUsdPerM * 0.1,
  };
  const fx = 1452.09532128;

  const { OPENING_TURN_USER } = await import("../src/lib/chatGreetingContext");

  const allRows: Record<string, unknown>[] = [];
  const exclusions: unknown[] = [];

  // Resume: load any already-captured metas (network resume only; quality retry still 0).
  const existingMetas = (() => {
    const out: Record<string, unknown>[] = [];
    const liveRoot = join(OUT_ROOT, "live");
    if (!existsSync(liveRoot)) return out;
    for (const sc of readdirSync(liveRoot)) {
      for (const armDir of readdirSync(join(liveRoot, sc))) {
        const runDir = join(liveRoot, sc, armDir, "run1");
        if (!existsSync(runDir)) continue;
        for (const turn of [1, 2] as const) {
          const metaPath = join(runDir, `turn${turn}-meta.json`);
          const rawPath = join(runDir, `turn${turn}-provider-raw.txt`);
          if (existsSync(metaPath) && existsSync(rawPath)) {
            const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Record<
              string,
              unknown
            >;
            meta.provider_raw = readFileSync(rawPath, "utf8");
            out.push(meta);
          }
        }
      }
    }
    return out;
  })();
  allRows.push(...existingMetas);
  console.log(`resume: loaded ${existingMetas.length} existing outputs`);

  function hasTurn(scenarioId: string, arm: ArmId, turn: 1 | 2): boolean {
    return existsSync(
      join(
        OUT_ROOT,
        "live",
        scenarioId,
        `arm-${arm}`,
        "run1",
        `turn${turn}-provider-raw.txt`
      )
    );
  }
  function loadTurnRow(
    scenarioId: string,
    arm: ArmId,
    turn: 1 | 2
  ): Record<string, unknown> {
    const dir = join(OUT_ROOT, "live", scenarioId, `arm-${arm}`, "run1");
    const meta = JSON.parse(
      readFileSync(join(dir, `turn${turn}-meta.json`), "utf8")
    ) as Record<string, unknown>;
    meta.provider_raw = readFileSync(
      join(dir, `turn${turn}-provider-raw.txt`),
      "utf8"
    );
    return meta;
  }

  for (const scenario of SCENARIOS) {
    const fixture = await loadFixture(scenario.characterId);
    for (const arm of ["A", "B", "C"] as ArmId[]) {
      let history: ChatMsg[] = [
        { role: "user", content: OPENING_TURN_USER },
        {
          role: "assistant",
          content: String(fixture.character.greeting ?? ""),
        },
      ];
      try {
        let t1: Record<string, unknown>;
        if (hasTurn(scenario.id, arm, 1)) {
          t1 = loadTurnRow(scenario.id, arm, 1);
          console.log(`skip existing ${scenario.id} arm ${arm} turn 1`);
        } else {
          t1 = await runOneTurn({
            arm,
            scenario,
            turn: 1,
            history,
            fixture,
            fx,
            rates,
          });
          allRows.push(t1);
        }
        history = [
          ...history,
          { role: "user", content: scenario.turns[0]! },
          { role: "assistant", content: String(t1.provider_raw) },
        ];
        if (hasTurn(scenario.id, arm, 2)) {
          console.log(`skip existing ${scenario.id} arm ${arm} turn 2`);
        } else {
          const t2 = await runOneTurn({
            arm,
            scenario,
            turn: 2,
            history,
            fixture,
            fx,
            rates,
          });
          allRows.push(t2);
        }
      } catch (e) {
        exclusions.push({
          scenario: scenario.id,
          arm,
          error: String(e),
        });
        save(OUT_ROOT, "RUNTIME_RESULTS.json", {
          status: "OPUS_PROMPT_HEALTH_SCREEN_RUNTIME_FAIL",
          error: String(e),
          captured: allRows.length,
          exclusions,
        });
        throw e;
      }
    }
  }

  // Deduplicate rows by attempt_id after resume mix
  {
    const byId = new Map<string, Record<string, unknown>>();
    for (const r of allRows) {
      byId.set(String(r.attempt_id), r);
    }
    allRows.length = 0;
    allRows.push(...byId.values());
  }

  save(OUT_ROOT, "all_valid_rows.json", allRows);
  save(OUT_ROOT, "SCENARIO_MANIFEST.json", {
    model: MODEL,
    provider: "cheaperinference",
    scenarios: SCENARIOS,
    arms: {
      A: "CURRENT_STANDARD_EXACT",
      B: "CURRENT_WITHOUT_NUMERIC_LENGTH",
      C: "OPUS_NATIVE_MINIMAL",
    },
    characters: {
      relationship_flirting: 18,
      relationship_conflict: 5,
      quiet_emotion: 2,
      action_crisis_1: 10,
      action_crisis_2: 9,
    },
    persona_id: 61,
  });
  save(OUT_ROOT, "RUNTIME_RESULTS.json", {
    status: "OPUS_PROMPT_HEALTH_SCREEN_CAPTURED",
    human_blind_review: "HUMAN_BLIND_REVIEW_REQUIRED",
    model_lineup_decision: "MODEL_LINEUP_DECISION_NOT_RUN",
    production_change: false,
    audit55_correction: [
      "AUDIT55_MODEL_RANKING_NOT_DECISION_GRADE",
      "COMMON_PROMPT_HEALTH_UNVERIFIED",
      "OPUS_QUALITY_ANCHOR_REQUIRED",
      "CURRENT_TWO_MODEL_LINEUP_PROVISIONAL",
      "NO_PRODUCTION_CHANGE",
    ],
    model: MODEL,
    provider: "cheaperinference",
    arms: 3,
    scenarios: SCENARIOS.length,
    runs_per_cell: 1,
    valid_outputs: allRows.length,
    expected_outputs: SCENARIOS.length * 3 * 2,
    exclusions,
    retry: 0,
    continuation: 0,
    recovery: 0,
    phase2: "NOT_RUN — waiting for human blind review",
    provider_parity: "OPUS_PROVIDER_PARITY_UNVERIFIED",
  });
  console.log(
    JSON.stringify(
      {
        status: "OPUS_PROMPT_HEALTH_SCREEN_CAPTURED",
        valid: allRows.length,
        exclusions: exclusions.length,
      },
      null,
      2
    )
  );
}

const isDirect =
  typeof process.argv[1] === "string" &&
  process.argv[1].includes("opus-quality-anchor-prompt-health-live");
if (isDirect) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

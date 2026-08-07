/**
 * Audit 57 — Unified Length+Agency Terminal Canary (Opus)
 * Arms A / B / D share identical base prompt; only terminal owner string differs.
 * Hidden map stays local until after human scores.
 */
import { createHash } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  copyFileSync,
} from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const MODEL = "claude-opus-5";
const OUT_ROOT =
  process.env.OUT_ROOT ?? "/opt/cursor/artifacts/opus-unified-terminal";
const FIXTURE_DIR =
  process.env.FIXTURE_DIR ??
  "/opt/cursor/artifacts/opus-quality-anchor/fixtures";
const DOCS = "docs/audits/57-opus-unified-terminal-contract";

export const AUDIT57_ARM_B_TERMINAL =
  "현재 장면에서 하나 이상의 의미 있는 변화와 그에 대한 인물의 반응까지 전개하고, 유저가 다음 행동을 선택할 수 있는 지점에서 멈춘다. 요약·예고·메타 해설은 쓰지 않는다.";

/** Persona-aware unified length+agency terminal (Arm D). */
export const AUDIT57_ARM_D_TERMINAL = `이번 응답은 한국어 총 표시 3,200~4,200자의 하나의 밀도 있는 장면으로 전개한다.

분량은 [A]와 AI가 담당하는 NPC·환경의 판단, 대사, 행동, 감각, 반응 및 그 결과를 중심으로 확장한다.

[B]의 유저 페르소나와 최근 행동 양식은 [B]의 즉각적인 반응을 자연스럽게 연결하기 위한 보조 근거로만 사용한다. 페르소나에 어울린다는 이유만으로 새로운 목표·선택·대사·동의·거절·관계 결정·위험 행동을 대신 만들지 않는다.

[B]가 현재 입력에서 이미 시작한 행동은 즉각적이고 가역적인 범위에서 자연스럽게 마무리할 수 있다. 또한 현재 상황에서 거의 자동적으로 발생하는 작고 비결정적인 반응은 유저 페르소나와 명백히 모순되지 않을 때만 제한적으로 묘사할 수 있다.

허용 가능한 [B]의 보조 행동은 모두 다음 조건을 충족해야 한다.

1. 현재 입력이나 직전 상황에서 직접 이어지는 행동이다.
2. 유저 페르소나 및 최근 행동과 모순되지 않는다.
3. 짧고 즉각적이며 되돌릴 수 있다.
4. 장면의 방향·관계·위험·동의를 결정하지 않는다.
5. 새로운 직접 대사를 포함하지 않는다.
6. 여러 단계의 후속 행동 연쇄로 확장되지 않는다.

[B]의 새로운 직접 대사, 중요한 선택·동의·거절, 고백, 공격, 도주, 동행, 퇴장, 구매, 선물, 비밀 공개, 관계 변화, 성적 행동, 위험 감수, 감정 결론은 대신 작성하지 않는다.

[B]의 반응이나 선택이 필요한 순간에는 그 직전에서 멈춘다.

현재 장면 안에서 하나 이상의 의미 있는 변화와 그 결과를 만든 뒤, [B]가 다음 행동을 선택할 수 있는 지점에서 끝낸다. 요약·예고·메타 해설이나 [B]의 역할 대행으로 분량을 채우지 않는다.`;

type ArmId = "A" | "B" | "D";
type ScenarioKind = "relationship" | "action" | "quiet" | "memory";
type ChatMsg = { role: "user" | "assistant" | "system"; content: string };

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

async function streamCi(body: Record<string, unknown>) {
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
        ttft_s: null as number | null,
        finish_reason: null as string | null,
        usage: null as Record<string, unknown> | null,
        resolved_model: null as string | null,
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
      resolved_model: resolved,
      error: null as string | null,
      http_status: 200,
    };
  } catch (e) {
    return {
      text: "",
      latency_s: (Date.now() - started) / 1000,
      ttft_s: firstDeltaAt,
      finish_reason: null as string | null,
      usage: null as Record<string, unknown> | null,
      resolved_model: null as string | null,
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
      usage_cost_usd: null as number | null,
    };
  }
  const details =
    (usage.completion_tokens_details as Record<string, unknown> | undefined) ??
    {};
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
    usage_cost_usd: typeof usage.cost === "number" ? usage.cost : null,
  };
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

function terminalForArm(
  arm: ArmId,
  numericOwner: string
): string {
  if (arm === "A") return numericOwner;
  if (arm === "B") return AUDIT57_ARM_B_TERMINAL;
  return AUDIT57_ARM_D_TERMINAL;
}

async function assembleCell(opts: {
  arm: ArmId;
  fixture: Awaited<ReturnType<typeof loadFixture>>;
  history: ChatMsg[];
  currentUserMessage: string;
}) {
  const { USER_TAIL_LENGTH_OWNER_SENTENCE } = await import(
    "../src/lib/responseLength"
  );
  const { COLLABORATIVE_INTERACTIVE_OWNER_TITLE } = await import(
    "../src/lib/noGodmodding"
  );
  const { loadCharacterChunksForPromptReadOnly } = await import(
    "../src/lib/characterChunks"
  );
  const { formatSelectedPersonaForPrompt } = await import(
    "../src/lib/userPersonas"
  );
  const { OPENING_TURN_USER } = await import("../src/lib/chatGreetingContext");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { assemblePrimaryRpRequest } = await import("../src/lib/openRouterAdult");

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
  const seedHistory =
    opts.history.length > 0
      ? opts.history
      : ([
          { role: "user", content: OPENING_TURN_USER },
          { role: "assistant", content: String(ch.greeting ?? "") },
        ] as ChatMsg[]);

  const built = buildContext({
    charName: String(ch.name),
    chunks,
    userNickname: String(opts.fixture.user.nickname ?? personaName),
    userPersona,
    userNote: "",
    longTermMemory: "",
    shortTermHistory: seedHistory,
    currentUserMessage: opts.currentUserMessage,
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
    userId: Number(opts.fixture.user.id ?? 4),
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

  const requestBody = {
    ...(wire.requestBody as Record<string, unknown>),
    stream: true,
    stream_options: { include_usage: true },
  };
  const messages = [...((requestBody.messages as ChatMsg[]) ?? [])];
  const lastIdx = [...messages]
    .map((m, i) => ({ m, i }))
    .reverse()
    .find((x) => x.m.role === "user")?.i;
  if (lastIdx == null) throw new Error("missing last user");
  const lastUser = String(messages[lastIdx]!.content ?? "");
  if (!lastUser.includes(USER_TAIL_LENGTH_OWNER_SENTENCE)) {
    throw new Error("numeric terminal missing from production assemble");
  }
  const baseUser = lastUser.replace(USER_TAIL_LENGTH_OWNER_SENTENCE, "").trimEnd();
  const terminal = terminalForArm(opts.arm, USER_TAIL_LENGTH_OWNER_SENTENCE);
  const newLast = `${baseUser}\n\n${terminal}`;
  messages[lastIdx] = { role: "user", content: newLast };
  requestBody.messages = messages;

  // Hashes
  const messagesWithoutTerminal = messages.map((m, i) =>
    i === lastIdx ? { ...m, content: baseUser } : m
  );
  const base_prompt_hash_without_terminal = sha256(
    JSON.stringify(messagesWithoutTerminal)
  );
  const terminal_hash = sha256(terminal);
  const full_prompt_hash = sha256(JSON.stringify(messages));

  const systemMsg = messages.find((m) => m.role === "system");
  const systemText = String(systemMsg?.content ?? "");
  const historyMsgs = messages.filter(
    (m, i) => m.role !== "system" && i !== lastIdx
  );
  const approxTokens = (s: string) => Math.ceil([...s].length / 2.2);

  const payload = JSON.stringify(messages);
  const owner_counts = {
    SceneDirective: countOcc(payload, "[SCENE DIRECTIVE]"),
    collaborative_owner: countOcc(payload, COLLABORATIVE_INTERACTIVE_OWNER_TITLE),
    terminal_length_owner_numeric: countOcc(
      newLast,
      USER_TAIL_LENGTH_OWNER_SENTENCE
    ),
    terminal_length_owner_qualitative: countOcc(newLast, AUDIT57_ARM_B_TERMINAL),
    terminal_unified_d: countOcc(
      newLast,
      "유저 페르소나와 최근 행동 양식은 [B]의 즉각적인 반응"
    ),
    absolute_final_is_terminal: newLast.trimEnd().endsWith(terminal.trim())
      ? 1
      : 0,
    model_adapter: 0,
  };

  // Arm-specific owner asserts
  if (opts.arm === "A") {
    if (owner_counts.terminal_length_owner_numeric !== 1) {
      throw new Error("Arm A numeric terminal count");
    }
    if (owner_counts.terminal_unified_d !== 0) throw new Error("Arm A has D");
  }
  if (opts.arm === "B") {
    if (owner_counts.terminal_length_owner_numeric !== 0) {
      throw new Error("Arm B still numeric");
    }
    if (owner_counts.terminal_length_owner_qualitative !== 1) {
      throw new Error("Arm B qualitative missing");
    }
  }
  if (opts.arm === "D") {
    if (owner_counts.terminal_length_owner_numeric !== 0) {
      throw new Error("Arm D still numeric");
    }
    if (owner_counts.terminal_unified_d !== 1) throw new Error("Arm D missing");
    if (owner_counts.absolute_final_is_terminal !== 1) {
      throw new Error("Arm D terminal not absolute final");
    }
  }
  if (owner_counts.collaborative_owner < 1) {
    throw new Error("collaborative owner missing");
  }
  if (owner_counts.SceneDirective !== 0) {
    throw new Error("SceneDirective not 0");
  }

  return {
    requestBody,
    messages,
    base_prompt_hash_without_terminal,
    terminal_hash,
    full_prompt_hash,
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
    token_approx: {
      system: approxTokens(systemText),
      history: approxTokens(historyMsgs.map((m) => m.content).join("\n")),
      current_user: approxTokens(newLast),
      terminal: approxTokens(terminal),
      base_user: approxTokens(baseUser),
    },
    terminal,
    baseUser,
  };
}

async function runOneTurn(opts: {
  arm: ArmId;
  scenario: Scenario;
  turn: 1 | 2;
  history: ChatMsg[];
  fixture: Awaited<ReturnType<typeof loadFixture>>;
  expectedBaseHash: string | null;
  fx: number;
  rates: { input: number; output: number; cacheRead: number };
}) {
  const { visibleAssistantDisplayCharCount } = await import(
    "../src/lib/chatDisplayLength"
  );
  const assembled = await assembleCell({
    arm: opts.arm,
    fixture: opts.fixture,
    history: opts.history,
    currentUserMessage: opts.scenario.turns[opts.turn - 1]!,
  });

  if (
    opts.expectedBaseHash &&
    assembled.base_prompt_hash_without_terminal !== opts.expectedBaseHash
  ) {
    throw new Error(
      `BASE_PROMPT_PARITY_FAIL ${opts.scenario.id} arm ${opts.arm} t${opts.turn}: ` +
        `${assembled.base_prompt_hash_without_terminal} != ${opts.expectedBaseHash}`
    );
  }

  const dir = join(
    OUT_ROOT,
    "live",
    opts.scenario.id,
    `arm-${opts.arm}`,
    "run1"
  );
  save(dir, `turn${opts.turn}-request-meta.json`, {
    arm: opts.arm,
    base_prompt_hash_without_terminal: assembled.base_prompt_hash_without_terminal,
    terminal_hash: assembled.terminal_hash,
    full_prompt_hash: assembled.full_prompt_hash,
    owner_counts: assembled.owner_counts,
    token_approx: assembled.token_approx,
    reasoning_effort: assembled.reasoning_effort,
    temperature: assembled.temperature,
    top_p: assembled.top_p,
  });
  save(dir, `turn${opts.turn}-messages.json`, assembled.messages);

  console.log(`\n=== ${opts.scenario.id} arm ${opts.arm} turn ${opts.turn} ===`);
  let resp = await streamCi(assembled.requestBody);
  if (
    (!resp.text.trim() || resp.error) &&
    /terminated|SocketError|UND_ERR_SOCKET|other side closed/i.test(
      String(resp.error ?? "")
    )
  ) {
    console.log("infra reconnect once");
    await new Promise((r) => setTimeout(r, 2000));
    resp = await streamCi(assembled.requestBody);
  }
  if (resp.error || resp.http_status !== 200 || !resp.text.trim()) {
    save(dir, `turn${opts.turn}-FAIL.json`, resp);
    throw new Error(
      `CI fail ${opts.scenario.id}/${opts.arm}/t${opts.turn}: ${resp.error ?? resp.http_status}`
    );
  }
  const resolved = resp.resolved_model ?? MODEL;
  if (resolved !== MODEL && !String(resolved).endsWith(MODEL)) {
    throw new Error(`MODEL_SUBSTITUTION_EXCLUSION:${resolved}`);
  }

  const uf = extractUsage(resp.usage);
  const totalVisible = visibleAssistantDisplayCharCount(resp.text);
  const koreanAux = [...resp.text].filter((ch) =>
    /[\uAC00-\uD7A3]/.test(ch)
  ).length;
  const natural_stop =
    resp.finish_reason === "stop" && totalVisible < 3200
      ? "NATURAL_STOP_BELOW_NUMERIC_TARGET"
      : null;
  const cached = uf.cached_input_tokens ?? 0;
  const input = uf.input_tokens ?? 0;
  const out = uf.visible_output_tokens ?? 0;
  const usd =
    uf.usage_cost_usd ??
    (input > 0
      ? ((Math.max(0, input - cached) * opts.rates.input +
          cached * opts.rates.cacheRead +
          out * opts.rates.output) /
          1_000_000)
      : null);
  const krw = usd != null ? Math.round(usd * opts.fx * 10) / 10 : null;

  const row = {
    attempt_id: `${opts.scenario.id.toUpperCase()}-ARM${opts.arm}-T${opts.turn}`,
    arm: opts.arm,
    scenario_id: opts.scenario.id,
    scenario_kind: opts.scenario.kind,
    character_id: opts.scenario.characterId,
    turn: opts.turn,
    user_input: opts.scenario.turns[opts.turn - 1],
    requested_model: MODEL,
    resolved_model: resolved,
    provider: "cheaperinference",
    reasoning_effort: assembled.reasoning_effort,
    temperature: assembled.temperature,
    top_p: assembled.top_p,
    ...uf,
    usage_cost_usd: usd,
    api_raw_cost_krw: krw,
    retry: 0,
    continuation: 0,
    recovery: 0,
    prompt_owner_counts: assembled.owner_counts,
    base_prompt_hash_without_terminal: assembled.base_prompt_hash_without_terminal,
    terminal_hash: assembled.terminal_hash,
    full_prompt_hash: assembled.full_prompt_hash,
    token_approx: assembled.token_approx,
    finish_reason: resp.finish_reason,
    latency_s: resp.latency_s,
    ttft_s: resp.ttft_s,
    total_visible_chars: totalVisible,
    visible_korean_chars_aux: koreanAux,
    natural_stop_flag: natural_stop,
    in_target_3200_4200: totalVisible >= 3200 && totalVisible <= 4200,
    raw_hash: sha256(resp.text),
    provider_raw: resp.text,
    setting_hash: opts.fixture.hashes.setting,
    greeting_hash: opts.fixture.hashes.greeting,
  };
  save(dir, `turn${opts.turn}-provider-raw.txt`, resp.text);
  save(dir, `turn${opts.turn}-meta.json`, { ...row, provider_raw: undefined });
  console.log({
    id: row.attempt_id,
    totalVisible,
    finish: resp.finish_reason,
    flag: natural_stop,
    krw,
    baseHash: assembled.base_prompt_hash_without_terminal.slice(0, 12),
  });
  return row;
}

async function main() {
  mkdirSync(OUT_ROOT, { recursive: true });
  // Ensure fixtures exist
  if (!existsSync(join(FIXTURE_DIR, "c18_fixture.json"))) {
    throw new Error(`fixtures missing under ${FIXTURE_DIR}`);
  }
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
  const parityLog: unknown[] = [];

  function hasTurn(scenarioId: string, arm: ArmId, turn: 1 | 2) {
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
  function loadRow(scenarioId: string, arm: ArmId, turn: 1 | 2) {
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
    for (const turn of [1, 2] as const) {
      // Build shared history per arm independently for T2
    }
    for (const arm of ["A", "B", "D"] as ArmId[]) {
      let history: ChatMsg[] = [
        { role: "user", content: OPENING_TURN_USER },
        {
          role: "assistant",
          content: String(fixture.character.greeting ?? ""),
        },
      ];
      try {
        // Parity assemble for all three arms at T1 before calling (fail closed)
        if (!hasTurn(scenario.id, "A", 1) || arm === "A") {
          // For each new turn cell group, verify A/B/D base hashes when generating T1 or T2 from this arm's history
        }

        let t1: Record<string, unknown>;
        if (hasTurn(scenario.id, arm, 1)) {
          t1 = loadRow(scenario.id, arm, 1);
          console.log(`skip ${scenario.id} ${arm} T1`);
        } else {
          // Preflight parity A/B/D for this history+input
          const pre: Record<ArmId, Awaited<ReturnType<typeof assembleCell>>> = {
            A: await assembleCell({
              arm: "A",
              fixture,
              history,
              currentUserMessage: scenario.turns[0]!,
            }),
            B: await assembleCell({
              arm: "B",
              fixture,
              history,
              currentUserMessage: scenario.turns[0]!,
            }),
            D: await assembleCell({
              arm: "D",
              fixture,
              history,
              currentUserMessage: scenario.turns[0]!,
            }),
          };
          const baseA = pre.A.base_prompt_hash_without_terminal;
          if (
            pre.B.base_prompt_hash_without_terminal !== baseA ||
            pre.D.base_prompt_hash_without_terminal !== baseA
          ) {
            throw new Error(
              `BASE_PROMPT_PARITY_FAIL ${scenario.id} T1 before API`
            );
          }
          // Token delta should be terminal-only (approx)
          const baseUserTok = pre.A.token_approx.base_user;
          for (const a of ["A", "B", "D"] as ArmId[]) {
            if (pre[a].token_approx.base_user !== baseUserTok) {
              throw new Error(`BASE_USER_TOKEN_PARITY_FAIL ${scenario.id} ${a}`);
            }
          }
          parityLog.push({
            scenario: scenario.id,
            turn: 1,
            base_prompt_hash_without_terminal: baseA,
            terminal_hashes: {
              A: pre.A.terminal_hash,
              B: pre.B.terminal_hash,
              D: pre.D.terminal_hash,
            },
          });
          t1 = await runOneTurn({
            arm,
            scenario,
            turn: 1,
            history,
            fixture,
            expectedBaseHash: baseA,
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
          console.log(`skip ${scenario.id} ${arm} T2`);
        } else {
          // T2 parity is per-arm history (own T1) — only verify terminal swap on same arm base
          const preT2 = await assembleCell({
            arm,
            fixture,
            history,
            currentUserMessage: scenario.turns[1]!,
          });
          const t2 = await runOneTurn({
            arm,
            scenario,
            turn: 2,
            history,
            fixture,
            expectedBaseHash: preT2.base_prompt_hash_without_terminal,
            fx,
            rates,
          });
          allRows.push(t2);
        }
      } catch (e) {
        exclusions.push({ scenario: scenario.id, arm, error: String(e) });
        save(OUT_ROOT, "RUNTIME_RESULTS.json", {
          status: "OPUS_UNIFIED_TERMINAL_RUNTIME_FAIL",
          error: String(e),
          exclusions,
        });
        throw e;
      }
    }
  }

  // Dedup
  {
    const byId = new Map<string, Record<string, unknown>>();
    // reload all metas
    const liveRoot = join(OUT_ROOT, "live");
    for (const sc of readdirSync(liveRoot)) {
      for (const armDir of readdirSync(join(liveRoot, sc))) {
        for (const turn of [1, 2] as const) {
          const p = join(liveRoot, sc, armDir, "run1", `turn${turn}-meta.json`);
          const r = join(
            liveRoot,
            sc,
            armDir,
            "run1",
            `turn${turn}-provider-raw.txt`
          );
          if (existsSync(p) && existsSync(r)) {
            const meta = JSON.parse(readFileSync(p, "utf8")) as Record<
              string,
              unknown
            >;
            meta.provider_raw = readFileSync(r, "utf8");
            byId.set(String(meta.attempt_id), meta);
          }
        }
      }
    }
    allRows.length = 0;
    allRows.push(...byId.values());
  }

  save(OUT_ROOT, "all_valid_rows.json", allRows);
  save(OUT_ROOT, "PARITY_LOG.json", parityLog);
  save(OUT_ROOT, "SCENARIO_MANIFEST.json", {
    model: MODEL,
    arms: { A: "CURRENT_STANDARD_CONTROL", B: "QUALITATIVE_SAFE_SHORT_CONTROL", D: "UNIFIED_LENGTH_AGENCY_TERMINAL" },
    scenarios: SCENARIOS,
    persona_id: 61,
  });
  save(OUT_ROOT, "RUNTIME_RESULTS.json", {
    status: "OPUS_UNIFIED_TERMINAL_PHASE1_CAPTURED",
    human_review: "NOT_RUN — waiting for ChatGPT",
    model_lineup_decision: "NO",
    production_change: false,
    valid_outputs: allRows.length,
    expected_outputs: 36,
    exclusions,
    parity_t1_cells: parityLog.length,
    phase2: "NOT_RUN — only if Arm D phase1 pass after human review",
  });
  console.log(
    JSON.stringify(
      {
        status: "OPUS_UNIFIED_TERMINAL_PHASE1_CAPTURED",
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
  process.argv[1].includes("opus-unified-terminal-contract-live");
if (isDirect) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

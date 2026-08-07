/**
 * Audit 59 — Cost-Capped Agency-Safe Length Recovery Canary (Opus)
 * Arm E = frozen Audit 58 Arm E terminal.
 * Arm F = Arm E with exact one-sentence stop replacement.
 * Stage 1: s2 + s6 = 8 calls. Stage 2 (s5 = 4) only if Stage 1 passes after human review.
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
  process.env.OUT_ROOT ?? "/opt/cursor/artifacts/opus-agency-safe-length-recovery";
const FIXTURE_DIR =
  process.env.FIXTURE_DIR ??
  "/opt/cursor/artifacts/opus-quality-anchor/fixtures";
const DOCS = "docs/audits/59-opus-agency-safe-length-recovery";
const STAGE = (process.env.AUDIT59_STAGE ?? "1") as "1" | "2";

const OLD_STOP =
  "첫 번째로 새롭게 요구되는 [B]의 행동 직전에 멈춘다.";
const NEW_STOP =
  "[B]에게 새로운 행동이 요구되더라도 그 행동을 수행한 것으로 서술하지 않은 채, [A]·NPC·환경이 독립적으로 만들 수 있는 판단·행동·위험 변화와 그 결과를 계속 전개하고, [B]의 실제 선택이나 수행 없이는 더 이상 의미 있는 진행이 불가능한 지점에서 멈춘다.";

/** Frozen Audit 58 Arm E — rebuilt identically from Audit 58 source constants. */
const AUDIT58_ARM_D_TERMINAL = `이번 응답은 한국어 총 표시 3,200~4,200자의 하나의 밀도 있는 장면으로 전개한다.

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

const AUDIT58_INSTRUCTION_BOUNDARY_PARAGRAPH = `[B]가 현재 입력에서 직접 선언하거나 시작한 하나의 행동은 그 행동 자체의 즉각적인 결과까지 이어갈 수 있다. 그러나 [B]가 “지시해”, “시키는 대로 하겠다”, “명령만 해”, “따르겠다”처럼 아직 특정되지 않은 이후 행동을 맡긴 표현은 미래 행동 전체에 대한 포괄적 위임이 아니다.
이 경우 AI는 [A]와 NPC가 지시·선택지·위험·예상 결과를 제시할 수 있지만, 현재 입력에서 [B]가 직접 선언하거나 시작하지 않은 지시 이행을 같은 응답 안에서 [B]가 실제로 수행한 것으로 서술하지 않는다. 첫 번째로 새롭게 요구되는 [B]의 행동 직전에 멈춘다.
하나의 명시된 행동을 처리한 뒤에는 그 결과에 대한 [A]·NPC·환경의 반응을 충분히 전개할 수 있지만, 그 반응 속에서 [B]에게 두 번째 행동을 자동으로 이어 붙이지 않는다.`;

function buildArmEFromD(armD: string): string {
  const allowedEnd = "6. 여러 단계의 후속 행동 연쇄로 확장되지 않는다.";
  const forbidden =
    "[B]의 새로운 직접 대사, 중요한 선택·동의·거절, 고백, 공격, 도주, 동행, 퇴장, 구매, 선물, 비밀 공개, 관계 변화, 성적 행동, 위험 감수, 감정 결론은 대신 작성하지 않는다.";
  const marker = `${allowedEnd}\n\n${forbidden}`;
  if (!armD.includes(marker)) throw new Error("ARM_E_ANCHOR_FAIL");
  return armD.replace(
    marker,
    `${allowedEnd}\n\n${AUDIT58_INSTRUCTION_BOUNDARY_PARAGRAPH}\n\n${forbidden}`
  );
}

export const AUDIT59_ARM_E_TERMINAL = buildArmEFromD(AUDIT58_ARM_D_TERMINAL);

function buildArmF(armE: string): string {
  const n = (armE.match(new RegExp(OLD_STOP.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || [])
    .length;
  if (n !== 1) {
    throw new Error(`OLD_STOP_COUNT_FAIL expected 1 got ${n}`);
  }
  if (armE.includes(NEW_STOP)) {
    throw new Error("Arm E already contains NEW_STOP");
  }
  return armE.replace(OLD_STOP, NEW_STOP);
}

export const AUDIT59_ARM_F_TERMINAL = buildArmF(AUDIT59_ARM_E_TERMINAL);

type ArmId = "E" | "F";
type ScenarioKind = "relationship" | "action" | "instruction";
type ChatMsg = { role: "user" | "assistant" | "system"; content: string };
type Scenario = {
  id: string;
  kind: ScenarioKind;
  label: string;
  characterId: number;
  turns: [string, string];
  stress: string;
  stage: 1 | 2;
};

const ALL_SCENARIOS: Scenario[] = [
  {
    id: "s2_blanket_compliance",
    kind: "instruction",
    label: "행동 없는 포괄적 순응",
    characterId: 9,
    stage: 1,
    stress: "NPC 지시 허용; 유저 지시 이행 서술 금지; length recovery",
    turns: [
      "시키는 대로 할게요. 뭘 하면 돼요?",
      "알겠어요. 위험하면 말해 주세요. 지시만 이어서 해주세요.",
    ],
  },
  {
    id: "s6_action_combat_1_regression",
    kind: "action",
    label: "일반 장문 액션 회귀 (Audit57 action_combat_1)",
    characterId: 10,
    stage: 1,
    stress: "길이 회복 + 액션 진행 유지; severe/over-freeze 0",
    turns: [
      "*멀리서 비명과 금속 마찰음이 겹친다. 렌은 에녹 쪽으로 몸을 낮춘다.* 저쪽이에요. 같이 가요?",
      "*렌은 에녹의 소매를 짧게 잡아끈다.* 왼쪽 골목으로 우회할까요?",
    ],
  },
  {
    id: "s5_relationship_hand",
    kind: "relationship",
    label: "관계 장면",
    characterId: 5,
    stage: 2,
    stress: "관계 품질 유지; 대사 폭증/파편화 없음; chars not below E",
    turns: [
      "*렌은 내민 손을 잡는다.* 그다음에는 어떻게 할까요?",
      "…알겠어요. 그다음에 어떻게 하면 좋을지 말해 주세요.",
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
        if (
          typeof choice0?.finish_reason === "string" &&
          choice0.finish_reason
        ) {
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
      ttft_s: null as number | null,
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

function terminalForArm(arm: ArmId): string {
  return arm === "E" ? AUDIT59_ARM_E_TERMINAL : AUDIT59_ARM_F_TERMINAL;
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
  const baseUser = lastUser
    .replace(USER_TAIL_LENGTH_OWNER_SENTENCE, "")
    .trimEnd();
  const terminal = terminalForArm(opts.arm);
  const newLast = `${baseUser}\n\n${terminal}`;
  messages[lastIdx] = { role: "user", content: newLast };
  requestBody.messages = messages;

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
    collaborative_owner: countOcc(
      payload,
      COLLABORATIVE_INTERACTIVE_OWNER_TITLE
    ),
    terminal_length_owner_numeric: countOcc(
      newLast,
      USER_TAIL_LENGTH_OWNER_SENTENCE
    ),
    terminal_unified_d: countOcc(
      newLast,
      "유저 페르소나와 최근 행동 양식은 [B]의 즉각적인 반응"
    ),
    terminal_instruction_boundary: countOcc(
      newLast,
      "미래 행동 전체에 대한 포괄적 위임이 아니다"
    ),
    old_stop: countOcc(newLast, OLD_STOP),
    new_stop: countOcc(newLast, NEW_STOP),
    absolute_final_is_terminal: newLast.trimEnd().endsWith(terminal.trim())
      ? 1
      : 0,
    model_adapter: 0,
  };

  if (owner_counts.terminal_length_owner_numeric !== 0) {
    throw new Error(`Arm ${opts.arm} still has numeric terminal`);
  }
  if (owner_counts.terminal_unified_d !== 1) {
    throw new Error(`Arm ${opts.arm} missing D/E core`);
  }
  if (owner_counts.terminal_instruction_boundary !== 1) {
    throw new Error(`Arm ${opts.arm} missing instruction-boundary paragraph`);
  }
  if (opts.arm === "E") {
    if (owner_counts.old_stop !== 1 || owner_counts.new_stop !== 0) {
      throw new Error("Arm E stop sentence mismatch");
    }
  }
  if (opts.arm === "F") {
    if (owner_counts.old_stop !== 0 || owner_counts.new_stop !== 1) {
      throw new Error("Arm F stop sentence mismatch");
    }
  }
  if (owner_counts.absolute_final_is_terminal !== 1) {
    throw new Error(`Arm ${opts.arm} terminal not absolute final`);
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
    stage: opts.scenario.stage,
    base_prompt_hash_without_terminal:
      assembled.base_prompt_hash_without_terminal,
    terminal_hash: assembled.terminal_hash,
    full_prompt_hash: assembled.full_prompt_hash,
    owner_counts: assembled.owner_counts,
    token_approx: assembled.token_approx,
    reasoning_effort: assembled.reasoning_effort,
    temperature: assembled.temperature,
    top_p: assembled.top_p,
  });
  save(dir, `turn${opts.turn}-messages.json`, assembled.messages);

  console.log(
    `\n=== stage${opts.scenario.stage} ${opts.scenario.id} arm ${opts.arm} turn ${opts.turn} ===`
  );
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
      ? (Math.max(0, input - cached) * opts.rates.input +
          cached * opts.rates.cacheRead +
          out * opts.rates.output) /
        1_000_000
      : null);
  const krw = usd != null ? Math.round(usd * opts.fx * 10) / 10 : null;

  const row = {
    attempt_id: `${opts.scenario.id.toUpperCase()}-ARM${opts.arm}-T${opts.turn}`,
    arm: opts.arm,
    stage: opts.scenario.stage,
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
    base_prompt_hash_without_terminal:
      assembled.base_prompt_hash_without_terminal,
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
    terminalHash: assembled.terminal_hash.slice(0, 12),
  });
  return row;
}

function freezeCheckAgainstAudit58Source() {
  const src = readFileSync(
    "scripts/opus-instruction-boundary-canary-live.ts",
    "utf8"
  );
  const m = src.match(
    /export const AUDIT58_ARM_E_TERMINAL = buildArmETerminal\(AUDIT58_ARM_D_TERMINAL\);/
  );
  if (!m) throw new Error("cannot locate Audit 58 Arm E export");
  // Rebuild E from Audit 58 paragraph + D freeze in that file
  const para = src.match(
    /export const AUDIT58_INSTRUCTION_BOUNDARY_PARAGRAPH = `([\s\S]*?)`;/
  );
  const d = src.match(
    /export const AUDIT58_ARM_D_TERMINAL = `([\s\S]*?)`;/
  );
  if (!para || !d) throw new Error("Audit 58 freeze source parse fail");
  if (para[1] !== AUDIT58_INSTRUCTION_BOUNDARY_PARAGRAPH) {
    throw new Error("instruction boundary paragraph drifted from Audit 58");
  }
  if (d[1] !== AUDIT58_ARM_D_TERMINAL) {
    throw new Error("Arm D freeze drifted from Audit 58 source");
  }
  // Exact E terminal must equal Audit 58's build
  const eFrom58File = (() => {
    const allowedEnd = "6. 여러 단계의 후속 행동 연쇄로 확장되지 않는다.";
    const forbidden =
      "[B]의 새로운 직접 대사, 중요한 선택·동의·거절, 고백, 공격, 도주, 동행, 퇴장, 구매, 선물, 비밀 공개, 관계 변화, 성적 행동, 위험 감수, 감정 결론은 대신 작성하지 않는다.";
    return d[1]!.replace(
      `${allowedEnd}\n\n${forbidden}`,
      `${allowedEnd}\n\n${para[1]}\n\n${forbidden}`
    );
  })();
  if (eFrom58File !== AUDIT59_ARM_E_TERMINAL) {
    throw new Error("Arm E terminal drifted from Audit 58 freeze");
  }
  if (!AUDIT59_ARM_E_TERMINAL.includes(OLD_STOP)) {
    throw new Error("Arm E missing OLD_STOP");
  }
  if (AUDIT59_ARM_F_TERMINAL.includes(OLD_STOP)) {
    throw new Error("Arm F still has OLD_STOP");
  }
  if (!AUDIT59_ARM_F_TERMINAL.includes(NEW_STOP)) {
    throw new Error("Arm F missing NEW_STOP");
  }
  // Diff must be exactly the sentence replacement
  if (AUDIT59_ARM_E_TERMINAL.replace(OLD_STOP, NEW_STOP) !== AUDIT59_ARM_F_TERMINAL) {
    throw new Error("E→F delta is not exact one-sentence replacement");
  }
}

async function main() {
  freezeCheckAgainstAudit58Source();

  if (STAGE === "2") {
    const gate = join(OUT_ROOT, "STAGE1_HUMAN_PASS.flag");
    if (!existsSync(gate)) {
      throw new Error(
        "STAGE2_BLOCKED: Stage 1 human pass flag missing — do not run Stage 2 API calls"
      );
    }
  }

  mkdirSync(OUT_ROOT, { recursive: true });
  mkdirSync(DOCS, { recursive: true });
  if (!existsSync(join(FIXTURE_DIR, "c9_fixture.json"))) {
    throw new Error(`fixtures missing under ${FIXTURE_DIR}`);
  }

  const scenarios = ALL_SCENARIOS.filter((s) =>
    STAGE === "1" ? s.stage === 1 : s.stage === 2
  );
  const expected = scenarios.length * 2 * 2;

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

  save(OUT_ROOT, "TERMINALS.json", {
    arm_e_sha256: sha256(AUDIT59_ARM_E_TERMINAL),
    arm_f_sha256: sha256(AUDIT59_ARM_F_TERMINAL),
    old_stop: OLD_STOP,
    new_stop: NEW_STOP,
    arm_e_terminal: AUDIT59_ARM_E_TERMINAL,
    arm_f_terminal: AUDIT59_ARM_F_TERMINAL,
    exact_sentence_replacement: true,
  });

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

  const stripTerminal = (messages: ChatMsg[], terminal: string): ChatMsg[] => {
    const out = messages.map((m) => ({ ...m }));
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i]!.role !== "user") continue;
      const c = String(out[i]!.content ?? "");
      if (!c.endsWith(terminal)) {
        throw new Error("TERMINAL_NOT_ABSOLUTE_FINAL during strip");
      }
      out[i] = {
        role: "user",
        content: c.slice(0, c.length - terminal.length).trimEnd(),
      };
      break;
    }
    return out;
  };

  for (const scenario of scenarios) {
    const fixture = await loadFixture(scenario.characterId);
    for (const arm of ["E", "F"] as ArmId[]) {
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
          t1 = loadRow(scenario.id, arm, 1);
          console.log(`skip ${scenario.id} ${arm} T1`);
        } else {
          const pre: Record<ArmId, Awaited<ReturnType<typeof assembleCell>>> = {
            E: await assembleCell({
              arm: "E",
              fixture,
              history,
              currentUserMessage: scenario.turns[0]!,
            }),
            F: await assembleCell({
              arm: "F",
              fixture,
              history,
              currentUserMessage: scenario.turns[0]!,
            }),
          };
          const baseE = pre.E.base_prompt_hash_without_terminal;
          if (pre.F.base_prompt_hash_without_terminal !== baseE) {
            throw new Error(
              `BASE_PROMPT_PARITY_FAIL ${scenario.id} T1 E/F before API`
            );
          }
          if (pre.E.token_approx.base_user !== pre.F.token_approx.base_user) {
            throw new Error(`BASE_USER_TOKEN_PARITY_FAIL ${scenario.id}`);
          }
          if (pre.E.terminal_hash === pre.F.terminal_hash) {
            throw new Error(`TERMINAL_HASH_IDENTICAL_FAIL ${scenario.id}`);
          }
          if (
            JSON.stringify(stripTerminal(pre.E.messages, pre.E.terminal)) !==
            JSON.stringify(stripTerminal(pre.F.messages, pre.F.terminal))
          ) {
            throw new Error(
              `NON_TERMINAL_DELTA_FAIL ${scenario.id} T1 — beyond stop sentence`
            );
          }
          parityLog.push({
            scenario: scenario.id,
            turn: 1,
            stage: scenario.stage,
            base_prompt_hash_without_terminal: baseE,
            terminal_hashes: {
              E: pre.E.terminal_hash,
              F: pre.F.terminal_hash,
            },
          });
          t1 = await runOneTurn({
            arm,
            scenario,
            turn: 1,
            history,
            fixture,
            expectedBaseHash: baseE,
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
          const preT2E = await assembleCell({
            arm: "E",
            fixture,
            history,
            currentUserMessage: scenario.turns[1]!,
          });
          const preT2F = await assembleCell({
            arm: "F",
            fixture,
            history,
            currentUserMessage: scenario.turns[1]!,
          });
          if (
            preT2E.base_prompt_hash_without_terminal !==
            preT2F.base_prompt_hash_without_terminal
          ) {
            throw new Error(
              `BASE_PROMPT_PARITY_FAIL ${scenario.id} T2 same-history E/F`
            );
          }
          parityLog.push({
            scenario: scenario.id,
            turn: 2,
            stage: scenario.stage,
            arm_history: arm,
            base_prompt_hash_without_terminal:
              preT2E.base_prompt_hash_without_terminal,
            terminal_hashes: {
              E: preT2E.terminal_hash,
              F: preT2F.terminal_hash,
            },
          });
          const preArm = arm === "E" ? preT2E : preT2F;
          const t2 = await runOneTurn({
            arm,
            scenario,
            turn: 2,
            history,
            fixture,
            expectedBaseHash: preArm.base_prompt_hash_without_terminal,
            fx,
            rates,
          });
          allRows.push(t2);
        }
      } catch (e) {
        exclusions.push({ scenario: scenario.id, arm, error: String(e) });
        save(OUT_ROOT, "RUNTIME_RESULTS.json", {
          status: "OPUS_AGENCY_SAFE_LENGTH_RECOVERY_RUNTIME_FAIL",
          stage: STAGE,
          error: String(e),
          exclusions,
        });
        throw e;
      }
    }
  }

  {
    const byId = new Map<string, Record<string, unknown>>();
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
            if (String(meta.stage) !== STAGE && meta.stage !== Number(STAGE)) {
              // keep all; filter below for stage status
            }
            meta.provider_raw = readFileSync(r, "utf8");
            byId.set(String(meta.attempt_id), meta);
          }
        }
      }
    }
    allRows.length = 0;
    allRows.push(...byId.values());
  }

  const stageRows = allRows.filter(
    (r) => Number(r.stage) === Number(STAGE)
  );

  // Operator length preview (not a human verdict)
  const lengthPreview: Record<string, unknown> = {};
  for (const arm of ["E", "F"]) {
    const m = stageRows.filter((r) => r.arm === arm);
    const chars = m
      .map((r) => r.total_visible_chars)
      .filter((x): x is number => typeof x === "number")
      .sort((a, b) => a - b);
    const krw = m
      .map((r) => r.api_raw_cost_krw)
      .filter((x): x is number => typeof x === "number");
    lengthPreview[arm] = {
      outputs: m.length,
      median_total_visible_chars: chars.length
        ? chars[Math.floor((chars.length - 1) / 2)]
        : null,
      ge_2400: chars.filter((c) => c >= 2400).length,
      avg_api_raw_cost_krw: krw.length
        ? krw.reduce((a, b) => a + b, 0) / krw.length
        : null,
    };
  }

  save(OUT_ROOT, "all_valid_rows.json", allRows);
  save(OUT_ROOT, "PARITY_LOG.json", parityLog);
  save(OUT_ROOT, "SCENARIO_MANIFEST.json", {
    model: MODEL,
    stage: Number(STAGE),
    arms: {
      E: "FROZEN_AUDIT58_ARM_E",
      F: "LENGTH_RECOVERY_STOP_SENTENCE",
    },
    scenarios,
    all_scenarios: ALL_SCENARIOS,
    persona_id: 61,
    expected_outputs: expected,
    retry_continuation_recovery: 0,
    exact_sentence_replacement: { from: OLD_STOP, to: NEW_STOP },
  });
  save(OUT_ROOT, `STAGE${STAGE}_LENGTH_PREVIEW.json`, lengthPreview);
  save(OUT_ROOT, "RUNTIME_RESULTS.json", {
    status:
      STAGE === "1"
        ? "OPUS_AGENCY_SAFE_LENGTH_RECOVERY_STAGE1_CAPTURED"
        : "OPUS_AGENCY_SAFE_LENGTH_RECOVERY_STAGE2_CAPTURED",
    stage: Number(STAGE),
    human_review: "NOT_RUN — waiting for ChatGPT",
    audit58_preserved: {
      OPUS_INSTRUCTION_BOUNDARY_AGENCY_PASS: true,
      OPUS_INSTRUCTION_BOUNDARY_CANARY_OVERALL_FAIL_LENGTH: true,
      AGENCY_BOUNDARY_SOLVED: true,
      LENGTH_RECOVERY_REQUIRED: true,
    },
    stage2:
      STAGE === "1"
        ? "NOT_RUN unless Stage 1 passes after human review"
        : "CAPTURED",
    model_lineup_decision: "NO",
    production_change: false,
    valid_outputs_this_stage: stageRows.length,
    expected_outputs_this_stage: expected,
    exclusions,
    parity_cells: parityLog.length,
    length_preview: lengthPreview,
    phase2: "NOT_RUN",
  });
  console.log(
    JSON.stringify(
      {
        status:
          STAGE === "1"
            ? "OPUS_AGENCY_SAFE_LENGTH_RECOVERY_STAGE1_CAPTURED"
            : "OPUS_AGENCY_SAFE_LENGTH_RECOVERY_STAGE2_CAPTURED",
        stage: STAGE,
        valid: stageRows.length,
        expected,
        exclusions: exclusions.length,
        length_preview: lengthPreview,
        arm_e_sha: sha256(AUDIT59_ARM_E_TERMINAL).slice(0, 16),
        arm_f_sha: sha256(AUDIT59_ARM_F_TERMINAL).slice(0, 16),
      },
      null,
      2
    )
  );
}

const isDirect =
  typeof process.argv[1] === "string" &&
  process.argv[1].includes("opus-agency-safe-length-recovery-live");
if (isDirect) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

/**
 * Phase G11-C5 — HISTORICAL SEQUENCE TRIANGULATION
 *
 * Tested object: HISTORICAL_SEQUENCE_BUNDLE (not EXACT_HISTORICAL_PROMPT).
 * FULL_HISTORICAL_PAYLOAD_PARITY = UNKNOWN.
 *
 * 4 frozen cells (REL_T1/T2, ACT_T1/T2) × 2 routes (OR + CI) = 8 NEW calls.
 * Historical #255 Gemini outputs are stored reference only (not re-called).
 *
 *   PHASE=preaudit|live \
 *     node --conditions=react-server --import tsx \
 *     scripts/rp-quality-g11c5-historical-sequence-triangulation.ts
 *
 * ONE TURN = ONE PRIMARY LLM CALL
 * production wire / merge = NOT_RUN
 */
import { createHash } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";
import {
  applyScenePacingArmToMessages,
  countPacingOwners,
  countTerminalDialogueBudgetOwners,
  resolveScenePacingDecision,
  type ScenePacingDecision,
} from "../src/lib/scenePacingController";
import { OPENING_TURN_USER } from "../src/lib/chatGreetingContext";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "../src/lib/responseLength";
import {
  adaptCheaperInferenceChatBody,
  buildCheaperInferenceHeaders,
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
} from "../src/lib/cheaperInferenceConfig";
import {
  OPENROUTER_CHAT_COMPLETIONS_URL,
  buildOpenRouterHeaders,
} from "../src/lib/openRouterConfig";
import {
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  OPENROUTER_GEMINI_31_PRO_MODEL,
} from "../src/lib/chatModels";
import { loadCharacterChunksForPromptReadOnly } from "../src/lib/characterChunks";
import { formatSelectedPersonaForPrompt } from "../src/lib/userPersonas";
import { buildContext } from "../src/services/contextBuilder";
import { assemblePrimaryRpRequest } from "../src/lib/openRouterAdult";
import { resolveNarrativePov } from "../src/lib/narrativePov";
import {
  computeRpQualityVectorV2,
  type SettingSource,
} from "../src/lib/rpQualityVector";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}
if (!process.env.CHEAPER_INFERENCE_API_KEY?.trim()) {
  for (const p of ["/tmp/ci_key", "/tmp/cheaper_key"]) {
    if (existsSync(p)) {
      const k = readFileSync(p, "utf8").trim();
      if (k) process.env.CHEAPER_INFERENCE_API_KEY = k;
    }
  }
}
if (!process.env.OPENROUTER_API_KEY?.trim()) {
  for (const p of ["/tmp/d6b1_or_key", "/tmp/or_key"]) {
    if (existsSync(p)) {
      const k = readFileSync(p, "utf8").trim();
      if (k) process.env.OPENROUTER_API_KEY = k;
    }
  }
}

const OUT_ROOT =
  process.env.OUT_ROOT ??
  "/opt/cursor/artifacts/rp-quality-g11c5-historical-sequence";
const DOCS =
  process.env.DOCS_DIR ?? "docs/audits/rp-historical-sequence-g11c5";
const CELL_PATH = join(DOCS, "fixtures/G11_C5_CELLS.json");
const PHASE =
  (process.env.PHASE as "preaudit" | "live" | undefined) ??
  (process.argv.includes("--live") ? "live" : "preaudit");

type Msg = { role: string; content: string };

type CellDef = {
  id: string;
  domain: string;
  turn: number;
  userInput: string;
  historyAfterGreeting?: Array<{ role: string; content: string }>;
  freeze_prior?: { user_t1: string; assistant_t1_raw_path: string };
  historical_attempt_id: string;
  historical_chars: number;
  historical_input_tokens: number;
};

type CharBundle = {
  character: Record<string, unknown>;
  persona: Record<string, unknown>;
  user: Record<string, unknown>;
};

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
function flattenContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) =>
        b && typeof b === "object" && "text" in b
          ? String((b as { text: unknown }).text ?? "")
          : ""
      )
      .join("\n\n");
  }
  return "";
}
function normalizeMessages(
  messages: Array<{ role: string; content: unknown }>
): Msg[] {
  return messages.map((m) => ({
    role: m.role,
    content: flattenContent(m.content),
  }));
}
function messageHashes(messages: Msg[]) {
  const per = messages.map((m) => ({
    role: m.role,
    content_sha256: sha256(m.content),
    chars: [...m.content].length,
  }));
  const system = messages.find((m) => m.role === "system");
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const history = messages.filter(
    (m, i) => !(m.role === "system" && i === 0) && !(m === lastUser)
  );
  const fullCanonical = messages
    .map((m) => `${m.role}\n${m.content}`)
    .join("\n---\n");
  return {
    per_message: per,
    system_sha256: sha256(system?.content ?? ""),
    history_sha256: sha256(
      history.map((m) => `${m.role}\n${m.content}`).join("\n---\n")
    ),
    last_user_sha256: sha256(lastUser?.content ?? ""),
    full_messages_sha256: sha256(fullCanonical),
    system_chars: [...(system?.content ?? "")].length,
    history_chars: history.reduce((n, m) => n + [...m.content].length, 0),
    last_user_chars: [...(lastUser?.content ?? "")].length,
  };
}
function visibleChars(text: string) {
  return text.replace(/\s+/g, "").length;
}
function countDirectSpeechBlocks(text: string) {
  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  let count = 0;
  for (const p of paras) {
    if (/^["“「『]/.test(p) || /["”」』]\s*$/.test(p)) count += 1;
  }
  return { speech_blocks: count, paragraphs: paras.length };
}
function dialogueCharShare(text: string) {
  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  let dial = 0;
  let total = 0;
  for (const p of paras) {
    const n = visibleChars(p);
    total += n;
    if (/^["“「『]/.test(p) || /["”」』]\s*$/.test(p)) dial += n;
  }
  return total ? dial / total : 0;
}
function median(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}
function mean(xs: number[]) {
  return xs.length
    ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length)
    : 0;
}

function loadCellFile() {
  return JSON.parse(readFileSync(CELL_PATH, "utf8")) as {
    characterFixture: string;
    cells: CellDef[];
  };
}

function historyForCell(cell: CellDef): Array<{ role: string; content: string }> {
  if (cell.freeze_prior) {
    const raw = readFileSync(cell.freeze_prior.assistant_t1_raw_path, "utf8");
    return [
      { role: "user", content: cell.freeze_prior.user_t1 },
      { role: "assistant", content: raw },
    ];
  }
  return cell.historyAfterGreeting ?? [];
}

function assembleFrozenArmA(cell: CellDef, characterFixture: string) {
  const bundle = JSON.parse(readFileSync(characterFixture, "utf8")) as CharBundle;
  const ch = { ...bundle.character };
  const persona = { ...bundle.persona };
  const personaName = String(persona.name ?? "렌");
  const contentKind = "character" as const;
  const party = false;
  const modelId = OPENROUTER_GEMINI_31_PRO_MODEL;
  const hist = historyForCell(cell);

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
    String(bundle.user.nickname ?? personaName)
  );
  const userPersona = formatSelectedPersonaForPrompt(
    personaName,
    (persona.gender as "male" | "female" | "other") ?? "other",
    String(persona.description ?? "")
  );
  const narrativePov = resolveNarrativePov({
    mode: "third_person",
    contentKind,
    mainCharacterName: String(ch.name),
  });
  const greeting = String(ch.greeting ?? "");
  const shortTermHistory = [
    { role: "user" as const, content: OPENING_TURN_USER },
    { role: "assistant" as const, content: greeting },
    ...hist.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  const built = buildContext({
    charName: String(ch.name),
    chunks,
    userNickname: String(bundle.user.nickname ?? personaName),
    userPersona,
    userNote: "",
    longTermMemory: "",
    shortTermHistory,
    currentUserMessage: cell.userInput,
    nsfw: !!ch.nsfw,
    gender: (ch.gender as "male" | "female" | "other") ?? "other",
    memoryMeta: "",
    modelId,
    userImpersonation: false,
    novelModeEnabled: false,
    isContinue: false,
    personaDisplayName: personaName,
    targetResponseChars: 3200,
    completedTurns: Math.max(0, shortTermHistory.length / 2 - 1),
    provider: "openrouter",
    contentKind,
    exampleDialog: String(ch.example_dialog ?? ""),
    userId: Number(bundle.user.id ?? 4),
    narrativePov,
  });

  const decision: ScenePacingDecision = resolveScenePacingDecision({
    contentKind,
    party,
    primaryCharacterName: String(ch.name),
    currentUserMessage: cell.userInput,
    recentMessages: shortTermHistory,
    currentTurn: Math.max(1, Math.floor(shortTermHistory.length / 2) + 1),
    progressionHistory: [],
    knownSupportingCastNames: [],
    establishedActiveCastNames: undefined,
    adultModeEnabled: false,
    chatId: `g11c5-A-${cell.id}`,
  });

  const wire = assemblePrimaryRpRequest({
    system: built.systemPrompt,
    history: built.history ?? [],
    modelId,
    targetResponseChars: 3200,
    messageOpts: {
      transportProvider: "openrouter",
      charName: String(ch.name),
      personaName,
    },
  });

  const bodyBase = {
    ...(wire.requestBody as Record<string, unknown>),
    stream: true,
    stream_options: { include_usage: true },
  };
  const messagesBase =
    (bodyBase.messages as Array<{ role: string; content: unknown }>) ?? [];
  const applied = applyScenePacingArmToMessages({
    messages: messagesBase.map((m) => ({
      role: m.role,
      content: flattenContent(m.content),
    })),
    arm: "A",
    decision,
    dialogueBudgetInput: {
      currentUserMessage: cell.userInput,
      recentMessages: shortTermHistory,
      knownSupportingCastNames: [],
      party,
      contentKind,
    },
  });

  const frozen = normalizeMessages(applied.messages);
  const hashes = messageHashes(frozen);

  const orBody = {
    ...bodyBase,
    model: OPENROUTER_GEMINI_31_PRO_MODEL,
    messages: frozen,
    temperature: 0.95,
    reasoning: { effort: "low" },
    include_reasoning: false,
  };
  delete (orBody as Record<string, unknown>).top_p;
  delete (orBody as Record<string, unknown>).stop;
  delete (orBody as Record<string, unknown>).max_tokens;
  delete (orBody as Record<string, unknown>).reasoning_effort;

  const ciBody = adaptCheaperInferenceChatBody({
    model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
    messages: frozen,
    stream: true,
    stream_options: { include_usage: true },
    temperature: 0.95,
    reasoning: { effort: "low" },
    include_reasoning: false,
  });

  const settingSources: SettingSource[] = [
    {
      bucket: "CHARACTER_CANON",
      text: [String(ch.system_prompt ?? ""), String(ch.example_dialog ?? "")].join(
        "\n"
      ),
    },
    { bucket: "WORLD_CANON", text: String(ch.world ?? "") },
    { bucket: "USER_PERSONA", text: String(persona.description ?? "") },
    { bucket: "CURRENT_USER_INPUT", text: cell.userInput },
    { bucket: "MEMORY", text: "" },
  ];

  const owners = countPacingOwners(
    frozen.find((m) => m.role === "system")?.content ?? ""
  );
  const terminalOwners = countTerminalDialogueBudgetOwners(
    [...frozen].reverse().find((m) => m.role === "user")?.content ?? ""
  );

  return {
    cell: cell.id,
    domain: cell.domain,
    frozen_messages: frozen,
    hashes,
    owners,
    terminalOwners,
    length_owner_terminal: ([...frozen]
      .reverse()
      .find((m) => m.role === "user")
      ?.content.trimEnd()
      .endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE) ?? false),
    or_body: orBody,
    ci_body: ciBody,
    schema_differences: {
      model_id: {
        or: OPENROUTER_GEMINI_31_PRO_MODEL,
        ci: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      },
      reasoning_wire: {
        or: "reasoning:{effort:low} + include_reasoning:false",
        ci: "reasoning_effort=low (reasoning object stripped)",
        note: "SCHEMA_DIFFERENCE — semantic effort both low",
      },
      endpoint: {
        or: OPENROUTER_CHAT_COMPLETIONS_URL,
        ci: CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
      },
    },
    settingSources,
    historical: {
      attempt_id: cell.historical_attempt_id,
      chars: cell.historical_chars,
      input_tokens: cell.historical_input_tokens,
    },
    arm_A_controls: {
      scene_pacing: owners.scene_pacing,
      d3_dialogue_terminal: terminalOwners.terminal_dialogue_budget_owner,
      l1: 0,
      p1: 0,
      length_owner_terminal: true,
    },
  };
}

type StreamState = {
  text: string;
  finish: string | null;
  usage: Record<string, unknown> | null;
  provider: string | null;
  model: string | null;
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
  if (ev.provider && typeof ev.provider === "object") {
    const p = ev.provider as Record<string, unknown>;
    if (typeof p.name === "string") state.provider = p.name;
  }
  if (typeof ev.provider === "string") state.provider = ev.provider;
  if (typeof ev.model === "string") state.model = ev.model;
  if (ev.usage && typeof ev.usage === "object") {
    state.usage = ev.usage as Record<string, unknown>;
  }
  const choices = ev.choices as Array<Record<string, unknown>> | undefined;
  const choice0 = choices?.[0];
  if (choice0 && typeof choice0.finish_reason === "string") {
    state.finish = choice0.finish_reason;
  }
  const delta = choice0?.delta as Record<string, unknown> | undefined;
  if (typeof delta?.content === "string") state.text += delta.content;
  if (typeof choice0?.text === "string") state.text += choice0.text;
}

async function streamEndpoint(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>
) {
  const t0 = Date.now();
  const state: StreamState = {
    text: "",
    finish: null,
    usage: null,
    provider: null,
    model: null,
    sawDone: false,
  };
  let firstDeltaAt: number | null = null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
      return {
        http_status: res.status,
        error: !res.ok
          ? (await res.text()).slice(0, 800)
          : "empty body",
        text: "",
        finish_reason: null as string | null,
        usage: null as Record<string, unknown> | null,
        provider: null as string | null,
        model: null as string | null,
        latency_s: (Date.now() - t0) / 1000,
        ttft_s: null as number | null,
        transport_failure: true,
      };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const before = state.text.length;
        processSseLine(line, state);
        if (firstDeltaAt == null && state.text.length > before) {
          firstDeltaAt = Date.now();
        }
      }
    }
    if (buf.trim()) processSseLine(buf, state);
    return {
      http_status: res.status,
      error: null as string | null,
      text: state.text,
      finish_reason: state.finish,
      usage: state.usage,
      provider: state.provider,
      model: state.model,
      latency_s: (Date.now() - t0) / 1000,
      ttft_s: firstDeltaAt != null ? (firstDeltaAt - t0) / 1000 : null,
      transport_failure: false,
    };
  } catch (e) {
    return {
      http_status: 0,
      error: e instanceof Error ? e.message : String(e),
      text: "",
      finish_reason: null,
      usage: null,
      provider: null,
      model: null,
      latency_s: (Date.now() - t0) / 1000,
      ttft_s: null,
      transport_failure: true,
    };
  }
}

function extractUsage(usage: Record<string, unknown> | null) {
  if (!usage) {
    return {
      input_tokens: null as number | null,
      visible_output_tokens: null as number | null,
      reasoning_tokens: null as number | null,
      total_billed_output_tokens: null as number | null,
      cost: null as number | null,
    };
  }
  const details =
    (usage.completion_tokens_details as Record<string, unknown> | undefined) ??
    {};
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
  return {
    input_tokens: input,
    visible_output_tokens: out,
    reasoning_tokens: reasoning,
    total_billed_output_tokens:
      out != null && reasoning != null ? out + reasoning : out,
    cost: typeof usage.cost === "number" ? usage.cost : null,
  };
}

function qualityNotes(text: string) {
  const v = visibleChars(text);
  const speech = countDirectSpeechBlocks(text);
  const dialShare = dialogueCharShare(text);
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const uniq = new Set(lines);
  const repetition =
    lines.length > 8 && uniq.size / lines.length < 0.55 ? "high" : "low";
  const canonPad =
    (text.match(/설정상|세계관에 따르면|원래부터/g) ?? []).length >= 4
      ? "elevated"
      : "low";
  const agencySevere =
    /당신이 말했다|유저가 대답했다|렌이 대답했다.*\"[^\"]{20,}\"/g.test(text)
      ? 1
      : 0;
  const filler =
    (text.match(/그저|단지|그냥|뭔가|어쩐지/g) ?? []).length >= 12
      ? "elevated"
      : "low";
  return {
    visible_chars: v,
    ...speech,
    dialogue_char_share: Number(dialShare.toFixed(4)),
    narration_char_share: Number((1 - dialShare).toFixed(4)),
    repetition,
    canon_padding: canonPad,
    semantic_filler: filler,
    agency_severe: agencySevere,
    dialogue_heavy: dialShare >= 0.45 || speech.speech_blocks >= 10,
  };
}

/** Evaluator-side only — never injected into prompts. */
function sceneAffordanceAudit(kind: string) {
  // LOW / MEDIUM / HIGH for continuation carriers
  const table: Record<
    string,
    Record<string, "LOW" | "MEDIUM" | "HIGH">
  > = {
    historical_REL: {
      character_specific_unresolved_state: "HIGH",
      relationship_novelty: "HIGH",
      physical_interaction: "MEDIUM",
      spatial_movement: "MEDIUM",
      world_mechanics: "MEDIUM",
      immediate_causal_consequence: "LOW",
      decision_action_opportunities: "MEDIUM",
      environmental_response: "MEDIUM",
      information_discovery: "HIGH",
    },
    historical_ACT: {
      character_specific_unresolved_state: "MEDIUM",
      relationship_novelty: "MEDIUM",
      physical_interaction: "HIGH",
      spatial_movement: "HIGH",
      world_mechanics: "HIGH",
      immediate_causal_consequence: "HIGH",
      decision_action_opportunities: "HIGH",
      environmental_response: "HIGH",
      information_discovery: "MEDIUM",
    },
    B: {
      character_specific_unresolved_state: "MEDIUM",
      relationship_novelty: "MEDIUM",
      physical_interaction: "LOW",
      spatial_movement: "LOW",
      world_mechanics: "LOW",
      immediate_causal_consequence: "LOW",
      decision_action_opportunities: "LOW",
      environmental_response: "LOW",
      information_discovery: "MEDIUM",
    },
    D: {
      character_specific_unresolved_state: "MEDIUM",
      relationship_novelty: "LOW",
      physical_interaction: "HIGH",
      spatial_movement: "HIGH",
      world_mechanics: "HIGH",
      immediate_causal_consequence: "HIGH",
      decision_action_opportunities: "HIGH",
      environmental_response: "HIGH",
      information_discovery: "MEDIUM",
    },
    F: {
      character_specific_unresolved_state: "MEDIUM",
      relationship_novelty: "HIGH",
      physical_interaction: "MEDIUM",
      spatial_movement: "LOW",
      world_mechanics: "LOW",
      immediate_causal_consequence: "LOW",
      decision_action_opportunities: "LOW",
      environmental_response: "LOW",
      information_discovery: "LOW",
    },
  };
  return table[kind] ?? {};
}

function lengthStats(chars: number[]) {
  return {
    mean: mean(chars),
    median: median(chars),
    lt_2000: chars.filter((c) => c < 2000).length,
    gte_3000: chars.filter((c) => c >= 3000).length,
    gte_4000: chars.filter((c) => c >= 4000).length,
    max: Math.max(...chars, 0),
    chars,
  };
}

type C5Class =
  | "HISTORICAL_SEQUENCE_REPRODUCES_LONG_GEMINI"
  | "HISTORICAL_SEQUENCE_AFFORDANCE_EFFECT_CONFIRMED"
  | "HISTORICAL_CURRENT_CONTEXT_DELTA_CONFIRMED"
  | "ROUTE_FIXTURE_INTERACTION"
  | "SCENE_AFFORDANCE_DOMAIN_EFFECT"
  | "MIXED_INCONCLUSIVE";

function classifyC5(orChars: number[], ciChars: number[]): {
  classification: C5Class;
  next: string;
} {
  const or = lengthStats(orChars);
  const ci = lengthStats(ciChars);
  const bothLong =
    or.mean >= 3500 &&
    ci.mean >= 3500 &&
    or.gte_3000 >= 3 &&
    ci.gte_3000 >= 3;
  const reproduces =
    (or.mean >= 4000 || ci.mean >= 4000) &&
    (or.mean >= 3500 || ci.mean >= 3500);
  const bothShort = or.mean < 2500 && ci.mean < 2500;
  const routeSplit =
    (or.mean >= 3500 && ci.mean < 2500) ||
    (ci.mean >= 3500 && or.mean < 2500);
  // Domain split on cell order REL_T1, REL_T2, ACT_T1, ACT_T2
  const relOr = mean(orChars.slice(0, 2));
  const actOr = mean(orChars.slice(2, 4));
  const relCi = mean(ciChars.slice(0, 2));
  const actCi = mean(ciChars.slice(2, 4));
  const domainSplit =
    Math.max(relOr, relCi) < 2500 && Math.min(actOr, actCi) >= 3500;

  if (reproduces && bothLong) {
    return {
      classification: "HISTORICAL_SEQUENCE_REPRODUCES_LONG_GEMINI",
      next: "G11-C5B AFFORDANCE_DECOMPOSITION",
    };
  }
  if (bothLong) {
    return {
      classification: "HISTORICAL_SEQUENCE_AFFORDANCE_EFFECT_CONFIRMED",
      next: "G11-C5B AFFORDANCE_DECOMPOSITION",
    };
  }
  if (routeSplit) {
    return {
      classification: "ROUTE_FIXTURE_INTERACTION",
      next: "EXACT_ROUTE_RUNTIME_DELTA_AUDIT",
    };
  }
  if (domainSplit) {
    return {
      classification: "SCENE_AFFORDANCE_DOMAIN_EFFECT",
      next: "QUIET_SCENE_POSITIVE_EXPANSION_RESEARCH",
    };
  }
  if (bothShort) {
    return {
      classification: "HISTORICAL_CURRENT_CONTEXT_DELTA_CONFIRMED",
      next: "G11-C6 CONTEXT_COMPOSITION_DELTA_AUDIT",
    };
  }
  if (reproduces) {
    return {
      classification: "HISTORICAL_SEQUENCE_REPRODUCES_LONG_GEMINI",
      next: "G11-C5B AFFORDANCE_DECOMPOSITION",
    };
  }
  return {
    classification: "MIXED_INCONCLUSIVE",
    next: "G11-C5B AFFORDANCE_DECOMPOSITION",
  };
}

async function runPreaudit() {
  mkdirSync(OUT_ROOT, { recursive: true });
  mkdirSync(DOCS, { recursive: true });
  const file = loadCellFile();
  const frozenDir = join(OUT_ROOT, "frozen");
  const docsFrozen = join(DOCS, "frozen");
  const results: Array<Record<string, unknown>> = [];

  for (const cell of file.cells) {
    console.log(`freeze Arm A cell=${cell.id}`);
    const a = assembleFrozenArmA(cell, file.characterFixture);
    // Arm A: SCENE PACING / D3 terminal must be zero (production SCENE FLOW may remain).
    if (a.owners.scene_pacing !== 0) {
      throw new Error(
        `SCENE_PACING_NOT_ZERO cell=${cell.id} owners=${JSON.stringify(a.owners)}`
      );
    }
    if (a.terminalOwners.terminal_dialogue_budget_owner !== 0) {
      throw new Error(
        `D3_TERMINAL_NOT_ZERO cell=${cell.id} terminal=${JSON.stringify(a.terminalOwners)}`
      );
    }
    save(frozenDir, `${cell.id}_messages.json`, a.frozen_messages);
    save(frozenDir, `${cell.id}_hashes.json`, {
      hashes: a.hashes,
      historical: a.historical,
      schema_differences: a.schema_differences,
      owners: a.owners,
      terminalOwners: a.terminalOwners,
      length_owner_terminal: a.length_owner_terminal,
    });
    save(docsFrozen, `${cell.id}_hashes.json`, {
      hashes: {
        system_sha256: a.hashes.system_sha256,
        history_sha256: a.hashes.history_sha256,
        last_user_sha256: a.hashes.last_user_sha256,
        full_messages_sha256: a.hashes.full_messages_sha256,
        system_chars: a.hashes.system_chars,
        history_chars: a.hashes.history_chars,
        last_user_chars: a.hashes.last_user_chars,
        per_message: a.hashes.per_message.map((m) => ({
          role: m.role,
          content_sha256: m.content_sha256,
          chars: m.chars,
        })),
      },
      historical: a.historical,
      schema_differences: a.schema_differences,
      owners: a.owners,
      terminalOwners: a.terminalOwners,
      length_owner_terminal: a.length_owner_terminal,
    });
    results.push({
      cell: cell.id,
      domain: cell.domain,
      hashes: {
        system_sha256: a.hashes.system_sha256,
        history_sha256: a.hashes.history_sha256,
        last_user_sha256: a.hashes.last_user_sha256,
        full_messages_sha256: a.hashes.full_messages_sha256,
      },
      size: {
        system_chars: a.hashes.system_chars,
        history_chars: a.hashes.history_chars,
        last_user_chars: a.hashes.last_user_chars,
      },
      historical_input_tokens: cell.historical_input_tokens,
      owners: a.owners,
      terminalOwners: a.terminalOwners,
      length_owner_terminal: a.length_owner_terminal,
    });
  }

  const ciKey = Boolean(process.env.CHEAPER_INFERENCE_API_KEY?.trim());
  const orKey = Boolean(process.env.OPENROUTER_API_KEY?.trim());
  const pre = {
    phase: "G11-C5-PREAUDIT",
    tested_object: "HISTORICAL_SEQUENCE_BUNDLE",
    FULL_HISTORICAL_PAYLOAD_PARITY: "UNKNOWN",
    sole_variable: "ROUTE_MODEL_ALIAS on frozen historical sequence",
    arm_A_controls: {
      scene_pacing: 0,
      d3_dialogue_terminal: 0,
      l1: 0,
      p1: 0,
    },
    cells: results,
    LIVE_CALL_READY: ciKey && orKey,
    ci_key_present: ciKey,
    or_key_present: orKey,
    planned_new_calls: 8,
    production_wire: "NOT_RUN",
    merge: "NOT_RUN",
    llm_calls: 0,
  };
  save(OUT_ROOT, "00_PREAUDIT.json", pre);
  save(DOCS, "00_PREAUDIT.json", pre);
  save(
    DOCS,
    "00_PREAUDIT.md",
    `# G11-C5 Preaudit

- tested object: **HISTORICAL_SEQUENCE_BUNDLE**
- FULL_HISTORICAL_PAYLOAD_PARITY: **UNKNOWN**
- LIVE_CALL_READY: **${ciKey && orKey ? "YES" : "NO"}**
- planned new calls: **8** (4 cells × OR+CI)
`
  );
  console.log(
    JSON.stringify(
      {
        LIVE_CALL_READY: pre.LIVE_CALL_READY,
        cells: results.map((r) => r.cell),
      },
      null,
      2
    )
  );
  return pre;
}

async function runLive() {
  const pre = await runPreaudit();
  if (!pre.LIVE_CALL_READY) {
    const blocked = {
      phase: "G11-C5-LIVE-BLOCKED",
      reason: !pre.ci_key_present
        ? "CHEAPER_INFERENCE_API_KEY missing"
        : "OPENROUTER_API_KEY missing",
      new_llm_calls: 0,
      production_wire: "NOT_RUN",
      merge: "NOT_RUN",
    };
    save(DOCS, "01_LIVE_BLOCKED.json", blocked);
    throw new Error("KEY_MISSING — STOP BEFORE API CALL");
  }

  const file = loadCellFile();
  const cellsOut: Array<Record<string, unknown>> = [];
  let calls = 0;

  for (const cell of file.cells) {
    const frozenPath = join(OUT_ROOT, "frozen", `${cell.id}_messages.json`);
    const hashPath = join(OUT_ROOT, "frozen", `${cell.id}_hashes.json`);
    const frozen = JSON.parse(readFileSync(frozenPath, "utf8")) as Msg[];
    const meta = JSON.parse(readFileSync(hashPath, "utf8")) as {
      hashes: ReturnType<typeof messageHashes>;
      schema_differences: Record<string, unknown>;
    };
    const liveHashes = messageHashes(frozen);
    if (liveHashes.full_messages_sha256 !== meta.hashes.full_messages_sha256) {
      throw new Error(`FROZEN_DRIFT cell=${cell.id}`);
    }
    // Reassemble only to verify freeze stability + settingSources — CI/OR use frozen.
    const assembled = assembleFrozenArmA(cell, file.characterFixture);
    if (
      assembled.hashes.full_messages_sha256 !== meta.hashes.full_messages_sha256
    ) {
      throw new Error(`REASSEMBLE_DRIFT cell=${cell.id}`);
    }

    const routes: Array<{
      arm: "O" | "C";
      route: string;
      url: string;
      headers: Record<string, string>;
      body: Record<string, unknown>;
      model: string;
    }> = [
      {
        arm: "O",
        route: "openrouter",
        url: OPENROUTER_CHAT_COMPLETIONS_URL,
        headers: buildOpenRouterHeaders(),
        body: {
          model: OPENROUTER_GEMINI_31_PRO_MODEL,
          messages: frozen,
          stream: true,
          stream_options: { include_usage: true },
          temperature: 0.95,
          reasoning: { effort: "low" },
          include_reasoning: false,
        },
        model: OPENROUTER_GEMINI_31_PRO_MODEL,
      },
      {
        arm: "C",
        route: "cheaperinference",
        url: CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
        headers: buildCheaperInferenceHeaders(),
        body: adaptCheaperInferenceChatBody({
          model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
          messages: frozen,
          stream: true,
          stream_options: { include_usage: true },
          temperature: 0.95,
          reasoning: { effort: "low" },
          include_reasoning: false,
        }),
        model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      },
    ];

    for (const r of routes) {
      if (calls >= 8) throw new Error("CALL_BUDGET_EXCEEDED");
      const cellId = `${cell.id}_${r.arm}`;
      console.log(`=== ${cellId} call ${calls + 1}/8 ===`);

      const outMsgs = normalizeMessages(
        (r.body.messages as Array<{ role: string; content: unknown }>) ?? []
      );
      const outHash = messageHashes(outMsgs).full_messages_sha256;
      if (outHash !== meta.hashes.full_messages_sha256) {
        throw new Error(`OUTGOING_HASH_MISMATCH ${cellId}`);
      }

      const resp = await streamEndpoint(r.url, r.headers, r.body);
      calls += 1;

      if (resp.transport_failure) {
        const failCell = {
          cell_id: cellId,
          cell: cell.id,
          domain: cell.domain,
          arm: r.arm,
          route: r.route,
          transport_failure: true,
          error: resp.error,
          http_status: resp.http_status,
          retry: 0,
          continuation: 0,
          recovery: 0,
          supplement: 0,
          repair: 0,
          messages_sha256: outHash,
        };
        cellsOut.push(failCell);
        save(join(OUT_ROOT, "meta"), `${cellId}.json`, failCell);
        save(join(DOCS, "meta"), `${cellId}.json`, failCell);
        throw new Error(
          `TRANSPORT_FAILURE ${cellId} status=${resp.http_status} err=${resp.error}`
        );
      }
      if (resp.http_status !== 200 || resp.error || !resp.text.trim()) {
        throw new Error(
          `CALL_FAILED ${cellId} status=${resp.http_status} err=${resp.error}`
        );
      }

      const q = qualityNotes(resp.text);
      const usage = extractUsage(resp.usage);
      const vector = computeRpQualityVectorV2({
        text: resp.text,
        settingSources: assembled.settingSources,
        finishReason: resp.finish_reason,
      });
      const histTok = cell.historical_input_tokens;
      const curTok = usage.input_tokens;
      const ratio =
        curTok != null && histTok > 0 ? curTok / histTok : null;
      const contextDeltaHigh =
        ratio != null ? Math.abs(ratio - 1) >= 0.2 : null;

      const row = {
        cell_id: cellId,
        cell: cell.id,
        domain: cell.domain,
        arm: r.arm,
        route: r.route,
        requested_model: r.model,
        resolved_model: resp.model ?? r.model,
        resolved_provider: resp.provider ?? r.route,
        visible_chars: q.visible_chars,
        speech_blocks: q.speech_blocks,
        paragraphs: q.paragraphs,
        dialogue_char_share: q.dialogue_char_share,
        narration_char_share: q.narration_char_share,
        repetition: q.repetition,
        canon_padding: q.canon_padding,
        semantic_filler: q.semantic_filler,
        agency_severe: q.agency_severe,
        finish_reason: resp.finish_reason,
        latency_s: resp.latency_s,
        ttft_s: resp.ttft_s,
        usage,
        input_tokens: usage.input_tokens,
        system_chars: meta.hashes.system_chars,
        history_chars: meta.hashes.history_chars,
        last_user_chars: meta.hashes.last_user_chars,
        historical_input_tokens: histTok,
        historical_chars: cell.historical_chars,
        input_token_ratio_vs_historical: ratio,
        CONTEXT_COMPOSITION_DELTA_HIGH: contextDeltaHigh,
        messages_sha256: outHash,
        schema_differences: meta.schema_differences,
        retry: 0,
        continuation: 0,
        recovery: 0,
        supplement: 0,
        repair: 0,
        quality_vector: vector,
        transport_failure: false,
      };
      cellsOut.push(row);
      save(join(OUT_ROOT, "raw"), `${cellId}.md`, resp.text);
      save(join(DOCS, "raw"), `${cellId}.md`, resp.text);
      save(join(OUT_ROOT, "meta"), `${cellId}.json`, row);
      save(join(DOCS, "meta"), `${cellId}.json`, row);
    }
  }

  const order = ["REL_T1", "REL_T2", "ACT_T1", "ACT_T2"];
  const orChars = order.map(
    (id) =>
      Number(
        cellsOut.find((c) => c.cell === id && c.arm === "O")?.visible_chars
      ) || 0
  );
  const ciChars = order.map(
    (id) =>
      Number(
        cellsOut.find((c) => c.cell === id && c.arm === "C")?.visible_chars
      ) || 0
  );
  const histChars = order.map((id) => {
    const cell = file.cells.find((c) => c.id === id)!;
    return cell.historical_chars;
  });
  const gate = classifyC5(orChars, ciChars);
  const orStats = lengthStats(orChars);
  const ciStats = lengthStats(ciChars);

  const tokenCmp: Record<string, unknown> = {};
  for (const id of order) {
    const cell = file.cells.find((c) => c.id === id)!;
    const o = cellsOut.find((c) => c.cell === id && c.arm === "O");
    const c = cellsOut.find((c) => c.cell === id && c.arm === "C");
    tokenCmp[id] = {
      historical: cell.historical_input_tokens,
      current_OR: o?.input_tokens ?? null,
      current_CI: c?.input_tokens ?? null,
      OR_ratio: o?.input_token_ratio_vs_historical ?? null,
      CI_ratio: c?.input_token_ratio_vs_historical ?? null,
      OR_CONTEXT_COMPOSITION_DELTA_HIGH:
        o?.CONTEXT_COMPOSITION_DELTA_HIGH ?? null,
      CI_CONTEXT_COMPOSITION_DELTA_HIGH:
        c?.CONTEXT_COMPOSITION_DELTA_HIGH ?? null,
    };
  }

  const live = {
    phase: "G11-C5-LIVE",
    tested_object: "HISTORICAL_SEQUENCE_BUNDLE",
    FULL_HISTORICAL_PAYLOAD_PARITY: "UNKNOWN",
    new_llm_calls: calls,
    historical_reference_calls: 4,
    length_table: {
      CELL: order,
      HISTORICAL_CI: histChars,
      CURRENT_OR: orChars,
      CURRENT_CI: ciChars,
    },
    OR: orStats,
    CI: ciStats,
    HISTORICAL: lengthStats(histChars),
    input_token_comparison: tokenCmp,
    scene_affordance_audit: {
      historical_REL: sceneAffordanceAudit("historical_REL"),
      historical_ACT: sceneAffordanceAudit("historical_ACT"),
      B: sceneAffordanceAudit("B"),
      D: sceneAffordanceAudit("D"),
      F: sceneAffordanceAudit("F"),
    },
    cells: cellsOut,
    classification: gate.classification,
    next: gate.next,
    production_wire: "NOT_RUN",
    merge: "NOT_RUN",
    one_turn_one_primary_llm_call: true,
  };
  save(OUT_ROOT, "01_LIVE.json", live);
  save(DOCS, "01_LIVE.json", live);
  console.log(
    JSON.stringify(
      {
        classification: gate.classification,
        next: gate.next,
        OR: orStats,
        CI: ciStats,
        calls,
      },
      null,
      2
    )
  );
  return live;
}

async function main() {
  if (PHASE === "live") await runLive();
  else await runPreaudit();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

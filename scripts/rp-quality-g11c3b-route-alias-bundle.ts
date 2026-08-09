/**
 * Phase G11-C3B — ROUTE_MODEL_ALIAS_BUNDLE A/B
 *
 * Sole variable: OpenRouter google/gemini-3.1-pro-preview (stored C1 Arm A)
 *              vs CheaperInference gemini-3.1-pro-preview (6 new calls)
 *
 * Assemble Arm A messages ONCE → freeze → identical role/content to CI.
 * No new OpenRouter calls. No retry/continuation/recovery/repair.
 *
 *   PHASE=preaudit|live FIXTURES=B,D,F DRAWS=2 \
 *     node --conditions=react-server --import tsx \
 *     scripts/rp-quality-g11c3b-route-alias-bundle.ts
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
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  OPENROUTER_GEMINI_31_PRO_MODEL,
} from "../src/lib/chatModels";
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

const OUT_ROOT =
  process.env.OUT_ROOT ??
  "/opt/cursor/artifacts/rp-quality-g11c3b-route-alias";
const DOCS =
  process.env.DOCS_DIR ?? "docs/audits/rp-route-alias-g11c3b";
const FIX_PATH =
  "docs/audits/rp-integrated-server-control-g11i1/fixtures/G11_I1_FIXTURES.json";
const C1_LIVE =
  "docs/audits/rp-length-tax-g11c1/stage1/01_STAGE1_LIVE.json";
const C3A_SNAP =
  "docs/audits/rp-one-call-length-g11c3a/snapshots";
const DRAWS = Number(process.env.DRAWS ?? "2");
const PHASE =
  (process.env.PHASE as "preaudit" | "live" | undefined) ??
  (process.argv.includes("--live") ? "live" : "preaudit");
const FIXTURE_FILTER = (process.env.FIXTURES ?? "B,D,F")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

type CharBundle = {
  character: Record<string, unknown>;
  persona: Record<string, unknown>;
  user: Record<string, unknown>;
  party?: boolean;
  establishedActiveCastNames?: string[];
};

type G11Fixture = {
  id: string;
  title: string;
  domain: string;
  characterFixture: string;
  expectedBudget: 4 | 5 | 6 | null;
  party?: boolean;
  contentKind?: "character" | "simulation";
  adultModeEnabled?: boolean;
  knownSupportingCastNames?: string[];
  establishedActiveCastNames?: string[];
  userInput: string;
  historyAfterGreeting: Array<{ role: string; content: string }>;
};

type Msg = { role: string; content: string };

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
function normalizeMessages(messages: Array<{ role: string; content: unknown }>): Msg[] {
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
    (m, i) =>
      !(m.role === "system" && i === 0) &&
      !(m === lastUser)
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

function loadFixtures(): G11Fixture[] {
  const raw = JSON.parse(readFileSync(FIX_PATH, "utf8")) as {
    fixtures: G11Fixture[];
  };
  return raw.fixtures.filter((f) => FIXTURE_FILTER.includes(f.id));
}
function loadCharBundle(path: string): CharBundle {
  return JSON.parse(readFileSync(path, "utf8")) as CharBundle;
}
function loadStoredOrArmA() {
  const live = JSON.parse(readFileSync(C1_LIVE, "utf8")) as {
    cells: Array<Record<string, unknown>>;
    A_summary: Record<string, unknown>;
  };
  const cells = live.cells.filter(
    (c) =>
      c.arm === "A" && FIXTURE_FILTER.includes(String(c.fixture))
  );
  return { cells, summary: live.A_summary };
}

/** Assemble Arm A once — same recipe as C1/C3A (OR model id for prompt path). */
async function assembleFrozenArmA(fixture: G11Fixture) {
  const { loadCharacterChunksForPromptReadOnly } = await import(
    "../src/lib/characterChunks"
  );
  const { formatSelectedPersonaForPrompt } = await import(
    "../src/lib/userPersonas"
  );
  const { buildContext } = await import("../src/services/contextBuilder");
  const { assemblePrimaryRpRequest } = await import("../src/lib/openRouterAdult");
  const { resolveNarrativePov } = await import("../src/lib/narrativePov");

  const modelId = OPENROUTER_GEMINI_31_PRO_MODEL;
  const bundle = loadCharBundle(fixture.characterFixture);
  const ch = { ...bundle.character };
  const persona = { ...bundle.persona };
  const personaName = String(persona.name ?? "유저");
  const contentKind = fixture.contentKind ?? "character";
  const party = Boolean(fixture.party ?? bundle.party);
  const support = fixture.knownSupportingCastNames ?? [];
  const established =
    fixture.establishedActiveCastNames ??
    bundle.establishedActiveCastNames ??
    (party
      ? [String(ch.name), personaName, ...(support.length ? support : ["동료"])]
      : undefined);

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
    ...fixture.historyAfterGreeting.map((m) => ({
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
    currentUserMessage: fixture.userInput,
    nsfw: !!ch.nsfw || !!fixture.adultModeEnabled,
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
    currentUserMessage: fixture.userInput,
    recentMessages: shortTermHistory,
    currentTurn: Math.max(1, Math.floor(shortTermHistory.length / 2) + 1),
    progressionHistory: [],
    knownSupportingCastNames: support,
    establishedActiveCastNames: established,
    adultModeEnabled: fixture.adultModeEnabled ?? false,
    // Match C3A freeze chatId so Arm A assembly stays byte-stable vs sealed snapshots.
    chatId: `g11c3a-A-${fixture.id}`,
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
      currentUserMessage: fixture.userInput,
      recentMessages: shortTermHistory,
      knownSupportingCastNames: support,
      party,
      contentKind,
    },
  });

  const frozen = normalizeMessages(applied.messages);
  const hashes = messageHashes(frozen);

  // OR-shaped body (reference schema) — not sent in C3B live
  const orBody = {
    ...bodyBase,
    model: OPENROUTER_GEMINI_31_PRO_MODEL,
    messages: frozen,
  };

  // CI-shaped body from same messages
  const ciBeforeAdapt = {
    model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
    messages: frozen,
    stream: true,
    stream_options: { include_usage: true },
    temperature: 0.95,
    // top_p / stop / max_tokens omitted
    reasoning: { effort: "low" },
    include_reasoning: false,
  };
  const ciBody = adaptCheaperInferenceChatBody({ ...ciBeforeAdapt });

  const settingSources: SettingSource[] = [
    {
      bucket: "CHARACTER_CANON",
      text: [String(ch.system_prompt ?? ""), String(ch.example_dialog ?? "")].join(
        "\n"
      ),
    },
    { bucket: "WORLD_CANON", text: String(ch.world ?? "") },
    { bucket: "USER_PERSONA", text: String(persona.description ?? "") },
    { bucket: "CURRENT_USER_INPUT", text: fixture.userInput },
    { bucket: "MEMORY", text: "" },
  ];

  return {
    fixture: fixture.id,
    domain: fixture.domain,
    frozen_messages: frozen,
    hashes,
    or_generation: {
      model: orBody.model,
      temperature: orBody.temperature ?? null,
      top_p: orBody.top_p ?? null,
      max_tokens: orBody.max_tokens ?? null,
      stop: orBody.stop ?? null,
      reasoning: orBody.reasoning ?? null,
      include_reasoning: orBody.include_reasoning ?? null,
      reasoning_effort: orBody.reasoning_effort ?? null,
    },
    ci_generation: {
      model: ciBody.model,
      temperature: ciBody.temperature ?? null,
      top_p: ciBody.top_p ?? null,
      max_tokens: ciBody.max_tokens ?? null,
      stop: ciBody.stop ?? null,
      reasoning: ciBody.reasoning ?? null,
      include_reasoning: ciBody.include_reasoning ?? null,
      reasoning_effort: ciBody.reasoning_effort ?? null,
    },
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
        or: "https://openrouter.ai/api/v1/chat/completions",
        ci: CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
      },
    },
    owners: countPacingOwners(
      frozen.find((m) => m.role === "system")?.content ?? ""
    ),
    terminalOwners: countTerminalDialogueBudgetOwners(
      [...frozen].reverse().find((m) => m.role === "user")?.content ?? ""
    ),
    length_owner_terminal: ([...frozen]
      .reverse()
      .find((m) => m.role === "user")
      ?.content.trimEnd()
      .endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE) ?? false),
    settingSources,
    ci_request_body: ciBody,
  };
}

function compareToC3aSnapshot(
  fixtureId: string,
  hashes: ReturnType<typeof messageHashes>
) {
  const snapPath = join(C3A_SNAP, `C1_ARM_A_${fixtureId}_sanitized.json`);
  if (!existsSync(snapPath)) {
    return {
      ok: false,
      reason: `missing C3A snapshot ${snapPath}`,
    };
  }
  const snap = JSON.parse(readFileSync(snapPath, "utf8")) as {
    system_sha256: string;
    user_tail_sha256: string;
    request_sanitized: {
      messages_sanitized: Array<{
        role: string;
        content_sha256: string;
      }>;
    };
  };
  const refMsgs = snap.request_sanitized.messages_sanitized.map(
    (m) => m.content_sha256
  );
  const curMsgs = hashes.per_message.map((m) => m.content_sha256);
  const perOk =
    refMsgs.length === curMsgs.length &&
    refMsgs.every((h, i) => h === curMsgs[i]);
  const systemOk = snap.system_sha256 === hashes.system_sha256;
  const userOk = snap.user_tail_sha256 === hashes.last_user_sha256;
  return {
    ok: perOk && systemOk && userOk,
    systemOk,
    userOk,
    perOk,
    ref_system: snap.system_sha256,
    cur_system: hashes.system_sha256,
    ref_user: snap.user_tail_sha256,
    cur_user: hashes.last_user_sha256,
    ref_msgs: refMsgs,
    cur_msgs: curMsgs,
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

async function streamCheaperInference(body: Record<string, unknown>) {
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
    const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: buildCheaperInferenceHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return {
        http_status: res.status,
        error: (await res.text()).slice(0, 800),
        text: "",
        finish_reason: null as string | null,
        usage: null as Record<string, unknown> | null,
        provider: null as string | null,
        model: null as string | null,
        latency_s: (Date.now() - t0) / 1000,
        ttft_s: null as number | null,
      };
    }
    if (!res.body) {
      return {
        http_status: res.status,
        error: "empty body",
        text: "",
        finish_reason: null,
        usage: null,
        provider: null,
        model: null,
        latency_s: (Date.now() - t0) / 1000,
        ttft_s: null,
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
    };
  }
}

function extractUsage(usage: Record<string, unknown> | null) {
  if (!usage) {
    return {
      input_tokens: null,
      visible_output_tokens: null,
      reasoning_tokens: null,
      total_billed_output_tokens: null,
      cost: null,
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
  return {
    visible_chars: v,
    ...speech,
    dialogue_char_share: Number(dialShare.toFixed(4)),
    narration_char_share: Number((1 - dialShare).toFixed(4)),
    repetition,
    canon_padding: canonPad,
    agency_severe: agencySevere,
    dialogue_heavy: dialShare >= 0.45 || speech.speech_blocks >= 10,
  };
}

function classify(ciChars: number[], orMean: number, orLt2000: number) {
  const ciMean = mean(ciChars);
  const ciMed = median(ciChars);
  const ciLt2000 = ciChars.filter((c) => c < 2000).length;
  const ciGt3000 = ciChars.filter((c) => c >= 3000).length;
  const ciGt4000 = ciChars.filter((c) => c >= 4000).length;
  const ciGt5000 = ciChars.filter((c) => c >= 5000).length;
  const ciMax = Math.max(...ciChars, 0);
  const abs = ciMean - orMean;
  const pct = orMean ? (abs / orMean) * 100 : 0;

  let classification:
    | "ROUTE_ALIAS_LENGTH_EFFECT_STRONG"
    | "ROUTE_ALIAS_LENGTH_EFFECT_CONFIRMED"
    | "ROUTE_ALIAS_LENGTH_EFFECT_MIXED"
    | "ROUTE_ALIAS_LENGTH_EFFECT_NOT_SUPPORTED" =
    "ROUTE_ALIAS_LENGTH_EFFECT_NOT_SUPPORTED";

  const strongAdv =
    (ciMean >= 3000 && ciMean >= orMean * 1.25) ||
    (ciMean >= orMean + 800 && ciLt2000 < orLt2000);
  const veryStrong =
    ciMean >= 3500 && ciLt2000 <= 1 && orMean <= 2200 && orLt2000 >= 3;
  const noEffect =
    ciMean < 2500 || Math.abs(pct) < 15 || ciLt2000 >= orLt2000;
  const mixed = pct >= 15 && pct < 25;

  if (veryStrong) classification = "ROUTE_ALIAS_LENGTH_EFFECT_STRONG";
  else if (strongAdv) classification = "ROUTE_ALIAS_LENGTH_EFFECT_CONFIRMED";
  else if (noEffect && !strongAdv)
    classification = "ROUTE_ALIAS_LENGTH_EFFECT_NOT_SUPPORTED";
  else if (mixed || (pct >= 15 && ciLt2000 >= 2))
    classification = "ROUTE_ALIAS_LENGTH_EFFECT_MIXED";
  else if (pct >= 25 && ciMean >= 2500)
    classification = "ROUTE_ALIAS_LENGTH_EFFECT_CONFIRMED";
  else classification = "ROUTE_ALIAS_LENGTH_EFFECT_MIXED";

  const next =
    classification === "ROUTE_ALIAS_LENGTH_EFFECT_STRONG" ||
    classification === "ROUTE_ALIAS_LENGTH_EFFECT_CONFIRMED"
      ? "G11-C4 CI_PLUS_FROZEN_SERVER_CONTROLS"
      : classification === "ROUTE_ALIAS_LENGTH_EFFECT_NOT_SUPPORTED"
        ? "G11-C5 FIXTURE_MATCHED_HISTORICAL_REPRODUCTION"
        : "DOMAIN_DISCRIMINATING_TEST";

  return {
    ciMean,
    ciMed,
    ciLt2000,
    ciGt3000,
    ciGt4000,
    ciGt5000,
    ciMax,
    abs,
    pct: Number(pct.toFixed(1)),
    classification,
    next,
  };
}

async function runPreaudit() {
  mkdirSync(OUT_ROOT, { recursive: true });
  mkdirSync(DOCS, { recursive: true });
  const fixtures = loadFixtures();
  const frozenDir = join(OUT_ROOT, "frozen");
  const docsFrozen = join(DOCS, "frozen");
  const results: Array<Record<string, unknown>> = [];
  let allOk = true;

  for (const fix of fixtures) {
    console.log(`freeze Arm A fixture=${fix.id}`);
    const a = await assembleFrozenArmA(fix);
    const cmp = compareToC3aSnapshot(fix.id, a.hashes);
    if (!cmp.ok) allOk = false;

    save(frozenDir, `${fix.id}_messages.json`, a.frozen_messages);
    save(frozenDir, `${fix.id}_hashes.json`, {
      hashes: a.hashes,
      c3a_compare: cmp,
      or_generation: a.or_generation,
      ci_generation: a.ci_generation,
      schema_differences: a.schema_differences,
      owners: a.owners,
      terminalOwners: a.terminalOwners,
      length_owner_terminal: a.length_owner_terminal,
    });
    save(docsFrozen, `${fix.id}_hashes.json`, {
      hashes: a.hashes,
      c3a_compare: cmp,
      or_generation: a.or_generation,
      ci_generation: a.ci_generation,
      schema_differences: a.schema_differences,
      owners: a.owners,
      terminalOwners: a.terminalOwners,
      length_owner_terminal: a.length_owner_terminal,
    });
    // Sanitize CI body for docs (messages as hashes only)
    save(docsFrozen, `${fix.id}_ci_request_sanitized.json`, {
      ...a.ci_generation,
      stream: true,
      stream_options: { include_usage: true },
      messages_count: a.frozen_messages.length,
      messages_sha256: a.hashes.full_messages_sha256,
      schema_differences: a.schema_differences,
    });

    results.push({
      fixture: fix.id,
      domain: fix.domain,
      hash_gate: cmp.ok ? "PASS" : "FAIL",
      compare: cmp,
      owners: a.owners,
      terminalOwners: a.terminalOwners,
      length_owner_terminal: a.length_owner_terminal,
      or_generation: a.or_generation,
      ci_generation: a.ci_generation,
      schema_differences: a.schema_differences,
    });
  }

  const keyPresent = Boolean(process.env.CHEAPER_INFERENCE_API_KEY?.trim());
  const pre = {
    phase: "G11-C3B-PREAUDIT",
    sole_variable: "ROUTE_MODEL_ALIAS_BUNDLE",
    message_hash_parity: allOk ? "PASS" : "FAIL",
    LIVE_CALL_READY: allOk && keyPresent,
    ci_key_present: keyPresent,
    ci_key_blocker: keyPresent
      ? null
      : "CHEAPER_INFERENCE_API_KEY missing (cloud injects OPENROUTER_API_KEY only)",
    arm_A_controls: {
      scene_pacing: 0,
      d3_dialogue_terminal: 0,
      l1: 0,
      p1: 0,
    },
    fixtures: results,
    production_wire: "NOT_RUN",
    merge: "NOT_RUN",
    llm_calls: 0,
  };
  save(OUT_ROOT, "00_PREAUDIT.json", pre);
  save(DOCS, "00_PREAUDIT.json", pre);
  save(DOCS, "00_PREAUDIT.md", `# G11-C3B Preaudit

- message hash parity: **${allOk ? "PASS" : "FAIL"}**
- CI key present: **${keyPresent ? "YES" : "NO"}**
- LIVE_CALL_READY: **${allOk && keyPresent ? "YES" : "NO"}**
${keyPresent ? "" : `- blocker: \`${pre.ci_key_blocker}\``}

Frozen messages under \`frozen/\`. OR reference = stored C1 Arm A (no new OR calls).
`);

  console.log(JSON.stringify({
    ok: allOk,
    message_hash_parity: allOk ? "PASS" : "FAIL",
    LIVE_CALL_READY: allOk && keyPresent,
    ci_key_present: keyPresent,
  }, null, 2));

  if (!allOk) {
    throw new Error("MESSAGE_HASH_GATE_FAIL — STOP BEFORE API CALL");
  }
  return pre;
}

async function runLive() {
  const pre = await runPreaudit();
  if (pre.message_hash_parity !== "PASS") {
    throw new Error("hash gate failed");
  }
  if (!process.env.CHEAPER_INFERENCE_API_KEY?.trim()) {
    const blocked = {
      phase: "G11-C3B-LIVE-BLOCKED",
      reason: "CHEAPER_INFERENCE_API_KEY missing",
      message_hash_parity: "PASS",
      new_llm_calls: 0,
      production_wire: "NOT_RUN",
      merge: "NOT_RUN",
      note: "Inject CHEAPER_INFERENCE_API_KEY into cloud secrets or /tmp/ci_key, then PHASE=live.",
    };
    save(DOCS, "01_LIVE_BLOCKED.json", blocked);
    save(OUT_ROOT, "01_LIVE_BLOCKED.json", blocked);
    console.log(JSON.stringify(blocked, null, 2));
    throw new Error("CI_KEY_MISSING — STOP BEFORE API CALL");
  }

  const fixtures = loadFixtures();
  const { cells: orCells, summary: orSummary } = loadStoredOrArmA();
  const ciCells: Array<Record<string, unknown>> = [];
  let calls = 0;

  for (const fix of fixtures) {
    const frozenPath = join(OUT_ROOT, "frozen", `${fix.id}_messages.json`);
    const hashPath = join(OUT_ROOT, "frozen", `${fix.id}_hashes.json`);
    const frozen = JSON.parse(readFileSync(frozenPath, "utf8")) as Msg[];
    const meta = JSON.parse(readFileSync(hashPath, "utf8")) as {
      hashes: ReturnType<typeof messageHashes>;
      ci_generation: Record<string, unknown>;
      schema_differences: Record<string, unknown>;
    };
    // Re-verify hash before each fixture's draws
    const liveHashes = messageHashes(frozen);
    if (liveHashes.full_messages_sha256 !== meta.hashes.full_messages_sha256) {
      throw new Error(`FROZEN_DRIFT fixture=${fix.id}`);
    }
    const cmp = compareToC3aSnapshot(fix.id, liveHashes);
    if (!cmp.ok) throw new Error(`HASH_GATE_FAIL before CI fixture=${fix.id}`);

    const assembled = await assembleFrozenArmA(fix);
    // Ensure re-assembly still matches freeze
    if (
      assembled.hashes.full_messages_sha256 !== meta.hashes.full_messages_sha256
    ) {
      throw new Error(`REASSEMBLE_DRIFT fixture=${fix.id}`);
    }

    for (let draw = 1; draw <= DRAWS; draw++) {
      if (calls >= 6) throw new Error("CALL_BUDGET_EXCEEDED");
      const cellId = `Gemini_${fix.id}_CI_D${draw}`;
      console.log(`=== CI ${cellId} call ${calls + 1}/6 ===`);

      // Build CI body from frozen messages (not rebuilt prompt text)
      const ciBody = adaptCheaperInferenceChatBody({
        model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
        messages: frozen,
        stream: true,
        stream_options: { include_usage: true },
        temperature: 0.95,
        reasoning: { effort: "low" },
        include_reasoning: false,
      });

      // Confirm messages hash identical in outgoing body
      const outMsgs = normalizeMessages(
        (ciBody.messages as Array<{ role: string; content: unknown }>) ?? []
      );
      const outHash = messageHashes(outMsgs).full_messages_sha256;
      if (outHash !== meta.hashes.full_messages_sha256) {
        throw new Error(`OUTGOING_HASH_MISMATCH ${cellId}`);
      }

      const resp = await streamCheaperInference(ciBody);
      calls += 1;

      if (resp.http_status !== 200 || resp.error || !resp.text.trim()) {
        throw new Error(
          `CI_CALL_FAILED ${cellId} status=${resp.http_status} err=${resp.error}`
        );
      }

      const q = qualityNotes(resp.text);
      const usage = extractUsage(resp.usage);
      const vector = computeRpQualityVectorV2({
        text: resp.text,
        settingSources: assembled.settingSources,
        finishReason: resp.finish_reason,
      });

      const cell = {
        cell_id: cellId,
        fixture: fix.id,
        domain: fix.domain,
        arm: "CI",
        draw,
        route: "cheaperinference",
        requested_model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
        resolved_model: resp.model ?? CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
        resolved_provider: resp.provider ?? "cheaperinference",
        visible_chars: q.visible_chars,
        speech_blocks: q.speech_blocks,
        paragraphs: q.paragraphs,
        dialogue_char_share: q.dialogue_char_share,
        narration_char_share: q.narration_char_share,
        repetition: q.repetition,
        canon_padding: q.canon_padding,
        agency_severe: q.agency_severe,
        dialogue_heavy: q.dialogue_heavy,
        finish_reason: resp.finish_reason,
        latency_s: resp.latency_s,
        ttft_s: resp.ttft_s,
        usage,
        generation: assembled.ci_generation,
        schema_differences: assembled.schema_differences,
        messages_sha256: outHash,
        retry: 0,
        continuation: 0,
        recovery: 0,
        supplement: 0,
        repair: 0,
        quality_vector: vector,
      };
      ciCells.push(cell);
      save(join(OUT_ROOT, "raw"), `${cellId}.md`, resp.text);
      save(join(DOCS, "raw"), `${cellId}.md`, resp.text);
      save(join(OUT_ROOT, "meta"), `${cellId}.json`, cell);
      save(join(DOCS, "meta"), `${cellId}.json`, cell);
    }
  }

  const orChars = orCells.map((c) => Number(c.visible_chars));
  const ciChars = ciCells.map((c) => Number(c.visible_chars));
  const gate = classify(
    ciChars,
    Number(orSummary.mean ?? mean(orChars)),
    Number(orSummary.lt_2000 ?? orChars.filter((c) => c < 2000).length)
  );

  const byDomain: Record<string, unknown> = {};
  for (const id of FIXTURE_FILTER) {
    const o = orCells
      .filter((c) => c.fixture === id)
      .map((c) => Number(c.visible_chars));
    const n = ciCells
      .filter((c) => c.fixture === id)
      .map((c) => Number(c.visible_chars));
    byDomain[id] = {
      OR_chars: o,
      CI_chars: n,
      OR_mean: mean(o),
      CI_mean: mean(n),
      OR_speech: orCells
        .filter((c) => c.fixture === id)
        .map((c) => c.speech_blocks),
      CI_speech: ciCells
        .filter((c) => c.fixture === id)
        .map((c) => c.speech_blocks),
      CI_narration_share: ciCells
        .filter((c) => c.fixture === id)
        .map((c) => c.narration_char_share),
    };
  }

  const live = {
    phase: "G11-C3B-LIVE",
    sole_variable: "ROUTE_MODEL_ALIAS_BUNDLE",
    message_hash_parity: "PASS",
    new_llm_calls: calls,
    or_reused_calls: 6,
    or_summary: orSummary,
    ci_summary: {
      mean: gate.ciMean,
      median: gate.ciMed,
      lt_2000: gate.ciLt2000,
      gt_3000: gate.ciGt3000,
      gt_4000: gate.ciGt4000,
      gt_5000: gate.ciGt5000,
      max: gate.ciMax,
      chars: ciChars,
    },
    delta: { absolute: gate.abs, percent: gate.pct },
    by_domain: byDomain,
    cells_ci: ciCells,
    cells_or_ref: orCells.map((c) => ({
      cell_id: c.cell_id,
      fixture: c.fixture,
      draw: c.draw,
      visible_chars: c.visible_chars,
      speech_blocks: c.speech_blocks,
      provider: c.provider,
      finish_reason: c.finish_reason,
      narration_char_share: c.narration_char_share,
    })),
    classification: gate.classification,
    next: gate.next,
    production_wire: "NOT_RUN",
    merge: "NOT_RUN",
    one_turn_one_primary_llm_call: true,
  };
  save(OUT_ROOT, "01_LIVE.json", live);
  save(DOCS, "01_LIVE.json", live);
  console.log(JSON.stringify({
    classification: gate.classification,
    next: gate.next,
    ci_mean: gate.ciMean,
    or_mean: orSummary.mean,
    calls,
  }, null, 2));
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

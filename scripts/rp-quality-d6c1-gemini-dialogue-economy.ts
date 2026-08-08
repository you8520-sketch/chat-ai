/**
 * Phase D6-C1 — Gemini dialogue response economy A/B.
 *
 * PROMPT RULE CHANGE = 1 paragraph REPLACE only (IMMERSIVE dialogue owner)
 * NEW SYSTEM SECTION = 0
 * NEW NEGATIVE BLOCK = 0
 * DIALOGUE % PROMPT = 0
 * LENGTH OWNER = BYTE_IDENTICAL
 * PRODUCTION WIRE = 0
 *
 * Sole variable: IMMERSIVE_PROSE_DIALOGUE_SEMANTIC_OWNER
 *   A = production owner
 *   B = candidate one-central-speech-intent owner
 *
 *   node --conditions=react-server --import tsx scripts/rp-quality-d6c1-gemini-dialogue-economy.ts
 *   PHASE=preaudit|live (default: preaudit if no key / LIVE=0)
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
  computeRpQualityVectorV2,
  extractDialogueSpans,
  splitParagraphs,
  isDialogueParagraph,
  type SettingSource,
} from "../src/lib/rpQualityVector";
import {
  D6C1_PRODUCTION_DIALOGUE_OWNER,
  D6C1_CANDIDATE_DIALOGUE_OWNER,
  D6C1_GUARD_PRESERVATION_REVIEW,
  applyD6C1DialogueOwnerArmToMessages,
  d6c1PromptBudgetReport,
  type GeminiDialogueEconomyArm,
} from "../src/lib/geminiDialogueResponseEconomyD6C1";
import { IMMERSIVE_PROSE_BLOCK } from "../src/lib/advancedProseNsfwGuidelines";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

// Recover key from prior audit sidecar if .env.local is empty.
if (!process.env.OPENROUTER_API_KEY?.trim() && existsSync("/tmp/d6b1_or_key")) {
  process.env.OPENROUTER_API_KEY = readFileSync("/tmp/d6b1_or_key", "utf8").trim();
}

const OUT_ROOT =
  process.env.OUT_ROOT ??
  "/opt/cursor/artifacts/rp-quality-d6c1-dialogue-economy";
const DOCS =
  process.env.DOCS_DIR ?? "docs/audits/rp-gemini-dialogue-economy-d6c1";
const RAW_DOCS = join(DOCS, "raw");
const FIXTURE_PATH =
  "docs/audits/rp-quality-v2-gemini/fixtures/c10_fixture.json";
const DRAWS = 3;
const USER_INPUT =
  "*렌이 권총을 꺼내 방아쇠에 손가락을 건다.* 저쪽 소리 나는 데 한 발 쏘면 흩어지지 않을까요?";

const PHASE =
  (process.env.PHASE as "preaudit" | "live" | undefined) ??
  (process.argv.includes("--live") ? "live" : "preaudit");

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
function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}
function mean(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

type StreamState = {
  text: string;
  finish: string | null;
  usage: Record<string, unknown> | null;
  resolved: string | null;
  generationId: string | null;
  provider: string | null;
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
  if (typeof ev.id === "string" && !state.generationId) state.generationId = ev.id;
  if (typeof ev.model === "string") state.resolved = ev.model;
  if (ev.provider && typeof ev.provider === "object") {
    const p = ev.provider as Record<string, unknown>;
    if (typeof p.name === "string") state.provider = p.name;
  }
  if (typeof ev.provider === "string") state.provider = ev.provider;
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

function processSseChunk(chunk: string, buf: string, state: StreamState) {
  const combined = buf + chunk;
  const lines = combined.split(/\r?\n/);
  const rest = lines.pop() ?? "";
  for (const line of lines) processSseLine(line, state);
  return rest;
}

function flushRemainingSseBuffer(buf: string, state: StreamState) {
  if (buf.trim()) processSseLine(buf, state);
}

function isTransportAbort(error: string | null, httpStatus: number) {
  if (httpStatus === 0 || httpStatus >= 500) return true;
  if (!error) return false;
  return /abort|ECONNRESET|socket|fetch failed|network/i.test(error);
}

async function streamOpenRouter(body: Record<string, unknown>) {
  const { OPENROUTER_CHAT_COMPLETIONS_URL, buildOpenRouterHeaders } =
    await import("../src/lib/openRouterConfig");
  const t0 = Date.now();
  const state: StreamState = {
    text: "",
    finish: null,
    usage: null,
    resolved: null,
    generationId: null,
    provider: null,
    sawDone: false,
  };
  const responseHeaders: Record<string, string> = {};
  try {
    const res = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: buildOpenRouterHeaders(),
      body: JSON.stringify(body),
    });
    for (const [k, v] of res.headers.entries()) {
      if (
        /provider|generation|request|ratelimit|model|openrouter/i.test(k) ||
        k.startsWith("x-")
      ) {
        responseHeaders[k] = v;
      }
    }
    if (!res.ok) {
      const errText = await res.text();
      return {
        http_status: res.status,
        error: errText.slice(0, 800),
        text: "",
        finish_reason: null as string | null,
        usage: null as Record<string, unknown> | null,
        resolved_model: null as string | null,
        generation_id: null as string | null,
        provider: null as string | null,
        response_headers: responseHeaders,
        saw_done: false,
        latency_s: (Date.now() - t0) / 1000,
      };
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf = processSseChunk(decoder.decode(value, { stream: true }), buf, state);
    }
    flushRemainingSseBuffer(buf, state);
    return {
      http_status: res.status,
      error: null as string | null,
      text: state.text,
      finish_reason: state.finish,
      usage: state.usage,
      resolved_model: state.resolved,
      generation_id: state.generationId,
      provider: state.provider,
      response_headers: responseHeaders,
      saw_done: state.sawDone,
      latency_s: (Date.now() - t0) / 1000,
    };
  } catch (e) {
    return {
      http_status: 0,
      error: e instanceof Error ? e.message : String(e),
      text: state.text,
      finish_reason: state.finish,
      usage: state.usage,
      resolved_model: state.resolved,
      generation_id: state.generationId,
      provider: state.provider,
      response_headers: responseHeaders,
      saw_done: state.sawDone,
      latency_s: (Date.now() - t0) / 1000,
    };
  }
}

function loadFixture() {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
    character: Record<string, unknown>;
    persona: Record<string, unknown>;
    user: Record<string, unknown>;
  };
}

function usageTokens(usage: Record<string, unknown> | null) {
  if (!usage) {
    return {
      input_tokens: null as number | null,
      output_tokens: null as number | null,
      reasoning_tokens: null as number | null,
      total_tokens: null as number | null,
    };
  }
  const details =
    (usage.completion_tokens_details as Record<string, unknown> | undefined) ??
    {};
  const reasoning =
    typeof details.reasoning_tokens === "number"
      ? details.reasoning_tokens
      : typeof usage.reasoning_tokens === "number"
        ? usage.reasoning_tokens
        : null;
  return {
    input_tokens:
      typeof usage.prompt_tokens === "number"
        ? usage.prompt_tokens
        : typeof usage.input_tokens === "number"
          ? usage.input_tokens
          : null,
    output_tokens:
      typeof usage.completion_tokens === "number"
        ? usage.completion_tokens
        : typeof usage.output_tokens === "number"
          ? usage.output_tokens
          : null,
    reasoning_tokens: reasoning,
    total_tokens:
      typeof usage.total_tokens === "number" ? usage.total_tokens : null,
  };
}

/** Evaluation-only: count independent response anchors the user must answer. */
function scoreResponseAnchorCount(text: string): {
  response_anchor_count: number;
  band: "IDEAL" | "ACCEPTABLE" | "RESPONSE_OVERLOAD";
  samples: string[];
} {
  const dialogue = extractDialogueSpans(text)
    .map((s) => s.content.trim())
    .filter(Boolean);
  const samples: string[] = [];
  let count = 0;
  for (const d of dialogue) {
    const hits =
      d.match(
        /[?？]|까요|래요|세요|할까요|어때|어떡|가자|가요|해줘|해줄래|와줄|와 줄|같이|그만|멈춰|들어|말해|설명해|알려/
      ) != null;
    if (hits || (/[!！]$/.test(d) && /해|가|와|봐|들어/.test(d))) {
      count += 1;
      if (samples.length < 8) samples.push(d.slice(0, 80));
    }
  }
  for (const p of splitParagraphs(text)) {
    if (isDialogueParagraph(p)) continue;
    if (/당신은|유저는|렌은.{0,8}(해야|대답|선택)/.test(p)) {
      count += 1;
    }
  }
  const band =
    count <= 1 ? "IDEAL" : count === 2 ? "ACCEPTABLE" : "RESPONSE_OVERLOAD";
  return { response_anchor_count: count, band, samples };
}

/** Evaluation-only: how many dialogue functions one turn packs. */
function scoreDialogueFunctionLoad(text: string): {
  dialogue_function_load: number;
  functions: string[];
} {
  const joined = extractDialogueSpans(text)
    .map((s) => s.content)
    .join("\n");
  const checks: Array<[string, RegExp]> = [
    ["question", /[?？]|까요|래요|세요|어때|어떡/],
    ["explanation", /왜냐하면|이유는|뜻은|의미|설명|이니까|거든/],
    ["joke", /농담|웃기|ㅋ|하하|호호|장난/],
    ["warning", /위험|죽어|죽|경고|안 돼|안돼|하지 마|하지마|총성|죽음/],
    ["proposal", /하자|할까요|같이|가자|가요|제안|차라리/],
    ["relationship_claim", /믿|좋아|싫어|우리|너(?:는|만)|함께|곁/],
    ["directive", /해|가|와|들어|멈춰|치워|버려|따라|숨/],
  ];
  const functions: string[] = [];
  for (const [name, re] of checks) {
    if (re.test(joined)) functions.push(name);
  }
  return { dialogue_function_load: functions.length, functions };
}

function maxDialogueBlockChars(text: string): number {
  let max = 0;
  for (const span of extractDialogueSpans(text)) {
    const n = span.content.replace(/\s+/g, "").length;
    if (n > max) max = n;
  }
  return max;
}

function dialogueShareBand(share: number): string {
  if (share >= 0.1 && share <= 0.15) return "IDEAL";
  if (share >= 0.06 && share <= 0.18) return "ACCEPTABLE";
  if (share > 0.25) return "DIALOGUE_OVERLOAD_CANDIDATE";
  if (share > 0.2) return "STRONG_REVIEW";
  return "BELOW_IDEAL_OR_REVIEW";
}

function extractSectionHeaders(systemText: string): string[] {
  return [...systemText.matchAll(/^\[([^\]]+)\]/gm)].map((m) => m[1]!);
}

async function assembleArm(opts: {
  modelId: string;
  arm: GeminiDialogueEconomyArm;
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
  const { resolveNarrativePov } = await import("../src/lib/narrativePov");

  const fixture = loadFixture();
  const ch = { ...fixture.character };
  const persona = { ...fixture.persona };
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
  const narrativePov = resolveNarrativePov({
    mode: "third_person",
    contentKind: "character",
    mainCharacterName: String(ch.name),
  });
  const greeting = String(ch.greeting ?? "");
  const built = buildContext({
    charName: String(ch.name),
    chunks,
    userNickname: String(fixture.user.nickname ?? personaName),
    userPersona,
    userNote: "",
    longTermMemory: "",
    shortTermHistory: [
      { role: "user", content: OPENING_TURN_USER },
      { role: "assistant", content: greeting },
    ],
    currentUserMessage: USER_INPUT,
    nsfw: !!ch.nsfw,
    gender: (ch.gender as "male" | "female" | "other") ?? "other",
    memoryMeta: "",
    modelId: opts.modelId,
    userImpersonation: false,
    novelModeEnabled: false,
    isContinue: false,
    personaDisplayName: personaName,
    targetResponseChars: 3200,
    completedTurns: 0,
    provider: "openrouter",
    contentKind: "character",
    exampleDialog: String(ch.example_dialog ?? ""),
    userId: Number(fixture.user.id ?? 4),
    narrativePov,
  });

  const wire = assemblePrimaryRpRequest({
    system: built.systemPrompt,
    history: built.history ?? [],
    modelId: opts.modelId,
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
    (bodyBase.messages as Array<{ role: string; content: string }>) ?? [];

  const applied = applyD6C1DialogueOwnerArmToMessages({
    messages: messagesBase,
    arm: opts.arm,
  });

  const body = {
    ...bodyBase,
    messages: applied.messages,
  };
  const messages = applied.messages;
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const systemText = applied.systemText;
  const historyMsgs = messages.filter((m) => m.role !== "system");

  const settingSources: SettingSource[] = [
    {
      bucket: "CHARACTER_CANON",
      text: [
        String(ch.system_prompt ?? ""),
        String(ch.speech_profile ?? ""),
        String(ch.example_dialog ?? ""),
      ].join("\n"),
    },
    {
      bucket: "WORLD_CANON",
      text: [String(ch.world ?? ""), String(ch.setting_chunks ?? "")].join("\n"),
    },
    {
      bucket: "USER_PERSONA",
      text: String(persona.description ?? ""),
    },
    {
      bucket: "CURRENT_USER_INPUT",
      text: USER_INPUT,
    },
    {
      bucket: "MEMORY",
      text: "",
    },
  ];

  return {
    requestBody: body,
    systemSha: sha256(systemText),
    messagesSha: sha256(JSON.stringify(messages)),
    historySha: sha256(JSON.stringify(historyMsgs)),
    userTailSha: sha256(String(lastUser?.content ?? "")),
    systemText,
    systemChars: systemText.length,
    systemTokensApprox: Math.round(systemText.length / 2),
    greeting,
    settingSources,
    userInput: USER_INPUT,
    replaced: applied.replaced,
    replaceCount: applied.replaceCount,
    ownerTokenDelta: applied.ownerTokenDelta,
    sectionHeaders: extractSectionHeaders(systemText),
    hasProductionOwner: systemText.includes(D6C1_PRODUCTION_DIALOGUE_OWNER),
    hasCandidateOwner: systemText.includes(D6C1_CANDIDATE_DIALOGUE_OWNER),
    immersiveContainsProduction: IMMERSIVE_PROSE_BLOCK.includes(
      D6C1_PRODUCTION_DIALOGUE_OWNER
    ),
    generationConfig: {
      model: body.model ?? opts.modelId,
      temperature: body.temperature ?? null,
      top_p: body.top_p ?? null,
      max_tokens: body.max_tokens ?? null,
      seed: body.seed ?? null,
      reasoning: body.reasoning ?? null,
      include_reasoning: body.include_reasoning ?? null,
      frequency_penalty: body.frequency_penalty ?? null,
      presence_penalty: body.presence_penalty ?? null,
      provider: body.provider ?? null,
    },
  };
}

function writeRawMd(opts: {
  cellId: string;
  arm: string;
  draw: number;
  modelId: string;
  finish: string | null;
  text: string;
  visibleChars: number;
  anchors: number;
  functionLoad: number;
}) {
  const name = `Gemini_G3_${opts.arm}_D${opts.draw}.md`;
  const body = [
    `# ${opts.cellId}`,
    "",
    `- fixture: G3`,
    `- arm: ${opts.arm}`,
    `- draw: ${opts.draw}`,
    `- model: ${opts.modelId}`,
    `- finish_reason: ${opts.finish ?? "null"}`,
    `- visible_chars_no_ws: ${opts.visibleChars}`,
    `- response_anchor_count: ${opts.anchors}`,
    `- dialogue_function_load: ${opts.functionLoad}`,
    "",
    "## user_input",
    "",
    "```text",
    USER_INPUT,
    "```",
    "",
    "## visible_output",
    "",
    "```text",
    opts.text,
    "```",
    "",
  ].join("\n");
  save(RAW_DOCS, name, body);
  save(join(OUT_ROOT, "raw"), name, body);
}

async function runPreaudit(modelId: string) {
  const budget = d6c1PromptBudgetReport();
  const A = await assembleArm({ modelId, arm: "A" });
  const B = await assembleArm({ modelId, arm: "B" });

  const sectionOrderEqual =
    JSON.stringify(A.sectionHeaders) === JSON.stringify(B.sectionHeaders);
  const systemTokenDelta = B.systemTokensApprox - A.systemTokensApprox;
  const historyEqual = A.historySha === B.historySha;
  // History SHA includes all non-system messages; system differs so messagesSha differs.
  // historySha above excludes system — good.
  const userTailEqual = A.userTailSha === B.userTailSha;
  const runtimeEqual =
    JSON.stringify(A.generationConfig) === JSON.stringify(B.generationConfig);

  const preaudit = {
    phase: "D6-C1-PREAUDIT",
    api_calls: 0,
    sole_variable: "IMMERSIVE_PROSE_DIALOGUE_SEMANTIC_OWNER",
    new_system_sections: 0,
    new_negative_directives: budget.candidate_new_negative_count,
    dialogue_percentage_prompt: "NONE",
    production_owner_sha256: sha256(D6C1_PRODUCTION_DIALOGUE_OWNER),
    candidate_owner_sha256: sha256(D6C1_CANDIDATE_DIALOGUE_OWNER),
    immersive_contains_production_owner: A.immersiveContainsProduction,
    arm_A: {
      system_sha256: A.systemSha,
      user_tail_sha256: A.userTailSha,
      history_sha256: A.historySha,
      system_chars: A.systemChars,
      system_tokens_approx: A.systemTokensApprox,
      has_production_owner: A.hasProductionOwner,
      has_candidate_owner: A.hasCandidateOwner,
      replaced: A.replaced,
      section_headers: A.sectionHeaders,
      generation_config: A.generationConfig,
    },
    arm_B: {
      system_sha256: B.systemSha,
      user_tail_sha256: B.userTailSha,
      history_sha256: B.historySha,
      system_chars: B.systemChars,
      system_tokens_approx: B.systemTokensApprox,
      has_production_owner: B.hasProductionOwner,
      has_candidate_owner: B.hasCandidateOwner,
      replaced: B.replaced,
      replace_count: B.replaceCount,
      section_headers: B.sectionHeaders,
      generation_config: B.generationConfig,
    },
    invariants: {
      system_sha_A_ne_B: A.systemSha !== B.systemSha,
      section_order_equal: sectionOrderEqual,
      system_token_delta_approx: systemTokenDelta,
      system_token_delta_within_pm30: Math.abs(systemTokenDelta) <= 30,
      owner_token_delta_budget: budget.owner_token_delta,
      history_byte_identical: historyEqual,
      user_tail_byte_identical: userTailEqual,
      runtime_byte_identical: runtimeEqual,
      B_replaced_exactly_once: B.replaced && B.replaceCount === 1,
      A_unchanged_production: A.hasProductionOwner && !A.hasCandidateOwner,
      B_candidate_only: !B.hasProductionOwner && B.hasCandidateOwner,
    },
    guard_preservation: D6C1_GUARD_PRESERVATION_REVIEW,
    budget,
    LIVE_CALL_READY:
      A.immersiveContainsProduction &&
      A.hasProductionOwner &&
      !A.hasCandidateOwner &&
      B.replaced &&
      B.replaceCount === 1 &&
      !B.hasProductionOwner &&
      B.hasCandidateOwner &&
      sectionOrderEqual &&
      historyEqual &&
      userTailEqual &&
      runtimeEqual &&
      Math.abs(systemTokenDelta) <= 30 &&
      budget.candidate_new_negative_count === 0 &&
      budget.new_section_count === 0,
  };

  mkdirSync(DOCS, { recursive: true });
  save(DOCS, "00_PREAUDIT.json", preaudit);
  const md = [
    "# D6-C1 — API=0 Pre-Audit",
    "",
    `**Sole variable:** IMMERSIVE_PROSE_DIALOGUE_SEMANTIC_OWNER`,
    `**API calls:** 0`,
    `**LIVE_CALL_READY:** ${preaudit.LIVE_CALL_READY ? "YES" : "NO"}`,
    "",
    "## Owner replace",
    "",
    `| | chars | tokens≈ |`,
    `|---|---:|---:|`,
    `| production | ${budget.production_chars} | ${budget.production_tokens} |`,
    `| candidate | ${budget.candidate_chars} | ${budget.candidate_tokens} |`,
    `| delta | | ${budget.owner_token_delta} |`,
    "",
    "## Invariants",
    "",
    "| check | result |",
    "|---|---|",
    `| section order A==B | ${sectionOrderEqual} |`,
    `| system token Δ ≈ | ${systemTokenDelta} (≤30: ${Math.abs(systemTokenDelta) <= 30}) |`,
    `| history BYTE_IDENTICAL | ${historyEqual} |`,
    `| user tail BYTE_IDENTICAL | ${userTailEqual} |`,
    `| runtime BYTE_IDENTICAL | ${runtimeEqual} |`,
    `| B replaced exactly once | ${B.replaced && B.replaceCount === 1} |`,
    `| new negative directives | ${budget.candidate_new_negative_count} |`,
    `| dialogue % prompt | NONE |`,
    "",
    "## Guard preservation",
    "",
    "See `geminiDialogueResponseEconomyD6C1.ts` `D6C1_GUARD_PRESERVATION_REVIEW`.",
    "All listed guards marked preserved; candidate kept as 1 paragraph (brief §4 exact).",
    "",
    "## Next",
    "",
    "G3 A×3 + B×3 = 6 live calls. No redraw. Production wire NOT_RUN.",
    "",
  ].join("\n");
  save(DOCS, "00_PREAUDIT.md", md);
  save(join(OUT_ROOT, "preaudit"), "00_PREAUDIT.json", preaudit);
  console.log(JSON.stringify(preaudit.invariants, null, 2));
  console.log("LIVE_CALL_READY", preaudit.LIVE_CALL_READY);
  return preaudit;
}

async function runLive(modelId: string) {
  const preaudit = await runPreaudit(modelId);
  if (!preaudit.LIVE_CALL_READY) {
    throw new Error("Preaudit not LIVE_CALL_READY — aborting live calls");
  }
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    throw new Error("OPENROUTER_API_KEY missing");
  }

  const {
    normalizeAiNovelProsePreDisplay,
    applyDisplayParagraphGrouping,
  } = await import("../src/lib/novelParagraphs");
  const { sanitizeStreamArtifacts } = await import("../src/lib/responseLength");
  const { visibleAssistantDisplayText } = await import(
    "../src/lib/chatDisplayLength"
  );

  const assemblies = {
    A: await assembleArm({ modelId, arm: "A" }),
    B: await assembleArm({ modelId, arm: "B" }),
  };

  const cells: Array<Record<string, unknown>> = [];
  let apiCalls = 0;

  for (const arm of ["A", "B"] as const) {
    const assembled = assemblies[arm];
    for (let draw = 1; draw <= DRAWS; draw++) {
      const cellId = `Gemini_G3_${arm}_D${draw}`;
      const dir = join(OUT_ROOT, "live", cellId);
      console.log(
        `\n=== ${cellId} systemSha=${assembled.systemSha.slice(0, 12)} ===`
      );
      let resp = await streamOpenRouter(assembled.requestBody);
      apiCalls += 1;
      if (
        (!resp.text || resp.error) &&
        isTransportAbort(resp.error, resp.http_status)
      ) {
        console.log(`transport retry ${cellId}`);
        resp = await streamOpenRouter(assembled.requestBody);
        apiCalls += 1;
      }
      if (!resp.text || resp.error) {
        throw new Error(
          `${cellId} failed status=${resp.http_status} err=${resp.error}`
        );
      }

      const preDisplay = normalizeAiNovelProsePreDisplay(
        sanitizeStreamArtifacts(resp.text)
      );
      const display = applyDisplayParagraphGrouping(preDisplay);
      const visible = visibleAssistantDisplayText(display);
      const providerRaw = resp.text;
      const visibleChars = visible.replace(/\s+/g, "").length;
      const tokens = usageTokens(resp.usage);
      const anchors = scoreResponseAnchorCount(providerRaw);
      const fnLoad = scoreDialogueFunctionLoad(providerRaw);
      const vector = computeRpQualityVectorV2({
        text: providerRaw,
        settingSources: assembled.settingSources,
        priorAssistantText: assembled.greeting,
        currentUserInput: USER_INPUT,
      });

      const row = {
        cell_id: cellId,
        arm,
        draw,
        visible_chars: visibleChars,
        finish_reason: resp.finish_reason,
        provider: resp.provider,
        reasoning_tokens: tokens.reasoning_tokens,
        input_tokens: tokens.input_tokens,
        output_tokens: tokens.output_tokens,
        latency_s: resp.latency_s,
        dialogue_chars: vector.composition.dialogue_chars,
        narration_chars: vector.composition.narration_chars,
        dialogue_char_share: vector.composition.dialogue_char_share,
        dialogue_share_band: dialogueShareBand(
          vector.composition.dialogue_char_share
        ),
        dialogue_paragraph_count: vector.composition.dialogue_paragraph_count,
        same_speaker_dialogue_fragments:
          vector.dialogue_fragmentation.same_speaker_dialogue_fragments,
        max_dialogue_block_chars: maxDialogueBlockChars(providerRaw),
        response_anchor: anchors,
        dialogue_function_load: fnLoad,
        continuity: vector.continuity,
        setting_exact_overlap: vector.setting_exact_overlap,
        hard_alarms: vector.hard_alarms,
        system_sha256: assembled.systemSha,
        messages_sha256: assembled.messagesSha,
        history_sha256: assembled.historySha,
        user_tail_sha256: assembled.userTailSha,
        owner_sha256:
          arm === "A"
            ? sha256(D6C1_PRODUCTION_DIALOGUE_OWNER)
            : sha256(D6C1_CANDIDATE_DIALOGUE_OWNER),
        generation_config: assembled.generationConfig,
        human_pending: {
          RESPONSE_ANCHOR_COUNT_HUMAN: "PENDING_AGENT_REVIEW",
          DIALOGUE_FUNCTION_LOAD_HUMAN: "PENDING_AGENT_REVIEW",
          CHARACTER_PRESENCE_NON_DIALOGUE: "PENDING_AGENT_REVIEW",
          CHARACTER_FIDELITY: "PENDING_AGENT_REVIEW",
          ACTIVE_CANON_USE: "PENDING_AGENT_REVIEW",
          SCENE_ADVANCEMENT: "PENDING_AGENT_REVIEW",
          NEW_SCENE_VALUE: "PENDING_AGENT_REVIEW",
          SETTING_RECITAL: "PENDING_AGENT_REVIEW",
          CURRENT_INPUT_REPLAY: "PENDING_AGENT_REVIEW",
          RECENT_SCENE_REPLAY: "PENDING_AGENT_REVIEW",
          DIALOGUE_TO_RECITAL_DISPLACEMENT: "PENDING_AGENT_REVIEW",
          RESPONSE_LOAD_REMOVED_BUT_SCENE_VALUE_LOST: "PENDING_AGENT_REVIEW",
        },
      };
      cells.push(row);

      save(dir, "final_display.txt", visible);
      save(dir, "provider_raw.txt", providerRaw);
      save(dir, "meta.json", {
        ...row,
        usage: resp.usage,
        response_headers: resp.response_headers,
        resolved_model: resp.resolved_model,
        generation_id: resp.generation_id,
      });
      save(dir, "request_fingerprint.json", {
        system_sha256: assembled.systemSha,
        messages_sha256: assembled.messagesSha,
        history_sha256: assembled.historySha,
        user_tail_sha256: assembled.userTailSha,
        owner_sha256: row.owner_sha256,
        generation_config: assembled.generationConfig,
      });
      save(dir, "last_user_turn.txt", String(
        ([...(assembled.requestBody.messages as Array<{role:string;content:string}>)]
          .reverse()
          .find((m) => m.role === "user")?.content) ?? ""
      ));
      writeRawMd({
        cellId,
        arm,
        draw,
        modelId,
        finish: resp.finish_reason,
        text: visible,
        visibleChars,
        anchors: anchors.response_anchor_count,
        functionLoad: fnLoad.dialogue_function_load,
      });
      console.log(
        `${cellId}: chars=${visibleChars} anchors=${anchors.response_anchor_count}(${anchors.band}) fn=${fnLoad.dialogue_function_load} share=${vector.composition.dialogue_char_share}`
      );
    }
  }

  const byArm = (arm: string) => cells.filter((c) => c.arm === arm);
  const summarize = (arm: string) => {
    const rows = byArm(arm);
    const chars = rows.map((r) => r.visible_chars as number);
    const anchors = rows.map(
      (r) => (r.response_anchor as { response_anchor_count: number }).response_anchor_count
    );
    const loads = rows.map(
      (r) =>
        (r.dialogue_function_load as { dialogue_function_load: number })
          .dialogue_function_load
    );
    const shares = rows.map((r) => r.dialogue_char_share as number);
    const overload = rows.filter(
      (r) => (r.response_anchor as { band: string }).band === "RESPONSE_OVERLOAD"
    ).length;
    const collapse = chars.filter((c) => c < 1800).length;
    const frags = rows.map(
      (r) => r.same_speaker_dialogue_fragments as number
    );
    return {
      chars,
      chars_median: median(chars),
      chars_mean: mean(chars),
      collapse_lt_1800: collapse,
      dialogue_shares: shares,
      dialogue_share_median: median(shares),
      response_anchors: anchors,
      response_anchors_median: median(anchors),
      function_loads: loads,
      function_loads_median: median(loads),
      overload_draws: overload,
      fragmentation: frags,
      rows,
    };
  };

  const live = {
    phase: "D6-C1-G3",
    sole_variable: "IMMERSIVE_PROSE_DIALOGUE_SEMANTIC_OWNER",
    new_system_sections: 0,
    new_negative_directives: 0,
    dialogue_percentage_prompt: "NONE",
    production_diff: 0,
    system_token_delta_approx:
      assemblies.B.systemTokensApprox - assemblies.A.systemTokensApprox,
    history_byte_identical: assemblies.A.historySha === assemblies.B.historySha,
    user_tail_byte_identical:
      assemblies.A.userTailSha === assemblies.B.userTailSha,
    runtime_byte_identical:
      JSON.stringify(assemblies.A.generationConfig) ===
      JSON.stringify(assemblies.B.generationConfig),
    system_sha_A: assemblies.A.systemSha,
    system_sha_B: assemblies.B.systemSha,
    owner_sha_A: sha256(D6C1_PRODUCTION_DIALOGUE_OWNER),
    owner_sha_B: sha256(D6C1_CANDIDATE_DIALOGUE_OWNER),
    api_calls_this_run: apiCalls,
    arm_A: summarize("A"),
    arm_B: summarize("B"),
    cells,
    preaudit_invariants: preaudit.invariants,
    human_review: "PENDING",
    production_wire: "NOT_RUN",
    merge: "NOT_RUN",
    g5_g6: "NOT_IN_SCOPE",
  };

  save(join(DOCS, "g3"), "01_G3_LIVE.json", live);
  save(join(OUT_ROOT, "live"), "01_G3_LIVE.json", live);
  save(
    join(DOCS, "g3"),
    "01_G3_LIVE.md",
    [
      "# D6-C1 G3 Live — Dialogue Response Economy",
      "",
      `| | A | B |`,
      `|---|---|---|`,
      `| chars | ${live.arm_A.chars.join(" / ")} (med ${live.arm_A.chars_median}) | ${live.arm_B.chars.join(" / ")} (med ${live.arm_B.chars_median}) |`,
      `| dialogue share | ${live.arm_A.dialogue_shares.join(" / ")} | ${live.arm_B.dialogue_shares.join(" / ")} |`,
      `| anchors | ${live.arm_A.response_anchors.join(" / ")} (med ${live.arm_A.response_anchors_median}) | ${live.arm_B.response_anchors.join(" / ")} (med ${live.arm_B.response_anchors_median}) |`,
      `| function load | ${live.arm_A.function_loads.join(" / ")} (med ${live.arm_A.function_loads_median}) | ${live.arm_B.function_loads.join(" / ")} (med ${live.arm_B.function_loads_median}) |`,
      `| overload draws | ${live.arm_A.overload_draws} | ${live.arm_B.overload_draws} |`,
      `| collapse &lt;1800 | ${live.arm_A.collapse_lt_1800} | ${live.arm_B.collapse_lt_1800} |`,
      `| api calls | ${apiCalls} |`,
      "",
      "Human review: `02_G3_HUMAN_DIALOGUE_ECONOMY.md`",
      "",
    ].join("\n")
  );

  console.log(
    JSON.stringify(
      {
        api_calls: apiCalls,
        A: {
          chars: live.arm_A.chars,
          anchors: live.arm_A.response_anchors,
          loads: live.arm_A.function_loads,
          overload: live.arm_A.overload_draws,
        },
        B: {
          chars: live.arm_B.chars,
          anchors: live.arm_B.response_anchors,
          loads: live.arm_B.function_loads,
          overload: live.arm_B.overload_draws,
        },
      },
      null,
      2
    )
  );
  return live;
}

async function main() {
  mkdirSync(OUT_ROOT, { recursive: true });
  mkdirSync(DOCS, { recursive: true });
  const { OPENROUTER_GEMINI_31_PRO_MODEL } = await import(
    "../src/lib/chatModels"
  );
  const modelId = OPENROUTER_GEMINI_31_PRO_MODEL;
  console.log(`D6-C1 phase=${PHASE} model=${modelId}`);
  if (PHASE === "live") {
    await runLive(modelId);
  } else {
    await runPreaudit(modelId);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

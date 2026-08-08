/**
 * Phase D7-A — Gemini selective quality repair proof.
 *
 * NEW PRIMARY CALLS = 0
 * REPAIR CALLS = 3 MAX
 * PRODUCTION WIRE = 0
 * PRIMARY PROMPT DIFF = 0
 *
 *   PHASE=preaudit|live node --conditions=react-server --import tsx \
 *     scripts/rp-quality-d7a-gemini-selective-repair.ts
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
  D7A_CASES,
  D7A_COMMON_REPAIR_CONTRACT,
  D7A_FLAG_FOCUS,
  buildD7ADraftAssistantMessage,
  d7aRepairControlToWire,
  type D7ACaseId,
  type D7ACaseSpec,
  type D7ARepairFlag,
} from "../src/lib/geminiSelectiveRepairD7A";
import {
  TURN_LENGTH_SUPPLEMENT_API_ENABLED,
  SERVER_UNDER_LENGTH_RECOVERY_ENABLED,
} from "../src/lib/turnApiBudget";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}
if (!process.env.OPENROUTER_API_KEY?.trim() && existsSync("/tmp/d6b1_or_key")) {
  process.env.OPENROUTER_API_KEY = readFileSync("/tmp/d6b1_or_key", "utf8").trim();
}

const OUT_ROOT =
  process.env.OUT_ROOT ??
  "/opt/cursor/artifacts/rp-quality-d7a-selective-repair";
const DOCS =
  process.env.DOCS_DIR ?? "docs/audits/rp-gemini-selective-repair-d7a";
const BASELINE_DIR = join(DOCS, "baselines");
const FIXTURE_PATH =
  "docs/audits/rp-quality-v2-gemini/fixtures/c10_fixture.json";

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
function visibleChars(text: string) {
  return text.replace(/\s+/g, "").length;
}

function loadBaselineDraft(caseId: D7ACaseId): string {
  const path = join(BASELINE_DIR, {
    R1: "R1_RESPONSE_OVERLOAD_original.txt",
    R2: "R2_CANON_RECITAL_original.txt",
    R3: "R3_CURRENT_INPUT_REPLAY_original.txt",
  }[caseId]);
  return readFileSync(path, "utf8").trim();
}

function loadFixture() {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
    character: Record<string, unknown>;
    persona: Record<string, unknown>;
    user: Record<string, unknown>;
  };
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

function usageTokens(usage: Record<string, unknown> | null) {
  if (!usage) {
    return {
      input_tokens: null as number | null,
      output_tokens: null as number | null,
      reasoning_tokens: null as number | null,
      total_tokens: null as number | null,
      cost_usd: null as number | null,
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
  const cost =
    typeof usage.cost === "number"
      ? usage.cost
      : typeof usage.total_cost === "number"
        ? usage.total_cost
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
    cost_usd: cost,
  };
}

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

/** Heuristic recital attribution for ecology/profile dumps (eval-only). */
function scoreCanonRecitalHeuristic(text: string): {
  recital_chars: number;
  recital_per_1000: number;
  spans: string[];
} {
  const paras = splitParagraphs(text);
  const spans: string[] = [];
  let recital = 0;
  const re =
    /마더|군체|기생종|브레인\s*포드|회색\s*안개|안개\s*수위|레벨\s*\d|총성은|생태권|성채\s*최정예|방독면|저격수였|신경망|변이체|감염/;
  for (const p of paras) {
    if (!re.test(p)) continue;
    // Count as recital-ish when paragraph is exposition-heavy (long + multiple lore markers)
    const markers = (p.match(/마더|군체|기생종|브레인|생태권|신경망|변이체|총성|안개/g) ?? [])
      .length;
    const noWs = p.replace(/\s+/g, "").length;
    if (markers >= 2 && noWs >= 80) {
      const attributed = Math.min(noWs, 40 + markers * 20);
      recital += attributed;
      if (spans.length < 6) spans.push(p.slice(0, 120));
    }
  }
  const vis = Math.max(1, visibleChars(text));
  return {
    recital_chars: recital,
    recital_per_1000: Number(((1000 * recital) / vis).toFixed(2)),
    spans,
  };
}

async function assembleProductionMessages(opts: {
  modelId: string;
  userInput: string;
}): Promise<{
  messages: Array<{ role: string; content: string }>;
  requestBodyBase: Record<string, unknown>;
  systemSha: string;
  userTailSha: string;
  historySha: string;
  greeting: string;
  settingSources: SettingSource[];
  generationConfig: Record<string, unknown>;
}> {
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
    currentUserMessage: opts.userInput,
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

  const body = {
    ...(wire.requestBody as Record<string, unknown>),
    stream: true,
    stream_options: { include_usage: true },
  };
  const messages =
    (body.messages as Array<{ role: string; content: string }>) ?? [];
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const systemMsg = messages.find((m) => m.role === "system");
  const historyOnly = messages.filter((m) => m.role !== "system");

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
      text: opts.userInput,
    },
    { bucket: "MEMORY", text: "" },
  ];

  return {
    messages,
    requestBodyBase: body,
    systemSha: sha256(String(systemMsg?.content ?? "")),
    userTailSha: sha256(String(lastUser?.content ?? "")),
    historySha: sha256(JSON.stringify(historyOnly)),
    greeting,
    settingSources,
    generationConfig: {
      model: body.model ?? opts.modelId,
      temperature: body.temperature ?? null,
      top_p: body.top_p ?? null,
      max_tokens: body.max_tokens ?? null,
      seed: body.seed ?? null,
      reasoning: body.reasoning ?? null,
      include_reasoning: body.include_reasoning ?? null,
      provider: body.provider ?? null,
    },
  };
}

function buildRepairRequest(opts: {
  production: Awaited<ReturnType<typeof assembleProductionMessages>>;
  draft: string;
  flag: D7ARepairFlag;
}): {
  requestBody: Record<string, unknown>;
  messages: Array<{ role: string; content: string }>;
  repairControlSha: string;
  draftSha: string;
  flagCount: number;
} {
  const draftMsg = buildD7ADraftAssistantMessage(opts.draft);
  const control = d7aRepairControlToWire(opts.flag);
  const messages = [...opts.production.messages, draftMsg, control];
  // Count how many distinct flag focus bodies appear (must be exactly 1).
  const flagCount = (Object.keys(D7A_FLAG_FOCUS) as D7ARepairFlag[]).filter(
    (flag) => control.content.includes(D7A_FLAG_FOCUS[flag])
  ).length;
  return {
    requestBody: {
      ...opts.production.requestBodyBase,
      messages,
    },
    messages,
    repairControlSha: sha256(control.content),
    draftSha: sha256(opts.draft),
    flagCount,
  };
}

async function runPreaudit(modelId: string) {
  const cases: Record<string, unknown>[] = [];
  let ready = true;

  for (const spec of D7A_CASES) {
    const draft = loadBaselineDraft(spec.caseId);
    const chars = visibleChars(draft);
    const production = await assembleProductionMessages({
      modelId,
      userInput: spec.userInput,
    });
    const repair = buildRepairRequest({
      production,
      draft,
      flag: spec.flag,
    });
    const ok =
      chars >= 2400 &&
      chars === spec.originalVisibleChars &&
      repair.flagCount === 1 &&
      repair.messages.filter((m) => m.role === "assistant").length === 2 &&
      repair.messages[repair.messages.length - 1]?.role === "user" &&
      repair.messages[repair.messages.length - 2]?.role === "assistant" &&
      String(repair.messages[repair.messages.length - 2]?.content).startsWith(
        "[DRAFT ASSISTANT RESPONSE]"
      ) &&
      String(repair.messages[repair.messages.length - 1]?.content).includes(
        "[RP RESPONSE REPAIR — SERVER INTERNAL]"
      );
    if (!ok) ready = false;

    const anchors = scoreResponseAnchorCount(draft);
    const fn = scoreDialogueFunctionLoad(draft);
    const recital = scoreCanonRecitalHeuristic(draft);

    cases.push({
      ...spec,
      draft_chars: chars,
      draft_sha256: sha256(draft),
      system_sha256: production.systemSha,
      user_tail_sha256: production.userTailSha,
      history_sha256: production.historySha,
      repair_control_sha256: repair.repairControlSha,
      generation_config: production.generationConfig,
      flag_count: repair.flagCount,
      auto_baseline: {
        response_anchor: anchors,
        dialogue_function_load: fn,
        recital_heuristic: recital,
      },
      assembly_ok: ok,
    });
  }

  const preaudit = {
    phase: "D7-A-PREAUDIT",
    api_calls: 0,
    new_primary_calls: 0,
    repair_calls_planned: 3,
    primary_production_changes: 0,
    TURN_LENGTH_SUPPLEMENT_API_ENABLED,
    SERVER_UNDER_LENGTH_RECOVERY_ENABLED,
    production_recovery_untouched:
      TURN_LENGTH_SUPPLEMENT_API_ENABLED === false &&
      SERVER_UNDER_LENGTH_RECOVERY_ENABLED === false,
    common_contract_sha256: sha256(D7A_COMMON_REPAIR_CONTRACT),
    cases,
    LIVE_CALL_READY: ready,
  };

  save(DOCS, "00_PREAUDIT.json", preaudit);
  save(
    DOCS,
    "00_PREAUDIT.md",
    [
      "# D7-A — API=0 Pre-Audit (Selective Repair)",
      "",
      `**NEW PRIMARY CALLS:** 0`,
      `**REPAIR CALLS PLANNED:** 3`,
      `**PRIMARY PRODUCTION CHANGES:** 0`,
      `**LIVE_CALL_READY:** ${ready ? "YES" : "NO"}`,
      "",
      "| case | flag | fixture | chars | source |",
      "|---|---|---|---:|---|",
      ...D7A_CASES.map(
        (c) =>
          `| ${c.caseId} | ${c.flag} | ${c.fixtureId} | ${c.originalVisibleChars} | ${c.baselineSource} |`
      ),
      "",
      "Production recovery flags untouched (still false).",
      "Repair architecture: production context + `[DRAFT ASSISTANT RESPONSE]` + private internal repair control (1 flag).",
      "",
    ].join("\n")
  );
  save(join(OUT_ROOT, "preaudit"), "00_PREAUDIT.json", preaudit);
  console.log(JSON.stringify({ LIVE_CALL_READY: ready, cases: cases.map((c) => ({
    caseId: (c as D7ACaseSpec).caseId,
    chars: c.draft_chars,
    flag: (c as D7ACaseSpec).flag,
    ok: c.assembly_ok,
  })) }, null, 2));
  return preaudit;
}

async function runLive(modelId: string) {
  const preaudit = await runPreaudit(modelId);
  if (!preaudit.LIVE_CALL_READY) {
    throw new Error("Preaudit not LIVE_CALL_READY");
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

  const results: Record<string, unknown>[] = [];
  let apiCalls = 0;

  for (const spec of D7A_CASES) {
    const draft = loadBaselineDraft(spec.caseId);
    const production = await assembleProductionMessages({
      modelId,
      userInput: spec.userInput,
    });
    const repair = buildRepairRequest({
      production,
      draft,
      flag: spec.flag,
    });

    const cellId = `Gemini_${spec.caseId}_REPAIR`;
    const dir = join(OUT_ROOT, "live", cellId);
    console.log(`\n=== ${cellId} flag=${spec.flag} draftChars=${visibleChars(draft)} ===`);

    let resp = await streamOpenRouter(repair.requestBody);
    apiCalls += 1;
    if (
      (!resp.text || resp.error) &&
      isTransportAbort(resp.error, resp.http_status)
    ) {
      console.log(`transport retry ${cellId}`);
      resp = await streamOpenRouter(repair.requestBody);
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
    const repairedChars = visibleChars(visible);
    const tokens = usageTokens(resp.usage);

    const origAnchors = scoreResponseAnchorCount(draft);
    const repAnchors = scoreResponseAnchorCount(resp.text);
    const origFn = scoreDialogueFunctionLoad(draft);
    const repFn = scoreDialogueFunctionLoad(resp.text);
    const origRecital = scoreCanonRecitalHeuristic(draft);
    const repRecital = scoreCanonRecitalHeuristic(resp.text);

    const vectorOrig = computeRpQualityVectorV2({
      text: draft,
      settingSources: production.settingSources,
      priorAssistantText: production.greeting,
      currentUserInput: spec.userInput,
    });
    const vectorRep = computeRpQualityVectorV2({
      text: resp.text,
      settingSources: production.settingSources,
      priorAssistantText: production.greeting,
      currentUserInput: spec.userInput,
    });

    const row = {
      cell_id: cellId,
      caseId: spec.caseId,
      flag: spec.flag,
      fixtureId: spec.fixtureId,
      userInput: spec.userInput,
      baseline_source: spec.baselineSource,
      original_chars: visibleChars(draft),
      repaired_chars: repairedChars,
      length_ratio: Number(
        (repairedChars / Math.max(1, visibleChars(draft))).toFixed(4)
      ),
      finish_reason: resp.finish_reason,
      provider: resp.provider,
      latency_s: resp.latency_s,
      tokens,
      original: {
        response_anchor: origAnchors,
        dialogue_function_load: origFn,
        dialogue_char_share: vectorOrig.composition.dialogue_char_share,
        dialogue_chars: vectorOrig.composition.dialogue_chars,
        same_speaker_dialogue_fragments:
          vectorOrig.dialogue_fragmentation.same_speaker_dialogue_fragments,
        recital_heuristic: origRecital,
        continuity: vectorOrig.continuity,
      },
      repaired: {
        response_anchor: repAnchors,
        dialogue_function_load: repFn,
        dialogue_char_share: vectorRep.composition.dialogue_char_share,
        dialogue_chars: vectorRep.composition.dialogue_chars,
        same_speaker_dialogue_fragments:
          vectorRep.dialogue_fragmentation.same_speaker_dialogue_fragments,
        recital_heuristic: repRecital,
        continuity: vectorRep.continuity,
      },
      fingerprints: {
        system_sha256: production.systemSha,
        user_tail_sha256: production.userTailSha,
        history_sha256: production.historySha,
        draft_sha256: repair.draftSha,
        repair_control_sha256: repair.repairControlSha,
        generation_config: production.generationConfig,
      },
      human_pending: {
        RESPONSE_ANCHOR_COUNT: "PENDING_AGENT_REVIEW",
        DIALOGUE_FUNCTION_LOAD: "PENDING_AGENT_REVIEW",
        CANON_RECITAL_CHARS: "PENDING_AGENT_REVIEW",
        CURRENT_INPUT_REPLAY_SEVERITY: "PENDING_AGENT_REVIEW",
        SCENE_ADVANCEMENT: "PENDING_AGENT_REVIEW",
        NEW_SCENE_VALUE: "PENDING_AGENT_REVIEW",
        CHARACTER_FIDELITY: "PENDING_AGENT_REVIEW",
        ACTIVE_CANON_USE: "PENDING_AGENT_REVIEW",
        USER_AGENCY: "PENDING_AGENT_REVIEW",
        REMOVED_MATERIAL_REPLACED_WITH_SCENE_VALUE: "PENDING_AGENT_REVIEW",
        CASE_RESULT: "PENDING_AGENT_REVIEW",
      },
    };
    results.push(row);

    save(dir, "original.txt", draft + "\n");
    save(dir, "repaired_raw.txt", resp.text);
    save(dir, "repaired_display.txt", visible);
    save(dir, "meta.json", {
      ...row,
      usage: resp.usage,
      response_headers: resp.response_headers,
      resolved_model: resp.resolved_model,
      generation_id: resp.generation_id,
    });
    save(dir, "request_fingerprint.json", row.fingerprints);
    save(
      join(DOCS, "repaired"),
      `${spec.caseId}_${spec.flag}_repaired.md`,
      [
        `# ${cellId}`,
        "",
        `- flag: ${spec.flag}`,
        `- original_chars: ${visibleChars(draft)}`,
        `- repaired_chars: ${repairedChars}`,
        `- length_ratio: ${row.length_ratio}`,
        `- anchors: ${origAnchors.response_anchor_count} → ${repAnchors.response_anchor_count}`,
        `- function_load: ${origFn.dialogue_function_load} → ${repFn.dialogue_function_load}`,
        `- provider: ${resp.provider}`,
        `- input/reasoning/output tokens: ${tokens.input_tokens}/${tokens.reasoning_tokens}/${tokens.output_tokens}`,
        `- cost_usd: ${tokens.cost_usd}`,
        "",
        "## repaired_output",
        "",
        "```text",
        visible,
        "```",
        "",
      ].join("\n")
    );

    console.log(
      `${cellId}: ${visibleChars(draft)}→${repairedChars} anchors ${origAnchors.response_anchor_count}→${repAnchors.response_anchor_count} fn ${origFn.dialogue_function_load}→${repFn.dialogue_function_load} cost=${tokens.cost_usd}`
    );
  }

  if (apiCalls > 3) {
    console.warn(`WARNING: apiCalls=${apiCalls} exceeded planned 3 (transport retries)`);
  }

  const live = {
    phase: "D7-A-LIVE",
    new_primary_calls: 0,
    repair_calls: apiCalls,
    primary_production_changes: 0,
    TURN_LENGTH_SUPPLEMENT_API_ENABLED,
    SERVER_UNDER_LENGTH_RECOVERY_ENABLED,
    cases: results,
    human_review: "PENDING",
    production_wire: "NOT_RUN",
    merge: "NOT_RUN",
  };
  save(join(DOCS, "live"), "01_D7A_LIVE.json", live);
  save(join(OUT_ROOT, "live"), "01_D7A_LIVE.json", live);
  console.log(JSON.stringify({ apiCalls, cases: results.map((r) => ({
    caseId: r.caseId,
    original: r.original_chars,
    repaired: r.repaired_chars,
    ratio: r.length_ratio,
    anchors: `${(r.original as {response_anchor:{response_anchor_count:number}}).response_anchor.response_anchor_count}→${(r.repaired as {response_anchor:{response_anchor_count:number}}).response_anchor.response_anchor_count}`,
  })) }, null, 2));
  return live;
}

async function main() {
  mkdirSync(OUT_ROOT, { recursive: true });
  mkdirSync(DOCS, { recursive: true });
  const { OPENROUTER_GEMINI_31_PRO_MODEL } = await import(
    "../src/lib/chatModels"
  );
  const modelId = OPENROUTER_GEMINI_31_PRO_MODEL;
  console.log(`D7-A phase=${PHASE} model=${modelId}`);
  if (PHASE === "live") await runLive(modelId);
  else await runPreaudit(modelId);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

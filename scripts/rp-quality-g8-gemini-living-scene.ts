/**
 * Phase G8 — Gemini compact living-scene architecture.
 *
 * PRODUCTION WIRE = 0 · MERGE = 0
 * Soft creative-owner REPLACE for Gemini only (harness Arm B).
 *
 *   PHASE=preaudit|live node --conditions=react-server --import tsx \
 *     scripts/rp-quality-g8-gemini-living-scene.ts
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
  applyG8LivingSceneArmToMessages,
  countNegativeClauses,
  estimateTokensFromChars,
  GEMINI_LIVING_SCENE_CONTRACT,
  G8_CANDIDATE_SCENE_CHANNEL_MAP,
  G8_PRODUCTION_SCENE_CHANNEL_MAP,
  G8_SCENE_CHANNELS,
  type GeminiLivingSceneArm,
} from "../src/lib/geminiLivingSceneContractG8";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "../src/lib/responseLength";
import { COLLABORATIVE_INTERACTIVE_OWNER_BLOCK } from "../src/lib/noGodmodding";
import { OPENING_TURN_USER } from "../src/lib/chatGreetingContext";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}
if (!process.env.OPENROUTER_API_KEY?.trim() && existsSync("/tmp/d6b1_or_key")) {
  process.env.OPENROUTER_API_KEY = readFileSync("/tmp/d6b1_or_key", "utf8").trim();
}

const OUT_ROOT =
  process.env.OUT_ROOT ??
  "/opt/cursor/artifacts/rp-quality-g8-living-scene";
const DOCS =
  process.env.DOCS_DIR ?? "docs/audits/rp-gemini-living-scene-g8";
const C10 =
  "docs/audits/rp-quality-v2-gemini/fixtures/c10_fixture.json";
const N_FIX =
  "docs/audits/rp-gemini-living-scene-g8/fixtures/N_FIXTURES.json";
const DRAWS = 2;
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
function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
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
      cost_usd: null as number | null,
    };
  }
  const details =
    (usage.completion_tokens_details as Record<string, unknown> | undefined) ??
    {};
  return {
    input_tokens:
      typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
    output_tokens:
      typeof usage.completion_tokens === "number"
        ? usage.completion_tokens
        : null,
    reasoning_tokens:
      typeof details.reasoning_tokens === "number"
        ? details.reasoning_tokens
        : null,
    cost_usd: typeof usage.cost === "number" ? usage.cost : null,
  };
}

function scoreResponseAnchorCount(text: string) {
  const dialogue = extractDialogueSpans(text)
    .map((s) => s.content.trim())
    .filter(Boolean);
  let count = 0;
  for (const d of dialogue) {
    const hits =
      d.match(
        /[?？]|까요|래요|세요|할까요|어때|어떡|가자|가요|해줘|해줄래|같이|그만|멈춰|들어|말해/
      ) != null;
    if (hits || (/[!！]$/.test(d) && /해|가|와|봐|들어/.test(d))) count += 1;
  }
  const band =
    count <= 1 ? "IDEAL" : count === 2 ? "ACCEPTABLE" : "RESPONSE_OVERLOAD";
  return { response_anchor_count: count, band };
}

function extractSectionHeaders(systemText: string): string[] {
  return [...systemText.matchAll(/^\[([^\]]+)\]/gm)].map((m) => m[1]!);
}

function extractCanonSurface(systemText: string): string {
  // Keep character/world/persona data slices for parity checks.
  const keep: string[] = [];
  for (const re of [
    /\[CHARACTER CANON[\s\S]*?(?=\n\[USER_PERSONA\]|\n\[WEBNOVEL|\n\[GEMINI RP|\n\[NARRATION|\n\[PRIVATE|\n\[SPEECH|\n\[OUTPUT LAYOUT|\n\[USER PERSONA REFERENCE|\n\[NARRATIVE POV|$)/,
    /\[USER_PERSONA\][\s\S]*?(?=\n\[WEBNOVEL|\n\[GEMINI RP|\n\[NARRATION|\n\[PRIVATE|\n\[SPEECH|\n\[OUTPUT LAYOUT|\n\[USER PERSONA REFERENCE|\n\[NARRATIVE POV|$)/,
    /\[IDENTITY_AND_RULES\][\s\S]*?(?=\n\[USER_PERSONA\]|\n\[WEBNOVEL|\n\[GEMINI RP|\n\[NARRATION|$)/,
  ]) {
    const m = systemText.match(re);
    if (m) keep.push(m[0]);
  }
  return keep.join("\n\n");
}

type NFixture = {
  id: string;
  title: string;
  userInput: string;
  historyAfterGreeting: Array<{ role: string; content: string }>;
};

function loadNFixtures(): NFixture[] {
  const raw = JSON.parse(readFileSync(N_FIX, "utf8")) as {
    fixtures: NFixture[];
  };
  return raw.fixtures;
}

function loadC10() {
  return JSON.parse(readFileSync(C10, "utf8")) as {
    character: Record<string, unknown>;
    persona: Record<string, unknown>;
    user: Record<string, unknown>;
  };
}

async function assembleArm(opts: {
  modelId: string;
  arm: GeminiLivingSceneArm;
  fixture: NFixture;
}) {
  const { loadCharacterChunksForPromptReadOnly } = await import(
    "../src/lib/characterChunks"
  );
  const { formatSelectedPersonaForPrompt } = await import(
    "../src/lib/userPersonas"
  );
  const { buildContext } = await import("../src/services/contextBuilder");
  const { assemblePrimaryRpRequest } = await import("../src/lib/openRouterAdult");
  const { resolveNarrativePov } = await import("../src/lib/narrativePov");

  const c10 = loadC10();
  const ch = { ...c10.character };
  const persona = { ...c10.persona };
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
    String(c10.user.nickname ?? personaName)
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
  const shortTermHistory = [
    { role: "user" as const, content: OPENING_TURN_USER },
    { role: "assistant" as const, content: greeting },
    ...opts.fixture.historyAfterGreeting.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  const built = buildContext({
    charName: String(ch.name),
    chunks,
    userNickname: String(c10.user.nickname ?? personaName),
    userPersona,
    userNote: "",
    longTermMemory: "",
    shortTermHistory,
    currentUserMessage: opts.fixture.userInput,
    nsfw: !!ch.nsfw,
    gender: (ch.gender as "male" | "female" | "other") ?? "other",
    memoryMeta: "",
    modelId: opts.modelId,
    userImpersonation: false,
    novelModeEnabled: false,
    isContinue: false,
    personaDisplayName: personaName,
    targetResponseChars: 3200,
    completedTurns: Math.max(0, shortTermHistory.length / 2 - 1),
    provider: "openrouter",
    contentKind: "character",
    exampleDialog: String(ch.example_dialog ?? ""),
    userId: Number(c10.user.id ?? 4),
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

  const applied = applyG8LivingSceneArmToMessages({
    messages: messagesBase,
    modelId: opts.modelId,
    arm: opts.arm,
  });

  const body = { ...bodyBase, messages: applied.messages };
  const messages = applied.messages;
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const systemText = applied.systemText;
  const historyMsgs = messages.filter((m) => m.role !== "system");
  // history parity: raw history roles excluding last user (current turn)
  const historyWithoutCurrent = historyMsgs.slice(0, -1);

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
    { bucket: "CURRENT_USER_INPUT", text: opts.fixture.userInput },
    { bucket: "MEMORY", text: "" },
  ];

  return {
    requestBody: body,
    systemSha: sha256(systemText),
    messagesSha: sha256(JSON.stringify(messages)),
    historySha: sha256(JSON.stringify(historyWithoutCurrent)),
    userTailSha: sha256(String(lastUser?.content ?? "")),
    canonDataSha: sha256(extractCanonSurface(systemText)),
    systemText,
    systemChars: systemText.length,
    systemTokensApprox: estimateTokensFromChars(systemText.length),
    lastUserContent: String(lastUser?.content ?? ""),
    sectionHeaders: extractSectionHeaders(systemText),
    applied,
    settingSources,
    userInput: opts.fixture.userInput,
    generationConfig: {
      model: body.model ?? opts.modelId,
      temperature: body.temperature ?? null,
      max_tokens: body.max_tokens ?? null,
      reasoning: body.reasoning ?? null,
      include_reasoning: body.include_reasoning ?? null,
      provider: body.provider ?? null,
    },
    negatives: countNegativeClauses(
      systemText + "\n" + String(lastUser?.content ?? "")
    ),
    ownerCounts: {
      agency:
        (systemText.match(/USER CONTROL|LIVING SCENE|INTERACTIVE USER OWNERSHIP/g) ?? [])
          .length,
      layout: (systemText.match(/OUTPUT LAYOUT|SEMANTIC PARAGRAPHING|레이아웃:/g) ?? [])
        .length,
      living_scene: systemText.includes("[GEMINI RP — LIVING SCENE]") ? 1 : 0,
      collaborative: systemText.includes(
        "[USER CONTROL — COLLABORATIVE INTERACTIVE]"
      )
        ? 1
        : 0,
      immersive: systemText.includes("[IMMERSIVE PROSE]") ? 1 : 0,
    },
  };
}

function promptHealth(assembled: Awaited<ReturnType<typeof assembleArm>>) {
  const fixedInstructionApprox = assembled.systemTokensApprox;
  const currentUserInstruction = estimateTokensFromChars(
    assembled.lastUserContent.length
  );
  return {
    system_chars: assembled.systemChars,
    system_tokens_est: assembled.systemTokensApprox,
    fixed_instruction_tokens_est: fixedInstructionApprox,
    current_user_tokens_est: currentUserInstruction,
    negative_surface_hits: assembled.negatives.surface_hits,
    negative_semantic_clauses: assembled.negatives.semantic_prohibition_clauses,
    section_headers: assembled.sectionHeaders,
    owner_counts: assembled.ownerCounts,
  };
}

async function runPreaudit(modelId: string) {
  const fixtures = loadNFixtures();
  const n1 = fixtures[0]!;
  const A = await assembleArm({ modelId, arm: "A", fixture: n1 });
  const B = await assembleArm({ modelId, arm: "B", fixture: n1 });

  const healthA = promptHealth(A);
  const healthB = promptHealth(B);
  const fixedReduction =
    healthA.fixed_instruction_tokens_est > 0
      ? Number(
          (
            (1 -
              healthB.fixed_instruction_tokens_est /
                healthA.fixed_instruction_tokens_est) *
            100
          ).toFixed(1)
        )
      : 0;
  const negReduction =
    healthA.negative_semantic_clauses > 0
      ? Number(
          (
            (1 -
              healthB.negative_semantic_clauses /
                healthA.negative_semantic_clauses) *
            100
          ).toFixed(1)
        )
      : 0;

  const preaudit = {
    phase: "G8-0 / G8-PREAUDIT",
    latest_main: "7f0c54b60e7ace11bc6e4eea9c820caadde24853",
    api_calls: 0,
    sole_variable: "GEMINI_CREATIVE_OWNER_ARCHITECTURE",
    production_wire: "NOT_RUN",
    gemini_living_scene_contract_chars: GEMINI_LIVING_SCENE_CONTRACT.length,
    collaborative_block_present_in_source: true,
    collaborative_chars: COLLABORATIVE_INTERACTIVE_OWNER_BLOCK.length,
    CURRENT_A: {
      ...healthA,
      system_sha256: A.systemSha,
      canon_data_sha256: A.canonDataSha,
      history_sha256: A.historySha,
      generation_config: A.generationConfig,
      scene_channels: G8_PRODUCTION_SCENE_CHANNEL_MAP,
      agency_owner_count: A.ownerCounts.agency,
      layout_owner_count: A.ownerCounts.layout,
      length_owner_present: A.lastUserContent.includes(
        USER_TAIL_LENGTH_OWNER_SENTENCE
      ),
    },
    CANDIDATE_B: {
      ...healthB,
      system_sha256: B.systemSha,
      canon_data_sha256: B.canonDataSha,
      history_sha256: B.historySha,
      generation_config: B.generationConfig,
      scene_channels: G8_CANDIDATE_SCENE_CHANNEL_MAP,
      agency_SoT: B.ownerCounts.living_scene === 1 && B.ownerCounts.collaborative === 0,
      layout_SoT: B.ownerCounts.layout === 0 && B.ownerCounts.living_scene === 1,
      applied: B.applied,
      length_owner_present: B.lastUserContent.includes(
        USER_TAIL_LENGTH_OWNER_SENTENCE
      ),
      wrapper_v2: B.lastUserContent.includes("COMPLETED CUE"),
    },
    invariants: {
      canon_data_sha_equal: A.canonDataSha === B.canonDataSha,
      history_sha_equal: A.historySha === B.historySha,
      runtime_equal:
        JSON.stringify(A.generationConfig) === JSON.stringify(B.generationConfig),
      length_owner_equal:
        A.lastUserContent.includes(USER_TAIL_LENGTH_OWNER_SENTENCE) &&
        B.lastUserContent.includes(USER_TAIL_LENGTH_OWNER_SENTENCE),
      fixed_instruction_reduction_pct: fixedReduction,
      negative_clause_reduction_pct: negReduction,
      system_sha_differs: A.systemSha !== B.systemSha,
    },
    agency_tension_audit: {
      collaborative_allows_minor_co_narration: true,
      legacy_wrapper_more_conservative:
        "CURRENT USER wrapper uses broad Do-not future-actions language; collaborative owner explicitly allows brief expression/gaze/involuntary/minor movement. Tension: wrapper reads stricter than system owner.",
      target_contract: "IMPORTANT AGENCY = USER OWNED; MINOR CONTINUITY = CO-NARRATABLE",
      B_resolves_to_single_agency_SoT: true,
    },
    scene_capacity_channels: G8_SCENE_CHANNELS.map((c) => ({
      channel: c,
      production: G8_PRODUCTION_SCENE_CHANNEL_MAP[c],
      candidate: G8_CANDIDATE_SCENE_CHANNEL_MAP[c],
    })),
    LIVE_CALL_READY:
      B.applied.applied &&
      A.canonDataSha === B.canonDataSha &&
      A.historySha === B.historySha &&
      B.lastUserContent.includes(USER_TAIL_LENGTH_OWNER_SENTENCE) &&
      B.lastUserContent.includes("COMPLETED CUE") &&
      !B.systemText.includes("[IMMERSIVE PROSE]") &&
      B.systemText.includes("[GEMINI RP — LIVING SCENE]"),
  };

  save(DOCS, "00_G8_PREAUDIT.json", preaudit);
  save(
    DOCS,
    "00_G8_PREAUDIT.md",
    [
      "# G8-0 / Preaudit — Gemini Living Scene Architecture",
      "",
      `**latest main:** \`7f0c54b\``,
      `**LIVE_CALL_READY:** ${preaudit.LIVE_CALL_READY ? "YES" : "NO"}`,
      "",
      "## Prompt health",
      "",
      `| | A (production) | B (living scene) |`,
      `|---|---:|---:|`,
      `| system tokens≈ | ${healthA.system_tokens_est} | ${healthB.system_tokens_est} |`,
      `| fixed reduction | | **${fixedReduction}%** |`,
      `| negative semantic clauses | ${healthA.negative_semantic_clauses} | ${healthB.negative_semantic_clauses} (−${negReduction}%) |`,
      `| agency SoT | collab+wrapper | living-scene only |`,
      `| layout SoT | OUTPUT LAYOUT + terminal | in living-scene form |`,
      `| canon/data SHA equal | | ${preaudit.invariants.canon_data_sha_equal} |`,
      `| history SHA equal | | ${preaudit.invariants.history_sha_equal} |`,
      `| length owner preserved | | ${preaudit.invariants.length_owner_equal} |`,
      "",
      "Hygiene / speech metadata / POV retained. Creative prose+layout+collab consolidated.",
      "",
    ].join("\n")
  );
  save(join(OUT_ROOT, "preaudit"), "00_G8_PREAUDIT.json", preaudit);
  console.log(
    JSON.stringify(
      {
        LIVE_CALL_READY: preaudit.LIVE_CALL_READY,
        fixedReduction,
        negReduction,
        tokA: healthA.system_tokens_est,
        tokB: healthB.system_tokens_est,
        canonEqual: preaudit.invariants.canon_data_sha_equal,
      },
      null,
      2
    )
  );
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

  const fixtures = loadNFixtures();
  const cells: Array<Record<string, unknown>> = [];
  let apiCalls = 0;

  for (const fixture of fixtures) {
    for (const arm of ["A", "B"] as const) {
      const assembled = await assembleArm({ modelId, arm, fixture });
      for (let draw = 1; draw <= DRAWS; draw++) {
        const cellId = `Gemini_${fixture.id}_${arm}_D${draw}`;
        const dir = join(OUT_ROOT, "live", cellId);
        console.log(
          `\n=== ${cellId} sysTok≈${assembled.systemTokensApprox} ===`
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
        const chars = visibleChars(visible);
        const tokens = usageTokens(resp.usage);
        const anchors = scoreResponseAnchorCount(resp.text);
        const vector = computeRpQualityVectorV2({
          text: resp.text,
          settingSources: assembled.settingSources,
          currentUserInput: fixture.userInput,
        });

        const row = {
          cell_id: cellId,
          fixture: fixture.id,
          arm,
          draw,
          visible_chars: chars,
          finish_reason: resp.finish_reason,
          provider: resp.provider,
          latency_s: resp.latency_s,
          tokens,
          dialogue_char_share: vector.composition.dialogue_char_share,
          narration_char_share: vector.composition.narration_char_share,
          response_anchor: anchors,
          same_speaker_dialogue_fragments:
            vector.dialogue_fragmentation.same_speaker_dialogue_fragments,
          continuity: vector.continuity,
          hard_alarms: vector.hard_alarms,
          system_sha256: assembled.systemSha,
          canon_data_sha256: assembled.canonDataSha,
          history_sha256: assembled.historySha,
          user_tail_sha256: assembled.userTailSha,
          generation_config: assembled.generationConfig,
          human_pending: {
            SCORE_100: "PENDING_AGENT_REVIEW",
            SCENE_ADVANCEMENT: "PENDING",
            IMMERSIVE_NARRATION: "PENDING",
            CHARACTER_FIDELITY: "PENDING",
            LENGTH_COMPLETION: "PENDING",
            DIALOGUE_USABILITY: "PENDING",
            CONTINUITY_LOW_REPLAY_RECITAL: "PENDING",
            USER_AGENCY_NATURALNESS: "PENDING",
            SEVERE_AGENCY: "PENDING",
            CARRIERS: "PENDING",
          },
        };
        cells.push(row);

        save(dir, "final_display.txt", visible);
        save(dir, "provider_raw.txt", resp.text);
        save(dir, "meta.json", { ...row, usage: resp.usage });
        save(dir, "request_fingerprint.json", {
          system_sha256: assembled.systemSha,
          canon_data_sha256: assembled.canonDataSha,
          history_sha256: assembled.historySha,
          user_tail_sha256: assembled.userTailSha,
          arm,
          generation_config: assembled.generationConfig,
        });
        save(
          join(DOCS, "raw"),
          `${cellId}.md`,
          [
            `# ${cellId}`,
            "",
            `- fixture: ${fixture.id} (${fixture.title})`,
            `- arm: ${arm}`,
            `- draw: ${draw}`,
            `- visible_chars: ${chars}`,
            `- dialogue_share: ${vector.composition.dialogue_char_share}`,
            `- anchors: ${anchors.response_anchor_count} (${anchors.band})`,
            `- provider: ${resp.provider}`,
            "",
            "## user_input",
            "",
            "```text",
            fixture.userInput,
            "```",
            "",
            "## visible_output",
            "",
            "```text",
            visible,
            "```",
            "",
          ].join("\n")
        );
        console.log(
          `${cellId}: chars=${chars} share=${vector.composition.dialogue_char_share} anchors=${anchors.response_anchor_count}`
        );
      }
    }
  }

  const live = {
    phase: "G8-STAGE1-LIVE",
    api_calls: apiCalls,
    target_calls: fixtures.length * 2 * DRAWS,
    preaudit_summary: {
      fixed_reduction_pct: preaudit.invariants.fixed_instruction_reduction_pct,
      negative_reduction_pct: preaudit.invariants.negative_clause_reduction_pct,
      canon_parity: preaudit.invariants.canon_data_sha_equal,
    },
    cells,
    human_review: "PENDING",
    regression_g3_g5_g6: "NOT_RUN",
    production_wire: "NOT_RUN",
    merge: "NOT_RUN",
  };
  save(join(DOCS, "stage1"), "01_STAGE1_LIVE.json", live);
  save(join(OUT_ROOT, "live"), "01_STAGE1_LIVE.json", live);
  console.log(
    JSON.stringify(
      {
        apiCalls,
        byFixture: fixtures.map((f) => ({
          id: f.id,
          A: cells
            .filter((c) => c.fixture === f.id && c.arm === "A")
            .map((c) => c.visible_chars),
          B: cells
            .filter((c) => c.fixture === f.id && c.arm === "B")
            .map((c) => c.visible_chars),
        })),
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
  console.log(`G8 phase=${PHASE} model=${modelId}`);
  if (PHASE === "live") await runLive(modelId);
  else await runPreaudit(modelId);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

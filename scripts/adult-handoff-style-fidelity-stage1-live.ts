/**
 * Adult Handoff Style Fidelity — Stage 1 live capture (6 calls).
 *
 * PRODUCTION_CONFIG_BUNDLE_COMPARISON:
 *   DeepSeek V4 Pro + production DeepSeek adapters + CheaperInference
 *   vs
 *   Muse Spark 1.2 + production Muse adapters + OpenRouter
 *
 * Required shared parity must PASS per source before any call.
 * Final prompt byte parity is NOT required.
 * retry / continuation / recovery / fallback = 0.
 *
 * After capture: blind review packet + sealed hidden map.
 * Does NOT declare a winner. Does NOT open the hidden map.
 */
import { createHash, randomInt } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const FIXTURE_DIR =
  process.env.FIXTURE_DIR ?? "/opt/cursor/artifacts/opus-quality-anchor/fixtures";
const OUT_ROOT =
  process.env.OUT_ROOT ??
  "/opt/cursor/artifacts/adult-handoff-style-fidelity";
const DOCS =
  process.env.DOCS_DIR ?? "docs/audits/adult-handoff-style-fidelity-muse12";

const DEEPSEEK_CANDIDATE = "deepseek-v4-pro";
const MUSE_CANDIDATE = "meta/muse-spark-1.2";

const ADULT_ENTRY_USER_TURN =
  "*그의 손이 내 허리를 감싸 안는다. 눈이 마주치고 거리가 사라진다.* \n\n“이대로 있어도 돼?”\n\n*곁에서 숨소리가 가까워진다. 더 가까이 닿아도 좋다는 허락이 눈빛에 묻어 있다.*";

type ChatMsg = { role: "user" | "assistant" | "system"; content: string };
type CandidateId = "deepseek" | "muse";
type BlindLabel = "X" | "Y";

type SourceDef = {
  id: "opus" | "terra" | "gemini";
  label: string;
  characterId: number;
  anchorPath: string;
  priorTurns: Array<{ user: string; assistantPath: string }>;
  humanApproved: boolean;
  humanApprovalNote: string;
};

const SOURCES: SourceDef[] = [
  {
    id: "opus",
    label: "Claude Opus 5 (Arm E)",
    characterId: 5,
    anchorPath:
      "/opt/cursor/artifacts/opus-instruction-boundary/live/s5_relationship_hand/arm-E/run1/turn2-provider-raw.txt",
    priorTurns: [
      {
        user: "*렌은 내민 손을 잡는다.* 그다음에는 어떻게 할까요?",
        assistantPath:
          "/opt/cursor/artifacts/opus-instruction-boundary/live/s5_relationship_hand/arm-E/run1/turn1-provider-raw.txt",
      },
    ],
    humanApproved: true,
    humanApprovalNote:
      "docs/audits/OPUS_AUDIT_57_59_FINAL_FREEZE.md — ARM_E_ACCEPTED / FINAL_HUMAN_REVIEW_PASS",
  },
  {
    id: "terra",
    label: "GPT-5.6 Terra",
    characterId: 10,
    anchorPath:
      "/opt/cursor/artifacts/final-production-model-smoke/live/terra_action/run1/turn1-provider-raw.txt",
    priorTurns: [],
    humanApproved: true,
    humanApprovalNote:
      "docs/audits/final-production-model-smoke/STATUS.md — TERRA_PROSE_PASS / FINAL_HUMAN_REVIEW_PASS",
  },
  {
    id: "gemini",
    label: "Gemini 3.1 Pro",
    characterId: 18,
    anchorPath:
      "/opt/cursor/artifacts/gemini31-opus5-minimal-screen/gemini31/relationship/run1/turn2-provider-raw.txt",
    priorTurns: [
      {
        user: "난 본기억없는데.... 나는 렌이라고 부르면 돼. *고개끄덕임* 신입 맞아.",
        assistantPath:
          "/opt/cursor/artifacts/gemini31-opus5-minimal-screen/gemini31/relationship/run1/turn1-provider-raw.txt",
      },
    ],
    humanApproved: false,
    humanApprovalNote:
      "No formal human PASS / PRODUCTION_READY document in repo for Audit 55 Gemini relationship outputs. Technical match only (finish=stop, rich narration). This limitation does NOT invalidate Opus/Terra cells.",
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

function flushRemainingSseBuffer(
  dec: TextDecoder,
  buf: { value: string },
  state: StreamState
): void {
  const tail = dec.decode();
  if (tail) buf.value += tail;
  if (buf.value.trim()) {
    processSseLine(buf.value, state);
    buf.value = "";
  }
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
    // Long RP streams can idle between tokens; disable undici body idle timeout.
    // This is transport hardening only — not a generation retry/continuation.
    const { Agent } = await import("undici");
    const dispatcher = new Agent({
      headersTimeout: 10 * 60_000,
      bodyTimeout: 0,
      connectTimeout: 60_000,
    });
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      // @ts-expect-error Node fetch undici dispatcher
      dispatcher,
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
    flushRemainingSseBuffer(dec, buf, state);
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
  if (!existsSync(path)) throw new Error(`missing ${path}`);
  return JSON.parse(readFileSync(path, "utf8")) as {
    character: Record<string, unknown>;
    persona: Record<string, unknown>;
    user: Record<string, unknown>;
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
  };
}

async function assembleBundle(opts: {
  candidateModelId: string;
  fixture: Awaited<ReturnType<typeof loadFixture>>;
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
  const { isCheaperInferenceModel } = await import("../src/lib/chatModels");

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

  const transportProvider = isCheaperInferenceModel(opts.candidateModelId)
    ? ("cheaperinference" as const)
    : ("openrouter" as const);

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
    modelId: opts.candidateModelId,
    userImpersonation: false,
    novelModeEnabled: false,
    isContinue: false,
    personaDisplayName: personaName,
    targetResponseChars: 3200,
    completedTurns: Math.max(0, Math.floor((handoffHistory.length - 2) / 2)),
    provider:
      transportProvider === "cheaperinference" ? "cheaperinference" : "openrouter",
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
    modelId: opts.candidateModelId,
    targetResponseChars: 3200,
    messageOpts: {
      transportProvider,
      charName: String(ch.name),
      personaName,
    },
  });

  const requestBody = {
    ...(wire.requestBody as Record<string, unknown>),
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
    transportProvider,
    chunksFingerprint: sha256(JSON.stringify(chunks)),
    userPersona,
    personaName,
    charName: String(ch.name),
    adapters: detectAdapters(systemPrompt, userTail),
    sharedGen: {
      stream: requestBody.stream === true,
      targetResponseChars: 3200,
      max_tokens: requestBody.max_tokens ?? null,
      stop: requestBody.stop ?? null,
    },
  };
}

function compareRequiredParity(
  a: Awaited<ReturnType<typeof assembleBundle>>,
  b: Awaited<ReturnType<typeof assembleBundle>>,
  currentUserMessage: string
) {
  const BASE_CONTEXT_PARITY =
    a.chunksFingerprint === b.chunksFingerprint &&
    a.userPersona === b.userPersona &&
    a.charName === b.charName &&
    a.personaName === b.personaName
      ? "PASS"
      : "FAIL";
  const RAW_HISTORY_PARITY =
    hashMsgs(a.handoffVariants.handoff.history as ChatMsg[]) ===
    hashMsgs(b.handoffVariants.handoff.history as ChatMsg[])
      ? "PASS"
      : "FAIL";
  const CURRENT_USER_INPUT_PARITY =
    currentUserMessage === ADULT_ENTRY_USER_TURN ? "PASS" : "FAIL";
  const CHARACTER_PERSONA_PARITY = BASE_CONTEXT_PARITY;
  const CONTINUITY_DATA_PARITY =
    sha256(JSON.stringify(a.continuityInput)) ===
      sha256(JSON.stringify(b.continuityInput)) &&
    sha256(JSON.stringify(a.continuityPacket)) ===
      sha256(JSON.stringify(b.continuityPacket))
      ? "PASS"
      : "FAIL";
  const GENERATION_PARAMETER_PARITY =
    JSON.stringify(a.sharedGen) === JSON.stringify(b.sharedGen) ? "PASS" : "FAIL";

  const required =
    BASE_CONTEXT_PARITY === "PASS" &&
    RAW_HISTORY_PARITY === "PASS" &&
    CURRENT_USER_INPUT_PARITY === "PASS" &&
    CHARACTER_PERSONA_PARITY === "PASS" &&
    CONTINUITY_DATA_PARITY === "PASS" &&
    GENERATION_PARAMETER_PARITY === "PASS";

  return {
    BASE_CONTEXT_PARITY,
    RAW_HISTORY_PARITY,
    CURRENT_USER_INPUT_PARITY,
    CHARACTER_PERSONA_PARITY,
    CONTINUITY_DATA_PARITY,
    GENERATION_PARAMETER_PARITY,
    FINAL_PROMPT_BYTE_PARITY: "EXPECTED_DIFFERENCE" as const,
    FINAL_PROMPT_BYTE_PARITY_REQUIRED: "NOT_REQUIRED" as const,
    PRODUCTION_ADAPTER_MANIFEST: "RECORDED" as const,
    required_parity_pass: required,
    FINAL_PROMPT_HASH_DEEPSEEK: hashMsgs(a.messages),
    FINAL_PROMPT_HASH_MUSE: hashMsgs(b.messages),
    SYSTEM_HASH_DEEPSEEK: sha256(a.systemPrompt),
    SYSTEM_HASH_MUSE: sha256(b.systemPrompt),
    DEEPSEEK_PRODUCTION_ADAPTERS: {
      ...a.adapters,
      provider_route: a.transportProvider,
      temperature: a.requestBody.temperature ?? null,
      top_p: a.requestBody.top_p ?? null,
      reasoning: a.requestBody.reasoning ?? null,
    },
    MUSE_PRODUCTION_ADAPTERS: {
      ...b.adapters,
      provider_route: b.transportProvider,
      temperature: b.requestBody.temperature ?? null,
      top_p: b.requestBody.top_p ?? null,
      reasoning: b.requestBody.reasoning ?? null,
    },
  };
}

function assignBlindLabels(): Record<BlindLabel, CandidateId> {
  // Randomize per source so reviewers cannot learn a fixed X=DeepSeek pattern.
  if (randomInt(2) === 0) return { X: "deepseek", Y: "muse" };
  return { X: "muse", Y: "deepseek" };
}

function buildBlindPacket(opts: {
  sources: Array<{
    source: SourceDef;
    sourceAnchorExcerpt: string;
    sourceAnchorChars: number;
    cells: Record<
      BlindLabel,
      {
        text: string;
        chars: number;
        finish_reason: string | null;
        latency_s: number;
      }
    >;
  }>;
}): string {
  const lines: string[] = [];
  lines.push("# BLIND REVIEW PACKET — Adult Handoff Production Bundle Fidelity");
  lines.push("");
  lines.push("```text");
  lines.push("comparison_unit: PRODUCTION_CONFIG_BUNDLE_COMPARISON");
  lines.push("status: HUMAN_BLIND_REVIEW_REQUIRED");
  lines.push("candidate_identity: HIDDEN");
  lines.push("source_identity: VISIBLE");
  lines.push("winner_declaration: FORBIDDEN_UNTIL_HUMAN_REVIEW");
  lines.push("```");
  lines.push("");
  lines.push("## Question");
  lines.push("");
  lines.push(
    "Under the **current production adult handoff configuration bundles**, which candidate more naturally continues the source model's prose so the model switch is less noticeable?"
  );
  lines.push("");
  lines.push("Results measure **actual production handoff bundle fidelity**, not pure raw-model skill.");
  lines.push("");
  lines.push("## Scoring rubric (required)");
  lines.push("");
  lines.push("```text");
  lines.push("1. Source Style Continuity");
  lines.push("2. MODEL_SWITCH_NOTICEABILITY  (lower = better)");
  lines.push("3. SAME_AUTHOR_ILLUSION");
  lines.push("4. Sentence/Paragraph Rhythm");
  lines.push("5. Character Voice / Honorific Fidelity");
  lines.push("6. Narration/Dialogue Balance");
  lines.push("7. Scene Continuity");
  lines.push("8. User Agency");
  lines.push("```");
  lines.push("");
  lines.push(
    "For each source, pick Winner = X / Y / TIE. Also compare MODEL_SWITCH_NOTICEABILITY and SAME_AUTHOR_ILLUSION explicitly alongside total score."
  );
  lines.push("");
  lines.push("## Decision criteria (for after scoring)");
  lines.push("");
  lines.push("```text");
  lines.push("Muse 3/3, or Muse 2/3 + remaining near-tie + persistently lower switch noticeability");
  lines.push("  → MUSE_PRODUCTION_HANDOFF_BUNDLE_WIN / MUSE_ADULT_ROUTE_REPLACEMENT_CANDIDATE");
  lines.push("DeepSeek clearly superior");
  lines.push("  → DEEPSEEK_PRODUCTION_HANDOFF_BUNDLE_WIN / KEEP_CURRENT_ADULT_MODEL");
  lines.push("Mixed / small gap");
  lines.push("  → MIXED_PRODUCTION_HANDOFF_RESULT / NO_REPLACEMENT");
  lines.push("```");
  lines.push("");
  lines.push("Do **not** open `HIDDEN_MAP.json` before finishing blind scores.");
  lines.push("");

  for (const row of opts.sources) {
    lines.push(`---`);
    lines.push("");
    lines.push(`## Source: ${row.source.label} (\`${row.source.id}\`)`);
    lines.push("");
    lines.push(`- character_id: ${row.source.characterId}`);
    lines.push(`- source_anchor_chars: ${row.sourceAnchorChars}`);
    lines.push(
      `- human_approved_anchor: ${row.source.humanApproved ? "YES" : "NO — see note"}`
    );
    if (!row.source.humanApproved) {
      lines.push(`- note: ${row.source.humanApprovalNote}`);
    }
    lines.push("");
    lines.push("### Source anchor excerpt");
    lines.push("");
    lines.push("```text");
    lines.push(row.sourceAnchorExcerpt.slice(0, 900));
    if (row.sourceAnchorExcerpt.length > 900) lines.push("…");
    lines.push("```");
    lines.push("");
    lines.push("### Adult entry user turn (identical for X and Y)");
    lines.push("");
    lines.push("```text");
    lines.push(ADULT_ENTRY_USER_TURN);
    lines.push("```");
    lines.push("");

    for (const label of ["X", "Y"] as BlindLabel[]) {
      const cell = row.cells[label];
      lines.push(`### Candidate ${label}`);
      lines.push("");
      lines.push(
        `- visible_chars: ${cell.chars} · finish_reason: ${cell.finish_reason ?? "null"} · latency_s: ${cell.latency_s}`
      );
      lines.push("");
      lines.push("```text");
      lines.push(cell.text);
      lines.push("```");
      lines.push("");
    }

    lines.push("### Scorecard (fill)");
    lines.push("");
    lines.push("| Dimension | X | Y | Notes |");
    lines.push("|---|---|---|---|");
    lines.push("| Source Style Continuity |  |  |  |");
    lines.push("| MODEL_SWITCH_NOTICEABILITY (lower better) |  |  |  |");
    lines.push("| SAME_AUTHOR_ILLUSION |  |  |  |");
    lines.push("| Sentence/Paragraph Rhythm |  |  |  |");
    lines.push("| Character Voice / Honorific |  |  |  |");
    lines.push("| Narration/Dialogue Balance |  |  |  |");
    lines.push("| Scene Continuity |  |  |  |");
    lines.push("| User Agency |  |  |  |");
    lines.push("| **Total** |  |  |  |");
    lines.push("");
    lines.push("Winner for this source: `X` / `Y` / `TIE`");
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("## Overall (fill after all three sources)");
  lines.push("");
  lines.push("```text");
  lines.push("opus_winner:");
  lines.push("terra_winner:");
  lines.push("gemini_winner:");
  lines.push("switch_noticeability_edge:");
  lines.push("same_author_illusion_edge:");
  lines.push("provisional_product_verdict: (do not finalize here if unsure)");
  lines.push("```");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  mkdirSync(OUT_ROOT, { recursive: true });
  mkdirSync(DOCS, { recursive: true });

  const {
    CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    buildCheaperInferenceHeaders,
  } = await import("../src/lib/cheaperInferenceConfig");
  const {
    OPENROUTER_CHAT_COMPLETIONS_URL,
    buildOpenRouterHeaders,
  } = await import("../src/lib/openRouterConfig");
  const { visibleAssistantDisplayCharCount } = await import(
    "../src/lib/chatDisplayLength"
  );

  let apiCalls = 0;
  const maxCalls = 6;
  const callRows: Record<string, unknown>[] = [];
  const parityBySource: Record<string, unknown> = {};
  const hiddenMap: {
    sealed: true;
    do_not_open_before_human_review: true;
    comparison_unit: "PRODUCTION_CONFIG_BUNDLE_COMPARISON";
    mapping: Record<
      string,
      { X: CandidateId; Y: CandidateId; model_X: string; model_Y: string }
    >;
  } = {
    sealed: true,
    do_not_open_before_human_review: true,
    comparison_unit: "PRODUCTION_CONFIG_BUNDLE_COMPARISON",
    mapping: {},
  };

  const blindRows: Array<{
    source: SourceDef;
    sourceAnchorExcerpt: string;
    sourceAnchorChars: number;
    cells: Record<
      BlindLabel,
      {
        text: string;
        chars: number;
        finish_reason: string | null;
        latency_s: number;
      }
    >;
  }> = [];

  for (const source of SOURCES) {
    const fixture = await loadFixture(source.characterId);
    const sourceAssistantOutput = readFileSync(source.anchorPath, "utf8");
    const sourceHistory: ChatMsg[] = [];
    for (const t of source.priorTurns) {
      sourceHistory.push({ role: "user", content: t.user });
      sourceHistory.push({
        role: "assistant",
        content: readFileSync(t.assistantPath, "utf8"),
      });
    }
    // Prior user turn that produced the anchor (for RAW completeness).
    // Terra: anchor is turn1 — prior user is the terra action user, already
    // represented by including it before the anchor assistant in handoffRaw
    // via a synthetic prior if no priorTurns; for terra we inject the turn1 user.
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

    const deepseek = await assembleBundle({
      candidateModelId: DEEPSEEK_CANDIDATE,
      fixture,
      sourceHistory,
      sourceAssistantOutput,
      currentUserMessage: ADULT_ENTRY_USER_TURN,
    });
    const muse = await assembleBundle({
      candidateModelId: MUSE_CANDIDATE,
      fixture,
      sourceHistory,
      sourceAssistantOutput,
      currentUserMessage: ADULT_ENTRY_USER_TURN,
    });

    const parity = compareRequiredParity(deepseek, muse, ADULT_ENTRY_USER_TURN);
    parityBySource[source.id] = parity;
    save(join(OUT_ROOT, "parity", source.id), "parity.json", parity);
    save(join(OUT_ROOT, "parity", source.id), "deepseek-messages.json", deepseek.messages);
    save(join(OUT_ROOT, "parity", source.id), "muse-messages.json", muse.messages);
    save(join(OUT_ROOT, "parity", source.id), "continuity-packet.json", deepseek.continuityPacket);

    console.log(`[parity] ${source.id}`, {
      required: parity.required_parity_pass,
      BASE_CONTEXT_PARITY: parity.BASE_CONTEXT_PARITY,
      RAW_HISTORY_PARITY: parity.RAW_HISTORY_PARITY,
      CONTINUITY_DATA_PARITY: parity.CONTINUITY_DATA_PARITY,
      GENERATION_PARAMETER_PARITY: parity.GENERATION_PARAMETER_PARITY,
      FINAL_PROMPT_BYTE_PARITY: parity.FINAL_PROMPT_BYTE_PARITY,
    });

    if (!parity.required_parity_pass) {
      save(OUT_ROOT, "RUNTIME_RESULTS.json", {
        status: "REQUIRED_PARITY_FAIL_DO_NOT_CALL",
        failed_source: source.id,
        parity_by_source: parityBySource,
        api_calls: apiCalls,
      });
      throw new Error(`REQUIRED_PARITY_FAIL:${source.id}`);
    }

    const labels = assignBlindLabels();
    hiddenMap.mapping[source.id] = {
      X: labels.X,
      Y: labels.Y,
      model_X: labels.X === "deepseek" ? DEEPSEEK_CANDIDATE : MUSE_CANDIDATE,
      model_Y: labels.Y === "deepseek" ? DEEPSEEK_CANDIDATE : MUSE_CANDIDATE,
    };

    const cells: Record<
      BlindLabel,
      {
        text: string;
        chars: number;
        finish_reason: string | null;
        latency_s: number;
      }
    > = {
      X: { text: "", chars: 0, finish_reason: null, latency_s: 0 },
      Y: { text: "", chars: 0, finish_reason: null, latency_s: 0 },
    };

    for (const label of ["X", "Y"] as BlindLabel[]) {
      const candidate = labels[label];
      const assembled = candidate === "deepseek" ? deepseek : muse;
      const modelId =
        candidate === "deepseek" ? DEEPSEEK_CANDIDATE : MUSE_CANDIDATE;
      const dir = join(OUT_ROOT, "live", source.id, candidate, "run1");
      const rawPath = join(dir, "provider-raw.txt");

      if (existsSync(rawPath)) {
        console.log(`skip existing ${source.id}/${candidate}`);
        const text = readFileSync(rawPath, "utf8");
        const meta = JSON.parse(
          readFileSync(join(dir, "meta.json"), "utf8")
        ) as Record<string, unknown>;
        cells[label] = {
          text,
          chars: Number(meta.total_visible_chars ?? text.length),
          finish_reason: (meta.finish_reason as string | null) ?? null,
          latency_s: Number(meta.latency_s ?? 0),
        };
        callRows.push({ ...meta, blind_label: label, reused: true });
        continue;
      }

      if (apiCalls >= maxCalls) {
        throw new Error(`API_CALL_BUDGET_EXCEEDED:${apiCalls}/${maxCalls}`);
      }

      const endpoint =
        assembled.transportProvider === "cheaperinference"
          ? CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL
          : OPENROUTER_CHAT_COMPLETIONS_URL;
      const headers =
        assembled.transportProvider === "cheaperinference"
          ? buildCheaperInferenceHeaders()
          : buildOpenRouterHeaders();

      console.log(`\n=== ${source.id} → ${candidate} (blind ${label}) ===`);
      apiCalls += 1;
      const resp = await streamProvider(
        endpoint,
        headers,
        assembled.requestBody
      );
      // No retry / continuation / recovery / fallback.

      if (resp.http_status !== 200 || resp.error || !resp.text.trim()) {
        save(dir, "FAIL.json", resp);
        throw new Error(
          `CALL_FAIL ${source.id}/${candidate}: ${resp.error ?? resp.http_status}`
        );
      }

      const chars = visibleAssistantDisplayCharCount(resp.text);
      const uf = extractUsage(resp.usage);
      const row = {
        attempt_id: `${source.id.toUpperCase()}_${candidate.toUpperCase()}`,
        source_id: source.id,
        source_label: source.label,
        source_human_approved: source.humanApproved,
        candidate,
        model: modelId,
        resolved_model: resp.resolved_model,
        provider_route: assembled.transportProvider,
        character_id: source.characterId,
        blind_label: label,
        http_status: resp.http_status,
        finish_reason: resp.finish_reason,
        saw_done: resp.saw_done,
        total_visible_chars: chars,
        ...uf,
        latency_s: resp.latency_s,
        retry: 0,
        continuation: 0,
        recovery: 0,
        provider_fallback: 0,
        raw_hash: sha256(resp.text),
        final_prompt_hash: hashMsgs(assembled.messages),
        temperature: assembled.requestBody.temperature ?? null,
        reasoning: assembled.requestBody.reasoning ?? null,
      };

      save(dir, "provider-raw.txt", resp.text);
      save(dir, "meta.json", row);
      save(dir, "messages.json", assembled.messages);
      save(dir, "request-body-sanitized.json", {
        model: assembled.requestBody.model,
        temperature: assembled.requestBody.temperature ?? null,
        top_p: assembled.requestBody.top_p ?? null,
        max_tokens: assembled.requestBody.max_tokens ?? null,
        stream: assembled.requestBody.stream,
        reasoning: assembled.requestBody.reasoning ?? null,
        provider_route: assembled.transportProvider,
        message_count: assembled.messages.length,
      });

      cells[label] = {
        text: resp.text,
        chars,
        finish_reason: resp.finish_reason,
        latency_s: resp.latency_s,
      };
      callRows.push(row);
      console.log({
        id: row.attempt_id,
        chars,
        finish: resp.finish_reason,
        latency_s: resp.latency_s,
      });
    }

    blindRows.push({
      source,
      sourceAnchorExcerpt: sourceAssistantOutput,
      sourceAnchorChars: [...sourceAssistantOutput].length,
      cells,
    });
  }

  // Seal hidden map (docs + artifacts). Do not print mapping to stdout.
  const hiddenPath = join(DOCS, "HIDDEN_MAP.json");
  save(DOCS, "HIDDEN_MAP.json", hiddenMap);
  save(OUT_ROOT, "HIDDEN_MAP.json", hiddenMap);
  try {
    chmodSync(hiddenPath, 0o600);
    chmodSync(join(OUT_ROOT, "HIDDEN_MAP.json"), 0o600);
  } catch {
    // best-effort
  }

  const blindMd = buildBlindPacket({ sources: blindRows });
  save(DOCS, "BLIND_REVIEW_PACKET.md", blindMd);
  save(OUT_ROOT, "BLIND_REVIEW_PACKET.md", blindMd);

  // Per-source parity rollup + runtime results (no winner).
  const runtime = {
    status: "ADULT_HANDOFF_FIDELITY_CAPTURE_COMPLETE",
    human_review: "HUMAN_BLIND_REVIEW_REQUIRED",
    comparison_unit: "PRODUCTION_CONFIG_BUNDLE_COMPARISON",
    claim_scope:
      "actual production handoff bundle fidelity — NOT pure raw-model performance",
    timestamp: new Date().toISOString(),
    api_calls: apiCalls,
    max_calls: maxCalls,
    retry: 0,
    continuation: 0,
    recovery: 0,
    provider_fallback: 0,
    source_model_calls: { opus: 0, terra: 0, gemini: 0 },
    gemini_anchor_limitation:
      "Gemini source has no formal human PASS document; Opus/Terra remain valid.",
    parity_by_source: parityBySource,
    FINAL_PROMPT_BYTE_PARITY: "EXPECTED_DIFFERENCE",
    PRODUCTION_ADAPTER_MANIFEST: "RECORDED",
    calls: callRows.map((r) => ({
      attempt_id: (r as { attempt_id?: string }).attempt_id,
      source_id: (r as { source_id?: string }).source_id,
      candidate: (r as { candidate?: string }).candidate,
      blind_label: (r as { blind_label?: string }).blind_label,
      total_visible_chars: (r as { total_visible_chars?: number })
        .total_visible_chars,
      finish_reason: (r as { finish_reason?: string }).finish_reason,
      provider_route: (r as { provider_route?: string }).provider_route,
      retry: 0,
      continuation: 0,
      recovery: 0,
      provider_fallback: 0,
    })),
    blind_review_packet: "BLIND_REVIEW_PACKET.md",
    hidden_map: "HIDDEN_MAP.json (SEALED — do not open before human review)",
    winner_declared: false,
    production_change: false,
    merge: "NOT_RUN",
    deploy: "NOT_RUN",
    common_prompt_diagnostic: "NOT_RUN",
  };

  save(OUT_ROOT, "RUNTIME_RESULTS.json", runtime);
  save(DOCS, "RUNTIME_RESULTS.json", runtime);
  save(DOCS, "STAGE1_CALLS.json", callRows);

  // Update aggregate PROMPT_PARITY from first source (representative) + note per-source files.
  const aggregateParity = {
    timestamp: new Date().toISOString(),
    comparison_unit: "PRODUCTION_CONFIG_BUNDLE_COMPARISON",
    FINAL_PROMPT_BYTE_PARITY: "EXPECTED_DIFFERENCE",
    PRODUCTION_ADAPTER_MANIFEST: "RECORDED",
    required_parity_all_sources_pass: Object.values(parityBySource).every(
      (p) => (p as { required_parity_pass?: boolean }).required_parity_pass
    ),
    parity_by_source: parityBySource,
    verdict: "REQUIRED_PARITY_PASS_LIVE_CAPTURE_COMPLETE",
  };
  save(DOCS, "PROMPT_PARITY.json", aggregateParity);

  console.log(
    JSON.stringify(
      {
        status: runtime.status,
        human_review: runtime.human_review,
        api_calls: apiCalls,
        winner_declared: false,
        hidden_map: "SEALED",
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

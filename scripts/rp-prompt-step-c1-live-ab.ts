/**
 * STEP C1 — live layout A/B (production layout vs compact candidate).
 *
 * Only variable: OUTPUT LAYOUT SYSTEM BLOCK.
 * Quality retry / continuation / recovery = 0.
 * Transport abort → same payload reissue once.
 *
 * Usage:
 *   STAGE=cheap node --conditions=react-server --import tsx scripts/rp-prompt-step-c1-live-ab.ts
 *   STAGE=premium node --conditions=react-server --import tsx scripts/rp-prompt-step-c1-live-ab.ts
 */
import { createHash, randomBytes } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const STAGE = (process.env.STAGE ?? "cheap").toLowerCase(); // cheap | premium
const OUT_ROOT =
  process.env.OUT_ROOT ?? "/opt/cursor/artifacts/rp-prompt-step-c1-layout-ab";
const DOCS = process.env.DOCS_DIR ?? "docs/audits/rp-prompt-step-c";
const FIXTURE_DIR =
  process.env.FIXTURE_DIR ??
  "/opt/cursor/artifacts/opus-quality-anchor/fixtures";

type ChatMsg = { role: "user" | "assistant" | "system"; content: string };
type Arm = "A" | "B";
type FixtureId = "D" | "N";

type Cell = {
  id: string;
  fixture: FixtureId;
  arm: Arm;
  modelKey: "Gemini" | "DeepSeek" | "Opus" | "Terra";
  modelId: string;
  characterId: number;
  userInput: string;
  provenance: string;
};

const FIXTURE_PROVENANCE = {
  D: {
    characterId: 18,
    label: "Dialogue / multi-speaker lobby (Like)",
    userInput: "신입 ...맞아.나 본적있어?(갸웃)나는 렌이라고 부르면 돼.",
    provenance:
      "opus-quality-anchor c18 + STEP A/parser + rp-prompt-compression-audit literary short input; greeting already multi-NPC (태형/직원/윤태건 path)",
  },
  N: {
    characterId: 5,
    label: "Narration-dense approach (Northern Duke)",
    userInput:
      "*렌은 조심스레 다가가 무릎을 꿇고 눈높이를 맞춘다.* …괜찮아요? 제가 좀 도와드릴게요.",
    provenance:
      "opus-quality-anchor SCENARIO_MANIFEST rel_conflict T1 — hard quiet/inner/sensory beat used in literary/agency audits",
  },
} as const;

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
  if (ev.usage && typeof ev.usage === "object") {
    state.usage = ev.usage as Record<string, unknown>;
  }
  const choices = ev.choices as Array<Record<string, unknown>> | undefined;
  const choice0 = choices?.[0];
  if (choice0 && typeof choice0.finish_reason === "string") {
    state.finish = choice0.finish_reason;
  }
  const delta = choice0?.delta as Record<string, unknown> | undefined;
  const content =
    typeof delta?.content === "string"
      ? delta.content
      : typeof (choice0?.message as Record<string, unknown> | undefined)
            ?.content === "string"
        ? String((choice0!.message as Record<string, unknown>).content)
        : "";
  if (content) state.text += content;
}

function processSseChunk(
  chunk: string,
  state: StreamState,
  buf: { value: string }
) {
  buf.value += chunk;
  const parts = buf.value.split("\n");
  buf.value = parts.pop() ?? "";
  for (const line of parts) processSseLine(line, state);
}

function flushRemainingSseBuffer(
  dec: TextDecoder,
  buf: { value: string },
  state: StreamState
) {
  const rest = buf.value + dec.decode();
  if (rest.trim()) processSseLine(rest, state);
  buf.value = "";
}

function isTransportAbort(error: string | null, httpStatus: number) {
  if (httpStatus === 0 && error) {
    return /abort|ECONNRESET|socket|fetch failed|network/i.test(error);
  }
  return httpStatus === 502 || httpStatus === 503 || httpStatus === 504;
}

async function streamCi(body: Record<string, unknown>) {
  const {
    CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    buildCheaperInferenceHeaders,
  } = await import("../src/lib/cheaperInferenceConfig");
  const started = Date.now();
  const state: StreamState = {
    text: "",
    finish: null,
    usage: null,
    resolved: null,
    sawDone: false,
  };
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
        : typeof usage.cache_read_input_tokens === "number"
          ? usage.cache_read_input_tokens
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

function countSentences(p: string): number {
  const parts = p
    .replace(/["“”]/g, "")
    .split(/(?<=[.!?。…？！])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return Math.max(1, parts.length);
}

function isDialogueParagraph(p: string): boolean {
  return /^[“"]/.test(p.trim()) || /[“"][^”"\n]+[”"]/.test(p);
}

function layoutMetrics(text: string) {
  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const narration = paras.filter((p) => !isDialogueParagraph(p));
  const dialogue = paras.filter((p) => isDialogueParagraph(p));
  const oneSentenceNarr = narration.filter((p) => countSentences(p) === 1);
  const sameLineViolations = (text.match(
    /[^.!?\n”“"]\s*[“"][^”"\n]+[”"]/g
  ) ?? []).length;
  // narration ending then quote on same paragraph without blank line
  const missingBlank = paras.filter((p) => {
    const hasNarr = /[가-힣A-Za-z]/.test(p.replace(/[“"][^”"]*[”"]/g, ""));
    const hasDlg = /[“"]/.test(p);
    return hasNarr && hasDlg && !/^\s*[“"]/.test(p);
  }).length;
  const midUtteranceFrag = (text.match(
    /[“"][^”"\n]+[”"]\s*\n(?!\n)[^\n“"]+\n(?!\n)\s*[“"]/g
  ) ?? []).length;

  return {
    visible_chars: text.replace(/\s/g, "").length,
    raw_chars: text.length,
    total_paragraphs: paras.length,
    narration_paragraphs: narration.length,
    dialogue_paragraphs: dialogue.length,
    one_sentence_narration_paragraph_count: oneSentenceNarr.length,
    one_sentence_narration_paragraph_ratio:
      narration.length > 0
        ? Math.round((oneSentenceNarr.length / narration.length) * 1000) / 1000
        : 0,
    avg_sentences_per_narration_paragraph:
      narration.length > 0
        ? Math.round(
            (narration.reduce((a, p) => a + countSentences(p), 0) /
              narration.length) *
              100
          ) / 100
        : 0,
    dialogue_to_narration_paragraph_ratio:
      narration.length > 0
        ? Math.round((dialogue.length / narration.length) * 1000) / 1000
        : dialogue.length,
    same_line_narration_dialogue_violations: sameLineViolations + missingBlank,
    missing_blank_line_violations: missingBlank,
    mid_utterance_fragmentation_count: midUtteranceFrag,
  };
}

/** Conservative severe agency alarm — human review remains authority. */
function agencySevereAlarm(text: string, userInput: string): 0 | 1 {
  const userDlg = (userInput.match(/[“"]([^”"]+)[”"]/g) ?? [])
    .map((s) => s.replace(/[“”"]/g, ""))
    .join(" ");
  // Count quoted lines that look like 렌 speaking new content
  const renSpeech = [
    ...text.matchAll(
      /렌(?:은|이|가)?[^.!?\n]{0,24}[“"]([^”"\n]{8,})[”"]/g
    ),
  ].map((m) => m[1] ?? "");
  const novel = renSpeech.filter((s) => s && !userInput.includes(s.slice(0, 12)));
  if (novel.length >= 3) return 1;
  // Long first-person user inner monologue authored by model
  if (
    /렌의 속마음|렌은 생각했다|나는 .+하기로 했다/.test(text) &&
    (text.match(/렌은 생각/g) ?? []).length >= 2
  ) {
    return 1;
  }
  void userDlg;
  return 0;
}

function hardFormatAlarms(m: ReturnType<typeof layoutMetrics>) {
  return {
    same_line_or_missing_blank:
      m.same_line_narration_dialogue_violations > 0 ||
      m.missing_blank_line_violations > 0,
    mid_utterance: m.mid_utterance_fragmentation_count > 2,
    extreme_one_sentence_ratio: m.one_sentence_narration_paragraph_ratio >= 0.85,
  };
}

function loadFixture(characterId: number) {
  const path = join(FIXTURE_DIR, `c${characterId}_fixture.json`);
  if (!existsSync(path)) throw new Error(`missing ${path}`);
  return JSON.parse(readFileSync(path, "utf8")) as {
    character: Record<string, unknown>;
    persona: Record<string, unknown>;
    user: Record<string, unknown>;
  };
}

async function assembleCell(opts: {
  modelId: string;
  fixture: ReturnType<typeof loadFixture>;
  currentUserMessage: string;
  arm: Arm;
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
  const {
    buildWebnovelOutputLayoutRecencyBlock,
    replaceOutputLayoutSystemBlockWithCompactCandidate,
    OUTPUT_LAYOUT_SEMANTIC_COMPACT_CANDIDATE,
    buildCompactTerminalLayoutRecencyLine,
  } = await import("../src/lib/webnovelOutputFormat");
  const { OPUS_ARM_E_TERMINAL } = await import(
    "../src/lib/opusTerminalLengthOwner"
  );
  const { TERRA_TERMINAL_LENGTH_OWNER_CONTRACT } = await import(
    "../src/lib/terraTerminalLengthOwner"
  );
  const { buildOpenRouterKoreanProseTopBlock } = await import(
    "../src/lib/openRouterProsePolicy"
  );
  const { buildNoGodmoddingBlock } = await import("../src/lib/noGodmodding");

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
  const narrativePov = resolveNarrativePov({
    mode: "third_person",
    contentKind: "character",
    mainCharacterName: String(ch.name),
  });
  const built = buildContext({
    charName: String(ch.name),
    chunks,
    userNickname: String(opts.fixture.user.nickname ?? personaName),
    userPersona,
    userNote: "",
    longTermMemory: "",
    shortTermHistory: [
      { role: "user", content: OPENING_TURN_USER },
      { role: "assistant", content: String(ch.greeting ?? "") },
    ],
    currentUserMessage: opts.currentUserMessage,
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
    userId: Number(opts.fixture.user.id ?? 4),
    narrativePov,
  });

  const layoutA = buildWebnovelOutputLayoutRecencyBlock();
  let system = built.systemPrompt;
  if (opts.arm === "B") {
    system = replaceOutputLayoutSystemBlockWithCompactCandidate(system);
  }
  const lastUser = built.history[built.history.length - 1]?.content ?? "";

  // Non-regression checks (payload-level)
  const protectedOk = {
    layout_A_in_arm_A: opts.arm === "A" ? system.includes(layoutA) : true,
    layout_B_in_arm_B:
      opts.arm === "B"
        ? system.includes(OUTPUT_LAYOUT_SEMANTIC_COMPACT_CANDIDATE)
        : true,
    layout_A_absent_in_arm_B:
      opts.arm === "B" ? !system.includes("[DIALOGUE & NARRATION]") : true,
    user_tail_echo: lastUser.includes(buildCompactTerminalLayoutRecencyLine()),
    canon_top: system.includes(buildOpenRouterKoreanProseTopBlock().slice(0, 40)),
    no_godmodding: system.includes(
      buildNoGodmoddingBlock("캐릭터", "렌", "standard").slice(0, 40)
    ),
    opus_arm_e:
      opts.modelId.includes("opus")
        ? lastUser.includes(OPUS_ARM_E_TERMINAL)
        : null,
    terra_terminal:
      opts.modelId.includes("terra")
        ? lastUser.includes(TERRA_TERMINAL_LENGTH_OWNER_CONTRACT)
        : null,
  };

  const wire = assemblePrimaryRpRequest({
    system,
    history: built.history ?? [],
    modelId: opts.modelId,
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
  return {
    requestBody,
    systemSha: sha256(system),
    lastUserSha: sha256(lastUser),
    protectedOk,
    system,
    lastUser,
  };
}

function buildCells(models: Record<string, string>): Cell[] {
  const cells: Cell[] = [];
  for (const [modelKey, modelId] of Object.entries(models) as Array<
    [Cell["modelKey"], string]
  >) {
    for (const fixture of ["D", "N"] as FixtureId[]) {
      for (const arm of ["A", "B"] as Arm[]) {
        const fx = FIXTURE_PROVENANCE[fixture];
        cells.push({
          id: `${modelKey}_${fixture}_${arm}`,
          fixture,
          arm,
          modelKey,
          modelId,
          characterId: fx.characterId,
          userInput: fx.userInput,
          provenance: fx.provenance,
        });
      }
    }
  }
  return cells;
}

async function main() {
  mkdirSync(OUT_ROOT, { recursive: true });
  mkdirSync(DOCS, { recursive: true });
  const {
    CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
    CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
    CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
  } = await import("../src/lib/chatModels");
  const { sanitizeStreamArtifacts } = await import("../src/lib/responseLength");
  const {
    normalizeAiNovelProsePreDisplay,
    applyDisplayParagraphGrouping,
  } = await import("../src/lib/novelParagraphs");
  const { visibleAssistantDisplayText } = await import(
    "../src/lib/chatDisplayLength"
  );
  const { estimateTokens } = await import("../src/lib/tokenEstimate");
  const {
    buildWebnovelOutputLayoutRecencyBlock,
    OUTPUT_LAYOUT_SEMANTIC_COMPACT_CANDIDATE,
  } = await import("../src/lib/webnovelOutputFormat");

  const layoutATok = estimateTokens(buildWebnovelOutputLayoutRecencyBlock());
  const layoutBTok = estimateTokens(OUTPUT_LAYOUT_SEMANTIC_COMPACT_CANDIDATE);

  const models =
    STAGE === "premium"
      ? {
          Opus: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
          Terra: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
        }
      : {
          Gemini: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
          DeepSeek: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        };

  // Premium stage uses hardest fixture only per model (2 A/B pairs = 4 calls)
  const cells =
    STAGE === "premium"
      ? ([
          {
            id: "Opus_D_A",
            fixture: "D" as const,
            arm: "A" as const,
            modelKey: "Opus" as const,
            modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
            characterId: FIXTURE_PROVENANCE.D.characterId,
            userInput: FIXTURE_PROVENANCE.D.userInput,
            provenance: FIXTURE_PROVENANCE.D.provenance,
          },
          {
            id: "Opus_D_B",
            fixture: "D" as const,
            arm: "B" as const,
            modelKey: "Opus" as const,
            modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
            characterId: FIXTURE_PROVENANCE.D.characterId,
            userInput: FIXTURE_PROVENANCE.D.userInput,
            provenance: FIXTURE_PROVENANCE.D.provenance,
          },
          {
            id: "Terra_N_A",
            fixture: "N" as const,
            arm: "A" as const,
            modelKey: "Terra" as const,
            modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
            characterId: FIXTURE_PROVENANCE.N.characterId,
            userInput: FIXTURE_PROVENANCE.N.userInput,
            provenance: FIXTURE_PROVENANCE.N.provenance,
          },
          {
            id: "Terra_N_B",
            fixture: "N" as const,
            arm: "B" as const,
            modelKey: "Terra" as const,
            modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
            characterId: FIXTURE_PROVENANCE.N.characterId,
            userInput: FIXTURE_PROVENANCE.N.userInput,
            provenance: FIXTURE_PROVENANCE.N.provenance,
          },
        ] satisfies Cell[])
      : buildCells(models);

  save(OUT_ROOT, "FIXTURE_PROVENANCE.json", FIXTURE_PROVENANCE);
  save(join(DOCS), "FIXTURE_PROVENANCE.json", FIXTURE_PROVENANCE);

  let successful = 0;
  let transportAborted = 0;
  let qualityRetries = 0;
  let continuations = 0;
  let recoveries = 0;
  const accounting: Record<string, number> = {
    Gemini: 0,
    DeepSeek: 0,
    Opus: 0,
    Terra: 0,
  };
  const rows: Record<string, unknown>[] = [];

  for (const cell of cells) {
    const dir = join(OUT_ROOT, "live", cell.id);
    const rawPath = join(dir, "provider_raw.txt");
    if (existsSync(rawPath) && existsSync(join(dir, "meta.json"))) {
      console.log(`skip existing ${cell.id}`);
      const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
      rows.push(meta);
      successful += 1;
      accounting[cell.modelKey] = (accounting[cell.modelKey] ?? 0) + 1;
      continue;
    }

    const fixture = loadFixture(cell.characterId);
    const assembled = await assembleCell({
      modelId: cell.modelId,
      fixture,
      currentUserMessage: cell.userInput,
      arm: cell.arm,
    });
    if (Object.values(assembled.protectedOk).some((v) => v === false)) {
      throw new Error(
        `protected owner check failed for ${cell.id}: ${JSON.stringify(assembled.protectedOk)}`
      );
    }

    console.log(`\n=== ${cell.id} ${cell.modelId} arm=${cell.arm} ===`);
    let resp = await streamCi(assembled.requestBody);
    if (
      (resp.http_status !== 200 || resp.error || !resp.text.trim()) &&
      isTransportAbort(resp.error, resp.http_status)
    ) {
      transportAborted += 1;
      console.log("transport abort — reissue once");
      resp = await streamCi(assembled.requestBody);
    }
    if (resp.http_status !== 200 || resp.error || !resp.text.trim()) {
      save(dir, "FAIL.json", resp);
      throw new Error(
        `CI fail ${cell.id}: ${resp.error ?? resp.http_status}`
      );
    }

    successful += 1;
    accounting[cell.modelKey] = (accounting[cell.modelKey] ?? 0) + 1;

    const providerRaw = resp.text;
    const preNormalize = sanitizeStreamArtifacts(providerRaw);
    const preDisplay = normalizeAiNovelProsePreDisplay(preNormalize);
    const finalDisplay = visibleAssistantDisplayText(
      applyDisplayParagraphGrouping(preDisplay)
    );
    const rawM = layoutMetrics(providerRaw);
    const finalM = layoutMetrics(finalDisplay);
    const agency = agencySevereAlarm(providerRaw, cell.userInput);
    const alarmsRaw = hardFormatAlarms(rawM);
    const alarmsFinal = hardFormatAlarms(finalM);
    const usage = extractUsage(resp.usage);

    const meta = {
      cell_id: cell.id,
      stage: STAGE,
      fixture: cell.fixture,
      arm: cell.arm,
      modelKey: cell.modelKey,
      modelId: cell.modelId,
      resolved_model: resp.resolved_model,
      character_id: cell.characterId,
      user_input: cell.userInput,
      provenance: cell.provenance,
      layout_system_tokens_arm: cell.arm === "A" ? layoutATok : layoutBTok,
      system_sha256: assembled.systemSha,
      last_user_sha256: assembled.lastUserSha,
      protectedOk: assembled.protectedOk,
      finish_reason: resp.finish_reason,
      saw_done: resp.saw_done,
      latency_s: resp.latency_s,
      retry: 0,
      continuation: 0,
      recovery: 0,
      transport_reissue: transportAborted > 0 ? 1 : 0,
      usage,
      PROVIDER_RAW: rawM,
      FINAL_DISPLAY: finalM,
      agency_severe: agency,
      hard_format_alarms_raw: alarmsRaw,
      hard_format_alarms_final: alarmsFinal,
      markdown_leak:
        /```/.test(providerRaw) ||
        /^\s{0,3}#{1,3}\s/m.test(providerRaw) ||
        /\*\*[^*]+\*\*/.test(providerRaw),
      input_echo_regression:
        providerRaw.includes("[CURRENT USER INPUT]") ||
        providerRaw.includes(cell.userInput.slice(0, 40)),
      raw_hash: sha256(providerRaw),
      final_hash: sha256(finalDisplay),
    };
    save(dir, "provider_raw.txt", providerRaw);
    save(dir, "final_display.txt", finalDisplay);
    save(dir, "meta.json", meta);
    save(dir, "system_sha.txt", assembled.systemSha);
    rows.push(meta);
    console.log({
      id: cell.id,
      chars: rawM.raw_chars,
      paras: rawM.total_paragraphs,
      agency,
      alarmsRaw,
      cost: usage.usage_cost_usd,
      in: usage.input_tokens,
      out: usage.visible_output_tokens,
    });
  }

  const accountingOut = {
    stage: STAGE,
    Gemini_successful_calls: accounting.Gemini ?? 0,
    DeepSeek_successful_calls: accounting.DeepSeek ?? 0,
    Opus_successful_calls: accounting.Opus ?? 0,
    Terra_successful_calls: accounting.Terra ?? 0,
    transport_aborted: transportAborted,
    quality_retries: qualityRetries,
    continuations,
    recoveries,
    successful_total: successful,
    layout_A_tokens: layoutATok,
    layout_B_tokens: layoutBTok,
    reduction: layoutATok - layoutBTok,
    reduction_percent: Number(
      (((layoutATok - layoutBTok) / layoutATok) * 100).toFixed(1)
    ),
  };
  save(OUT_ROOT, `RUNTIME_${STAGE}.json`, { accounting: accountingOut, rows });
  save(DOCS, `06_LIVE_RESULTS_${STAGE}.json`, { accounting: accountingOut, rows });

  // Blind map for this stage (seal before scoring)
  const pairs: Record<string, { X: Arm; Y: Arm }> = {};
  const pairKeys = new Set(
    cells.map((c) => `${c.modelKey}_${c.fixture}`)
  );
  for (const key of pairKeys) {
    const flip = randomBytes(1)[0]! % 2 === 0;
    pairs[key] = flip ? { X: "A", Y: "B" } : { X: "B", Y: "A" };
  }
  const hiddenPath = join(OUT_ROOT, `HIDDEN_MAP_${STAGE}.json`);
  if (!existsSync(hiddenPath)) {
    save(OUT_ROOT, `HIDDEN_MAP_${STAGE}.json`, {
      note: "Reveal only after scoring seal",
      blindMap: pairs,
      arm_meanings: {
        A: "production buildWebnovelOutputLayoutRecencyBlock()",
        B: "OUTPUT_LAYOUT_SEMANTIC_COMPACT_CANDIDATE",
      },
    });
  }
  const hidden = JSON.parse(readFileSync(hiddenPath, "utf8")) as {
    blindMap: Record<string, { X: Arm; Y: Arm }>;
  };

  // Write blind review packs (no arm labels)
  const blindLines: string[] = [
    `# 07_BLIND_REVIEW (${STAGE})`,
    "",
    "Identity hidden. Score before reading `10_REVEAL.md`.",
    "",
  ];
  for (const key of Object.keys(hidden.blindMap)) {
    const map = hidden.blindMap[key]!;
    const [modelKey, fixture] = key.split("_") as [Cell["modelKey"], FixtureId];
    const xMeta = rows.find(
      (r) => r.modelKey === modelKey && r.fixture === fixture && r.arm === map.X
    ) as Record<string, unknown> | undefined;
    const yMeta = rows.find(
      (r) => r.modelKey === modelKey && r.fixture === fixture && r.arm === map.Y
    ) as Record<string, unknown> | undefined;
    if (!xMeta || !yMeta) continue;
    const xRaw = readFileSync(
      join(OUT_ROOT, "live", String(xMeta.cell_id), "provider_raw.txt"),
      "utf8"
    );
    const yRaw = readFileSync(
      join(OUT_ROOT, "live", String(yMeta.cell_id), "provider_raw.txt"),
      "utf8"
    );
    const fx = FIXTURE_PROVENANCE[fixture];
    blindLines.push(`## Pair ${key}`);
    blindLines.push("");
    blindLines.push(`- character_id: ${fx.characterId}`);
    blindLines.push(`- label: ${fx.label}`);
    blindLines.push(`- provenance: ${fx.provenance}`);
    blindLines.push("");
    blindLines.push("### User input");
    blindLines.push("");
    blindLines.push(fx.userInput);
    blindLines.push("");
    blindLines.push("### Output X");
    blindLines.push("");
    blindLines.push(xRaw);
    blindLines.push("");
    blindLines.push("### Output Y");
    blindLines.push("");
    blindLines.push(yRaw);
    blindLines.push("");
    blindLines.push("---");
    blindLines.push("");
  }
  save(DOCS, `07_BLIND_REVIEW_${STAGE}.md`, blindLines.join("\n"));
  save(OUT_ROOT, `07_BLIND_REVIEW_${STAGE}.md`, blindLines.join("\n"));

  console.log(JSON.stringify(accountingOut, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

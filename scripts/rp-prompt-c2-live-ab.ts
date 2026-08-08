/**
 * STEP C2-Micro — live prose A/B (production prose vs C2-Micro candidate).
 *
 * Only variable: COMMON PROSE QUALITY BLOCK (PROSE_STYLE_SECTION).
 * Quality retry / continuation / recovery = 0.
 * Transport abort → same payload reissue once.
 *
 * Usage:
 *   STAGE=cheap node --conditions=react-server --import tsx scripts/rp-prompt-c2-live-ab.ts
 *   STAGE=premium node --conditions=react-server --import tsx scripts/rp-prompt-c2-live-ab.ts
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
  process.env.OUT_ROOT ?? "/opt/cursor/artifacts/rp-prompt-c2-prose-ab";
const DOCS = process.env.DOCS_DIR ?? "docs/audits/rp-prompt-c2";
const FIXTURE_DIR =
  process.env.FIXTURE_DIR ?? "docs/audits/rp-prompt-c2/fixtures";

type Arm = "A" | "B";
type FixtureId = "Q" | "D" | "T";

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
  Q: {
    characterId: 5,
    label: "Quiet / inner / sensory (Northern Duke)",
    userInput:
      "*렌은 조심스레 다가가 무릎을 꿇고 눈높이를 맞춘다.* …괜찮아요? 제가 좀 도와드릴게요.",
    provenance:
      "C1 fixture N provenance — hard quiet/inner/sensory; card reconstructed from seed DB",
  },
  D: {
    characterId: 18,
    label: "Dialogue / multi-speaker lobby (Like)",
    userInput: "신입 ...맞아.나 본적있어?(갸웃)나는 렌이라고 부르면 돼.",
    provenance:
      "C1 fixture D provenance — multi-NPC lobby path; greeting from Terra canary neutral",
  },
  T: {
    characterId: 10,
    label: "Action / tension (Enoch)",
    userInput:
      "*멀리서 비명과 금속 마찰음이 겹친다. 렌은 에녹 쪽으로 몸을 낮춘다.* 저쪽이에요. 같이 가요?",
    provenance:
      "final-production-model-smoke terra_action T1; card reconstructed from d2-enoch",
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
function est(t: string) {
  return Math.max(1, Math.ceil(t.length * 0.9));
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

async function streamOpenRouter(body: Record<string, unknown>) {
  const { OPENROUTER_CHAT_COMPLETIONS_URL, buildOpenRouterHeaders } =
    await import("../src/lib/openRouterConfig");
  const started = Date.now();
  const state: StreamState = {
    text: "",
    finish: null,
    usage: null,
    resolved: null,
    sawDone: false,
  };
  try {
    const res = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: buildOpenRouterHeaders(),
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

function proseMetrics(text: string) {
  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const narration = paras.filter((p) => !isDialogueParagraph(p));
  const dialogue = paras.filter((p) => isDialogueParagraph(p));
  const oneSentenceNarr = narration.filter((p) => countSentences(p) === 1);
  const sentences = text
    .split(/(?<=[.!?。…？！])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const avgSentenceLen =
    sentences.length > 0
      ? Math.round(
          (sentences.reduce((a, s) => a + s.replace(/\s/g, "").length, 0) /
            sentences.length) *
            10
        ) / 10
      : 0;
  return {
    visible_chars: text.replace(/\s/g, "").length,
    raw_chars: text.length,
    total_paragraphs: paras.length,
    narration_paragraphs: narration.length,
    dialogue_paragraphs: dialogue.length,
    dialogue_share:
      paras.length > 0
        ? Math.round((dialogue.length / paras.length) * 1000) / 1000
        : 0,
    one_sentence_narration_ratio:
      narration.length > 0
        ? Math.round((oneSentenceNarr.length / narration.length) * 1000) / 1000
        : 0,
    avg_sentence_length_chars: avgSentenceLen,
  };
}

function agencySevereAlarm(text: string, userInput: string): 0 | 1 {
  const renSpeech = [
    ...text.matchAll(
      /렌(?:은|이|가)?[^.!?\n]{0,24}[“"]([^”"\n]{8,})[”"]/g
    ),
  ].map((m) => m[1] ?? "");
  const novel = renSpeech.filter((s) => s && !userInput.includes(s.slice(0, 12)));
  if (novel.length >= 3) return 1;
  if (
    /렌의 속마음|렌은 생각했다|나는 .+하기로 했다/.test(text) &&
    (text.match(/렌은 생각/g) ?? []).length >= 2
  ) {
    return 1;
  }
  return 0;
}

function incompleteAlarm(text: string, finish: string | null): boolean {
  if (finish === "length") return true;
  const t = text.trim();
  if (t.length < 200) return true;
  if (/[…]{2,}$/.test(t) && t.length < 800) return true;
  if (/(그리고|하지만|그런데)\s*$/.test(t)) return true;
  return false;
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
    PROSE_STYLE_SECTION,
    PROSE_STYLE_SECTION_C2_MICRO,
    PROSE_STYLE_SECTION_C2_MICRO_MARKER,
    replaceProseStyleSectionWithC2MicroCandidate,
  } = await import("../src/lib/advancedProseNsfwGuidelines");
  const { buildWebnovelOutputLayoutRecencyBlock } = await import(
    "../src/lib/webnovelOutputFormat"
  );
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
    system = replaceProseStyleSectionWithC2MicroCandidate(system);
  }
  const lastUser = built.history[built.history.length - 1]?.content ?? "";

  const protectedOk = {
    layout_A_present: system.includes(layoutA.slice(0, 40)),
    prose_A_in_arm_A:
      opts.arm === "A" ? system.includes(PROSE_STYLE_SECTION) : true,
    prose_B_in_arm_B:
      opts.arm === "B"
        ? system.includes(PROSE_STYLE_SECTION_C2_MICRO) &&
          system.includes(PROSE_STYLE_SECTION_C2_MICRO_MARKER)
        : true,
    prose_A_absent_in_arm_B:
      opts.arm === "B" ? !system.includes(PROSE_STYLE_SECTION) : true,
    canon_top: system.includes(buildOpenRouterKoreanProseTopBlock().slice(0, 40)),
    no_godmodding: system.includes(
      buildNoGodmoddingBlock("캐릭터", "렌", "standard").slice(0, 40)
    ),
    opus_arm_e: opts.modelId.includes("opus")
      ? lastUser.includes(OPUS_ARM_E_TERMINAL)
      : null,
    terra_terminal: opts.modelId.includes("terra")
      ? lastUser.includes(TERRA_TERMINAL_LENGTH_OWNER_CONTRACT)
      : null,
  };

  const wire = assemblePrimaryRpRequest({
    system,
    history: built.history ?? [],
    modelId: opts.modelId,
    targetResponseChars: 3200,
    messageOpts: {
      transportProvider: "openrouter",
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
    for (const fixture of ["Q", "D", "T"] as FixtureId[]) {
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
    OPENROUTER_GEMINI_31_PRO_MODEL,
    OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
    CLAUDE_OPUS_MODEL,
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
  const {
    buildAdvancedProseNsfwGuidelines,
    buildAdvancedProseNsfwGuidelinesC2Micro,
  } = await import("../src/lib/advancedProseNsfwGuidelines");

  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    throw new Error("OPENROUTER_API_KEY is required for C2 live A/B");
  }

  const proseATok = est(
    buildAdvancedProseNsfwGuidelines({ nsfwEnabled: true })
  );
  const proseBTok = est(
    buildAdvancedProseNsfwGuidelinesC2Micro({ nsfwEnabled: true })
  );

  const models =
    STAGE === "premium"
      ? {
          Opus: CLAUDE_OPUS_MODEL,
          Terra: "openai/gpt-5.6", // fallback OR slug if terra CI unavailable
        }
      : {
          Gemini: OPENROUTER_GEMINI_31_PRO_MODEL,
          DeepSeek: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
        };

  // Stage 2: Opus Q+T (or D), Terra hardest Q — per mission
  const cells =
    STAGE === "premium"
      ? ([
          {
            id: "Opus_Q_A",
            fixture: "Q" as const,
            arm: "A" as const,
            modelKey: "Opus" as const,
            modelId: CLAUDE_OPUS_MODEL,
            characterId: FIXTURE_PROVENANCE.Q.characterId,
            userInput: FIXTURE_PROVENANCE.Q.userInput,
            provenance: FIXTURE_PROVENANCE.Q.provenance,
          },
          {
            id: "Opus_Q_B",
            fixture: "Q" as const,
            arm: "B" as const,
            modelKey: "Opus" as const,
            modelId: CLAUDE_OPUS_MODEL,
            characterId: FIXTURE_PROVENANCE.Q.characterId,
            userInput: FIXTURE_PROVENANCE.Q.userInput,
            provenance: FIXTURE_PROVENANCE.Q.provenance,
          },
          {
            id: "Opus_T_A",
            fixture: "T" as const,
            arm: "A" as const,
            modelKey: "Opus" as const,
            modelId: CLAUDE_OPUS_MODEL,
            characterId: FIXTURE_PROVENANCE.T.characterId,
            userInput: FIXTURE_PROVENANCE.T.userInput,
            provenance: FIXTURE_PROVENANCE.T.provenance,
          },
          {
            id: "Opus_T_B",
            fixture: "T" as const,
            arm: "B" as const,
            modelKey: "Opus" as const,
            modelId: CLAUDE_OPUS_MODEL,
            characterId: FIXTURE_PROVENANCE.T.characterId,
            userInput: FIXTURE_PROVENANCE.T.userInput,
            provenance: FIXTURE_PROVENANCE.T.provenance,
          },
          {
            id: "Terra_Q_A",
            fixture: "Q" as const,
            arm: "A" as const,
            modelKey: "Terra" as const,
            modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
            characterId: FIXTURE_PROVENANCE.Q.characterId,
            userInput: FIXTURE_PROVENANCE.Q.userInput,
            provenance: FIXTURE_PROVENANCE.Q.provenance,
          },
          {
            id: "Terra_Q_B",
            fixture: "Q" as const,
            arm: "B" as const,
            modelKey: "Terra" as const,
            modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
            characterId: FIXTURE_PROVENANCE.Q.characterId,
            userInput: FIXTURE_PROVENANCE.Q.userInput,
            provenance: FIXTURE_PROVENANCE.Q.provenance,
          },
        ] satisfies Cell[])
      : buildCells(models);

  // Terra on OpenRouter may not exist — if CI key missing, skip Terra in premium
  // (handled at call time). Cheap stage uses OR Gemini/DeepSeek only.

  save(OUT_ROOT, "FIXTURE_PROVENANCE.json", FIXTURE_PROVENANCE);
  save(DOCS, "FIXTURE_PROVENANCE.json", FIXTURE_PROVENANCE);

  let successful = 0;
  let transportAborted = 0;
  let transportReissues = 0;
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

    // Premium Terra requires CI; if unavailable, mark NOT_RUN and continue
    if (
      cell.modelKey === "Terra" &&
      !process.env.CHEAPER_INFERENCE_API_KEY?.trim()
    ) {
      save(dir, "NOT_RUN.json", {
        reason: "CHEAPER_INFERENCE_API_KEY empty — Terra unavailable on OpenRouter",
      });
      console.log(`NOT_RUN ${cell.id} (no CI key for Terra)`);
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
    let resp = await streamOpenRouter(assembled.requestBody);
    let reissued = 0;
    if (
      (resp.http_status !== 200 || resp.error || !resp.text.trim()) &&
      isTransportAbort(resp.error, resp.http_status)
    ) {
      transportAborted += 1;
      reissued = 1;
      transportReissues += 1;
      console.log("transport abort — reissue once");
      resp = await streamOpenRouter(assembled.requestBody);
    }
    if (resp.http_status !== 200 || resp.error || !resp.text.trim()) {
      save(dir, "FAIL.json", resp);
      throw new Error(`OR fail ${cell.id}: ${resp.error ?? resp.http_status}`);
    }

    successful += 1;
    accounting[cell.modelKey] = (accounting[cell.modelKey] ?? 0) + 1;

    const providerRaw = resp.text;
    const preNormalize = sanitizeStreamArtifacts(providerRaw);
    const preDisplay = normalizeAiNovelProsePreDisplay(preNormalize);
    const finalDisplay = visibleAssistantDisplayText(
      applyDisplayParagraphGrouping(preDisplay)
    );
    const rawM = proseMetrics(providerRaw);
    const finalM = proseMetrics(finalDisplay);
    const agency = agencySevereAlarm(providerRaw, cell.userInput);
    const incomplete = incompleteAlarm(providerRaw, resp.finish_reason);
    const usage = extractUsage(resp.usage);
    const metadataLeak =
      /```/.test(providerRaw) ||
      /^\s{0,3}#{1,3}\s/m.test(providerRaw) ||
      /\[CURRENT USER INPUT\]/.test(providerRaw) ||
      /\[OUTPUT LAYOUT\]/.test(providerRaw);
    const inputEcho =
      providerRaw.includes("[CURRENT USER INPUT]") ||
      (cell.userInput.length >= 20 &&
        providerRaw.includes(cell.userInput.slice(0, 24)));

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
      prose_system_tokens_arm: cell.arm === "A" ? proseATok : proseBTok,
      system_sha256: assembled.systemSha,
      last_user_sha256: assembled.lastUserSha,
      protectedOk: assembled.protectedOk,
      finish_reason: resp.finish_reason,
      saw_done: resp.saw_done,
      latency_s: resp.latency_s,
      retry: 0,
      continuation: 0,
      recovery: 0,
      transport_reissue: reissued,
      usage,
      PROVIDER_RAW: rawM,
      FINAL_DISPLAY: finalM,
      agency_severe: agency,
      incomplete,
      metadata_leak: metadataLeak,
      input_echo_regression: inputEcho,
      raw_hash: sha256(providerRaw),
      final_hash: sha256(finalDisplay),
    };
    save(dir, "provider_raw.txt", providerRaw);
    save(dir, "final_display.txt", finalDisplay);
    save(dir, "meta.json", meta);
    rows.push(meta);
    console.log({
      id: cell.id,
      chars: rawM.visible_chars,
      paras: rawM.total_paragraphs,
      agency,
      incomplete,
      echo: inputEcho,
      in: usage.input_tokens,
      cached: usage.cached_input_tokens,
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
    transport_reissues: transportReissues,
    quality_retries: 0,
    continuations: 0,
    recoveries: 0,
    successful_total: successful,
    prose_A_tokens: proseATok,
    prose_B_tokens: proseBTok,
    reduction: proseATok - proseBTok,
    reduction_percent: Number(
      (((proseATok - proseBTok) / proseATok) * 100).toFixed(1)
    ),
  };
  save(OUT_ROOT, `RUNTIME_${STAGE}.json`, { accounting: accountingOut, rows });
  save(DOCS, `05_LIVE_RESULTS_${STAGE}.json`, { accounting: accountingOut, rows });

  // Blind map seal
  const pairs: Record<string, { X: Arm; Y: Arm }> = {};
  const pairKeys = new Set(cells.map((c) => `${c.modelKey}_${c.fixture}`));
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
        A: "production PROSE_STYLE_SECTION",
        B: "PROSE_STYLE_SECTION_C2_MICRO (M1+M2 only)",
      },
    });
  }
  const hidden = JSON.parse(readFileSync(hiddenPath, "utf8")) as {
    blindMap: Record<string, { X: Arm; Y: Arm }>;
  };
  save(DOCS, "08_HIDDEN_MAP.json", hidden);

  const blindLines: string[] = [
    `# 06_BLIND_REVIEW (${STAGE})`,
    "",
    "Identity hidden. Score before reading `09_REVEAL.md`.",
    "",
    "Human score /100:",
    "- 문장 리듬 / 문장 선택 15",
    "- 문학적 이미지의 정확성 10",
    "- 감각의 구체성 10",
    "- 내면의 자연스러운 연속성 10",
    "- 캐릭터 고유성 15",
    "- 장면 밀도 10",
    "- NPC/환경의 살아 있는 움직임 10",
    "- 대사의 자연스러움 5",
    "- 과설명·AI문체 억제 10",
    "- 완성도 5",
    "",
    "PREFERRED = X / Y / TIE",
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
  save(DOCS, `06_BLIND_REVIEW_${STAGE}.md`, blindLines.join("\n"));
  save(OUT_ROOT, `06_BLIND_REVIEW_${STAGE}.md`, blindLines.join("\n"));
  save(DOCS, "05_LIVE_RESULTS.md", [
    `# 05_LIVE_RESULTS (${STAGE})`,
    "",
    "See `05_LIVE_RESULTS_" + STAGE + ".json` for machine rows.",
    "",
    "```json",
    JSON.stringify(accountingOut, null, 2),
    "```",
    "",
  ].join("\n"));

  console.log(JSON.stringify(accountingOut, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

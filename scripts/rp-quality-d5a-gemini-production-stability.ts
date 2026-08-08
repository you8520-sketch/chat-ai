/**
 * Phase D5-A — Gemini 3.1 Pro production-A stability root-cause audit.
 *
 * PROMPT CHANGE = 0
 * OWNER REWRITE = 0
 * NEW RULE = 0
 * PRODUCTION WIRE = 0
 * D5-B = NOT_RUN
 *
 * Sole question: with BYTE-IDENTICAL production A payload, how large is
 * Gemini 3.1 Pro length/quality variance across 3 draws × G5/G6-T1/G3?
 *
 *   node --conditions=react-server --import tsx scripts/rp-quality-d5a-gemini-production-stability.ts
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

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const OUT_ROOT =
  process.env.OUT_ROOT ??
  "/opt/cursor/artifacts/rp-quality-d5a-production-stability";
const DOCS =
  process.env.DOCS_DIR ?? "docs/audits/rp-gemini-production-stability-d5a";
const RAW_DOCS = join(DOCS, "d5a", "raw");
const FIXTURE_DIR = "docs/audits/rp-quality-v2-gemini/fixtures";
const DRAWS = 3;

type FixtureId = "G5" | "G6T1" | "G3";

type FixtureSpec = {
  id: FixtureId;
  characterId: number;
  userInput: string;
  provenance: string;
  measures: string[];
};

const FIXTURES: FixtureSpec[] = [
  {
    id: "G5",
    characterId: 10,
    userInput: "누구세요? …방금 그 소리는 뭐였죠?",
    provenance:
      "D5-A G5 — short Turn-1 after greeting already established shutter/ruins event (Enoch)",
    measures: [
      "INTRO_REPLAY",
      "SETTING_RECITAL",
      "CURRENT_INPUT_REPLAY",
      "SCENE_ADVANCEMENT",
      "NEW_SCENE_VALUE",
    ],
  },
  {
    id: "G6T1",
    characterId: 10,
    userInput:
      "*멀리서 비명과 금속 마찰음이 겹친다. 렌은 에녹 쪽으로 몸을 낮춘다.* 저쪽이에요. 같이 가요?",
    provenance:
      "D5-A G6-T1 — user completes env/action/speech; measure CURRENT_INPUT restage",
    measures: [
      "CURRENT_INPUT_REPLAY",
      "SCENE_ADVANCEMENT",
      "NEW_SCENE_VALUE",
      "visible_chars",
    ],
  },
  {
    id: "G3",
    characterId: 10,
    userInput:
      "*렌이 권총을 꺼내 방아쇠에 손가락을 건다.* 저쪽 소리 나는 데 한 발 쏘면 흩어지지 않을까요?",
    provenance:
      "D5-A G3 — canon-required: 총성=죽음 / 통제형 에녹 must refuse gunshot",
    measures: [
      "ACTIVE_CANON_USE",
      "CHARACTER_FIDELITY",
      "SETTING_RECITAL",
      "SCENE_ADVANCEMENT",
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
  if (typeof ev.id === "string" && !state.generationId) {
    state.generationId = ev.id;
  }
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
        error: errText.slice(0, 500),
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

function loadFixture(characterId: number) {
  const path = join(FIXTURE_DIR, `c${characterId}_fixture.json`);
  return JSON.parse(readFileSync(path, "utf8")) as {
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
  const promptDetails =
    (usage.prompt_tokens_details as Record<string, unknown> | undefined) ?? {};
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
    prompt_tokens_details: promptDetails,
    completion_tokens_details: details,
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
    // Question / request / proposal markers in spoken lines.
    const hits =
      d.match(
        /[?？]|까요|래요|세요|할까요|할까요\?|어때|어떡|가자|가요|해줘|해줄래|와줄|와 줄|같이|그만|멈춰|들어|말해|설명해|알려/
      ) != null;
    // Count each dialogue paragraph that poses a distinct ask.
    if (hits || /[!！]$/.test(d) && /해|가|와|봐|들어/.test(d)) {
      count += 1;
      if (samples.length < 8) samples.push(d.slice(0, 80));
    }
  }
  // Also count bare interrogative narration prompts that demand a user answer.
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

async function assembleProductionA(opts: {
  modelId: string;
  fixture: ReturnType<typeof loadFixture>;
  spec: FixtureSpec;
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

  const ch = { ...opts.fixture.character };
  const persona = { ...opts.fixture.persona };
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
  const greeting = String(ch.greeting ?? "");
  const built = buildContext({
    charName: String(ch.name),
    chunks,
    userNickname: String(opts.fixture.user.nickname ?? personaName),
    userPersona,
    userNote: "",
    longTermMemory: "",
    shortTermHistory: [
      { role: "user", content: OPENING_TURN_USER },
      { role: "assistant", content: greeting },
    ],
    currentUserMessage: opts.spec.userInput,
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
  const messagesCanonical = JSON.stringify(messages);

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
      text: opts.spec.userInput,
    },
    {
      bucket: "MEMORY",
      text: "",
    },
  ];

  return {
    requestBody: body,
    systemSha: sha256(String(systemMsg?.content ?? built.systemPrompt)),
    messagesSha: sha256(messagesCanonical),
    userTailSha: sha256(String(lastUser?.content ?? "")),
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
      frequency_penalty: body.frequency_penalty ?? null,
      presence_penalty: body.presence_penalty ?? null,
      provider: body.provider ?? null,
    },
  };
}

function writeRawMd(opts: {
  cellId: string;
  fixture: FixtureId;
  draw: number;
  modelId: string;
  finish: string | null;
  text: string;
  userInput: string;
  visibleChars: number;
}) {
  const name = `${opts.fixture}_D${opts.draw}.md`;
  const body = [
    `# ${opts.cellId}`,
    "",
    `- fixture: ${opts.fixture}`,
    `- draw: ${opts.draw}`,
    `- arm: A (production BYTE-IDENTICAL)`,
    `- model: ${opts.modelId}`,
    `- finish_reason: ${opts.finish ?? "null"}`,
    `- visible_chars_no_ws: ${opts.visibleChars}`,
    "",
    "## user_input",
    "",
    "```text",
    opts.userInput,
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

async function main() {
  mkdirSync(OUT_ROOT, { recursive: true });
  mkdirSync(join(DOCS, "d5a"), { recursive: true });
  mkdirSync(RAW_DOCS, { recursive: true });

  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    throw new Error("OPENROUTER_API_KEY required for D5-A live baseline");
  }

  const { OPENROUTER_GEMINI_31_PRO_MODEL } = await import(
    "../src/lib/chatModels"
  );
  const { sanitizeStreamArtifacts } = await import("../src/lib/responseLength");
  const {
    normalizeAiNovelProsePreDisplay,
    applyDisplayParagraphGrouping,
  } = await import("../src/lib/novelParagraphs");
  const { visibleAssistantDisplayText } = await import(
    "../src/lib/chatDisplayLength"
  );

  const modelId = OPENROUTER_GEMINI_31_PRO_MODEL;

  save(join(DOCS, "d5a"), "00_FIXTURE_PROVENANCE.json", {
    fixtures: FIXTURES,
    modelId,
    draws_per_fixture: DRAWS,
    total_target_calls: FIXTURES.length * DRAWS,
    production_prompt: "BYTE_IDENTICAL",
    prompt_delta: 0,
    owner_rewrite: 0,
    new_rule: 0,
    quality_retry: 0,
    continuation: 0,
    recovery: 0,
    d2_d3_d4_candidates: "NOT_USED",
    d5b: "NOT_RUN",
  });

  let apiCalls = 0;
  const rows: Record<string, unknown>[] = [];
  const fingerprints: Record<string, unknown>[] = [];

  for (const spec of FIXTURES) {
    const fixture = loadFixture(spec.characterId);
    // Assemble once; reuse BYTE-IDENTICAL payload for all draws.
    const assembled = await assembleProductionA({
      modelId,
      fixture,
      spec,
    });
    fingerprints.push({
      fixture: spec.id,
      system_sha256: assembled.systemSha,
      messages_sha256: assembled.messagesSha,
      user_tail_sha256: assembled.userTailSha,
      generation_config: assembled.generationConfig,
    });

    for (let draw = 1; draw <= DRAWS; draw++) {
      const cellId = `Gemini_${spec.id}_A_D${draw}`;
      const dir = join(OUT_ROOT, "live", cellId);
      const rawPath = join(dir, "provider_raw.txt");

      let providerRaw: string;
      let meta: Record<string, unknown>;

      if (existsSync(rawPath) && existsSync(join(dir, "meta.json"))) {
        console.log(`skip existing ${cellId}`);
        providerRaw = readFileSync(rawPath, "utf8");
        meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
      } else {
        console.log(
          `\n=== ${cellId} production A draw=${draw}/${DRAWS} messagesSha=${assembled.messagesSha.slice(0, 12)} ===`
        );
        let resp = await streamOpenRouter(assembled.requestBody);
        let reissued = 0;
        if (
          (resp.http_status !== 200 || resp.error || !resp.text.trim()) &&
          isTransportAbort(resp.error, resp.http_status)
        ) {
          reissued = 1;
          console.log("transport abort — reissue once (same payload)");
          resp = await streamOpenRouter(assembled.requestBody);
        }
        if (resp.http_status !== 200 || resp.error || !resp.text.trim()) {
          save(dir, "FAIL.json", resp);
          throw new Error(`OR fail ${cellId}: ${resp.error ?? resp.http_status}`);
        }
        apiCalls += 1;
        providerRaw = resp.text;
        const preNormalize = sanitizeStreamArtifacts(providerRaw);
        const preDisplay = normalizeAiNovelProsePreDisplay(preNormalize);
        const finalDisplay = visibleAssistantDisplayText(
          applyDisplayParagraphGrouping(preDisplay)
        );
        const tokens = usageTokens(resp.usage);
        meta = {
          cell_id: cellId,
          fixture: spec.id,
          draw,
          arm: "A",
          production_prompt: "BYTE_IDENTICAL",
          prompt_delta: 0,
          model_identifier: modelId,
          resolved_model: resp.resolved_model,
          provider: resp.provider,
          provider_generation_id: resp.generation_id,
          response_headers: resp.response_headers,
          finish_reason: resp.finish_reason,
          saw_done: resp.saw_done,
          latency_s: resp.latency_s,
          transport_reissue: reissued,
          quality_retry: 0,
          continuation: 0,
          recovery: 0,
          system_sha256: assembled.systemSha,
          messages_sha256: assembled.messagesSha,
          user_tail_sha256: assembled.userTailSha,
          generation_config: assembled.generationConfig,
          usage_raw: resp.usage,
          ...tokens,
          incomplete:
            !!resp.finish_reason &&
            resp.finish_reason !== "stop" &&
            resp.finish_reason !== "end_turn",
          visible_chars_no_ws: providerRaw.replace(/\s+/g, "").length,
        };
        save(dir, "provider_raw.txt", providerRaw);
        save(dir, "final_display.txt", finalDisplay);
        save(dir, "meta.json", meta);
        save(dir, "request_fingerprint.json", {
          system_sha256: assembled.systemSha,
          messages_sha256: assembled.messagesSha,
          user_tail_sha256: assembled.userTailSha,
          generation_config: assembled.generationConfig,
        });
      }

      writeRawMd({
        cellId,
        fixture: spec.id,
        draw,
        modelId: String(meta.model_identifier ?? modelId),
        finish: (meta.finish_reason as string) ?? null,
        text: providerRaw,
        userInput: spec.userInput,
        visibleChars: Number(meta.visible_chars_no_ws ?? 0),
      });

      const vector = computeRpQualityVectorV2({
        text: providerRaw,
        providerRaw,
        finishReason: (meta.finish_reason as string) ?? null,
        sawDone: (meta.saw_done as boolean) ?? null,
        incomplete: (meta.incomplete as boolean) ?? null,
        currentUserInput: spec.userInput,
        priorAssistantText: assembled.greeting,
        greetingOrIntroText: assembled.greeting,
        settingSources: assembled.settingSources,
      });
      const anchors = scoreResponseAnchorCount(providerRaw);
      const fnLoad = scoreDialogueFunctionLoad(providerRaw);
      const maxBlock = maxDialogueBlockChars(providerRaw);

      rows.push({
        cell_id: cellId,
        fixture: spec.id,
        draw,
        measures: spec.measures,
        visible_chars: vector.length.visible_chars_no_whitespace,
        length_band: vector.length.length_band,
        dialogue_chars: vector.composition.dialogue_chars,
        narration_chars: vector.composition.narration_chars,
        dialogue_char_share: vector.composition.dialogue_char_share,
        dialogue_share_band: dialogueShareBand(
          vector.composition.dialogue_char_share
        ),
        same_speaker_dialogue_fragments:
          vector.dialogue_fragmentation.same_speaker_dialogue_fragments,
        max_dialogue_block_chars: maxBlock,
        max_consecutive_short_dialogue_run:
          vector.dialogue_fragmentation.max_consecutive_short_dialogue_run,
        response_anchor: anchors,
        dialogue_function_load: fnLoad,
        continuity: vector.continuity,
        setting_exact_overlap: vector.setting_exact_overlap,
        hard_alarms: vector.hard_alarms,
        review_flags: vector.review_flags,
        finish_reason: meta.finish_reason,
        incomplete: meta.incomplete,
        latency_s: meta.latency_s,
        provider: meta.provider,
        provider_generation_id: meta.provider_generation_id,
        input_tokens: meta.input_tokens,
        output_tokens: meta.output_tokens,
        reasoning_tokens: meta.reasoning_tokens,
        system_sha256: meta.system_sha256,
        messages_sha256: meta.messages_sha256,
        generation_config: meta.generation_config,
        human_pending: {
          CURRENT_INPUT_REPLAY: "PENDING_AGENT_REVIEW",
          INTRO_REPLAY: "PENDING_AGENT_REVIEW",
          RECENT_SCENE_REPLAY: "PENDING_AGENT_REVIEW",
          SETTING_RECITAL: "PENDING_AGENT_REVIEW",
          ACTIVE_CANON_USE: "PENDING_AGENT_REVIEW",
          CHARACTER_FIDELITY: "PENDING_AGENT_REVIEW",
          SCENE_ADVANCEMENT: "PENDING_AGENT_REVIEW",
          NEW_SCENE_VALUE: "PENDING_AGENT_REVIEW",
          COMPLETION: "PENDING_AGENT_REVIEW",
        },
      });
    }
  }

  // Fingerprint invariance: all draws of a fixture must share messages SHA.
  const shaByFixture: Record<string, Set<string>> = {};
  for (const r of rows) {
    const f = String(r.fixture);
    shaByFixture[f] ??= new Set();
    shaByFixture[f]!.add(String(r.messages_sha256));
  }
  const fingerprintOk = Object.values(shaByFixture).every((s) => s.size === 1);

  const allChars = rows.map((r) => Number(r.visible_chars));
  const lengthDist = {
    n: allChars.length,
    min: Math.min(...allChars),
    max: Math.max(...allChars),
    mean: mean(allChars),
    median: median(allChars),
    max_min_ratio:
      Math.min(...allChars) > 0
        ? Math.max(...allChars) / Math.min(...allChars)
        : null,
    rate_ge_3200: allChars.filter((c) => c >= 3200).length / allChars.length,
    rate_ge_3000: allChars.filter((c) => c >= 3000).length / allChars.length,
    rate_2400_2999:
      allChars.filter((c) => c >= 2400 && c < 3000).length / allChars.length,
    rate_1800_2399:
      allChars.filter((c) => c >= 1800 && c < 2400).length / allChars.length,
    rate_lt_1800: allChars.filter((c) => c < 1800).length / allChars.length,
  };

  const byFixture: Record<string, unknown> = {};
  let intrinsicHigh = false;
  for (const spec of FIXTURES) {
    const fr = rows.filter((r) => r.fixture === spec.id);
    const chars = fr.map((r) => Number(r.visible_chars));
    const ratio =
      Math.min(...chars) > 0 ? Math.max(...chars) / Math.min(...chars) : 0;
    const hasLong = chars.some((c) => c >= 3000);
    const hasCollapse = chars.some((c) => c < 1800);
    if (ratio >= 1.8 || (hasLong && hasCollapse)) intrinsicHigh = true;
    byFixture[spec.id] = {
      chars_draw: chars,
      min: Math.min(...chars),
      max: Math.max(...chars),
      mean: mean(chars),
      median: median(chars),
      max_min_ratio: ratio,
      has_ge_3000_and_lt_1800: hasLong && hasCollapse,
      dialogue_char_share: fr.map((r) => r.dialogue_char_share),
      fragmentation: fr.map((r) => r.same_speaker_dialogue_fragments),
      response_anchor_count: fr.map(
        (r) => (r.response_anchor as { response_anchor_count: number }).response_anchor_count
      ),
      dialogue_function_load: fr.map(
        (r) =>
          (r.dialogue_function_load as { dialogue_function_load: number })
            .dialogue_function_load
      ),
      providers: fr.map((r) => r.provider),
      generation_ids: fr.map((r) => r.provider_generation_id),
      finish_reasons: fr.map((r) => r.finish_reason),
      latencies_s: fr.map((r) => r.latency_s),
    };
  }

  const providers = new Set(
    rows.map((r) => String(r.provider ?? "unknown")).filter(Boolean)
  );

  const summary = {
    phase: "D5-A",
    model: modelId,
    production_prompt: "BYTE_IDENTICAL",
    prompt_delta: 0,
    owner_rewrite: 0,
    new_rule: 0,
    api_calls_this_run: apiCalls,
    stage1_target: FIXTURES.length * DRAWS,
    stage1_cells: rows.length,
    fingerprint_byte_identical_ok: fingerprintOk,
    fingerprints,
    length_distribution_overall: lengthDist,
    by_fixture: byFixture,
    GEMINI_INTRINSIC_LENGTH_VARIANCE: intrinsicHigh ? "HIGH" : "NOT_HIGH",
    provider_set: [...providers],
    d5b: "NOT_RUN",
    production_wire: "NOT_RUN",
    merge: "NOT_RUN",
    rows,
  };

  save(join(DOCS, "d5a"), "00_FINGERPRINTS.json", {
    fingerprint_byte_identical_ok: fingerprintOk,
    cells: fingerprints,
  });
  save(join(DOCS, "d5a"), "01_STAGE1_LIVE.json", summary);
  save(
    join(DOCS, "d5a"),
    "01_STAGE1_LIVE.md",
    [
      "# D5-A Stage1 Live — Gemini production-A stability baseline",
      "",
      `API calls this run: **${apiCalls}** / target ${FIXTURES.length * DRAWS}`,
      "",
      "Production prompt: BYTE_IDENTICAL (prompt delta 0, owner rewrite 0).",
      "quality retry / continuation / recovery = 0.",
      "",
      "```json",
      JSON.stringify(
        {
          GEMINI_INTRINSIC_LENGTH_VARIANCE:
            summary.GEMINI_INTRINSIC_LENGTH_VARIANCE,
          length_distribution_overall: lengthDist,
          by_fixture: Object.fromEntries(
            Object.entries(byFixture).map(([k, v]) => {
              const x = v as {
                chars_draw: number[];
                min: number;
                max: number;
                median: number;
                max_min_ratio: number;
              };
              return [
                k,
                {
                  chars_draw: x.chars_draw,
                  min: x.min,
                  max: x.max,
                  median: x.median,
                  max_min_ratio: x.max_min_ratio,
                },
              ];
            })
          ),
        },
        null,
        2
      ),
      "```",
      "",
    ].join("\n")
  );

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

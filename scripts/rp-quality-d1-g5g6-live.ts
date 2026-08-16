/**
 * Phase D1 — minimal G5/G6 continuity live baseline.
 *
 * Production prompts only (no prose ablation arms).
 * Models: Gemini 3.1 Pro + DeepSeek V4 Pro
 *
 * G5: greeting in history + short user turn (1 call / model) — optional;
 *     prefer reusing C2 stored A-arm cells; set RUN_G5=1 to force live.
 * G6: turn1 assistant event → turn2 short user (2 calls / model)
 *
 * Budget default: G6 only = 4 successful calls.
 *
 *   node --conditions=react-server --import tsx scripts/rp-quality-d1-g5g6-live.ts
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
import { computeRpQualityVectorV2 } from "../src/lib/rpQualityVector";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const OUT_ROOT =
  process.env.OUT_ROOT ?? "/opt/cursor/artifacts/rp-quality-d1-g5g6";
const DOCS = process.env.DOCS_DIR ?? "docs/audits/rp-quality-v2-gemini";
const FIXTURE_DIR = join(DOCS, "fixtures");
const RUN_G5 = process.env.RUN_G5 === "1";
const RUN_G6 = process.env.RUN_G6 !== "0";

type ModelKey = "Gemini" | "DeepSeek";

const G5 = {
  id: "G5",
  characterId: 10,
  userInput: "누구세요? …방금 그 소리는 뭐였죠?",
  provenance: "D1 G5 — short Turn-1 reaction after greeting event (Enoch)",
} as const;

const G6 = {
  id: "G6",
  characterId: 10,
  turn1User:
    "*멀리서 비명과 금속 마찰음이 겹친다. 렌은 에녹 쪽으로 몸을 낮춘다.* 저쪽이에요. 같이 가요?",
  turn2User: "알겠어요. …그럼 어디로요?",
  provenance: "D1 G6 — Turn1 event then short Turn2 reaction (Enoch / terra_action T1)",
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
    sawDone: false,
  };
  try {
    const res = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: buildOpenRouterHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text();
      return {
        http_status: res.status,
        error: errText.slice(0, 500),
        text: "",
        finish_reason: null as string | null,
        usage: null as Record<string, unknown> | null,
        resolved_model: null as string | null,
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

async function assembleCell(opts: {
  modelId: string;
  fixture: ReturnType<typeof loadFixture>;
  currentUserMessage: string;
  /** Extra completed turns after greeting (user/assistant pairs). */
  extraHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  completedTurns?: number;
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
  const shortTermHistory: Array<{ role: "user" | "assistant"; content: string }> =
    [
      { role: "user", content: OPENING_TURN_USER },
      { role: "assistant", content: String(ch.greeting ?? "") },
      ...(opts.extraHistory ?? []),
    ];
  const built = buildContext({
    charName: String(ch.name),
    chunks,
    userNickname: String(opts.fixture.user.nickname ?? personaName),
    userPersona,
    userNote: "",
    longTermMemory: "",
    shortTermHistory,
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
    completedTurns: opts.completedTurns ?? 0,
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
  return {
    requestBody: {
      ...(wire.requestBody as Record<string, unknown>),
      stream: true,
      stream_options: { include_usage: true },
    },
    systemSha: sha256(built.systemPrompt),
    greeting: String(ch.greeting ?? ""),
  };
}

async function callOnce(opts: {
  cellId: string;
  modelKey: ModelKey;
  modelId: string;
  requestBody: Record<string, unknown>;
}) {
  const dir = join(OUT_ROOT, "live", opts.cellId);
  const rawPath = join(dir, "provider_raw.txt");
  if (existsSync(rawPath) && existsSync(join(dir, "meta.json"))) {
    console.log(`skip existing ${opts.cellId}`);
    return {
      skipped: true,
      text: readFileSync(rawPath, "utf8"),
      meta: JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as Record<
        string,
        unknown
      >,
    };
  }

  console.log(`\n=== ${opts.cellId} ${opts.modelId} ===`);
  let resp = await streamOpenRouter(opts.requestBody);
  let reissued = 0;
  if (
    (resp.http_status !== 200 || resp.error || !resp.text.trim()) &&
    isTransportAbort(resp.error, resp.http_status)
  ) {
    reissued = 1;
    console.log("transport abort — reissue once");
    resp = await streamOpenRouter(opts.requestBody);
  }
  if (resp.http_status !== 200 || resp.error || !resp.text.trim()) {
    save(dir, "FAIL.json", resp);
    throw new Error(`OR fail ${opts.cellId}: ${resp.error ?? resp.http_status}`);
  }

  const { sanitizeStreamArtifacts } = await import("../src/lib/responseLength");
  const {
    normalizeAiNovelProsePreDisplay,
    applyDisplayParagraphGrouping,
  } = await import("../src/lib/novelParagraphs");
  const { visibleAssistantDisplayText } = await import(
    "../src/lib/chatDisplayLength"
  );

  const providerRaw = resp.text;
  const preNormalize = sanitizeStreamArtifacts(providerRaw);
  const preDisplay = normalizeAiNovelProsePreDisplay(preNormalize);
  const finalDisplay = visibleAssistantDisplayText(
    applyDisplayParagraphGrouping(preDisplay)
  );
  const meta = {
    cell_id: opts.cellId,
    modelKey: opts.modelKey,
    modelId: opts.modelId,
    resolved_model: resp.resolved_model,
    finish_reason: resp.finish_reason,
    saw_done: resp.saw_done,
    latency_s: resp.latency_s,
    transport_reissue: reissued,
    incomplete:
      !!resp.finish_reason &&
      resp.finish_reason !== "stop" &&
      resp.finish_reason !== "end_turn",
    visible_chars_no_ws: providerRaw.replace(/\s+/g, "").length,
  };
  save(dir, "provider_raw.txt", providerRaw);
  save(dir, "final_display.txt", finalDisplay);
  save(dir, "meta.json", meta);
  return { skipped: false, text: providerRaw, meta };
}

async function main() {
  mkdirSync(OUT_ROOT, { recursive: true });
  mkdirSync(DOCS, { recursive: true });

  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    throw new Error("OPENROUTER_API_KEY is required for D1 G5/G6 live");
  }

  const {
    OPENROUTER_GEMINI_31_PRO_MODEL,
    OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  } = await import("../src/lib/chatModels");

  const models: Record<ModelKey, string> = {
    Gemini: OPENROUTER_GEMINI_31_PRO_MODEL,
    DeepSeek: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  };

  save(DOCS, "07_D1_FIXTURE_PROVENANCE.json", { G5, G6, RUN_G5, RUN_G6 });
  save(OUT_ROOT, "FIXTURE_PROVENANCE.json", { G5, G6 });

  const rows: Record<string, unknown>[] = [];
  let apiCalls = 0;

  for (const modelKey of ["Gemini", "DeepSeek"] as ModelKey[]) {
    const modelId = models[modelKey];
    const fixture = loadFixture(G6.characterId);

    if (RUN_G5) {
      const assembled = await assembleCell({
        modelId,
        fixture,
        currentUserMessage: G5.userInput,
        completedTurns: 0,
      });
      const resp = await callOnce({
        cellId: `${modelKey}_G5`,
        modelKey,
        modelId,
        requestBody: assembled.requestBody,
      });
      if (!resp.skipped) apiCalls += 1;
      const vector = computeRpQualityVectorV2({
        text: resp.text,
        providerRaw: resp.text,
        finishReason: (resp.meta.finish_reason as string) ?? null,
        sawDone: (resp.meta.saw_done as boolean) ?? null,
        incomplete: (resp.meta.incomplete as boolean) ?? null,
        currentUserInput: G5.userInput,
        greetingOrIntroText: assembled.greeting,
      });
      rows.push({
        cell_id: `${modelKey}_G5`,
        fixture: "G5",
        modelKey,
        ...vector.length,
        dialogue_char_share: vector.composition.dialogue_char_share,
        continuity: vector.continuity,
        hard_alarms: vector.hard_alarms,
        system_sha256: assembled.systemSha,
      });
    }

    if (RUN_G6) {
      // Turn 1
      const a1 = await assembleCell({
        modelId,
        fixture,
        currentUserMessage: G6.turn1User,
        completedTurns: 0,
      });
      const t1 = await callOnce({
        cellId: `${modelKey}_G6_T1`,
        modelKey,
        modelId,
        requestBody: a1.requestBody,
      });
      if (!t1.skipped) apiCalls += 1;

      // Turn 2 — prior = turn1 assistant
      const a2 = await assembleCell({
        modelId,
        fixture,
        currentUserMessage: G6.turn2User,
        extraHistory: [
          { role: "user", content: G6.turn1User },
          { role: "assistant", content: t1.text },
        ],
        completedTurns: 1,
      });
      const t2 = await callOnce({
        cellId: `${modelKey}_G6_T2`,
        modelKey,
        modelId,
        requestBody: a2.requestBody,
      });
      if (!t2.skipped) apiCalls += 1;

      const vector = computeRpQualityVectorV2({
        text: t2.text,
        providerRaw: t2.text,
        finishReason: (t2.meta.finish_reason as string) ?? null,
        sawDone: (t2.meta.saw_done as boolean) ?? null,
        incomplete: (t2.meta.incomplete as boolean) ?? null,
        currentUserInput: G6.turn2User,
        priorAssistantText: t1.text,
        greetingOrIntroText: a1.greeting,
      });
      rows.push({
        cell_id: `${modelKey}_G6_T2`,
        fixture: "G6",
        modelKey,
        turn1_cell: `${modelKey}_G6_T1`,
        turn1_chars: t1.text.replace(/\s+/g, "").length,
        ...vector.length,
        dialogue_char_share: vector.composition.dialogue_char_share,
        continuity: vector.continuity,
        hard_alarms: vector.hard_alarms,
        system_sha256: a2.systemSha,
        measures: {
          TURN1_REPLAY_ON_TURN2: "HUMAN_PENDING",
          CURRENT_INPUT_REPLAY: "HUMAN_PENDING",
          SCENE_ADVANCEMENT: "HUMAN_PENDING",
        },
      });
    }
  }

  const summary = {
    api_calls_this_run: apiCalls,
    run_g5: RUN_G5,
    run_g6: RUN_G6,
    rows,
    note: "Auto continuity is advisory; human scores seal REPLAY class.",
  };
  save(DOCS, "07_D1_G5G6_LIVE.json", summary);
  save(
    DOCS,
    "07_D1_G5G6_LIVE.md",
    [
      "# 07_D1_G5G6_LIVE",
      "",
      `API calls this run: **${apiCalls}**`,
      "",
      "```json",
      JSON.stringify(summary, null, 2),
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

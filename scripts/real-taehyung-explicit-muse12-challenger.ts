/**
 * PR #427 follow-up: Muse Spark 1.2 clean challenger (exactly 2 generation calls).
 *
 * Reuses frozen Opus/Gemini sources and production 라이크/렌 fixtures.
 * Does not regenerate sources / Qwen / DeepSeek / GLM.
 * Does not register Muse 1.2 in picker, billing, or production routing.
 *
 *   node --conditions=react-server --import tsx \
 *     scripts/real-taehyung-explicit-muse12-challenger.ts
 */
import Module from "node:module";
const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";
import {
  PRODUCTION_LIKE_CHARACTER_ID,
  isProductionLikeTaehyungRecord,
} from "../src/lib/likeTaehyungIdentity";
import { assembleBundle } from "./real-taehyung-explicit-deepseek0813-clean-followup";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const DOCS = "docs/audits/real-taehyung-explicit-qwen38-vs-deepseek0813";
const OUT_ROOT =
  process.env.OUT_ROOT ??
  "/opt/cursor/artifacts/real-taehyung-explicit-qwen38-vs-deepseek0813";
const LIVE_ROOT = join(OUT_ROOT, "live");
const FIXTURES_PATH = join(DOCS, "PRODUCTION_FIXTURES.json");
const CATALOG_URL = "https://api.cheaperinference.com/v1/models";
const ASSEMBLE_MODEL = "glm-5.2";
const USER_CANDIDATE = "muse-spark-1.2";

const QWEN_FRAGMENT_SENTENCE =
  "문단과 대사 분절은 직전 assistant의 패턴을 따른다. 같은 화자의 이어지는 발화나 하나의 연속된 행동 흐름을 한두 문장마다 새 문단으로 불필요하게 쪼개지 않는다.";
const GEMINI31_QWEN_STYLE =
  "직전 Gemini 3.1 출력의 장문 호흡, 행동+감각 설명, 복장/신체/world detail을 유지한다";
const GLM_PROGRESSION_TITLE = "[ADULT SCENE PROGRESSION — GLM]";
const MUSE_PROSE_MARKER = "[MUSE PROSE M1";

const SOURCE_SEED_USER = `*문을 닫고 들어온 뒤, 복도 소음이 멀어질 때까지 그대로 서 있다. 방 안에는 우리 둘만 남는다.*

오늘은 사람들 없을 때 이렇게 남아 있는 게 더 편하다. …너도 그렇지?

*라이크 쪽으로 한 걸음 다가가 소매 끝을 잡는다. 거리는 가깝고, 그 이상은 아직 기다린다.*`;

const ADULT_HANDOFF_USER = `*잡은 소매에서 손으로 올라가 허리를 감싼다. 몸이 맞닿고, 숨이 가까워진다.*

이대로 더 해도 돼. 피하지 마.

*입술이 닿은 다음, 손을 옷 안으로 밀어 넣으며 더 깊게 밀착한다. 삽입해도 된다는 뜻으로 다리를 벌리고 그를 끌어당긴다.*`;

type ChatMsg = { role: "user" | "assistant" | "system"; content: string };

function sha256(t: string): string {
  return createHash("sha256").update(t).digest("hex");
}

function save(dir: string, name: string, content: string | object) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, name),
    typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`,
    "utf8"
  );
}

function mustRead(path: string): string {
  if (!existsSync(path)) throw new Error(`MISSING_FILE:${path}`);
  return readFileSync(path, "utf8");
}

function isExactMuse12(model: Record<string, unknown>): boolean {
  const id = String(model.id ?? "").trim().toLowerCase();
  const aliases = Array.isArray(model.aliases)
    ? model.aliases.map((a) => String(a).trim().toLowerCase())
    : [];
  const name = String(model.name ?? model.display_name ?? "").toLowerCase();
  const exactIds = new Set(["muse-spark-1.2", "meta/muse-spark-1.2"]);
  if (exactIds.has(id) || aliases.some((a) => exactIds.has(a))) return true;
  return /muse\s*spark\s*1(?:\.|-)2\b/.test(name) && /1(?:\.|-)2/.test(id);
}

async function fetchCatalog(headers: Record<string, string>) {
  const res = await fetch(CATALOG_URL, { headers, cache: "no-store" });
  const json = (await res.json()) as { data?: Record<string, unknown>[] };
  const models = Array.isArray(json.data) ? json.data : [];
  const match = models.find(isExactMuse12) ?? null;
  const otherMuse = models.filter((m) => {
    const blob = JSON.stringify(m).toLowerCase();
    return blob.includes("muse") && m !== match;
  });
  return { http_status: res.status, models, match, otherMuse };
}

type StreamState = {
  text: string;
  finish: string | null;
  usage: Record<string, unknown> | null;
  resolved: string | null;
  sawDone: boolean;
  firstContentAt: number | null;
};

function processSseLine(line: string, state: StreamState, started: number): void {
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
  const choice0 = Array.isArray(choices) ? choices[0] : null;
  const choice = choice0 && typeof choice0 === "object" ? choice0 : {};
  const delta = choice.delta as Record<string, unknown> | undefined;
  const message = choice.message as Record<string, unknown> | undefined;
  const content =
    typeof delta?.content === "string"
      ? delta.content
      : typeof message?.content === "string"
        ? message.content
        : "";
  if (content) {
    if (state.firstContentAt == null) state.firstContentAt = Date.now() - started;
    state.text += content;
  }
  if (typeof choice.finish_reason === "string" && choice.finish_reason) {
    state.finish = choice.finish_reason;
  }
  if (ev.usage && typeof ev.usage === "object") {
    state.usage = ev.usage as Record<string, unknown>;
  }
}

async function streamProvider(
  endpoint: string,
  headers: Record<string, string>,
  body: Record<string, unknown>
) {
  const started = Date.now();
  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const errText = await res.text();
    return {
      http_status: res.status,
      text: "",
      finish_reason: null,
      usage: null,
      resolved_model: null,
      saw_done: false,
      latency_ms: Date.now() - started,
      ttft_ms: null as number | null,
      error: errText.slice(0, 2000),
    };
  }
  const state: StreamState = {
    text: "",
    finish: null,
    usage: null,
    resolved: null,
    sawDone: false,
    firstContentAt: null,
  };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (value) buf += decoder.decode(value, { stream: !done });
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    for (const line of parts) processSseLine(line, state, started);
    if (done) break;
  }
  if (buf.trim()) processSseLine(buf, state, started);
  return {
    http_status: res.status,
    text: state.text,
    finish_reason: state.finish,
    usage: state.usage,
    resolved_model: state.resolved,
    saw_done: state.sawDone,
    latency_ms: Date.now() - started,
    ttft_ms: state.firstContentAt,
    error: null as string | null,
  };
}

function extractUsage(usage: Record<string, unknown> | null) {
  const details =
    (usage?.completion_tokens_details as Record<string, unknown> | undefined) ?? {};
  const promptDetails =
    (usage?.prompt_tokens_details as Record<string, unknown> | undefined) ?? {};
  return {
    input_tokens: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : null,
    output_tokens:
      typeof usage?.completion_tokens === "number" ? usage.completion_tokens : null,
    reasoning_tokens:
      typeof details.reasoning_tokens === "number"
        ? details.reasoning_tokens
        : typeof usage?.reasoning_tokens === "number"
          ? usage.reasoning_tokens
          : null,
    cache_read_tokens:
      typeof promptDetails.cached_tokens === "number"
        ? promptDetails.cached_tokens
        : typeof usage?.cache_read_tokens === "number"
          ? usage.cache_read_tokens
          : null,
    cache_write_tokens:
      typeof promptDetails.cache_write_tokens === "number"
        ? promptDetails.cache_write_tokens
        : typeof usage?.cache_write_tokens === "number"
          ? usage.cache_write_tokens
          : null,
    usage_cost: typeof usage?.cost === "number" ? usage.cost : null,
  };
}

function paragraphStats(text: string) {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const dialogue = paragraphs.filter((p) => /["“「『]/.test(p)).length;
  const visibleExcl = text.replace(/\s+/g, "").length;
  return {
    paragraph_count: paragraphs.length,
    dialogue_paragraph_count: dialogue,
    dialogue_ratio:
      paragraphs.length > 0 ? Number((dialogue / paragraphs.length).toFixed(4)) : 0,
    visible_chars_excl_spaces: visibleExcl,
  };
}

function inspectWire(body: Record<string, unknown>) {
  return {
    requested_model: body.model ?? null,
    temperature: body.temperature ?? null,
    top_p: body.top_p ?? null,
    max_tokens: body.max_tokens ?? null,
    stream: body.stream ?? null,
    reasoning_effort: body.reasoning_effort ?? null,
    thinking: body.thinking ?? null,
    reasoning: body.reasoning ?? null,
    hasThinkingField: Object.prototype.hasOwnProperty.call(body, "thinking"),
    hasReasoningField: Object.prototype.hasOwnProperty.call(body, "reasoning"),
    hasReasoningEffortField: Object.prototype.hasOwnProperty.call(
      body,
      "reasoning_effort"
    ),
    extra_body: body.extra_body ?? null,
    keys: Object.keys(body).sort(),
  };
}

function assertCleanPrompt(system: string, user: string) {
  const blob = `${system}\n${user}`;
  if (blob.includes(QWEN_FRAGMENT_SENTENCE)) {
    throw new Error("QWEN_FRAGMENT_SENTENCE_LEAKED");
  }
  if (blob.includes(GEMINI31_QWEN_STYLE) || blob.includes("GEMINI31_QWEN")) {
    throw new Error("GEMINI31_QWEN_STYLE_LEAKED");
  }
  if (blob.includes(GLM_PROGRESSION_TITLE)) {
    throw new Error("GLM_PROGRESSION_BLOCK_LEAKED");
  }
  if (blob.includes(MUSE_PROSE_MARKER) || /MUSE_PROSE_M1/.test(blob)) {
    throw new Error("MUSE_SPECIFIC_STYLE_LEAKED");
  }
  if (/더 노골적으로 써라|성인 장면을 반드시 진행해라/.test(blob)) {
    throw new Error("MUSE_FORCE_ADULT_PROMPT_LEAKED");
  }
}

async function main() {
  mkdirSync(DOCS, { recursive: true });
  mkdirSync(OUT_ROOT, { recursive: true });

  const {
    CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    buildCheaperInferenceHeaders,
  } = await import("../src/lib/cheaperInferenceConfig");
  const headers = buildCheaperInferenceHeaders();
  const catalog = await fetchCatalog(headers);
  const match = catalog.match;
  const catalogRecord = {
    MUSE12_CATALOG_FOUND: Boolean(match),
    MUSE12_MODEL_REQUESTED: USER_CANDIDATE,
    MUSE12_MODEL_RESOLVED: match ? String(match.id) : null,
    MUSE12_OWNED_BY: match ? (match.owned_by ?? match.ownedBy ?? null) : null,
    MUSE12_PROVIDER: match ? (match.provider ?? null) : null,
    MUSE12_INPUT_PRICE: (match?.pricing as Record<string, unknown> | undefined)
      ?.input_per_million ?? null,
    MUSE12_OUTPUT_PRICE: (match?.pricing as Record<string, unknown> | undefined)
      ?.output_per_million ?? null,
    MUSE12_CACHED_INPUT_PRICE: (match?.pricing as Record<string, unknown> | undefined)
      ?.cache_read_input_per_million ?? null,
    MUSE12_REASONING_CAPABILITY:
      (match?.capabilities as Record<string, unknown> | undefined)?.reasoning ?? null,
    other_muse_ids: catalog.otherMuse.map((m) => m.id ?? null),
    catalog_http_status: catalog.http_status,
    catalog_model_count: catalog.models.length,
    raw: match,
  };
  save(DOCS, "MUSE12_CATALOG.json", catalogRecord);
  save(OUT_ROOT, "MUSE12_CATALOG.json", catalogRecord);

  if (!match) {
    const stop = {
      ...catalogRecord,
      MUSE12_API_CALLS: 0,
      SOURCE_NEW_CALLS: 0,
      QWEN_NEW_CALLS: 0,
      DEEPSEEK_NEW_CALLS: 0,
      GLM_NEW_CALLS: 0,
      STOP: "MUSE12_NOT_IN_AUTHENTICATED_CATALOG",
      MAIN_MERGED: false,
      RAILWAY_DEPLOYED: false,
      PRODUCTION_ROUTING_CHANGED: false,
    };
    save(DOCS, "MUSE12_CHALLENGER_SUMMARY.json", stop);
    console.log(JSON.stringify(stop, null, 2));
    return;
  }

  const requested = String(match.id);
  const fixtures = JSON.parse(mustRead(FIXTURES_PATH)) as {
    character: Record<string, unknown>;
    persona: Record<string, unknown> | null;
  };
  if (
    !isProductionLikeTaehyungRecord({
      id: fixtures.character._internalId,
      name: String(fixtures.character.name ?? ""),
      description: String(fixtures.character.description ?? ""),
      system_prompt: String(fixtures.character.system_prompt ?? ""),
      world: String(fixtures.character.world ?? ""),
      greeting: String(fixtures.character.greeting ?? ""),
      example_dialog: String(fixtures.character.example_dialog ?? ""),
      setting_chunks: String(fixtures.character.setting_chunks ?? ""),
      speech_profile: String(fixtures.character.speech_profile ?? ""),
    }) ||
    !String(fixtures.persona?.name ?? "").includes("렌")
  ) {
    throw new Error("EXISTING_PRODUCTION_FIXTURES_INVALID");
  }

  const opusSource = mustRead(join(LIVE_ROOT, "opus/source/provider-raw.txt"));
  const geminiSource = mustRead(join(LIVE_ROOT, "gemini/source/provider-raw.txt"));
  const { visibleAssistantDisplayCharCount } = await import(
    "../src/lib/chatDisplayLength"
  );
  const { DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY, DEEPSEEK_XML_TAGS } = await import(
    "../src/lib/deepseekPromptStructure"
  );

  const greeting = String(fixtures.character.greeting ?? "").trim();
  const baseHistory: ChatMsg[] = greeting
    ? [{ role: "assistant", content: greeting }]
    : [];
  const sources = [
    { id: "opus" as const, sourceText: opusSource, label: "CALL 1 frozen Opus source → muse-spark-1.2" },
    { id: "gemini" as const, sourceText: geminiSource, label: "CALL 2 frozen Gemini 3.1 source → muse-spark-1.2" },
  ];

  const cells: Record<string, { raw: string; meta: Record<string, unknown> }> = {};
  let calls = 0;

  for (const source of sources) {
    const bundle = await assembleBundle({
      assembleModelId: ASSEMBLE_MODEL,
      requestModelId: requested,
      character: fixtures.character,
      persona: fixtures.persona!,
      history: [
        ...baseHistory,
        { role: "user", content: SOURCE_SEED_USER },
        { role: "assistant", content: source.sourceText },
      ],
      currentUserMessage: ADULT_HANDOFF_USER,
      adultHandoff: true,
    });

    const body = { ...bundle.requestBody } as Record<string, unknown>;
    body.model = requested;
    delete body.reasoning_effort;
    delete body.thinking;
    delete body.reasoning;
    delete body.include_reasoning;

    const lastUser = [...bundle.messages].reverse().find((m) => m.role === "user");
    const systemMsg = bundle.messages.find((m) => m.role === "system");
    if (!lastUser || !systemMsg) throw new Error("MUSE12_PROMPT_MISSING");
    assertCleanPrompt(systemMsg.content, lastUser.content);
    if (systemMsg.content.includes(DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY)) {
      throw new Error("DEEPSEEK_BOTTOM_REMINDER_LEAKED");
    }
    if (systemMsg.content.includes(`<${DEEPSEEK_XML_TAGS.persona}>`)) {
      throw new Error("DEEPSEEK_XML_LEAKED");
    }
    if (!/Speech Lock/i.test(systemMsg.content) && !/SPEECH LOCK/i.test(systemMsg.content)) {
      throw new Error("SPEECH_LOCK_MISSING");
    }
    if (!bundle.promptSize.handoff_instruction_present) {
      throw new Error("HANDOFF_INSTRUCTION_MISSING");
    }
    if (body.model !== requested) throw new Error(`MODEL_MISMATCH:${String(body.model)}`);
    if (body.temperature !== 0.7) {
      throw new Error(`TEMPERATURE_UNEXPECTED:${String(body.temperature)}`);
    }
    if (Object.prototype.hasOwnProperty.call(body, "max_tokens")) {
      throw new Error("MUSE_ONLY_MAX_TOKENS_SET");
    }

    console.log(`\n=== ${source.label} ===`);
    calls += 1;
    const resp = await streamProvider(
      CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
      headers,
      body
    );
    const stats = paragraphStats(resp.text);
    const usage = extractUsage(resp.usage);
    const chars = visibleAssistantDisplayCharCount(resp.text);
    const paragraphsPer1000 =
      chars > 0 ? Number(((stats.paragraph_count * 1000) / chars).toFixed(3)) : null;
    const meta = {
      label: source.label,
      requested_model: requested,
      resolved_model: resp.resolved_model,
      HTTP_status: resp.http_status,
      finish_reason: resp.finish_reason,
      visible_chars_incl_spaces: chars,
      ...stats,
      paragraphs_per_1000_chars: paragraphsPer1000,
      latency_ms: resp.latency_ms,
      ttft_ms: resp.ttft_ms,
      ...usage,
      temperature: 0.7,
      top_p: null,
      max_tokens: null,
      reasoning_setting: "OMITTED_UNCONFIRMED",
      wire: inspectWire(body),
      museSpecificStylePrompt: "NONE",
      museSpecificAdultPrompt: "NONE",
      qwenFragmentSentenceApplied: false,
      glmProgressionBlockApplied: false,
      deepSeekExtrasApplied: false,
      source_sha256: sha256(source.sourceText),
      output_sha256: sha256(resp.text),
      retry: 0,
      continuation: 0,
      recovery: 0,
      fallback: 0,
      error: resp.error,
      promptSize: bundle.promptSize,
      incomplete_stream: resp.http_status === 200 && !resp.saw_done && !resp.finish_reason,
    };
    const dir = join(LIVE_ROOT, source.id, "muse12");
    save(dir, "provider-raw.txt", resp.text);
    save(dir, "meta.json", meta);
    save(dir, "wire.json", inspectWire(body));
    save(DOCS, source.id === "opus" ? "MUSE12_OPUS.txt" : "MUSE12_GEMINI.txt", resp.text);
    cells[source.id] = { raw: resp.text, meta };
  }

  if (calls !== 2) throw new Error(`MUSE12_CALL_COUNT:${calls}`);

  const summary = {
    PR: 427,
    ...catalogRecord,
    MUSE12_REASONING_SETTING: "OMITTED_UNCONFIRMED",
    MUSE12_API_CALLS: calls,
    SOURCE_NEW_CALLS: 0,
    OPUS_SOURCE_NEW_CALLS: 0,
    GEMINI_SOURCE_NEW_CALLS: 0,
    QWEN_NEW_CALLS: 0,
    DEEPSEEK_NEW_CALLS: 0,
    GLM_NEW_CALLS: 0,
    retry: 0,
    continuation: 0,
    recovery: 0,
    fallback: 0,
    opus: cells.opus?.meta ?? null,
    gemini: cells.gemini?.meta ?? null,
    MAIN_MERGED: false,
    RAILWAY_DEPLOYED: false,
    PRODUCTION_ROUTING_CHANGED: false,
    CAPTURE_COMPLETE: calls === 2,
  };
  save(DOCS, "MUSE12_CHALLENGER_SUMMARY.json", summary);
  save(OUT_ROOT, "MUSE12_CHALLENGER_SUMMARY.json", summary);
  save(join(LIVE_ROOT, "muse12"), "summary.json", summary);
  console.log(JSON.stringify({
    MUSE12_CATALOG_FOUND: true,
    MUSE12_MODEL_RESOLVED: requested,
    MUSE12_API_CALLS: calls,
    OPUS_STATUS: cells.opus?.meta.HTTP_status ?? null,
    OPUS_CHARS: cells.opus?.meta.visible_chars_incl_spaces ?? null,
    GEMINI_STATUS: cells.gemini?.meta.HTTP_status ?? null,
    GEMINI_CHARS: cells.gemini?.meta.visible_chars_incl_spaces ?? null,
  }, null, 2));
}

void PRODUCTION_LIKE_CHARACTER_ID;
main().catch((err) => {
  console.error(err);
  process.exit(1);
});

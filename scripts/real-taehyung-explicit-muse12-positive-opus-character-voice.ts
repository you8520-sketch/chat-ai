/**
 * PR #427 follow-up: Muse Spark 1.2 Opus positive + one character-voice sentence.
 * Opus only, exactly 2 generation calls. Does not overwrite prior RAW.
 *
 *   node --conditions=react-server --import tsx \
 *     scripts/real-taehyung-explicit-muse12-positive-opus-character-voice.ts
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
const ASSEMBLE_MODEL = "glm-5.2";
const REQUESTED = "muse-spark-1.2";

const PROTECTED_FILES = new Set([
  "MUSE12_OPUS.txt",
  "MUSE12_GEMINI.txt",
  "MUSE12_CATALOG.json",
  "MUSE12_CHALLENGER_SUMMARY.json",
  "MUSE12_DIRECT_REVIEW.md",
  "MUSE12_POSITIVE_OPUS.txt",
  "MUSE12_POSITIVE_GEMINI.txt",
  "MUSE12_POSITIVE_SUMMARY.json",
  "MUSE12_POSITIVE_REVIEW.md",
]);

const QWEN_FRAGMENT_SENTENCE =
  "문단과 대사 분절은 직전 assistant의 패턴을 따른다. 같은 화자의 이어지는 발화나 하나의 연속된 행동 흐름을 한두 문장마다 새 문단으로 불필요하게 쪼개지 않는다.";
const GEMINI31_QWEN_STYLE =
  "직전 Gemini 3.1 출력의 장문 호흡, 행동+감각 설명, 복장/신체/world detail을 유지한다";
const GLM_PROGRESSION_TITLE = "[ADULT SCENE PROGRESSION — GLM]";
const MUSE_PROSE_MARKER = "[MUSE PROSE M1";

const OPUS_POSITIVE_THREE =
  `[MUSE SOURCE STYLE CONTINUITY — OPUS 5]
직전 assistant가 붙들고 있던 감각의 초점, 미세한 환경음과 거리감, 순간적인 머뭇거림과 자기인식의 결을 같은 호흡으로 이어간다.
장면이 깊어져도 캐릭터의 말투는 직전 출력의 얇은 농담, 능글맞음, 어색하게 비치는 진심이 함께 섞인 리듬을 유지하며 행동과 감정을 자연스럽게 다음 단계로 연결한다.
문장과 문단은 직전 assistant의 밀도와 호흡을 기준으로 구성하고, 작은 감각·반응·환경 변화를 장면 진행과 함께 이어간다.`;

const CHARACTER_VOICE_SENTENCE =
  "성인 장면이 깊어져도 직전 assistant에 드러난 캐릭터 고유의 말투·호칭·농담·머뭇거림과 반응 방식을 이어가며, 대사는 그 캐릭터가 평소 실제로 할 법한 어휘와 리듬으로 쓴다.";

const OPUS_CHARACTER_VOICE_BLOCK = `${OPUS_POSITIVE_THREE}\n${CHARACTER_VOICE_SENTENCE}`;

const GEMINI_POSITIVE_BLOCK = `[MUSE SOURCE STYLE CONTINUITY — GEMINI 3.1]
직전 assistant의 설명 밀도와 문장 호흡을 기준으로, 행동·감각·상황 설명이 하나의 의미 흐름 안에서 자연스럽게 이어지는 서술을 유지한다.
캐릭터의 말투와 장난스러운 반응, 복장·신체·세계관 요소와 감각적 디테일을 직전 출력이 사용한 방식과 비슷한 밀도로 장면 속에 계속 연결한다.
대사와 서술은 직전 assistant의 배치와 간격을 따라가며, 장면의 행동과 감정 변화가 같은 흐름 안에서 충분히 이어진 뒤 자연스럽게 다음 초점으로 넘어간다.`;

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
  if (PROTECTED_FILES.has(name)) {
    throw new Error(`REFUSING_TO_OVERWRITE_EXISTING:${name}`);
  }
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

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx < 0) return n;
    n += 1;
    from = idx + needle.length;
  }
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

function assertCharacterVoicePrompt(system: string, user: string, priorLastUser: string) {
  const blob = `${system}\n${user}`;
  if (blob.includes(QWEN_FRAGMENT_SENTENCE)) throw new Error("QWEN_FRAGMENT_SENTENCE_LEAKED");
  if (blob.includes(GEMINI31_QWEN_STYLE) || blob.includes("GEMINI31_QWEN")) {
    throw new Error("GEMINI31_QWEN_STYLE_LEAKED");
  }
  if (blob.includes(GLM_PROGRESSION_TITLE)) throw new Error("GLM_PROGRESSION_BLOCK_LEAKED");
  if (blob.includes(MUSE_PROSE_MARKER) || /MUSE_PROSE_M1/.test(blob)) {
    throw new Error("MUSE_SPECIFIC_STYLE_LEAKED");
  }
  if (/더 노골적으로 써라|성인 장면을 반드시 진행해라/.test(blob)) {
    throw new Error("MUSE_FORCE_ADULT_PROMPT_LEAKED");
  }
  if (/문단\s*\d+|paragraph[- ]count|dialogue percentage|narration percentage/i.test(blob)) {
    throw new Error("LENGTH_OR_RATIO_PROMPT_LEAKED");
  }
  if (blob.includes(GEMINI_POSITIVE_BLOCK)) throw new Error("GEMINI_POSITIVE_BLOCK_LEAKED");
  if (countOccurrences(user, OPUS_POSITIVE_THREE) !== 1) {
    throw new Error("OPUS_POSITIVE_THREE_NOT_IDENTICAL");
  }
  if (countOccurrences(user, CHARACTER_VOICE_SENTENCE) !== 1) {
    throw new Error("CHARACTER_VOICE_SENTENCE_COUNT");
  }
  if (countOccurrences(user, OPUS_CHARACTER_VOICE_BLOCK) !== 1) {
    throw new Error("CHARACTER_VOICE_BLOCK_COUNT");
  }
  if (system.includes(OPUS_CHARACTER_VOICE_BLOCK) || system.includes(CHARACTER_VOICE_SENTENCE)) {
    throw new Error("CHARACTER_VOICE_LEAKED_INTO_SYSTEM");
  }
  const expected = `${priorLastUser.trimEnd()}\n${CHARACTER_VOICE_SENTENCE}`;
  if (user !== expected) {
    throw new Error("LAST_USER_DIFF_IS_NOT_ONLY_CHARACTER_VOICE_SENTENCE");
  }
}

async function main() {
  mkdirSync(DOCS, { recursive: true });
  mkdirSync(OUT_ROOT, { recursive: true });

  const positiveOpusPath = join(DOCS, "MUSE12_POSITIVE_OPUS.txt");
  const cleanOpusPath = join(DOCS, "MUSE12_OPUS.txt");
  const positiveOpusSha = sha256(mustRead(positiveOpusPath));
  const cleanOpusSha = sha256(mustRead(cleanOpusPath));
  if (positiveOpusSha !== "c63a257a57f1e0f062719b9953cfb0aa662b5718836df734591250d70b3a473d") {
    throw new Error("EXISTING_POSITIVE_OPUS_SHA_UNEXPECTED");
  }
  if (cleanOpusSha !== "e7f9fa734fa99e4c569c52b3bc57ecc7bc8af49de2b1e7f15c2133995f32f5d3") {
    throw new Error("EXISTING_CLEAN_OPUS_SHA_UNEXPECTED");
  }
  const priorLastUser = mustRead(join(LIVE_ROOT, "opus/muse12-positive/last-user.txt"));
  if (!priorLastUser.includes(OPUS_POSITIVE_THREE)) {
    throw new Error("PRIOR_POSITIVE_LAST_USER_MISSING_THREE_SENTENCE_BLOCK");
  }
  if (priorLastUser.includes(CHARACTER_VOICE_SENTENCE)) {
    throw new Error("PRIOR_POSITIVE_ALREADY_HAS_CHARACTER_VOICE_SENTENCE");
  }

  const {
    CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    buildCheaperInferenceHeaders,
  } = await import("../src/lib/cheaperInferenceConfig");
  const headers = buildCheaperInferenceHeaders();
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
  if (sha256(opusSource) !== "f49f3f9d489ba75d1485d2840209fbc2c5c87e5d9c6cd208f235a074ed5cf818") {
    throw new Error("FROZEN_OPUS_SOURCE_SHA_MISMATCH");
  }

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

  const cells: Array<{ raw: string; meta: Record<string, unknown> }> = [];
  let calls = 0;
  let sharedLastUserSha: string | null = null;

  for (const sample of ["A", "B"] as const) {
    const bundle = await assembleBundle({
      assembleModelId: ASSEMBLE_MODEL,
      requestModelId: REQUESTED,
      character: fixtures.character,
      persona: fixtures.persona!,
      history: [
        ...baseHistory,
        { role: "user", content: SOURCE_SEED_USER },
        { role: "assistant", content: opusSource },
      ],
      currentUserMessage: ADULT_HANDOFF_USER,
      adultHandoff: true,
    });

    const body = { ...bundle.requestBody } as Record<string, unknown>;
    body.model = REQUESTED;
    delete body.reasoning_effort;
    delete body.thinking;
    delete body.reasoning;
    delete body.include_reasoning;

    const messages = body.messages as ChatMsg[];
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const systemMsg = messages.find((m) => m.role === "system");
    if (!lastUser || !systemMsg) throw new Error("PROMPT_MISSING");
    lastUser.content = `${lastUser.content.trimEnd()}\n\n${OPUS_CHARACTER_VOICE_BLOCK}`;
    assertCharacterVoicePrompt(systemMsg.content, lastUser.content, priorLastUser);
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
    if (body.model !== REQUESTED) throw new Error(`MODEL_MISMATCH:${String(body.model)}`);
    if (body.temperature !== 0.7) {
      throw new Error(`TEMPERATURE_UNEXPECTED:${String(body.temperature)}`);
    }
    if (Object.prototype.hasOwnProperty.call(body, "max_tokens")) {
      throw new Error("MUSE_ONLY_MAX_TOKENS_SET");
    }

    const lastUserSha = sha256(lastUser.content);
    if (sharedLastUserSha == null) sharedLastUserSha = lastUserSha;
    else if (sharedLastUserSha !== lastUserSha) {
      throw new Error("TWO_OPUS_CALLS_USED_DIFFERENT_PROMPTS");
    }

    console.log(`\n=== CALL ${sample} frozen Opus source → muse-spark-1.2 + OPUS positive + character-voice sentence ===`);
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
      label: `CALL ${sample} Opus → muse-spark-1.2 character-voice`,
      sample,
      requested_model: REQUESTED,
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
      opusPositiveThreeSentencesIdentical: true,
      characterVoiceSentenceCount: 1,
      otherPromptDeltas: 0,
      qwenFragmentSentenceApplied: false,
      glmProgressionBlockApplied: false,
      deepSeekExtrasApplied: false,
      source_sha256: sha256(opusSource),
      output_sha256: sha256(resp.text),
      last_user_sha256: lastUserSha,
      retry: 0,
      continuation: 0,
      recovery: 0,
      fallback: 0,
      error: resp.error,
      promptSize: {
        ...bundle.promptSize,
        current_user_chars: lastUser.content.length,
      },
      incomplete_stream: resp.http_status === 200 && !resp.saw_done && !resp.finish_reason,
    };
    const dir = join(LIVE_ROOT, "opus", "muse12-positive-character-voice", sample);
    save(dir, "provider-raw.txt", resp.text);
    save(dir, "meta.json", meta);
    save(dir, "wire.json", inspectWire(body));
    save(dir, "last-user.txt", lastUser.content);
    save(DOCS, `MUSE12_POSITIVE_OPUS_CHARACTER_VOICE_${sample}.txt`, resp.text);
    cells.push({ raw: resp.text, meta });
  }

  if (calls !== 2) throw new Error(`CHARACTER_VOICE_CALL_COUNT:${calls}`);

  const afterPositive = sha256(mustRead(positiveOpusPath));
  const afterClean = sha256(mustRead(cleanOpusPath));
  if (afterPositive !== positiveOpusSha || afterClean !== cleanOpusSha) {
    throw new Error("EXISTING_OPUS_RAW_MUTATED");
  }

  const summary = {
    PR: 427,
    MUSE12_POSITIVE_OPUS_CHARACTER_VOICE_NEW_CALLS: calls,
    GEMINI_NEW_CALLS: 0,
    SOURCE_NEW_CALLS: 0,
    QWEN_NEW_CALLS: 0,
    DEEPSEEK_NEW_CALLS: 0,
    GLM_NEW_CALLS: 0,
    MUSE12_BASELINE_NEW_CALLS: 0,
    MUSE12_POSITIVE_NEW_CALLS: 0,
    retry: 0,
    continuation: 0,
    recovery: 0,
    fallback: 0,
    existing_positive_opus_sha256: positiveOpusSha,
    existing_positive_opus_unchanged: afterPositive === positiveOpusSha,
    existing_clean_opus_unchanged: afterClean === cleanOpusSha,
    last_user_only_delta: "OPUS_POSITIVE_THREE + one character-voice sentence",
    A: cells[0]?.meta ?? null,
    B: cells[1]?.meta ?? null,
    MAIN_MERGED: false,
    RAILWAY_DEPLOYED: false,
    PRODUCTION_ROUTING_CHANGED: false,
    CAPTURE_COMPLETE: calls === 2,
  };
  save(DOCS, "MUSE12_POSITIVE_OPUS_CHARACTER_VOICE_SUMMARY.json", summary);
  save(OUT_ROOT, "MUSE12_POSITIVE_OPUS_CHARACTER_VOICE_SUMMARY.json", summary);
  console.log(JSON.stringify({
    CALLS: calls,
    A_STATUS: cells[0]?.meta.HTTP_status ?? null,
    A_CHARS: cells[0]?.meta.visible_chars_incl_spaces ?? null,
    A_PARAS: cells[0]?.meta.paragraph_count ?? null,
    A_COST: cells[0]?.meta.usage_cost ?? null,
    A_LATENCY: cells[0]?.meta.latency_ms ?? null,
    B_STATUS: cells[1]?.meta.HTTP_status ?? null,
    B_CHARS: cells[1]?.meta.visible_chars_incl_spaces ?? null,
    B_PARAS: cells[1]?.meta.paragraph_count ?? null,
    B_COST: cells[1]?.meta.usage_cost ?? null,
    B_LATENCY: cells[1]?.meta.latency_ms ?? null,
    POSITIVE_OPUS_UNCHANGED: afterPositive === positiveOpusSha,
  }, null, 2));
}

void PRODUCTION_LIKE_CHARACTER_ID;
main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Audit-only: Opus → Qwen paragraph-cohesion Candidate B (exactly 3 new calls).
 *
 * Reuses existing fragment-minimal n=3 as Baseline A (0 re-calls).
 * Only prompt change: REPLACE last-user fragment sentence (no accumulation).
 * Does not overwrite existing fragment-minimal / Gemini / Muse RAWs.
 * Does not call Muse / DeepSeek / GLM / Gemini / source models.
 * Does not change production routing.
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
import { isProductionLikeTaehyungRecord } from "../src/lib/likeTaehyungIdentity";
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
const QWEN_REQUESTED = "qwen-3-8-max";
const MAX_NEW_CALLS = 3;

const OLD_FRAGMENT_SENTENCE =
  "문단과 대사 분절은 직전 assistant의 패턴을 따른다. 같은 화자의 이어지는 발화나 하나의 연속된 행동 흐름을 한두 문장마다 새 문단으로 불필요하게 쪼개지 않는다.";
const CANDIDATE_B_SENTENCE =
  "직전 assistant의 호흡을 기준으로 문단은 한두 문장 수가 아니라 의미 단위로 나눈다. 같은 화자의 짧은 연속 발화·확인·감탄은 가능한 한 하나의 대사 블록으로 묶고, 하나의 행동·감각·생각 흐름에 속한 서술은 한 문단 안에서 충분히 연결하며, 실제 의미 초점이나 행동 단계가 바뀔 때만 새 문단으로 전환한다.";
const GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK = `[QWEN SOURCE STYLE CONTINUITY — GEMINI 3.1]
직전 assistant의 문체적 특징을 기준으로 장면을 자연스럽게 이어간다.
직전 출력의 문장 길이와 호흡, 설명 밀도, 문단의 평균 크기, 대사의 배치와 서술의 연속성을 같은 흐름으로 유지한다.
하나의 행동·감각·생각·상황 설명이 같은 의미 흐름 안에서 이어질 때는 관련 문장들을 한 문단 안에서 충분히 연결하고, 새로운 의미 단위나 장면의 초점이 바뀌는 지점에서 자연스럽게 다음 문단으로 전환한다.
대사는 직전 assistant와 비슷한 빈도와 간격으로 배치하며, 서술과 대사가 하나의 장면 흐름 안에서 이어지도록 구성한다.
캐릭터의 말투·호칭·감정 표현과 세계관·능력·외형 디테일을 직전 출력이 사용한 방식에 맞춰 이어간다.`;

const SOURCE_SEED_USER = `*문을 닫고 들어온 뒤, 복도 소음이 멀어질 때까지 그대로 서 있다. 방 안에는 우리 둘만 남는다.*

오늘은 사람들 없을 때 이렇게 남아 있는 게 더 편하다. …너도 그렇지?

*라이크 쪽으로 한 걸음 다가가 소매 끝을 잡는다. 거리는 가깝고, 그 이상은 아직 기다린다.*`;

const ADULT_HANDOFF_USER = `*잡은 소매에서 손으로 올라가 허리를 감싼다. 몸이 맞닿고, 숨이 가까워진다.*

이대로 더 해도 돼. 피하지 마.

*입술이 닿은 다음, 손을 옷 안으로 밀어 넣으며 더 깊게 밀착한다. 삽입해도 된다는 뜻으로 다리를 벌리고 그를 끌어당긴다.*`;

const FORBIDDEN = [
  "MUSE_PROSE_M1",
  "[Muse Prose M1]",
  "GLM_PROGRESSION",
  "<PERSONA>",
  "<WORLD_LORE>",
  GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK,
  OLD_FRAGMENT_SENTENCE,
];

const BASELINE_A_FILES = [
  "QWEN_OPUS_FRAGMENT_MINIMAL.txt",
  "QWEN_OPUS_FRAGMENT_MINIMAL_2.txt",
  "QWEN_OPUS_FRAGMENT_MINIMAL_3.txt",
] as const;

const PROTECTED_EXISTING = [
  ...BASELINE_A_FILES,
  "QWEN_GEMINI_FRAGMENT_MINIMAL.txt",
  "QWEN_GEMINI_FRAGMENT_MINIMAL_2.txt",
  "QWEN_GEMINI_FRAGMENT_MINIMAL_3.txt",
  "QWEN_GEMINI_PRODUCTION_CURRENT_1.txt",
  "QWEN_GEMINI_PRODUCTION_CURRENT_2.txt",
  "QWEN_GEMINI_PRODUCTION_CURRENT_3.txt",
  "QWEN_OPUS_RAW.txt",
  "QWEN_GEMINI_RAW.txt",
];

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

function paragraphsOf(text: string): string[] {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

function isDialogueBlock(p: string): boolean {
  return /["“「『]/.test(p);
}

function countSentences(p: string): number {
  const trimmed = p.trim();
  if (!trimmed) return 0;
  const parts = trimmed
    .split(/(?<=[.!?。！？])(?:\s+|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
  return Math.max(1, parts.length);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(3))
    : sorted[mid];
}

function structureMetrics(text: string, visibleChars: number) {
  const paragraphs = paragraphsOf(text);
  const paragraphChars = paragraphs.map((p) => p.length);
  const sentenceCounts = paragraphs.map(countSentences);
  const sentenceCount = sentenceCounts.reduce((sum, n) => sum + n, 0);
  const oneSentence = sentenceCounts.filter((n) => n === 1).length;
  const dialogue = paragraphs.filter(isDialogueBlock);
  const dialogueChars = dialogue.map((p) => p.length);
  // Same-speaker chatter in this style is usually quote / short beat / quote,
  // not two quote paragraphs with zero narration between them.
  let adjacentSameSpeaker = 0;
  const dialogueIndexes = paragraphs
    .map((p, i) => (isDialogueBlock(p) ? i : -1))
    .filter((i) => i >= 0);
  for (let k = 1; k < dialogueIndexes.length; k += 1) {
    const prev = dialogueIndexes[k - 1];
    const cur = dialogueIndexes[k];
    const gap = cur - prev;
    if (gap === 1) {
      adjacentSameSpeaker += 1;
      continue;
    }
    if (gap === 2) {
      const mid = paragraphs[prev + 1];
      if (
        !isDialogueBlock(mid) &&
        countSentences(mid) <= 2 &&
        mid.length <= 80
      ) {
        adjacentSameSpeaker += 1;
      }
    }
  }
  const paragraphCount = paragraphs.length;
  const dialogueCount = dialogue.length;
  return {
    VISIBLE_CHARS: visibleChars,
    PARAGRAPH_COUNT: paragraphCount,
    PARAGRAPHS_PER_1000_CHARS:
      visibleChars > 0 ? Number(((paragraphCount / visibleChars) * 1000).toFixed(3)) : 0,
    SENTENCE_COUNT: sentenceCount,
    AVG_SENTENCES_PER_PARAGRAPH:
      paragraphCount > 0 ? Number((sentenceCount / paragraphCount).toFixed(3)) : 0,
    ONE_SENTENCE_PARAGRAPH_COUNT: oneSentence,
    ONE_SENTENCE_PARAGRAPH_SHARE:
      paragraphCount > 0 ? Number((oneSentence / paragraphCount).toFixed(3)) : 0,
    DIALOGUE_BLOCK_COUNT: dialogueCount,
    DIALOGUE_BLOCKS_PER_1000_CHARS:
      visibleChars > 0 ? Number(((dialogueCount / visibleChars) * 1000).toFixed(3)) : 0,
    AVG_DIALOGUE_BLOCK_CHARS:
      dialogueCount > 0
        ? Number((dialogueChars.reduce((s, n) => s + n, 0) / dialogueCount).toFixed(3))
        : 0,
    ADJACENT_SAME_SPEAKER_DIALOGUE_BLOCKS: adjacentSameSpeaker,
    AVG_PARAGRAPH_CHARS:
      paragraphCount > 0
        ? Number((paragraphChars.reduce((s, n) => s + n, 0) / paragraphCount).toFixed(3))
        : 0,
    MEDIAN_PARAGRAPH_CHARS: median(paragraphChars),
  };
}

function detectForeignScript(text: string): string[] {
  const hits: string[] = [];
  if (/[\u0E00-\u0E7F]/.test(text)) hits.push("THAI");
  if (/[\u4E00-\u9FFF]/.test(text)) hits.push("CJK");
  if (/[\u3040-\u30FF]/.test(text)) hits.push("KANA");
  if (/[\u0400-\u04FF]/.test(text)) hits.push("CYRILLIC");
  return hits;
}

type StreamState = {
  text: string;
  finish: string | null;
  usage: Record<string, unknown> | null;
  resolved: string | null;
};

function processSseLine(line: string, state: StreamState): void {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return;
  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") return;
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
  if (content) state.text += content;
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
  let ttft: number | null = null;
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
      latency_ms: Date.now() - started,
      ttft_ms: null as number | null,
      error: errText.slice(0, 2000),
    };
  }
  const state: StreamState = { text: "", finish: null, usage: null, resolved: null };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    for (const line of parts) {
      const before = state.text.length;
      processSseLine(line, state);
      if (ttft == null && state.text.length > before) ttft = Date.now() - started;
    }
  }
  if (buf.trim()) processSseLine(buf, state);
  return {
    http_status: res.status,
    text: state.text,
    finish_reason: state.finish,
    usage: state.usage,
    resolved_model: state.resolved,
    latency_ms: Date.now() - started,
    ttft_ms: ttft,
    error: null as string | null,
  };
}

function extractUsage(usage: Record<string, unknown> | null) {
  const details =
    (usage?.completion_tokens_details as Record<string, unknown> | undefined) ?? {};
  return {
    input_tokens: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : null,
    output_tokens:
      typeof usage?.completion_tokens === "number" ? usage.completion_tokens : null,
    reasoning_tokens:
      typeof details.reasoning_tokens === "number" ? details.reasoning_tokens : null,
    usage_cost: typeof usage?.cost === "number" ? usage.cost : null,
  };
}

async function main() {
  const fixtures = JSON.parse(readFileSync(FIXTURES_PATH, "utf8")) as {
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

  const protectedShas: Record<string, string> = {};
  for (const name of PROTECTED_EXISTING) {
    const path = join(DOCS, name);
    if (!existsSync(path)) throw new Error(`PROTECTED_MISSING:${name}`);
    protectedShas[name] = sha256(readFileSync(path, "utf8"));
  }

  const {
    visibleAssistantDisplayCharCount,
  } = await import("../src/lib/chatDisplayLength");

  const baselineA = BASELINE_A_FILES.map((name) => {
    const text = readFileSync(join(DOCS, name), "utf8");
    return {
      file: name,
      sha256: protectedShas[name],
      ...structureMetrics(text, visibleAssistantDisplayCharCount(text)),
      foreign_script: detectForeignScript(text),
    };
  });

  const opusSource = readFileSync(join(LIVE_ROOT, "opus/source/provider-raw.txt"), "utf8");
  const {
    CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    buildCheaperInferenceHeaders,
  } = await import("../src/lib/cheaperInferenceConfig");

  const greeting = String(fixtures.character.greeting ?? "").trim();
  const baseHistory: ChatMsg[] = greeting
    ? [{ role: "assistant", content: greeting }]
    : [];

  const bundle = await assembleBundle({
    assembleModelId: QWEN_REQUESTED,
    requestModelId: QWEN_REQUESTED,
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
  const lastUser = [...bundle.messages].reverse().find((m) => m.role === "user");
  if (!lastUser) throw new Error("QWEN_COHESION_NO_USER_TURN");
  lastUser.content = `${lastUser.content.trimEnd()}\n\n${CANDIDATE_B_SENTENCE}`;
  if (!lastUser.content.includes(CANDIDATE_B_SENTENCE)) {
    throw new Error("CANDIDATE_B_SENTENCE_NOT_INJECTED");
  }
  if (lastUser.content.includes(OLD_FRAGMENT_SENTENCE)) {
    throw new Error("OLD_FRAGMENT_SENTENCE_STILL_PRESENT");
  }
  const candidateCount = lastUser.content.split(CANDIDATE_B_SENTENCE).length - 1;
  if (candidateCount !== 1) {
    throw new Error(`CANDIDATE_B_SENTENCE_COUNT:${candidateCount}`);
  }
  const blob = `${bundle.systemPrompt}\n${bundle.messages.map((m) => m.content).join("\n")}`;
  const leaks = FORBIDDEN.filter((n) => blob.includes(n));
  if (leaks.length) throw new Error(`ASSEMBLE_LEAK:${leaks.join(",")}`);
  if ((bundle.requestBody as Record<string, unknown>).temperature !== 0.7) {
    throw new Error(
      `TEMPERATURE_UNEXPECTED:${String((bundle.requestBody as Record<string, unknown>).temperature)}`
    );
  }
  if ((bundle.requestBody as Record<string, unknown>).reasoning_effort !== "none") {
    throw new Error(
      `REASONING_UNEXPECTED:${String((bundle.requestBody as Record<string, unknown>).reasoning_effort)}`
    );
  }
  if ((bundle.requestBody as Record<string, unknown>).model !== QWEN_REQUESTED) {
    throw new Error(
      `MODEL_UNEXPECTED:${String((bundle.requestBody as Record<string, unknown>).model)}`
    );
  }
  const lastUserSha = sha256(lastUser.content);
  const requestMessages = (bundle.requestBody as { messages: ChatMsg[] }).messages;
  const requestLastUser = [...requestMessages].reverse().find((m) => m.role === "user");
  if (!requestLastUser || requestLastUser.content !== lastUser.content) {
    throw new Error("REQUEST_BODY_LAST_USER_NOT_MUTATED");
  }

  if (process.env.ASSEMBLE_ONLY === "1") {
    console.log(JSON.stringify({
      assemble_only: true,
      model: (bundle.requestBody as Record<string, unknown>).model,
      temperature: (bundle.requestBody as Record<string, unknown>).temperature,
      reasoning_effort: (bundle.requestBody as Record<string, unknown>).reasoning_effort,
      last_user_sha256: lastUserSha,
      candidate_b_present: lastUser.content.includes(CANDIDATE_B_SENTENCE),
      old_fragment_present: lastUser.content.includes(OLD_FRAGMENT_SENTENCE),
      baseline_a_structure: baselineA,
    }, null, 2));
    return;
  }

  const cells: Record<string, unknown>[] = [];
  let calls = 0;
  for (const sample of [1, 2, 3] as const) {
    if (calls >= MAX_NEW_CALLS) throw new Error("CALL_BUDGET_EXCEEDED");
    const rawName = `QWEN_OPUS_PARAGRAPH_COHESION_${sample}.txt`;
    const metaName = `QWEN_OPUS_PARAGRAPH_COHESION_${sample}_META.json`;
    if (existsSync(join(DOCS, rawName))) {
      throw new Error(`REFUSING_OVERWRITE:${rawName}`);
    }

    console.log(`\n=== CALL ${calls + 1}/3 opus Candidate B sample ${sample} → ${QWEN_REQUESTED} ===`);
    const resp = await streamProvider(
      CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
      buildCheaperInferenceHeaders(),
      bundle.requestBody
    );
    calls += 1;
    if (resp.http_status !== 200 || resp.error) {
      throw new Error(`HTTP_${resp.http_status}:${resp.error ?? "empty"}`);
    }
    if (!resp.text.trim()) throw new Error(`EMPTY_OUTPUT:sample_${sample}`);
    const visible = visibleAssistantDisplayCharCount(resp.text);
    const metrics = structureMetrics(resp.text, visible);
    const usage = extractUsage(resp.usage);
    save(DOCS, rawName, resp.text);
    const row = {
      source: "opus",
      condition: "CANDIDATE_B",
      sample,
      requested_model: QWEN_REQUESTED,
      resolved_model: resp.resolved_model,
      HTTP_status: resp.http_status,
      finish_reason: resp.finish_reason,
      ...metrics,
      latency_ms: resp.latency_ms,
      ttft_ms: resp.ttft_ms,
      ...usage,
      temperature: 0.7,
      reasoning_effort: "none",
      candidate_b_sentence_present: true,
      old_fragment_sentence_present: false,
      gemini31_block_present: false,
      last_user_sha256: lastUserSha,
      output_sha256: sha256(resp.text),
      foreign_script: detectForeignScript(resp.text),
      retry: 0,
      continuation: 0,
      recovery: 0,
      fallback: 0,
      rawFile: rawName,
      error: resp.error,
    };
    save(DOCS, metaName, row);
    cells.push(row);
    console.log(
      `[qwen-cohesion] ${calls}/3 B#${sample} chars=${visible} paras=${metrics.PARAGRAPH_COUNT} /1000=${metrics.PARAGRAPHS_PER_1000_CHARS} dlg=${metrics.DIALOGUE_BLOCK_COUNT} finish=${resp.finish_reason}`
    );
  }

  if (calls !== MAX_NEW_CALLS) throw new Error(`CALL_COUNT_MISMATCH:${calls}`);
  for (const name of PROTECTED_EXISTING) {
    const now = sha256(readFileSync(join(DOCS, name), "utf8"));
    if (now !== protectedShas[name]) throw new Error(`PROTECTED_MUTATED:${name}`);
  }

  save(DOCS, "QWEN_OPUS_PARAGRAPH_COHESION_RUNTIME.json", {
    extractedAt: new Date().toISOString(),
    experiment: "OPUS_QWEN_FRAGMENT_SENTENCE replacement A/B",
    TOTAL_NEW_QWEN_CALLS: calls,
    OTHER_MODEL_CALLS: 0,
    MUSE_NEW_CALLS: 0,
    DEEPSEEK_NEW_CALLS: 0,
    GLM_NEW_CALLS: 0,
    GEMINI_NEW_CALLS: 0,
    SOURCE_NEW_CALLS: 0,
    retry: 0,
    continuation: 0,
    recovery: 0,
    fallback: 0,
    temperature: 0.7,
    reasoning_effort: "none",
    model: QWEN_REQUESTED,
    injection: "last-user replacement, not accumulation",
    old_fragment_sentence: OLD_FRAGMENT_SENTENCE,
    candidate_b_sentence: CANDIDATE_B_SENTENCE,
    gemini31_block_used: false,
    production_changed: false,
    main_merged: false,
    railway_deployed: false,
    last_user_sha256: lastUserSha,
    protected_existing_unchanged: true,
    protected_shas: protectedShas,
    baseline_a_structure: baselineA,
    cells,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

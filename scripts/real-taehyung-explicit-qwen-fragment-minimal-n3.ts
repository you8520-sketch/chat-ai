/**
 * PR #427 — Qwen 3.8 fragment-minimal n=3 fill (exactly 4 new calls).
 * Does not overwrite existing n=1 RAWs.
 * Does not call Muse / DeepSeek / GLM / source models.
 *
 * Byte-identical to scripts/real-taehyung-explicit-qwen-fragment-minimal.ts:
 * same assembleBundle, same user turns, same OPUS_QWEN_FRAGMENT_SENTENCE
 * appended to last user for both sources (that is what n=1 actually used).
 * GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK is not added — it would be a new
 * prompt vs existing Gemini n=1.
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
const MAX_NEW_CALLS = 4;
const OPUS_QWEN_FRAGMENT_SENTENCE =
  "문단과 대사 분절은 직전 assistant의 패턴을 따른다. 같은 화자의 이어지는 발화나 하나의 연속된 행동 흐름을 한두 문장마다 새 문단으로 불필요하게 쪼개지 않는다.";
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

function paragraphStats(text: string) {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return {
    paragraph_count: paragraphs.length,
    dialogue_paragraph_count: paragraphs.filter((p) => /["“「『]/.test(p)).length,
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

  const existingOpus = join(DOCS, "QWEN_OPUS_FRAGMENT_MINIMAL.txt");
  const existingGemini = join(DOCS, "QWEN_GEMINI_FRAGMENT_MINIMAL.txt");
  if (!existsSync(existingOpus) || !existsSync(existingGemini)) {
    throw new Error("EXISTING_QWEN_N1_MISSING");
  }
  const existingOpusSha = sha256(readFileSync(existingOpus, "utf8"));
  const existingGeminiSha = sha256(readFileSync(existingGemini, "utf8"));

  const opusSource = readFileSync(join(LIVE_ROOT, "opus/source/provider-raw.txt"), "utf8");
  const geminiSource = readFileSync(join(LIVE_ROOT, "gemini/source/provider-raw.txt"), "utf8");
  const {
    CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    buildCheaperInferenceHeaders,
  } = await import("../src/lib/cheaperInferenceConfig");
  const { visibleAssistantDisplayCharCount } = await import(
    "../src/lib/chatDisplayLength"
  );

  const greeting = String(fixtures.character.greeting ?? "").trim();
  const baseHistory: ChatMsg[] = greeting
    ? [{ role: "assistant", content: greeting }]
    : [];
  const jobs = [
    { id: "opus" as const, sample: 2, sourceText: opusSource },
    { id: "opus" as const, sample: 3, sourceText: opusSource },
    { id: "gemini" as const, sample: 2, sourceText: geminiSource },
    { id: "gemini" as const, sample: 3, sourceText: geminiSource },
  ];

  const cells: Record<string, unknown>[] = [];
  let calls = 0;
  const lastUserShas: Record<string, string> = {};

  for (const job of jobs) {
    if (calls >= MAX_NEW_CALLS) throw new Error("CALL_BUDGET_EXCEEDED");
    const bundle = await assembleBundle({
      assembleModelId: QWEN_REQUESTED,
      requestModelId: QWEN_REQUESTED,
      character: fixtures.character,
      persona: fixtures.persona!,
      history: [
        ...baseHistory,
        { role: "user", content: SOURCE_SEED_USER },
        { role: "assistant", content: job.sourceText },
      ],
      currentUserMessage: ADULT_HANDOFF_USER,
      adultHandoff: true,
    });
    const lastUser = [...bundle.messages].reverse().find((m) => m.role === "user");
    if (!lastUser) throw new Error("QWEN_FRAGMENT_NO_USER_TURN");
    lastUser.content = `${lastUser.content.trimEnd()}\n\n${OPUS_QWEN_FRAGMENT_SENTENCE}`;
    if (!lastUser.content.includes(OPUS_QWEN_FRAGMENT_SENTENCE)) {
      throw new Error("QWEN_FRAGMENT_SENTENCE_NOT_INJECTED");
    }
    const blob = `${bundle.systemPrompt}\n${bundle.messages.map((m) => m.content).join("\n")}`;
    const leaks = FORBIDDEN.filter((n) => blob.includes(n));
    if (leaks.length) throw new Error(`ASSEMBLE_LEAK:${leaks.join(",")}`);
    if ((bundle.requestBody as Record<string, unknown>).temperature !== 0.7) {
      throw new Error(`TEMPERATURE_UNEXPECTED:${String((bundle.requestBody as Record<string, unknown>).temperature)}`);
    }
    if ((bundle.requestBody as Record<string, unknown>).reasoning_effort !== "none") {
      throw new Error(
        `REASONING_UNEXPECTED:${String((bundle.requestBody as Record<string, unknown>).reasoning_effort)}`
      );
    }
    const lastUserSha = sha256(lastUser.content);
    lastUserShas[`${job.id}_${job.sample}`] = lastUserSha;
    if (job.sample === 3 && lastUserShas[`${job.id}_2`] !== lastUserSha) {
      throw new Error(`LAST_USER_SHA_MISMATCH:${job.id}`);
    }

    console.log(`\n=== CALL ${calls + 1}/4 ${job.id} sample ${job.sample} → ${QWEN_REQUESTED} fragment-minimal ===`);
    const resp = await streamProvider(
      CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
      buildCheaperInferenceHeaders(),
      bundle.requestBody
    );
    calls += 1;
    if (resp.http_status !== 200 || resp.error) {
      throw new Error(`HTTP_${resp.http_status}:${resp.error ?? "empty"}`);
    }
    const stats = paragraphStats(resp.text);
    const visible = visibleAssistantDisplayCharCount(resp.text);
    const usage = extractUsage(resp.usage);
    const rawName = `QWEN_${job.id.toUpperCase()}_FRAGMENT_MINIMAL_${job.sample}.txt`;
    const metaName = `QWEN_${job.id.toUpperCase()}_FRAGMENT_MINIMAL_${job.sample}_META.json`;
    if (existsSync(join(DOCS, rawName))) {
      throw new Error(`REFUSING_OVERWRITE:${rawName}`);
    }
    save(DOCS, rawName, resp.text);
    const row = {
      source: job.id,
      sample: job.sample,
      requested_model: QWEN_REQUESTED,
      resolved_model: resp.resolved_model,
      HTTP_status: resp.http_status,
      finish_reason: resp.finish_reason,
      visible_chars: visible,
      ...stats,
      paragraphs_per_1000: visible > 0 ? Number(((stats.paragraph_count / visible) * 1000).toFixed(3)) : 0,
      latency_ms: resp.latency_ms,
      ttft_ms: resp.ttft_ms,
      ...usage,
      temperature: 0.7,
      reasoning_effort: "none",
      fragment_sentence_present: true,
      gemini31_block_present: false,
      last_user_sha256: lastUserSha,
      output_sha256: sha256(resp.text),
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
      `[qwen-n3] ${calls}/4 ${job.id}#${job.sample} chars=${visible} paras=${stats.paragraph_count} cost=${usage.usage_cost} finish=${resp.finish_reason}`
    );
  }

  if (calls !== MAX_NEW_CALLS) throw new Error(`CALL_COUNT_MISMATCH:${calls}`);
  if (sha256(readFileSync(existingOpus, "utf8")) !== existingOpusSha) {
    throw new Error("EXISTING_OPUS_N1_MUTATED");
  }
  if (sha256(readFileSync(existingGemini, "utf8")) !== existingGeminiSha) {
    throw new Error("EXISTING_GEMINI_N1_MUTATED");
  }

  save(DOCS, "QWEN_FRAGMENT_MINIMAL_N3_RUNTIME.json", {
    extractedAt: new Date().toISOString(),
    TOTAL_NEW_QWEN_CALLS: calls,
    MUSE_NEW_CALLS: 0,
    DEEPSEEK_NEW_CALLS: 0,
    GLM_NEW_CALLS: 0,
    SOURCE_NEW_CALLS: 0,
    retry: 0,
    continuation: 0,
    recovery: 0,
    fallback: 0,
    temperature: 0.7,
    reasoning_effort: "none",
    adapter: "OPUS_QWEN_FRAGMENT_SENTENCE for both sources (byte-identical to n=1)",
    gemini31_block_used: false,
    existing_n1_unchanged: true,
    existing_opus_n1_sha256: existingOpusSha,
    existing_gemini_n1_sha256: existingGeminiSha,
    last_user_shas: lastUserShas,
    cells,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

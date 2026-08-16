/**
 * Qwen fragment-minimal 2-call follow-up. Only run after production finalizer
 * still leaves clear paragraph/dialogue fragmentation.
 *
 *   node --conditions=react-server --import tsx \
 *     scripts/real-taehyung-explicit-qwen-fragment-minimal.ts
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
const QWEN_REQUESTED = "qwen-3-8-max";
const QWEN_FRAGMENT_SENTENCE =
  "문단과 대사 분절은 직전 assistant의 패턴을 따른다. 같은 화자의 이어지는 발화나 하나의 연속된 행동 흐름을 한두 문장마다 새 문단으로 불필요하게 쪼개지 않는다.";

const SOURCE_SEED_USER = `*문을 닫고 들어온 뒤, 복도 소음이 멀어질 때까지 그대로 서 있다. 방 안에는 우리 둘만 남는다.*

오늘은 사람들 없을 때 이렇게 남아 있는 게 더 편하다. …너도 그렇지?

*라이크 쪽으로 한 걸음 다가가 소매 끝을 잡는다. 거리는 가깝고, 그 이상은 아직 기다린다.*`;

const ADULT_HANDOFF_USER = `*잡은 소매에서 손으로 올라가 허리를 감싼다. 몸이 맞닿고, 숨이 가까워진다.*

이대로 더 해도 돼. 피하지 마.

*입술이 닿은 다음, 손을 옷 안으로 밀어 넣으며 더 깊게 밀착한다. 삽입해도 된다는 뜻으로 다리를 벌리고 그를 끌어당긴다.*`;

type ChatMsg = { role: "user" | "assistant" | "system"; content: string };

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
      latency_s: (Date.now() - started) / 1000,
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
    for (const line of parts) processSseLine(line, state);
  }
  if (buf.trim()) processSseLine(buf, state);
  return {
    http_status: res.status,
    text: state.text,
    finish_reason: state.finish,
    usage: state.usage,
    resolved_model: state.resolved,
    latency_s: (Date.now() - started) / 1000,
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
  const sources = [
    { id: "opus" as const, sourceText: opusSource },
    { id: "gemini" as const, sourceText: geminiSource },
  ];

  const cells: Record<string, { raw: string; meta: Record<string, unknown> }> = {};
  let calls = 0;
  for (const source of sources) {
    const bundle = await assembleBundle({
      assembleModelId: QWEN_REQUESTED,
      requestModelId: QWEN_REQUESTED,
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
    const lastUser = [...bundle.messages].reverse().find((m) => m.role === "user");
    if (!lastUser) throw new Error("QWEN_FRAGMENT_NO_USER_TURN");
    lastUser.content = `${lastUser.content.trimEnd()}\n\n${QWEN_FRAGMENT_SENTENCE}`;
    if (!lastUser.content.includes(QWEN_FRAGMENT_SENTENCE)) {
      throw new Error("QWEN_FRAGMENT_SENTENCE_NOT_INJECTED");
    }
    console.log(`\n=== CALL Q${calls + 1} ${source.id} → ${QWEN_REQUESTED} fragment-minimal ===`);
    calls += 1;
    const resp = await streamProvider(
      CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
      buildCheaperInferenceHeaders(),
      bundle.requestBody
    );
    const stats = paragraphStats(resp.text);
    const meta = {
      requested_model: QWEN_REQUESTED,
      resolved_model: resp.resolved_model,
      HTTP_status: resp.http_status,
      finish_reason: resp.finish_reason,
      visible_chars: visibleAssistantDisplayCharCount(resp.text),
      ...stats,
      latency: resp.latency_s,
      ...extractUsage(resp.usage),
      temperature: bundle.generation.temperature,
      top_p: bundle.generation.top_p,
      thinking: bundle.generation.thinking,
      reasoning_effort: bundle.generation.reasoning_effort,
      fragment_sentence_present: true,
      retry: 0,
      continuation: 0,
      recovery: 0,
      fallback: 0,
      error: resp.error,
    };
    const dir = join(OUT_ROOT, "live", source.id, "qwen-fragment-minimal");
    save(dir, "provider-raw.txt", resp.text);
    save(dir, "meta.json", meta);
    cells[source.id] = { raw: resp.text, meta };
  }

  const reviewPath = join(DOCS, "CLEAN_FOLLOWUP_DIRECT_REVIEW.md");
  let review = readFileSync(reviewPath, "utf8");
  if (!review.includes("## Qwen 3.8 Max fragment-minimal")) {
    review = review.replace(
      /(# Gemini source\n)/,
      `## Qwen 3.8 Max fragment-minimal\n\n${cells.opus?.raw || "_NO_OUTPUT_"}\n\n$1`
    );
    review += `\n## Qwen 3.8 Max fragment-minimal\n\n${cells.gemini?.raw || "_NO_OUTPUT_"}\n`;
    save(DOCS, "CLEAN_FOLLOWUP_DIRECT_REVIEW.md", review);
    save(OUT_ROOT, "CLEAN_FOLLOWUP_DIRECT_REVIEW.md", review);
  }

  const runtimePath = join(DOCS, "CLEAN_FOLLOWUP_RUNTIME.json");
  const runtime = existsSync(runtimePath)
    ? JSON.parse(readFileSync(runtimePath, "utf8")) as Record<string, unknown>
    : {};
  runtime.QWEN_FRAGMENT_PROMPT_TEST = "REQUIRED";
  runtime.QWEN_FRAGMENT_API_CALLS = calls;
  runtime.TOTAL_NEW_API_CALLS = Number(runtime.DEEPSEEK_CLEAN_API_CALLS ?? 2) + calls;
  runtime.qwen_fragment_minimal = Object.fromEntries(
    Object.entries(cells).map(([k, v]) => [k, v.meta])
  );
  save(DOCS, "CLEAN_FOLLOWUP_RUNTIME.json", runtime);
  save(OUT_ROOT, "CLEAN_FOLLOWUP_RUNTIME.json", runtime);

  const summaryPath = join(DOCS, "CLEAN_FOLLOWUP_SUMMARY.json");
  const summary = existsSync(summaryPath)
    ? JSON.parse(readFileSync(summaryPath, "utf8")) as Record<string, unknown>
    : {};
  summary.QWEN_FRAGMENT_CALLS = calls;
  summary.TOTAL_NEW_API_CALLS = Number(summary.DEEPSEEK_CLEAN_CALLS ?? 2) + calls;
  summary.QWEN_FRAGMENT_RETEST_REQUIRED = true;
  summary.CAPTURE_COMPLETE = Number(summary.DEEPSEEK_CLEAN_CALLS ?? 2) === 2 && calls === 2;
  save(DOCS, "CLEAN_FOLLOWUP_SUMMARY.json", summary);
  save(OUT_ROOT, "CLEAN_FOLLOWUP_SUMMARY.json", summary);
  console.log(JSON.stringify({
    QWEN_FRAGMENT_CALLS: calls,
    OPUS_STATUS: cells.opus?.meta.HTTP_status ?? null,
    GEMINI_STATUS: cells.gemini?.meta.HTTP_status ?? null,
    OPUS_PARAGRAPHS: cells.opus?.meta.paragraph_count ?? null,
    GEMINI_PARAGRAPHS: cells.gemini?.meta.paragraph_count ?? null,
  }, null, 2));
}

void PRODUCTION_LIKE_CHARACTER_ID;
main().catch((err) => {
  console.error(err);
  process.exit(1);
});

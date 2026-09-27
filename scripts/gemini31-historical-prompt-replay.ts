/**
 * Phase 2 — historical FULL prompt replay on CI (same route as Phase1 Arm A).
 * Loads frozen messages from historical-freeze/; exactly one call per sample.
 */
import "./lib/server-only-mock";
import fs from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "./load-env-local";
import {
  exitIfBenchmarkCheaperInferenceApiKeyMissing,
  sanitizeBenchmarkCredentialText,
} from "./lib/benchmarkCheaperInferenceCredential";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const OUT =
  process.env.HIST_REPLAY_OUT?.trim() ||
  "/opt/cursor/artifacts/gemini31-serving-path-parity/historical-replay";
const MSG_PATH =
  process.env.HIST_MESSAGES?.trim() ||
  "/opt/cursor/artifacts/gemini31-serving-path-parity/historical-freeze/messages.json";
const RUNS = Math.max(1, Math.min(5, Number(process.env.PHASE2_RUNS ?? "3") || 3));

function write(rel: string, content: string | object) {
  const p = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(
    p,
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8",
  );
}

async function streamOnce(
  url: string,
  headers: Record<string, string>,
  body: unknown,
) {
  const started = Date.now();
  let text = "";
  let finish: string | null = null;
  let usage: Record<string, unknown> | null = null;
  let returnedModel: string | null = null;
  let generationId: string | null = null;
  let error: string | null = null;
  let status = 0;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12 * 60 * 1000),
    });
    status = res.status;
    if (!res.ok || !res.body) {
      error = sanitizeBenchmarkCredentialText((await res.text()).slice(0, 1500));
      return { text, finish, usage, returnedModel, generationId, error, status, latencyMs: Date.now() - started };
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const handle = (line: string) => {
      const t = line.trim();
      if (!t.startsWith("data:")) return;
      const data = t.slice(5).trim();
      if (!data || data === "[DONE]") return;
      try {
        const ev = JSON.parse(data) as Record<string, unknown>;
        if (typeof ev.model === "string") returnedModel = ev.model;
        if (typeof ev.id === "string") generationId = ev.id;
        const choice = (ev.choices as Array<Record<string, unknown>> | undefined)?.[0];
        const delta = (choice?.delta ?? {}) as Record<string, unknown>;
        if (typeof delta.content === "string") text += delta.content;
        if (typeof choice?.finish_reason === "string" && choice.finish_reason) finish = choice.finish_reason;
        if (ev.usage && typeof ev.usage === "object") usage = ev.usage as Record<string, unknown>;
      } catch { /* */ }
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      lines.forEach(handle);
    }
    buf += dec.decode();
    if (buf.trim()) handle(buf);
  } catch (e) {
    error = sanitizeBenchmarkCredentialText(String(e)).slice(0, 1500);
  }
  return { text, finish, usage, returnedModel, generationId, error, status, latencyMs: Date.now() - started };
}

async function main() {
  const apiKey = exitIfBenchmarkCheaperInferenceApiKeyMissing("HIST_REPLAY_NOT_RUN");
  const { CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL } = await import("../src/lib/chatModels");
  const {
    CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    adaptCheaperInferenceChatBody,
    buildCheaperInferenceHeaders,
  } = await import("../src/lib/cheaperInferenceConfig");
  const { visibleAssistantDisplayCharCount } = await import("../src/lib/chatDisplayLength");
  const { GEMINI_PRO_GENERATION_PARAMS } = await import("../src/lib/openRouterClient");

  const messages = JSON.parse(fs.readFileSync(MSG_PATH, "utf8"));
  const histMeta = JSON.parse(
    fs.readFileSync(
      path.join(path.dirname(MSG_PATH), "meta.json"),
      "utf8",
    ),
  );
  const results = [];
  let calls = 0;
  for (let run = 1; run <= RUNS; run++) {
    const body = adaptCheaperInferenceChatBody({
      model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      messages: structuredClone(messages),
      stream: true,
      stream_options: { include_usage: true },
      temperature: GEMINI_PRO_GENERATION_PARAMS.temperature,
    });
    delete body.max_tokens;
    body.reasoning_effort = "low";
    delete body.reasoning;
    delete body.thinking;
    console.log(`[hist] run${run} …`);
    const cap = await streamOnce(
      CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
      buildCheaperInferenceHeaders(apiKey),
      body,
    );
    calls += 1;
    const details = cap.usage?.completion_tokens_details as
      | { reasoning_tokens?: unknown }
      | undefined;
    const reasoningReported =
      typeof details?.reasoning_tokens === "number" ? "REPORTED" : "UNREPORTED";
    const row = {
      arm: "HIST",
      run,
      historical_commit: histMeta.historical_commit,
      frozen_prompt_hash: histMeta.frozen_prompt_hash,
      requested_model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      returned_model: cap.returnedModel,
      generation_id: cap.generationId,
      prompt_tokens: typeof cap.usage?.prompt_tokens === "number" ? cap.usage.prompt_tokens : null,
      completion_tokens:
        typeof cap.usage?.completion_tokens === "number" ? cap.usage.completion_tokens : null,
      reasoning_reporting_state: reasoningReported,
      reasoning_tokens:
        reasoningReported === "REPORTED" ? Number(details!.reasoning_tokens) : null,
      visible_chars: visibleAssistantDisplayCharCount(cap.text),
      finish_reason: cap.finish,
      latency_ms: cap.latencyMs,
      provider_calls: 1,
      status: cap.status,
      error: cap.error,
    };
    write(`run${run}/raw.txt`, cap.text);
    write(`run${run}/meta.json`, { ...row, usage: cap.usage });
    results.push(row);
    console.log(
      `  visible=${row.visible_chars} finish=${row.finish_reason} completion=${row.completion_tokens} reason=${row.reasoning_tokens} err=${row.error ? "YES" : "no"}`,
    );
  }
  write("RESULTS.json", results);
  write("SUMMARY.json", { provider_calls: calls, per_sample: 1 });
  console.log(`provider calls=${calls}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

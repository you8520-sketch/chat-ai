/**
 * DeepSeek 0813 TRUE-OFF transport audit.
 * No Style Mirror. No Completion. No RP quality evaluation.
 *
 *   node --conditions=react-server --import tsx scripts/deepseek-0813-true-off-transport-audit.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";
import { adaptCheaperInferenceChatBody } from "../src/lib/cheaperInferenceConfig";
import {
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  buildCheaperInferenceHeaders,
} from "../src/lib/cheaperInferenceConfig";

loadEnvLocal();

const OUT =
  process.env.OUT_ROOT ??
  "/opt/cursor/artifacts/deepseek-0813-true-off-transport";
const DOC = "docs/audits/deepseek-0813-true-off-transport";
const TARGET = "deepseek-v4-pro-0813";
const FIXTURE = "Reply with only the digit 4.";
const MAX_PROBES = 3;

function save(dir: string, name: string, content: string | object) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, name),
    typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`,
    "utf8"
  );
}

function saveBoth(name: string, content: string | object) {
  save(OUT, name, content);
  save(DOC, name, content);
}

type StreamState = {
  text: string;
  finish: string | null;
  usage: Record<string, unknown> | null;
  resolved: string | null;
  sawDone: boolean;
  reasoningChars: number;
  reasoningEvents: number;
  firstVisibleAt: number | null;
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
  const choices = ev.choices as Array<Record<string, unknown>> | undefined;
  const choice0 = choices?.[0];
  const delta = choice0?.delta as Record<string, unknown> | undefined;
  const message = choice0?.message as Record<string, unknown> | undefined;
  const content =
    typeof delta?.content === "string"
      ? delta.content
      : typeof message?.content === "string"
        ? String(message.content)
        : "";
  if (content) {
    if (state.firstVisibleAt == null) state.firstVisibleAt = Date.now();
    state.text += content;
  }
  const reasoning =
    (typeof delta?.reasoning === "string" && delta.reasoning) ||
    (typeof delta?.reasoning_content === "string" && delta.reasoning_content) ||
    "";
  if (reasoning) {
    state.reasoningEvents += 1;
    state.reasoningChars += [...reasoning].length;
  }
  if (typeof choice0?.finish_reason === "string" && choice0.finish_reason) {
    state.finish = choice0.finish_reason;
  }
  if (ev.usage && typeof ev.usage === "object") {
    state.usage = ev.usage as Record<string, unknown>;
  }
}

async function streamOnce(body: Record<string, unknown>) {
  const started = Date.now();
  const state: StreamState = {
    text: "",
    finish: null,
    usage: null,
    resolved: null,
    sawDone: false,
    reasoningChars: 0,
    reasoningEvents: 0,
    firstVisibleAt: null,
  };
  const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: buildCheaperInferenceHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return {
      http: res.status,
      error: (await res.text()).slice(0, 2000),
      text: "",
      finish: null,
      usage: null,
      resolved: null,
      sawDone: false,
      reasoningEvents: 0,
      reasoningChars: 0,
      ttftMs: null as number | null,
      latencyMs: Date.now() - started,
    };
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error("no body");
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    for (const line of parts) processSseLine(line, state);
  }
  if (buf.trim()) processSseLine(buf, state);
  return {
    http: 200,
    error: null as string | null,
    text: state.text,
    finish: state.finish,
    usage: state.usage,
    resolved: state.resolved,
    sawDone: state.sawDone,
    reasoningEvents: state.reasoningEvents,
    reasoningChars: state.reasoningChars,
    ttftMs: state.firstVisibleAt == null ? null : state.firstVisibleAt - started,
    latencyMs: Date.now() - started,
  };
}

function baseMessages() {
  return [{ role: "user", content: FIXTURE }];
}

function currentOutbound(): Record<string, unknown> {
  return adaptCheaperInferenceChatBody({
    model: TARGET,
    messages: baseMessages(),
    stream: true,
    stream_options: { include_usage: true },
    temperature: 0,
    max_tokens: 32,
    reasoning_effort: "high",
    reasoning: { effort: "none" },
    include_reasoning: true,
  });
}

function reasoningZero(resp: { reasoningEvents: number; reasoningChars: number }): boolean {
  return resp.reasoningEvents === 0 && resp.reasoningChars === 0;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: buildCheaperInferenceHeaders() });
  if (!res.ok) {
    return { http: res.status, error: (await res.text()).slice(0, 1000) };
  }
  return res.json();
}

async function inspectCapabilities() {
  const catalog = (await fetchJson("https://api.cheaperinference.com/v1/models")) as {
    data?: Array<Record<string, unknown>>;
  };
  const entry = (catalog.data ?? []).find((m) => m.id === TARGET) ?? null;
  const openapi = (await fetchJson("https://api.cheaperinference.com/openapi.json")) as {
    paths?: Record<string, { post?: { requestBody?: { content?: Record<string, { schema?: { $ref?: string } }> } } }>;
    components?: { schemas?: Record<string, Record<string, unknown>> };
  };
  const ccSchema = openapi.components?.schemas?.ChatCompletionRequest ?? null;
  const ccProps = (ccSchema?.properties ?? {}) as Record<string, unknown>;
  const openapiText = JSON.stringify(openapi);
  const capabilities = {
    source: "GET https://api.cheaperinference.com/v1/models",
    exact_model_id: TARGET,
    entry,
    named_capability_flags: entry
      ? ((entry.capabilities as Record<string, unknown> | undefined) ?? null)
      : null,
    field_support: {
      enable_thinking: {
        catalog_capability: false,
        openapi_chat_property: "enable_thinking" in ccProps,
        openapi_anywhere: openapiText.includes("enable_thinking"),
        docs_chat_forwarded: false,
        existing_adapter_evidence: false,
        probe_allowed: false,
      },
      thinking: {
        catalog_capability: false,
        openapi_chat_property: "thinking" in ccProps,
        openapi_messages_property: true,
        docs_chat_forwarded: false,
        existing_adapter_evidence: true,
        note: "Current RP adapter sends thinking={type:disabled}. Style Track S1 already showed this is not proven off.",
      },
      reasoning_effort: {
        catalog_capability: false,
        openapi_chat_property: "reasoning_effort" in ccProps,
        openapi_anywhere: openapiText.includes("reasoning_effort"),
        docs_chat_forwarded: false,
        existing_adapter_evidence: true,
        note: "TRPG isolated 0813 adapters add reasoning_effort=none because thinking.disabled alone does not turn reasoning off.",
        probe_allowed: true,
      },
      reasoning: {
        catalog_capability: false,
        openapi_chat_property: "reasoning" in ccProps,
        docs_chat_forwarded: true,
        existing_adapter_evidence: true,
        note: "CI chat schema lists reasoning; docs say it is forwarded. RP DeepSeek adapter currently deletes it. Luna/Terra adapter sends reasoning.effort=none.",
        probe_allowed: true,
      },
      include_reasoning: {
        catalog_capability: false,
        openapi_chat_property: "include_reasoning" in ccProps,
        openapi_anywhere: openapiText.includes("include_reasoning"),
        existing_adapter_evidence: false,
        probe_allowed: false,
      },
    },
    chat_completion_top_level_properties: Object.keys(ccProps).sort(),
    chat_completion_additional_properties: ccSchema?.additionalProperties === true,
  };
  saveBoth("CI_CAPABILITIES.json", capabilities);
  saveBoth("CI_MODEL_ENTRY.json", entry);
  saveBoth("OPENAPI_CHAT_COMPLETION_REQUEST.json", ccSchema);
  return capabilities;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(DOC, { recursive: true });
  const capabilities = await inspectCapabilities();
  const outbound = currentOutbound();
  saveBoth("CURRENT_OUTBOUND.json", outbound);

  const probes: Record<string, unknown>[] = [];
  let used = 0;

  type Candidate = {
    id: string;
    reason: string;
    body: Record<string, unknown>;
  };

  const candidates: Candidate[] = [];
  if (capabilities.field_support.reasoning_effort.probe_allowed) {
    candidates.push({
      id: "current_plus_reasoning_effort_none",
      reason:
        "Existing TRPG 0813 adapter evidence: add only reasoning_effort=none to current thinking.disabled.",
      body: {
        ...outbound,
        reasoning_effort: "none",
      },
    });
  }
  if (capabilities.field_support.reasoning.probe_allowed) {
    candidates.push({
      id: "current_plus_reasoning_effort_object_none",
      reason:
        "CI OpenAPI/docs forward reasoning. Add only reasoning={effort:none} to current thinking.disabled.",
      body: {
        ...outbound,
        reasoning: { effort: "none" },
      },
    });
  }

  let foundConfig: string | null = null;
  let reproduced = false;

  for (const candidate of candidates) {
    if (used >= MAX_PROBES) break;
    let consecutiveZeros = 0;
    for (let n = 1; n <= 2; n += 1) {
      if (used >= MAX_PROBES) break;
      used += 1;
      const probeNo = used;
      console.log(`=== probe ${probeNo} ${candidate.id} call ${n} ===`);
      const resp = await streamOnce(candidate.body);
      const row = {
        probe: probeNo,
        config_id: candidate.id,
        reason: candidate.reason,
        outbound: {
          model: candidate.body.model,
          thinking: candidate.body.thinking ?? null,
          reasoning_effort: candidate.body.reasoning_effort ?? null,
          reasoning: candidate.body.reasoning ?? null,
          include_reasoning: candidate.body.include_reasoning ?? null,
          enable_thinking: candidate.body.enable_thinking ?? null,
          temperature: candidate.body.temperature ?? null,
          max_tokens: candidate.body.max_tokens ?? null,
        },
        http: resp.http,
        error: resp.error,
        reasoning_events: resp.reasoningEvents,
        reasoning_chars: resp.reasoningChars,
        ttft_ms: resp.ttftMs,
        latency_ms: resp.latencyMs,
        finish_reason: resp.finish,
        response_model: resp.resolved,
        visible_chars: [...resp.text].length,
        visible_preview: resp.text.slice(0, 80),
        usage: resp.usage,
      };
      probes.push(row);
      save(OUT, `probe${probeNo}.json`, row);
      save(DOC, `probe${probeNo}.json`, row);
      if (resp.http !== 200 || !reasoningZero(resp)) {
        consecutiveZeros = 0;
        break;
      }
      consecutiveZeros += 1;
    }
    if (consecutiveZeros >= 2) {
      foundConfig = candidate.id;
      reproduced = true;
      break;
    }
  }

  const report = {
    status: "DEEPSEEK0813_TRUE_OFF_TRANSPORT_AUDIT",
    CURRENT_THINKING_DISABLED_PROVEN_OFF: false,
    TARGET,
    FIXTURE,
    MODEL_STYLE_CALLS: 0,
    SOURCE_MIRROR_CALLS: 0,
    COMPLETION_CALLS: 0,
    probes_used: used,
    probes,
    TRUE_OFF_CONFIG_FOUND: foundConfig,
    TRUE_OFF_REPRODUCED: reproduced,
    RECOMMENDED_OUTBOUND: reproduced
      ? probes.filter((p) => p.config_id === foundConfig).at(-1)
      : "TRUE_OFF_NOT_AVAILABLE_OR_NOT_PROVEN — keep current thinking.disabled as requested-off only",
    STYLE_TRACK_S1_RETEST_REQUIRED: reproduced,
    PRODUCTION_CHANGED: false,
    MAIN_MERGED: false,
    RAILWAY_DEPLOYED: false,
  };
  saveBoth("SUMMARY.json", report);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * H1S-R provider triage + exact H1S revalidation.
 * Does not import chat/billing. Does not change H1S production source.
 *
 * STEP=parity   — freeze envelope/message parity only (default)
 * STEP=p0       — one tiny Cheaper Inference probe
 * STEP=control  — one frozen H1R request (requires P0=200)
 * STEP=h1s      — exact frozen H1S request(s)
 */
import { createHash } from "crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { loadEnvLocal } from "../load-env-local";
import {
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  buildCheaperInferenceHeaders,
} from "../../src/lib/cheaperInferenceConfig";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "../../src/lib/chatModels";

loadEnvLocal();

const ROOT = process.cwd();
const EVIDENCE = path.join(ROOT, "data/ds0813-phase-h1s-r-provider-triage");
const STEP = (process.env.STEP ?? "parity").trim();
const DEEPSEEK = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;
const FLOOR = 2700;

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function shaJson(obj: unknown): string {
  return sha256(JSON.stringify(obj, Object.keys(obj as object).sort()));
}

type ChatMsg = { role: string; content: string };

function envelopeOf(keys: {
  model: string;
  reasoning_effort: string;
  stream: boolean;
  stream_options: unknown;
  temperature: number;
  thinking: unknown;
  top_p: number;
  MESSAGE_COUNT: number;
}) {
  return {
    model: keys.model,
    reasoning_effort: keys.reasoning_effort,
    stream: keys.stream,
    stream_options: keys.stream_options,
    temperature: keys.temperature,
    thinking: keys.thinking,
    top_p: keys.top_p,
    message_count: keys.MESSAGE_COUNT,
  };
}

function requestBody(messages: ChatMsg[]) {
  return {
    model: DEEPSEEK,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    temperature: 0.92,
    top_p: 0.92,
    thinking: { type: "disabled" },
    reasoning_effort: "none",
  };
}

function messagesSha(messages: ChatMsg[]): string {
  return sha256(messages.map((m) => `${m.role}\u0000${m.content}`).join("\u0001"));
}

function writeJson(rel: string, value: unknown) {
  writeFileSync(path.join(EVIDENCE, rel), JSON.stringify(value, null, 2), "utf8");
}

function writeText(rel: string, value: string) {
  writeFileSync(path.join(EVIDENCE, rel), value, "utf8");
}

type StreamTiming = {
  REQUEST_START: string | null;
  HEADERS_RECEIVED: string | null;
  FIRST_VISIBLE_DELTA: string | null;
  LAST_VISIBLE_DELTA: string | null;
  FINISH_EVENT: string | null;
  TTFT_MS: number | null;
  TOTAL_LATENCY_MS: number | null;
};

function iso(ms: number | null): string | null {
  return ms == null ? null : new Date(ms).toISOString();
}

async function callExactBody(body: Record<string, unknown>, label: string) {
  const wallStart = Date.now();
  let headersMs: number | null = null;
  let firstVisible: number | null = null;
  let lastVisible: number | null = null;
  let finishMs: number | null = null;
  const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: buildCheaperInferenceHeaders(),
    body: JSON.stringify(body),
  });
  headersMs = Date.now();
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    writeText(`${label}_HTTP_${res.status}_BODY.txt`, errText.slice(0, 4000));
    return {
      httpStatus: res.status,
      text: "",
      finishReason: null as string | null,
      usage: null as Record<string, unknown> | null,
      errorBody: errText.slice(0, 800),
      timing: {
        REQUEST_START: iso(wallStart),
        HEADERS_RECEIVED: iso(headersMs),
        FIRST_VISIBLE_DELTA: null,
        LAST_VISIBLE_DELTA: null,
        FINISH_EVENT: null,
        TTFT_MS: null,
        TOTAL_LATENCY_MS: Date.now() - wallStart,
      } satisfies StreamTiming,
    };
  }
  if (!res.body) {
    return {
      httpStatus: res.status,
      text: "",
      finishReason: null as string | null,
      usage: null as Record<string, unknown> | null,
      errorBody: null as string | null,
      timing: {
        REQUEST_START: iso(wallStart),
        HEADERS_RECEIVED: iso(headersMs),
        FIRST_VISIBLE_DELTA: null,
        LAST_VISIBLE_DELTA: null,
        FINISH_EVENT: null,
        TTFT_MS: null,
        TOTAL_LATENCY_MS: Date.now() - wallStart,
      } satisfies StreamTiming,
    };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let carry = "";
  let text = "";
  let finishReason: string | null = null;
  let usage: Record<string, unknown> | null = null;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const now = Date.now();
      carry += decoder.decode(value, { stream: true });
      const lines = carry.split("\n");
      carry = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") {
          if (finishMs == null) finishMs = now;
          continue;
        }
        try {
          const json = JSON.parse(payload) as {
            choices?: Array<{
              delta?: { content?: string | null; text?: string | null };
              finish_reason?: string | null;
            }>;
            usage?: Record<string, unknown>;
          };
          const choice = json.choices?.[0];
          const visible = `${choice?.delta?.content ?? ""}${choice?.delta?.text ?? ""}`;
          if (visible) {
            if (firstVisible == null) firstVisible = now;
            lastVisible = now;
            text += visible;
          }
          if (choice?.finish_reason) {
            finishReason = choice.finish_reason;
            finishMs = now;
          }
          if (json.usage) usage = json.usage;
        } catch {
          /* incomplete SSE */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return {
    httpStatus: res.status,
    text,
    finishReason,
    usage,
    errorBody: null as string | null,
    timing: {
      REQUEST_START: iso(wallStart),
      HEADERS_RECEIVED: iso(headersMs),
      FIRST_VISIBLE_DELTA: iso(firstVisible),
      LAST_VISIBLE_DELTA: iso(lastVisible),
      FINISH_EVENT: iso(finishMs),
      TTFT_MS: firstVisible != null ? firstVisible - wallStart : null,
      TOTAL_LATENCY_MS: Date.now() - wallStart,
    } satisfies StreamTiming,
  };
}

function freezeParity() {
  const h1rKeys = JSON.parse(
    readFileSync(path.join(EVIDENCE, "h1r-frozen/H_HANDOFF.keys.json"), "utf8")
  ) as Parameters<typeof envelopeOf>[0];
  const h1sKeys = JSON.parse(
    readFileSync(path.join(EVIDENCE, "h1s-frozen/H_HANDOFF.keys.json"), "utf8")
  ) as Parameters<typeof envelopeOf>[0];
  const h1rMsgs = JSON.parse(
    readFileSync(path.join(EVIDENCE, "h1r-frozen/DEEPSEEK_HANDOFF_MESSAGES.json"), "utf8")
  ) as ChatMsg[];
  const h1sMsgs = JSON.parse(
    readFileSync(path.join(EVIDENCE, "h1s-frozen/DEEPSEEK_HANDOFF_MESSAGES.json"), "utf8")
  ) as ChatMsg[];
  const h1rEnv = envelopeOf(h1rKeys);
  const h1sEnv = envelopeOf(h1sKeys);
  const diffs = h1rMsgs.map((m, i) => {
    const n = h1sMsgs[i];
    const identical = m.role === n?.role && m.content === n?.content;
    return {
      index: i,
      role: m.role,
      identical,
      h1rChars: m.content.length,
      h1sChars: n?.content.length ?? 0,
      deltaChars: (n?.content.length ?? 0) - m.content.length,
    };
  });
  const systemH1r = h1rMsgs[0]?.content ?? "";
  const systemH1s = h1sMsgs[0]?.content ?? "";
  const ownerStart = systemH1s.indexOf("현재 사용자 턴 전체가 최신 장면 상태다");
  const ownerH1s =
    ownerStart >= 0 ? systemH1s.slice(ownerStart).trim() : "";
  const ownerH1rStart = systemH1r.indexOf("현재 사용자 턴 전체가 최신 장면 상태다");
  const ownerH1r =
    ownerH1rStart >= 0 ? systemH1r.slice(ownerH1rStart).trim() : "";
  const parity = {
    H1R_REQUEST_SHAPE_SHA: shaJson(h1rEnv),
    H1S_REQUEST_SHAPE_SHA: shaJson(h1sEnv),
    REQUEST_ENVELOPE_IDENTICAL: JSON.stringify(h1rEnv) === JSON.stringify(h1sEnv),
    H1R_FINAL_MESSAGES_SHA: messagesSha(h1rMsgs),
    H1S_FINAL_MESSAGES_SHA: messagesSha(h1sMsgs),
    H1R_ENVELOPE: h1rEnv,
    H1S_ENVELOPE: h1sEnv,
    MESSAGE_CONTENT_DIFFS: diffs,
    ONLY_SYSTEM_MESSAGE_DIFFERS: diffs.slice(1).every((d) => d.identical) && !diffs[0]?.identical,
    H1R_SYSTEM_CHARS: systemH1r.length,
    H1S_SYSTEM_CHARS: systemH1s.length,
    H1R_OWNER_CHARS: ownerH1r.length,
    H1S_OWNER_CHARS: ownerH1s.length,
  };
  writeJson("REQUEST_SHAPE_PARITY.json", parity);
  writeText("SYSTEM_H1R_TAIL.txt", ownerH1r);
  writeText("SYSTEM_H1S_TAIL.txt", ownerH1s);
  console.log(JSON.stringify({ phase: "parity", parity }, null, 2));
  return parity;
}

function rowFromCall(label: string, out: Awaited<ReturnType<typeof callExactBody>>) {
  const visible = out.text.replace(/\r/g, "");
  const usable = out.httpStatus === 200 && visible.length > 0;
  return {
    KEY: label,
    QUALITY_SAMPLE: usable,
    LENGTH_SAMPLE: usable,
    HTTP_STATUS: out.httpStatus,
    FINISH_REASON: out.finishReason,
    VISIBLE_CHARS: visible.length,
    UNDER_LENGTH: usable ? visible.length < FLOOR : null,
    USAGE_PRESENT: out.usage != null,
    ERROR_BODY: out.errorBody,
    timing: out.timing,
    usage: out.usage,
    RAW_SHA256: sha256(out.text),
  };
}

async function main() {
  mkdirSync(path.join(EVIDENCE, "raw"), { recursive: true });
  const parity = freezeParity();
  if (STEP === "parity") return;

  if (STEP === "p0") {
    const body = requestBody([{ role: "user", content: "Reply with exactly: pong" }]);
    writeJson("P0_REQUEST.keys.json", {
      model: body.model,
      reasoning_effort: body.reasoning_effort,
      stream: body.stream,
      stream_options: body.stream_options,
      temperature: body.temperature,
      thinking: body.thinking,
      top_p: body.top_p,
      MESSAGE_COUNT: 1,
    });
    const out = await callExactBody(body, "P0");
    writeText("raw/P0.txt", out.text);
    const row = {
      ...rowFromCall("P0", out),
      P0_HTTP_STATUS: out.httpStatus,
      P0_FINISH_REASON: out.finishReason,
      P0_VISIBLE: out.text,
      P0_USAGE_PRESENT: out.usage != null,
      P0_LATENCY_MS: out.timing.TOTAL_LATENCY_MS,
      P0_ERROR_BODY: out.errorBody,
    };
    writeJson("P0.json", row);
    writeJson("raw/P0.meta.json", row);
    console.log(JSON.stringify({ phase: "p0", row }, null, 2));
    if (out.httpStatus !== 200) {
      writeJson("STOP.json", {
        STOP: true,
        PROVIDER_PATH_HEALTHY: false,
        H1S_QUALITY_REVALIDATION_BLOCKED: true,
        P0_HTTP_STATUS: out.httpStatus,
      });
    }
    return;
  }

  if (STEP === "control") {
    if (!existsSync(path.join(EVIDENCE, "P0.json"))) {
      throw new Error("P0.json missing");
    }
    const p0 = JSON.parse(readFileSync(path.join(EVIDENCE, "P0.json"), "utf8")) as {
      HTTP_STATUS: number;
    };
    if (p0.HTTP_STATUS !== 200) throw new Error("P0 was not HTTP 200");
    const h1rMsgs = JSON.parse(
      readFileSync(path.join(EVIDENCE, "h1r-frozen/DEEPSEEK_HANDOFF_MESSAGES.json"), "utf8")
    ) as ChatMsg[];
    const body = requestBody(h1rMsgs);
    const out = await callExactBody(body, "CONTROL_H1R");
    writeText("raw/CONTROL_H1R.txt", out.text);
    const row = {
      ...rowFromCall("CONTROL_H1R", out),
      CONTROL_H1R_HTTP_STATUS: out.httpStatus,
      CONTROL_H1R_VISIBLE_CHARS: out.text.replace(/\r/g, "").length,
      CONTROL_H1R_USAGE_PRESENT: out.usage != null,
      CONTROL_H1R_LATENCY_MS: out.timing.TOTAL_LATENCY_MS,
      CONTROL_H1R_ERROR_BODY: out.errorBody,
      FINAL_MESSAGES_SHA: messagesSha(h1rMsgs),
      EXPECTED_H1R_FINAL_MESSAGES_SHA: parity.H1R_FINAL_MESSAGES_SHA,
    };
    writeJson("CONTROL_H1R.json", row);
    writeJson("raw/CONTROL_H1R.meta.json", row);
    console.log(JSON.stringify({ phase: "control", row }, null, 2));
    if (out.httpStatus !== 200) {
      writeJson("STOP.json", {
        STOP: true,
        PROVIDER_BASIC_PATH_HEALTHY: true,
        KNOWN_GOOD_HANDOFF_PATH_HEALTHY: false,
        H1S_PROMPT_CAUSED_500: "NOT_PROVEN",
        H1S_QUALITY_REVALIDATION_BLOCKED: true,
        CONTROL_H1R_HTTP_STATUS: out.httpStatus,
      });
    }
    return;
  }

  if (STEP === "h1s") {
    const p0 = JSON.parse(readFileSync(path.join(EVIDENCE, "P0.json"), "utf8")) as {
      HTTP_STATUS: number;
    };
    const control = JSON.parse(
      readFileSync(path.join(EVIDENCE, "CONTROL_H1R.json"), "utf8")
    ) as { HTTP_STATUS: number };
    if (p0.HTTP_STATUS !== 200 || control.HTTP_STATUS !== 200) {
      throw new Error("P0 and H1R control must both be HTTP 200");
    }
    const keys = (process.env.H1S_KEYS ?? "H1SR1").split(",").map((k) => k.trim());
    const h1sMsgs = JSON.parse(
      readFileSync(path.join(EVIDENCE, "h1s-frozen/DEEPSEEK_HANDOFF_MESSAGES.json"), "utf8")
    ) as ChatMsg[];
    const body = requestBody(h1sMsgs);
    for (const key of keys) {
      const out = await callExactBody(body, key);
      writeText(`raw/${key}.txt`, out.text);
      const row = {
        ...rowFromCall(key, out),
        FINAL_MESSAGES_SHA: messagesSha(h1sMsgs),
        EXPECTED_H1S_FINAL_MESSAGES_SHA: parity.H1S_FINAL_MESSAGES_SHA,
      };
      writeJson(`${key}.json`, row);
      writeJson(`raw/${key}.meta.json`, row);
      console.log(JSON.stringify({ phase: "h1s", key, row }, null, 2));
      if (out.httpStatus === 500) {
        writeJson("STOP.json", {
          STOP: true,
          H1R_CONTROL_200: true,
          H1S_EXACT_500: true,
          H1S_REQUEST_CONTENT_SPECIFIC_FAILURE: true,
          H1S_QUALITY_REVALIDATION_BLOCKED: true,
          KEY: key,
        });
        return;
      }
    }
    return;
  }

  throw new Error(`unknown STEP=${STEP}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

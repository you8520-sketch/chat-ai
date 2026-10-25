/**
 * Evidence-only Phase E: DeepSeek 0813 transport isolation.
 * Not imported by production. Does not change src/.
 *
 * ASSEMBLE_ONLY=1 — freeze outbound bodies, no provider calls.
 * Otherwise exactly 2 DeepSeek calls (T_HANDOFF, T_HISTORICAL).
 */
import Module from "module";
import { createHash } from "crypto";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "../../src/lib/chatModels";
import { UNIFIED_RESPONSE_LENGTH_TARGET } from "../../src/lib/responseLengthConstants";
import { buildOpenRouterRequestBody } from "../../src/lib/openRouterClient";
import {
  adaptCheaperInferenceChatBody,
  applyDeepSeekAdultHandoffTrueOff,
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  buildCheaperInferenceHeaders,
} from "../../src/lib/cheaperInferenceConfig";
import type { ChatMsg } from "../../src/lib/ai";

const ROOT = process.cwd();
const EVIDENCE = path.join(ROOT, "data/ds0813-phase-e-transport-audit");
const ASSEMBLE_ONLY = process.env.ASSEMBLE_ONLY === "1";
const MODEL = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;
const TARGET = UNIFIED_RESPONSE_LENGTH_TARGET;
const EXPECTED = {
  SYSTEM_SHA: "01cd8ec380ce4f5cd1759c73869536258c99cbd0d55e3dfe28e2f6c2ef787ee6",
  HISTORY_SHA: "29e3149289586f303c3ffc120a299184163b162a78e46e4f264e87231f6d1d58",
  CURRENT_USER_SHA: "f1814a3aa6946b0ff339e0577b8d2130729cafec6b0c42a77cc369f41e379750",
} as const;

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function countHangul(text: string): number {
  return (text.match(/[\uAC00-\uD7A3]/g) ?? []).length;
}

function countParagraphs(text: string): number {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).length;
}

function countDialogue(text: string): number {
  return (text.match(/[「“"][^」”"]+[」”"]/g) ?? []).length;
}

function extractQuotes(text: string): string[] {
  return [...text.matchAll(/[「“"]([^」”"]+)[」”"]/g)].map((m) => m[1].trim()).filter(Boolean);
}

function normalizeDialogue(s: string): string {
  return s.replace(/[….\s]/g, "");
}

function publicBodyKeys(body: Record<string, unknown>): Record<string, unknown> {
  const skip = new Set(["messages"]);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(body).sort()) {
    if (skip.has(key)) continue;
    if (/authorization|api[_-]?key|bearer/i.test(key)) continue;
    out[key] = body[key];
  }
  out.KEYS = Object.keys(body).sort();
  out.HAS_MESSAGES = Array.isArray(body.messages);
  out.MESSAGE_COUNT = Array.isArray(body.messages) ? body.messages.length : 0;
  return out;
}

function flagsFor(text: string, userInput: string) {
  const refusal =
    /죄송하지만|요청을 수행할 수 없|I cannot|I'm unable|cannot comply|정책상 거부/.test(text);
  const meta = /as an ai|language model|system prompt|I am an AI|인공지능으로서/i.test(text);
  const sysLeak =
    /USER_TAIL_LENGTH_OWNER|TARGET_LENGTH|MINIMUM_FLOOR|\[DEEPSEEK LENGTH|SNPV2_DEEPSEEK|NO GODMODDING|CHARACTER KNOWLEDGE BOUNDARY|\[SHORT HISTORY\]/.test(
      text
    );
  const inputQuotes = extractQuotes(userInput).map(normalizeDialogue);
  const userAttributed = [
    ...text.matchAll(/도윤(?:이|은|가|도|만|에게)?[^「“"\n]{0,24}[「“"]([^」”"]+)[」”"]/g),
    ...text.matchAll(/[「“"]([^」”"]+)[」”"][^.!\n]{0,16}도윤/g),
  ].map((m) => normalizeDialogue(m[1]));
  const newUserDialogue = userAttributed.some((q) => q && !inputQuotes.includes(q));
  const userIntentional =
    /도윤(?:이|은|가)?\s*(?:손을 뻗|몸을 돌|고개를 끄덕이며 다가|문을 열고|옷을 벗기|키스를 깊게|답했다|물었다|선택했다|결정했다)/.test(
      text
    );
  return {
    REFUSAL: refusal,
    META_LEAK: meta,
    SYSTEM_LEAK: sysLeak,
    NEW_USER_DIALOGUE_BEYOND_CURRENT_INPUT: newUserDialogue,
    NEW_USER_INTENTIONAL_ACTION_BEYOND_CURRENT_INPUT: userIntentional,
    USER_MAJOR_CHOICE_AUTHORED: /도윤(?:이|은|가)?\s*(?:선택|결정)(?:했다|한다)/.test(text),
    USER_CONSENT_OR_REFUSAL_AUTHORED:
      /도윤(?:이|은|가)?\s*(?:동의|거절|승낙|허락|거부)(?:했다|한다)/.test(text),
    NOTE_INVOLUNTARY_USER_PHYSIOLOGY_NOT_AGENCY:
      "automatic involuntary physiological reactions are allowed",
  };
}

type StreamTiming = {
  REQUEST_START_MS: number | null;
  HEADERS_RECEIVED_MS: number | null;
  FIRST_VISIBLE_DELTA_MS: number | null;
  LAST_VISIBLE_DELTA_MS: number | null;
  FINISH_EVENT_MS: number | null;
  TTFT_MS: number | null;
  VISIBLE_STREAM_DURATION_MS: number | null;
  TOTAL_LATENCY_MS: number | null;
  REASONING_STREAM_EVENTS: number;
  REASONING_TEXT_CHARS: number;
};

function emptyTiming(): StreamTiming {
  return {
    REQUEST_START_MS: null,
    HEADERS_RECEIVED_MS: null,
    FIRST_VISIBLE_DELTA_MS: null,
    LAST_VISIBLE_DELTA_MS: null,
    FINISH_EVENT_MS: null,
    TTFT_MS: null,
    VISIBLE_STREAM_DURATION_MS: null,
    TOTAL_LATENCY_MS: null,
    REASONING_STREAM_EVENTS: 0,
    REASONING_TEXT_CHARS: 0,
  };
}

function finalizeTiming(t: StreamTiming): StreamTiming {
  if (t.REQUEST_START_MS != null && t.FIRST_VISIBLE_DELTA_MS != null) {
    t.TTFT_MS = t.FIRST_VISIBLE_DELTA_MS - t.REQUEST_START_MS;
  }
  if (t.FIRST_VISIBLE_DELTA_MS != null && t.LAST_VISIBLE_DELTA_MS != null) {
    t.VISIBLE_STREAM_DURATION_MS = t.LAST_VISIBLE_DELTA_MS - t.FIRST_VISIBLE_DELTA_MS;
  }
  return t;
}

async function callExactBody(body: Record<string, unknown>) {
  const timing = emptyTiming();
  const wallStart = Date.now();
  timing.REQUEST_START_MS = wallStart;
  const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: buildCheaperInferenceHeaders(),
    body: JSON.stringify(body),
  });
  timing.HEADERS_RECEIVED_MS = Date.now();
  if (!res.body) {
    timing.TOTAL_LATENCY_MS = Date.now() - wallStart;
    return {
      httpStatus: res.status,
      text: "",
      finishReason: null,
      usage: null,
      timing: finalizeTiming(timing),
      error: `empty body ${res.status}`,
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
          if (timing.FINISH_EVENT_MS == null) timing.FINISH_EVENT_MS = now;
          continue;
        }
        try {
          const json = JSON.parse(payload) as {
            choices?: Array<{
              delta?: {
                content?: string | null;
                text?: string | null;
                reasoning?: string | null;
                reasoning_content?: string | null;
              };
              finish_reason?: string | null;
            }>;
            usage?: Record<string, unknown>;
          };
          const choice = json.choices?.[0];
          const reasoning = `${choice?.delta?.reasoning ?? ""}${choice?.delta?.reasoning_content ?? ""}`;
          if (reasoning) {
            timing.REASONING_STREAM_EVENTS += 1;
            timing.REASONING_TEXT_CHARS += [...reasoning].length;
          }
          const visible = `${choice?.delta?.content ?? ""}${choice?.delta?.text ?? ""}`;
          if (visible) {
            if (timing.FIRST_VISIBLE_DELTA_MS == null) timing.FIRST_VISIBLE_DELTA_MS = now;
            timing.LAST_VISIBLE_DELTA_MS = now;
            text += visible;
          }
          if (choice?.finish_reason) {
            finishReason = choice.finish_reason;
            timing.FINISH_EVENT_MS = now;
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
  timing.TOTAL_LATENCY_MS = Date.now() - wallStart;
  return {
    httpStatus: res.status,
    text,
    finishReason,
    usage,
    timing: finalizeTiming(timing),
    error: res.status >= 500 ? `HTTP ${res.status}` : null,
  };
}

function messagesSha(messages: ChatMsg[]): string {
  return sha256(messages.map((m) => `${m.role}\u0000${m.content}`).join("\u0001"));
}

async function main() {
  mkdirSync(path.join(EVIDENCE, "raw"), { recursive: true });
  mkdirSync(path.join(EVIDENCE, "flags"), { recursive: true });
  mkdirSync(path.join(EVIDENCE, "bodies"), { recursive: true });

  const frozen = JSON.parse(
    readFileSync(path.join(EVIDENCE, "baseline/A_A_MESSAGES.json"), "utf8")
  ) as {
    SYSTEM_SHA: string;
    HISTORY_SHA: string;
    CURRENT_USER_SHA: string;
    system: string;
    history: ChatMsg[];
    currentUser: string;
  };
  const inputs = JSON.parse(
    readFileSync(path.join(EVIDENCE, "baseline/user-inputs.json"), "utf8")
  ) as { A: { text: string } };

  const systemSha = sha256(frozen.system);
  const currentUserSha = sha256(frozen.currentUser);
  const lastUser = [...frozen.history].reverse().find((m) => m.role === "user");
  if (!lastUser || lastUser.content !== frozen.currentUser) {
    throw new Error("frozen history current user mismatch");
  }
  const historyOnly = frozen.history
    .filter((m) => !(m.role === "user" && m.content === frozen.currentUser))
    .map((m) => m.content)
    .join("\n\n");
  const historySha = sha256(historyOnly);
  if (
    systemSha !== EXPECTED.SYSTEM_SHA ||
    historySha !== EXPECTED.HISTORY_SHA ||
    currentUserSha !== EXPECTED.CURRENT_USER_SHA
  ) {
    throw new Error(
      `frozen A_A SHA mismatch ${JSON.stringify({ systemSha, historySha, currentUserSha })}`
    );
  }

  const messages: ChatMsg[] = [{ role: "system", content: frozen.system }, ...frozen.history];
  const nativeOpenRouter = buildOpenRouterRequestBody(
    MODEL,
    messages,
    true,
    TARGET
  ) as Record<string, unknown>;
  const native = adaptCheaperInferenceChatBody(nativeOpenRouter);
  const handoff = applyDeepSeekAdultHandoffTrueOff({ ...native });
  const historical: Record<string, unknown> = { ...native };
  historical.temperature = 0.7;
  delete historical.top_p;
  historical.thinking = { type: "disabled" };
  historical.reasoning_effort = "none";
  delete historical.enable_thinking;
  delete historical.reasoning;
  delete historical.include_reasoning;

  const msgShaNative = messagesSha(native.messages as ChatMsg[]);
  const msgShaHandoff = messagesSha(handoff.messages as ChatMsg[]);
  const msgShaHistorical = messagesSha(historical.messages as ChatMsg[]);
  const messagesIdentical =
    msgShaNative === msgShaHandoff && msgShaHandoff === msgShaHistorical;

  const owners = {
    NATIVE_DS_REASONING_EFFORT: native.reasoning_effort ?? "OMITTED",
    HANDOFF_DS_REASONING_EFFORT: handoff.reasoning_effort ?? "OMITTED",
    NATIVE_TRANSPORT: {
      temperature: native.temperature ?? "OMITTED",
      top_p: native.top_p ?? "OMITTED",
      thinking: native.thinking ?? "OMITTED",
      reasoning_effort: native.reasoning_effort ?? "OMITTED",
      max_tokens: native.max_tokens ?? "OMITTED",
    },
    HANDOFF_TRANSPORT: {
      temperature: handoff.temperature ?? "OMITTED",
      top_p: handoff.top_p ?? "OMITTED",
      thinking: handoff.thinking ?? "OMITTED",
      reasoning_effort: handoff.reasoning_effort ?? "OMITTED",
      max_tokens: handoff.max_tokens ?? "OMITTED",
    },
    HISTORICAL_TRANSPORT: {
      temperature: historical.temperature ?? "OMITTED",
      top_p: historical.top_p ?? "OMITTED",
      thinking: historical.thinking ?? "OMITTED",
      reasoning_effort: historical.reasoning_effort ?? "OMITTED",
      max_tokens: historical.max_tokens ?? "OMITTED",
    },
    CODE_OWNERS: {
      file: "src/lib/cheaperInferenceConfig.ts",
      native:
        "adaptCheaperInferenceChatBody deletes reasoning_effort and sets thinking.disabled for DeepSeek V4 Pro",
      handoff:
        "applyDeepSeekAdultHandoffTrueOff / deepSeekAdultHandoffTrueOff keeps thinking.disabled and sets reasoning_effort=none",
    },
    PRODUCTION_DEEPSEEK: {
      temperature: 0.92,
      top_p: 0.92,
      max_tokens: "OMITTED",
      source: {
        temperature: "resolveDeepSeekTemperatureForTarget",
        top_p: "DEEPSEEK_V4_PRO_GENERATION_PARAMS.top_p",
        max_tokens: "resolveOpenRouterMaxTokens returns undefined",
      },
    },
  };
  writeFileSync(path.join(EVIDENCE, "TRANSPORT_OWNERS.json"), JSON.stringify(owners, null, 2), "utf8");

  const parity = {
    SYSTEM_SHA: systemSha,
    HISTORY_SHA: historySha,
    CURRENT_USER_SEMANTIC_SHA: currentUserSha,
    MESSAGES_IDENTICAL: messagesIdentical,
    MESSAGE_SHA: msgShaNative,
    BASELINE_A_A: EXPECTED,
  };
  writeFileSync(path.join(EVIDENCE, "PARITY.json"), JSON.stringify(parity, null, 2), "utf8");

  writeFileSync(
    path.join(EVIDENCE, "bodies/T_NATIVE.keys.json"),
    JSON.stringify(publicBodyKeys(native), null, 2),
    "utf8"
  );
  writeFileSync(
    path.join(EVIDENCE, "bodies/T_HANDOFF.keys.json"),
    JSON.stringify(publicBodyKeys(handoff), null, 2),
    "utf8"
  );
  writeFileSync(
    path.join(EVIDENCE, "bodies/T_HISTORICAL.keys.json"),
    JSON.stringify(publicBodyKeys(historical), null, 2),
    "utf8"
  );

  if (!messagesIdentical) throw new Error("MESSAGES_IDENTICAL=false");
  if (native.reasoning_effort !== undefined) throw new Error("native reasoning_effort not omitted");
  if (handoff.reasoning_effort !== "none") throw new Error("handoff reasoning_effort != none");
  if (historical.reasoning_effort !== "none") throw new Error("historical reasoning_effort != none");
  if (historical.top_p !== undefined) throw new Error("historical top_p not omitted");
  if (historical.temperature !== 0.7) throw new Error("historical temperature != 0.7");
  if (handoff.temperature !== 0.92 || native.temperature !== 0.92) {
    throw new Error("handoff/native temperature != 0.92");
  }

  console.log(JSON.stringify({ phase: "assembled", owners, parity }, null, 2));
  if (ASSEMBLE_ONLY) return;

  const calls: Array<{ key: "T_HANDOFF" | "T_HISTORICAL"; body: Record<string, unknown> }> = [
    { key: "T_HANDOFF", body: handoff },
    { key: "T_HISTORICAL", body: historical },
  ];
  const results: Record<string, unknown>[] = [];
  for (const call of calls) {
    console.log(JSON.stringify({ phase: "calling", key: call.key }));
    const out = await callExactBody(call.body);
    const raw = out.text;
    writeFileSync(path.join(EVIDENCE, "raw", `${call.key}.txt`), raw, "utf8");
    const contaminated =
      out.timing.REASONING_STREAM_EVENTS > 0 || out.timing.REASONING_TEXT_CHARS > 0;
    const flags = {
      ...flagsFor(raw, inputs.A.text),
      TRANSPORT_SAMPLE_CONTAMINATED: contaminated,
    };
    writeFileSync(path.join(EVIDENCE, "flags", `${call.key}.json`), JSON.stringify(flags, null, 2), "utf8");
    const usage = (out.usage ?? {}) as Record<string, unknown>;
    const row = {
      KEY: call.key,
      HTTP_STATUS: out.httpStatus,
      ERROR: out.error,
      FINISH_REASON: out.finishReason,
      INPUT_TOKENS: usage.prompt_tokens ?? usage.input_tokens ?? null,
      OUTPUT_TOKENS: usage.completion_tokens ?? usage.output_tokens ?? null,
      REASONING_TOKENS: usage.reasoning_tokens ?? usage.reasoningOutputTokens ?? null,
      VISIBLE_CHARS: raw.replace(/\r/g, "").length,
      KOREAN_CHARS: countHangul(raw),
      PARAGRAPHS: countParagraphs(raw),
      DIALOGUE_LINES: countDialogue(raw),
      RAW_SHA256: sha256(raw),
      SYSTEM_SHA: systemSha,
      HISTORY_SHA: historySha,
      CURRENT_USER_SEMANTIC_SHA: currentUserSha,
      timing: out.timing,
      flags,
      usage,
    };
    results.push(row);
    writeFileSync(path.join(EVIDENCE, "raw", `${call.key}.meta.json`), JSON.stringify(row, null, 2), "utf8");
    if (out.httpStatus >= 500) {
      writeFileSync(
        path.join(EVIDENCE, `${call.key}_5XX_STOP.json`),
        JSON.stringify({ STOP: true, HTTP_STATUS: out.httpStatus }, null, 2),
        "utf8"
      );
    }
  }

  const h = results.find((r) => r.KEY === "T_HANDOFF") as { VISIBLE_CHARS?: number } | undefined;
  const hist = results.find((r) => r.KEY === "T_HISTORICAL") as { VISIBLE_CHARS?: number } | undefined;
  const nativeChars = 1625;
  const handoffChars = h?.VISIBLE_CHARS ?? 0;
  const historicalChars = hist?.VISIBLE_CHARS ?? 0;
  const handoffGe = handoffChars >= 2700;
  const historicalGe = historicalChars >= 2700;
  const report = {
    T_NATIVE_CHARS: nativeChars,
    T_HANDOFF_CHARS: handoffChars,
    T_HISTORICAL_CHARS: historicalChars,
    T_HANDOFF_GE_2700: handoffGe,
    T_HISTORICAL_GE_2700: historicalGe,
    DELTA_NATIVE_TO_HANDOFF: handoffChars - nativeChars,
    DELTA_NATIVE_TO_HISTORICAL: historicalChars - nativeChars,
    HANDOFF_TRANSPORT_LENGTH_RESTORATION_OBSERVED: handoffGe && nativeChars < 2700,
    HISTORICAL_TRANSPORT_LENGTH_RESTORATION_OBSERVED: historicalGe && nativeChars < 2700,
    TRANSPORT_RESTORATION_NOT_OBSERVED: !handoffGe && !historicalGe,
    COMMON_REASONING_EFFORT_NONE_SIGNAL: handoffGe && historicalGe,
    PROVIDER_CALLS: results.length,
    RETRIES: 0,
    CONTINUATION_CALLS: 0,
    QUALITY_SCORE_ASSIGNED: false,
    MODEL_WINNER_SELECTED: false,
  };
  writeFileSync(
    path.join(EVIDENCE, "LENGTH_REPORT.json"),
    JSON.stringify({ report, results }, null, 2),
    "utf8"
  );
  console.log(JSON.stringify({ phase: "done", report }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

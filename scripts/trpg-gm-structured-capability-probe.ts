/**
 * GM structured-output capability probe — NOT imported by production.
 * Tests exact TRPG_GM_MODEL + stream=true + response_format before patching.
 *
 * Usage:
 *   node --conditions=react-server --import tsx scripts/trpg-gm-structured-capability-probe.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildCheaperInferenceHeaders,
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  resolveCheaperInferenceApiKey,
} from "../src/lib/cheaperInferenceConfig";
import { adaptTrpgGmChatBody } from "../src/lib/trpg/gmClient";
import { finishReasonFromSsePayload } from "../src/lib/trpg/gmCompletionIntegrity";
import { feedGmProviderSseBytes } from "../src/lib/trpg/gmProviderSse";
import { TRPG_GM_MAX_TOKENS, TRPG_GM_MODEL } from "../src/lib/trpg/types";

type ProbeFormat = "json_object" | "json_schema";

const GM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["narration", "delta"],
  properties: {
    narration: { type: "string" },
    delta: {
      type: "object",
      additionalProperties: true,
      properties: {
        players: { type: "array" },
        location: { type: "string" },
        next_round_context: { type: "string" },
        campaign_finished: { type: "boolean" },
        localScene: { type: "object" },
      },
    },
  },
} as const;

const SYSTEM = `You are a TRPG GM. Respond in Korean. Output JSON only with narration (Korean prose) and delta (state changes).`;

const USER = `[ROUND]
Human PC moves toward the door cautiously.
Return JSON: {"narration":"...","delta":{"players":[],"location":"문 앞","next_round_context":"문을 연다","campaign_finished":false}}`;

function responseFormat(kind: ProbeFormat): Record<string, unknown> {
  if (kind === "json_object") return { type: "json_object" };
  return {
    type: "json_schema",
    json_schema: {
      name: "trpg_gm_output",
      strict: true,
      schema: GM_SCHEMA,
    },
  };
}

function deltaContent(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const delta = (payload as { choices?: Array<{ delta?: { content?: unknown } }> }).choices?.[0]?.delta;
  return typeof delta?.content === "string" ? delta.content : "";
}

async function probeOne(kind: ProbeFormat, callIndex: number): Promise<Record<string, unknown>> {
  const body = adaptTrpgGmChatBody({
    model: TRPG_GM_MODEL,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: USER },
    ],
    stream: true,
    temperature: 0.7,
    max_tokens: TRPG_GM_MAX_TOKENS,
    response_format: responseFormat(kind),
  });

  const started = Date.now();
  let httpStatus = 0;
  let streamChunks = 0;
  let rawText = "";
  let finishReason: string | null = null;
  let semanticDone = false;
  let httpError: string | null = null;

  try {
    const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: buildCheaperInferenceHeaders(resolveCheaperInferenceApiKey()),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    httpStatus = res.status;
    if (!res.ok) {
      httpError = (await res.text()).slice(0, 400);
      return {
        kind,
        callIndex,
        REQUEST_RESPONSE_FORMAT: responseFormat(kind),
        HTTP_STATUS: httpStatus,
        HTTP_ERROR: httpError,
        ELAPSED_MS: Date.now() - started,
      };
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("empty stream body");
    const decoder = new TextDecoder();
    const sseState = { buffer: "" };

    const onPayload = (payload: unknown) => {
      const piece = deltaContent(payload);
      if (piece) {
        streamChunks += 1;
        rawText += piece;
      }
      const fr = finishReasonFromSsePayload(payload);
      if (fr) finishReason = fr;
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        feedGmProviderSseBytes(sseState, decoder.decode(), onPayload, true);
        break;
      }
      const sawDone = feedGmProviderSseBytes(
        sseState,
        decoder.decode(value, { stream: true }),
        onPayload,
        false
      );
      if (sawDone) {
        semanticDone = true;
        try {
          await reader.cancel();
        } catch {
          // ignore
        }
        break;
      }
    }
  } catch (err) {
    httpError = err instanceof Error ? err.message : String(err);
  }

  let parsed: unknown = null;
  let parseError: string | null = null;
  try {
    parsed = JSON.parse(rawText.trim());
  } catch (e) {
    parseError = e instanceof Error ? e.message : String(e);
  }

  const obj = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  const narration = typeof obj?.narration === "string" ? obj.narration : "";
  const delta = obj?.delta;

  return {
    kind,
    callIndex,
    REQUEST_RESPONSE_FORMAT: responseFormat(kind),
    HTTP_STATUS: httpStatus,
    HTTP_ERROR: httpError,
    STREAM_CHUNKS_RECEIVED: streamChunks,
    RAW_OUTPUT_CHARS: rawText.length,
    RAW_PREFIX: rawText.slice(0, 120),
    FINAL_JSON_PARSEABLE: parseError == null,
    PARSE_ERROR: parseError,
    SCHEMA_VALID: obj != null && typeof obj.narration === "string" && typeof obj.delta === "object" && obj.delta != null,
    NARRATION_PRESENT: narration.trim().length > 0,
    NARRATION_CHARS: narration.length,
    DELTA_PRESENT: delta != null && typeof delta === "object",
    FINISH_REASON: finishReason,
    SEMANTIC_DONE: semanticDone,
    ELAPSED_MS: Date.now() - started,
  };
}

async function main(): Promise<void> {
  const outDir = join(process.cwd(), "tmp/trpg-gm-structured-capability");
  mkdirSync(outDir, { recursive: true });

  const results: Record<string, unknown>[] = [];
  for (const kind of ["json_object", "json_schema"] as const) {
    for (let i = 1; i <= 3; i += 1) {
      console.info(`[probe] ${kind} call ${i}/3`);
      const row = await probeOne(kind, i);
      results.push(row);
      console.info(JSON.stringify(row, null, 2));
    }
  }

  writeFileSync(join(outDir, "capability-probe.json"), JSON.stringify(results, null, 2));
  console.info(`Wrote ${join(outDir, "capability-probe.json")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

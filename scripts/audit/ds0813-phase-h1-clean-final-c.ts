/**
 * H1-CLEAN FINAL-C — two-call revalidation only.
 *
 * Loads the frozen FINAL-B assembled request. Does not reassemble.
 * Does not edit production prompts, length owner, or sampling params.
 * CI first, OpenRouter fallback allowed. No retries. No continuation.
 */
import Module from "module";
import { createHash } from "crypto";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { loadEnvLocal } from "../load-env-local";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import type { ChatMsg } from "../../src/lib/ai";
import { UNIFIED_RESPONSE_LENGTH_TARGET } from "../../src/lib/responseLengthConstants";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_DEEPSEEK_V4_PRO_0813_BACKUP_MODEL,
} from "../../src/lib/chatModels";
import {
  DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION,
} from "../../src/lib/adultSceneRouting";
import { ADULT_HANDOFF_CURRENT_USER_WRAPPER_BODY } from "../../src/lib/currentUserInputLabel";
import {
  classifyCurrentUserMajorRewind,
  classifyLowStakesAmbientCoaction,
  classifySameBeatMicroContinuation,
  classifyTrueNewUserActionBeat,
} from "../../src/lib/handoffUserActionTaxonomy";
import {
  adaptOpenRouterDeepSeekBackupBody,
  executeDeepSeekWithProviderFailover,
  extractVisibleAssistantDeltaFromSseJson,
  resolveDeepSeekPrimaryTransport,
  type DeepSeekFailoverTelemetry,
  type DeepSeekProviderId,
} from "../../src/lib/deepseekProviderFailover";

loadEnvLocal();

const ROOT = process.cwd();
const FROZEN_B = path.join(ROOT, "data/ds0813-phase-h1-clean-final-b");
const EVIDENCE = path.join(ROOT, "data/ds0813-phase-h1-clean-final-c");
const FLOOR = 2700;
const FROZEN_MESSAGES_SHA = "4a16d53923d88f2f747e6b48b5b3e3ea0f20d67e2b0372d44b45f4a2f6d3e670";
const EXPECTED_OWNER = `현재 사용자 턴이 확정한 장면 다음부터 이어 쓴다. 직전 assistant의 말투·유머·호칭·문장 호흡·대사/서술 균형과 화면에 이미 나온 장면 상태를 자연스럽게 이어, 같은 캐릭터와 같은 글의 다음 부분처럼 작성한다.
이미 다룬 감각이나 행동을 표현만 바꿔 반복하기보다 캐릭터의 새 행동·대사·반응과 그 결과로 장면을 계속 전진시킨다. 현재 사용자 턴이 바꾼 상태가 이전 장면보다 우선한다.`;

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function writeJson(rel: string, value: unknown) {
  writeFileSync(path.join(EVIDENCE, rel), JSON.stringify(value, null, 2), "utf8");
}

function writeText(rel: string, value: string) {
  writeFileSync(path.join(EVIDENCE, rel), value, "utf8");
}

function countHangul(text: string): number {
  return (text.match(/[\uAC00-\uD7A3]/g) ?? []).length;
}

function firstMatchSentence(text: string, re: RegExp): string | null {
  const m = text.match(re);
  if (!m || m.index == null) return null;
  const start = Math.max(0, m.index - 20);
  const end = Math.min(text.length, m.index + Math.max(80, m[0].length + 40));
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

type FlagValue = boolean | "UNCERTAIN";

function flagWithEvidence(
  value: FlagValue,
  evidence: string | null
): { value: FlagValue; evidence: string | null } {
  return { value, evidence: value === false ? null : evidence };
}

function semanticRepetition(text: string): { value: FlagValue; evidence: string | null } {
  const sentences = text
    .split(/(?<=[.!?。…])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12);
  const seen = new Map<string, number>();
  let dup: string | null = null;
  for (const s of sentences) {
    const n = (seen.get(s) ?? 0) + 1;
    seen.set(s, n);
    if (n === 2 && !dup) dup = s.slice(0, 80);
  }
  const kissCycle = (text.match(/키스|입술|숨결/g) ?? []).length;
  if (dup) return { value: "UNCERTAIN", evidence: dup };
  if (kissCycle >= 12) return { value: "UNCERTAIN", evidence: `KISS_CYCLE=${kissCycle}` };
  return { value: false, evidence: null };
}

function flagsFor(text: string, httpStatus: number) {
  const genericLine = firstMatchSentence(
    text,
    /도망치지\s*마|후회해도\s*늦었어|이제\s*안\s*멈춰|이미\s*늦었어|멈출\s*생각\s*없/
  );
  const spoken = firstMatchSentence(
    text,
    /렌(?:이|은|가|도)?[^「“"\n]{0,20}(?:말했다|물었다|답했다|대꾸했다|중얼거렸다|속삭였다)\s*[「“"][^」”"]+[」”"]/
  );
  const spokenQuote = firstMatchSentence(
    text,
    /렌(?:이|은|가|도)?[^.\n]{0,24}[「“"][^」”"]+[」”"]/
  );
  const inner = firstMatchSentence(
    text,
    /렌(?:이|은|가)?\s*(?:속으로|마음속으로|생각했다|바랐다)/
  );
  const intent = firstMatchSentence(
    text,
    /렌(?:이|은|가|도|의)?[^.\n]{0,24}(?:더\s*원하고|원하고\s*있|좋아하(?:고|는)|동의한|거절한|두려운|겁먹은|원했다)/
  );
  const refusal = firstMatchSentence(text, /I cannot fulfill this request|OPENROUTER_API_KEY/);
  const meta = firstMatchSentence(
    text,
    /SceneContinuityPacket|DEEPSEEK_HANDOFF|adult_handoff|STATUS_VALUES/
  );
  const usable = httpStatus === 200 && text.length > 0;
  const trueBeat = classifyTrueNewUserActionBeat(text);
  return {
    SAME_BEAT_MICRO_CONTINUATION: classifySameBeatMicroContinuation(text),
    LOW_STAKES_AMBIENT_COACTION: classifyLowStakesAmbientCoaction(text),
    TRUE_NEW_USER_ACTION_BEAT: trueBeat,
    NEW_USER_DIALOGUE: flagWithEvidence(
      spoken ? true : spokenQuote ? "UNCERTAIN" : false,
      spoken ?? spokenQuote
    ),
    NEW_USER_INNER_THOUGHT: flagWithEvidence(inner ? "UNCERTAIN" : false, inner),
    NEW_USER_INTENT_AS_FACT: flagWithEvidence(Boolean(intent), intent),
    CURRENT_USER_MAJOR_REWIND: classifyCurrentUserMajorRewind(text),
    CHARACTER_VOICE_SEAM: flagWithEvidence(genericLine ? "UNCERTAIN" : false, genericLine),
    GENERIC_ADULT_RP_VOICE: flagWithEvidence(Boolean(genericLine), genericLine),
    SEMANTIC_REPETITION: semanticRepetition(text),
    ODD_OR_NONSENSICAL_PROSE: flagWithEvidence(Boolean(refusal || meta || !usable), refusal ?? meta),
    UNDER_LENGTH: flagWithEvidence(
      usable && text.length < FLOOR,
      usable && text.length < FLOOR ? `VISIBLE_CHARS=${text.length}` : null
    ),
    PRIMARY_REFUSAL_VISIBLE: Boolean(refusal),
    META_LEAK: Boolean(meta),
  };
}

async function consumeStream(response: Response): Promise<{
  text: string;
  finishReason: string | null;
  usage: Record<string, unknown> | null;
  firstVisibleMs: number | null;
  lastVisibleMs: number | null;
}> {
  const started = Date.now();
  if (!response.body) {
    return {
      text: "",
      finishReason: null,
      usage: null,
      firstVisibleMs: null,
      lastVisibleMs: null,
    };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let carry = "";
  let text = "";
  let finishReason: string | null = null;
  let usage: Record<string, unknown> | null = null;
  let firstVisibleMs: number | null = null;
  let lastVisibleMs: number | null = null;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      carry += decoder.decode(value, { stream: true });
      const lines = carry.split("\n");
      carry = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload) as {
            choices?: Array<{ finish_reason?: string | null }>;
            usage?: Record<string, unknown>;
          };
          const visible = extractVisibleAssistantDeltaFromSseJson(json);
          if (visible) {
            const now = Date.now() - started;
            if (firstVisibleMs == null) firstVisibleMs = now;
            lastVisibleMs = now;
            text += visible;
          }
          const reason = json.choices?.[0]?.finish_reason;
          if (reason) finishReason = reason;
          if (json.usage) usage = json.usage;
        } catch {
          /* incomplete SSE */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { text, finishReason, usage, firstVisibleMs, lastVisibleMs };
}

async function callFailover(body: Record<string, unknown>): Promise<{
  usedProvider: DeepSeekProviderId;
  telemetry: DeepSeekFailoverTelemetry;
  httpStatus: number;
  text: string;
  finishReason: string | null;
  usage: Record<string, unknown> | null;
  firstVisibleMs: number | null;
  lastVisibleMs: number | null;
  totalLatencyMs: number;
}> {
  const wallStart = Date.now();
  const primaryTransport = resolveDeepSeekPrimaryTransport();
  const backupBody = adaptOpenRouterDeepSeekBackupBody(
    body,
    OPENROUTER_DEEPSEEK_V4_PRO_0813_BACKUP_MODEL
  );
  if (backupBody.model !== OPENROUTER_DEEPSEEK_V4_PRO_0813_BACKUP_MODEL) {
    throw new Error(`backup model ${String(backupBody.model)}`);
  }
  let telemetry: DeepSeekFailoverTelemetry | null = null;
  const result = await executeDeepSeekWithProviderFailover({
    routeKind: "adult_handoff",
    logicalModel: "pro",
    primary: {
      endpoint: primaryTransport.endpoint,
      headers: primaryTransport.headers,
      body,
    },
    backupBody,
    stream: true,
    hooks: {
      onTelemetry: (next) => {
        telemetry = next;
      },
    },
  });
  const consumed = await consumeStream(result.response);
  return {
    usedProvider: result.usedProvider,
    telemetry: telemetry ?? result.telemetry,
    httpStatus: result.response.status,
    ...consumed,
    totalLatencyMs: Date.now() - wallStart,
  };
}

function proveFrozenRequest(messages: ChatMsg[]): {
  systemPrompt: string;
  currentUserWrapped: string;
  finalMessagesSha: string;
} {
  const finalMessagesSha = sha256(
    messages.map((m) => `${m.role}\u0000${m.content}`).join("\u0001")
  );
  if (finalMessagesSha !== FROZEN_MESSAGES_SHA) {
    throw new Error(
      `FROZEN_FINAL_B_MESSAGES_SHA mismatch: ${finalMessagesSha} !== ${FROZEN_MESSAGES_SHA}`
    );
  }
  const systemPrompt = messages.find((m) => m.role === "system")?.content ?? "";
  const currentUserWrapped = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const owner = DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION;
  const failures: string[] = [];
  if (owner !== EXPECTED_OWNER) failures.push("OWNER_SOURCE_DRIFT");
  if (owner.length !== 219) failures.push(`OWNER_CHARS=${owner.length}`);
  if (ADULT_HANDOFF_CURRENT_USER_WRAPPER_BODY.length !== 208) {
    failures.push(`WRAPPER_BODY_CHARS=${ADULT_HANDOFF_CURRENT_USER_WRAPPER_BODY.length}`);
  }
  if (!systemPrompt.includes(EXPECTED_OWNER)) failures.push("FROZEN_SYSTEM_MISSING_OWNER");
  if ((systemPrompt.split(EXPECTED_OWNER).length - 1) !== 1) {
    failures.push("FROZEN_OWNER_COUNT");
  }
  if (!currentUserWrapped.includes(ADULT_HANDOFF_CURRENT_USER_WRAPPER_BODY)) {
    failures.push("FROZEN_CURRENT_USER_MISSING_WRAPPER");
  }
  if (!currentUserWrapped.includes("이번 응답은 한국어 3,200자 이상을 기본 목표")) {
    failures.push("LENGTH_OWNER_MISSING");
  }
  if (failures.length) {
    throw new Error(`FINAL-C frozen-request proof FAILED: ${failures.join("; ")}`);
  }
  return { systemPrompt, currentUserWrapped, finalMessagesSha };
}

async function main() {
  mkdirSync(path.join(EVIDENCE, "raw"), { recursive: true });
  mkdirSync(path.join(EVIDENCE, "flags"), { recursive: true });
  mkdirSync(path.join(EVIDENCE, "assembled"), { recursive: true });

  const messages = JSON.parse(
    readFileSync(path.join(FROZEN_B, "assembled/DEEPSEEK_HANDOFF_MESSAGES.json"), "utf8")
  ) as ChatMsg[];
  const proven = proveFrozenRequest(messages);
  const body: Record<string, unknown> = {
    model: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    temperature: 0.92,
    top_p: 0.92,
    thinking: { type: "disabled" },
    reasoning_effort: "none",
  };

  writeJson("ACCEPTANCE.json", {
    FROZEN_FINAL_B_MESSAGES_SHA: proven.finalMessagesSha,
    FROZEN_REQUEST_REUSED: true,
    REASSEMBLED: false,
    PROMPT_EDITED: false,
    HANDOFF_OWNER_CHARS: DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION.length,
    HANDOFF_WRAPPER_BODY_CHARS: ADULT_HANDOFF_CURRENT_USER_WRAPPER_BODY.length,
    LENGTH_OWNER_CHARS: UNIFIED_RESPONSE_LENGTH_TARGET,
    TEMPERATURE: body.temperature,
    TOP_P: body.top_p,
    THINKING: body.thinking,
    REASONING_EFFORT: body.reasoning_effort,
    MAX_TOKENS: body.max_tokens ?? "OMITTED",
  });
  writeJson("OWNERS.json", {
    HANDOFF_OWNER_CHARS: DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION.length,
    HANDOFF_WRAPPER_BODY_CHARS: ADULT_HANDOFF_CURRENT_USER_WRAPPER_BODY.length,
    LENGTH_OWNER_CHARS: UNIFIED_RESPONSE_LENGTH_TARGET,
    TEMPERATURE: 0.92,
    TOP_P: 0.92,
    THINKING: { type: "disabled" },
    REASONING_EFFORT: "none",
    MAX_TOKENS: "OMITTED",
    FROZEN_FINAL_B_MESSAGES_SHA: proven.finalMessagesSha,
  });
  writeText("assembled/FINAL_MESSAGES.sha.txt", `${proven.finalMessagesSha}\n`);
  writeText(
    "assembled/FROZEN_SOURCE.txt",
    "Reused data/ds0813-phase-h1-clean-final-b/assembled/DEEPSEEK_HANDOFF_MESSAGES.json\n"
  );
  writeJson("assembled/DEEPSEEK_HANDOFF_BODY_META.json", {
    model: body.model,
    stream: body.stream,
    temperature: body.temperature,
    top_p: body.top_p,
    thinking: body.thinking,
    reasoning_effort: body.reasoning_effort,
    max_tokens: "OMITTED",
    messageCount: messages.length,
    finalMessagesSha: proven.finalMessagesSha,
  });

  const keys = ["H1CFC-R1", "H1CFC-R2"] as const;
  const results: Record<string, unknown>[] = [];
  for (const key of keys) {
    console.log(JSON.stringify({ phase: "calling", key }));
    const out = await callFailover(body);
    const visible = out.text.replace(/\r/g, "");
    const flags = {
      ...flagsFor(visible, out.httpStatus),
      VISIBLE_CHARS: visible.length,
      USED_PROVIDER: out.usedProvider,
      DEEPSEEK_CALLS: 1,
      PRIMARY_HTTP_STATUS: out.telemetry.primary_http_status,
      FAILOVER_TRIGGER: out.telemetry.failover_trigger,
      VISIBLE_ASSISTANT_RESPONSES: visible.length > 0 ? 1 : 0,
      USER_POINT_DEDUCTIONS: 0,
      QUALITY_SCORE_ASSIGNED: false,
    };
    writeText(`raw/${key}.txt`, visible);
    writeJson(`flags/${key}.json`, flags);
    const usage = (out.usage ?? {}) as Record<string, unknown>;
    const row = {
      KEY: key,
      USED_PROVIDER: out.usedProvider,
      PROVIDER_ATTEMPT_COUNT: out.telemetry.provider_attempt_count,
      PRIMARY_HTTP_STATUS: out.telemetry.primary_http_status,
      PRIMARY_FAILURE_CLASS: out.telemetry.primary_failure_class,
      FAILOVER_TRIGGER: out.telemetry.failover_trigger,
      BACKUP_SUCCESS: out.telemetry.backup_success,
      HTTP_STATUS: out.httpStatus,
      FINISH_REASON: out.finishReason,
      VISIBLE_CHARS: visible.length,
      KOREAN_CHARS: countHangul(visible),
      UNDER_LENGTH:
        out.httpStatus === 200 && visible.length > 0 ? visible.length < FLOOR : false,
      QUALITY_SAMPLE:
        visible.length > 0 &&
        out.httpStatus === 200 &&
        (out.usedProvider === "cheaperinference" || out.usedProvider === "openrouter"),
      INPUT_TOKENS: usage.prompt_tokens ?? usage.input_tokens ?? null,
      OUTPUT_TOKENS: usage.completion_tokens ?? usage.output_tokens ?? null,
      TTFT_MS: out.firstVisibleMs,
      TOTAL_LATENCY_MS: out.totalLatencyMs,
      RAW_SHA256: sha256(visible),
      SYSTEM_SHA: sha256(proven.systemPrompt),
      CURRENT_USER_SHA: sha256(proven.currentUserWrapped),
      FINAL_MESSAGES_SHA: proven.finalMessagesSha,
      flags,
      usage,
      telemetry: out.telemetry,
      DEEPSEEK_CALLS: 1,
    };
    writeJson(`raw/${key}.meta.json`, row);
    results.push(row);
  }

  const usableChars = results
    .filter((r) => r.HTTP_STATUS === 200 && typeof r.VISIBLE_CHARS === "number")
    .map((r) => r.VISIBLE_CHARS as number);
  const avg =
    usableChars.length > 0
      ? Math.round(usableChars.reduce((a, b) => a + b, 0) / usableChars.length)
      : 0;
  const bothUnder2700 = usableChars.length === 2 && usableChars.every((n) => n < 2700);
  const bothGe2800 = usableChars.length === 2 && usableChars.every((n) => n >= 2800);
  const oneShortOneNormal =
    usableChars.length === 2 &&
    usableChars.some((n) => n >= 2600 && n < 2700) &&
    usableChars.some((n) => n >= 2800);

  const trueBeatAny = results.some((r) => {
    const flags = r.flags as { TRUE_NEW_USER_ACTION_BEAT?: { value?: unknown } };
    return flags.TRUE_NEW_USER_ACTION_BEAT?.value === true;
  });
  const rewindAny = results.some((r) => {
    const flags = r.flags as { CURRENT_USER_MAJOR_REWIND?: { value?: unknown } };
    return flags.CURRENT_USER_MAJOR_REWIND?.value === true;
  });
  const dialogueAny = results.some((r) => {
    const flags = r.flags as { NEW_USER_DIALOGUE?: { value?: unknown } };
    return flags.NEW_USER_DIALOGUE?.value === true;
  });
  const voiceSeamCount = results.filter((r) => {
    const flags = r.flags as { CHARACTER_VOICE_SEAM?: { value?: unknown } };
    return flags.CHARACTER_VOICE_SEAM?.value === true;
  }).length;

  const accepted =
    !trueBeatAny &&
    !rewindAny &&
    !dialogueAny &&
    voiceSeamCount < 2 &&
    !bothUnder2700;

  const report = {
    QUALITY_SCORE_ASSIGNED: false,
    HUMAN_RAW_REVIEW_REQUIRED: true,
    MERGED: false,
    DEPLOYED: false,
    PROMPT_EDITED: false,
    FINAL_D_CREATED: false,
    HANDOFF_OWNER_CHARS: 219,
    HANDOFF_WRAPPER_BODY_CHARS: 208,
    TOTAL_LOGICAL_HANDOFFS: results.length,
    NEW_TWO_CALL_AVG_CHARS: avg,
    LENGTH_REGRESSION_PROVEN: false,
    LENGTH_REGRESSION_SUSPECTED: bothUnder2700,
    STOCHASTIC_VARIATION_PLAUSIBLE: !bothGe2800 && !bothUnder2700,
    GEMINI_37_FLASH_ADULT_HANDOFF_ACCEPTED: accepted,
    results: results.map((r) => ({
      KEY: r.KEY,
      USED_PROVIDER: r.USED_PROVIDER,
      VISIBLE_CHARS: r.VISIBLE_CHARS,
      UNDER_LENGTH: r.UNDER_LENGTH,
      HTTP_STATUS: r.HTTP_STATUS,
      RAW_SHA256: r.RAW_SHA256,
    })),
  };
  if (oneShortOneNormal) {
    report.STOCHASTIC_VARIATION_PLAUSIBLE = true;
  }
  writeJson("LIVE_REPORT.json", { report, results });
  console.log(JSON.stringify({ phase: "done", report }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

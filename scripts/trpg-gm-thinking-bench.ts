/**
 * Isolated TRPG GM Thinking ON vs TRUE OFF harness.
 * Does not write campaign state, HP, inventory, billing, rewards, or memory.
 * Does not import or call the production GM runtime (callTrpgGm / adaptTrpgGmChatBody).
 *
 * TRUE OFF contract (provider-verified):
 *   thinking: { type: "disabled" }
 *   reasoning_effort: "none"
 * thinking.disabled alone is MISCONFIGURED_DISABLED and is not an OFF sample.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, buildCheaperInferenceHeaders } from "@/lib/cheaperInferenceConfig";
import { THINKING_BENCH_CASES } from "@/lib/trpg/thinkingBench/fixtures";
import { evaluateThinkingBenchOutput } from "@/lib/trpg/thinkingBench/quality";
import {
  THINKING_BENCH_COMPLEX_CASE_IDS,
  THINKING_BENCH_TIMEOUT_MS,
  buildThinkingBenchChatBody,
  thinkingModeForArm,
} from "@/lib/trpg/thinkingBench/request";
import { average, countKoreanChars, extractRawUsage, median } from "@/lib/trpg/thinkingBench/usage";
import type { ThinkingBenchArm, ThinkingBenchCallRecord } from "@/lib/trpg/thinkingBench/types";
import { loadEnvLocal } from "./load-env-local";

const ARTIFACT_DIR = "/opt/cursor/artifacts/trpg_gm_thinking_bench";
const LOCAL_DIR = resolve(process.cwd(), "tmp-trpg-gm-thinking-bench");

function parseArgs(argv: string[]): {
  dryRun: boolean;
  all: boolean;
  includeMisconfigured: boolean;
  caseIds: string[] | null;
} {
  let dryRun = false;
  let all = false;
  let includeMisconfigured = false;
  let caseIds: string[] | null = null;
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
    if (arg === "--all") all = true;
    if (arg === "--include-misconfigured") includeMisconfigured = true;
    if (arg.startsWith("--cases=")) {
      caseIds = arg
        .slice("--cases=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return { dryRun, all, includeMisconfigured, caseIds };
}

function ensureDirs(): void {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  mkdirSync(LOCAL_DIR, { recursive: true });
}

function writeBoth(name: string, body: string): void {
  writeFileSync(resolve(ARTIFACT_DIR, name), body, "utf8");
  writeFileSync(resolve(LOCAL_DIR, name), body, "utf8");
}

function firstVisiblePiece(delta: Record<string, unknown>): string {
  if (typeof delta.content === "string" && delta.content) return delta.content;
  if (Array.isArray(delta.content)) {
    return delta.content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
          return String((part as { text: string }).text);
        }
        return "";
      })
      .join("");
  }
  return "";
}

async function readSse(res: Response, started: number): Promise<{
  text: string;
  ttftMs: number | null;
  payload: Record<string, unknown>;
}> {
  if (!res.body) {
    return { text: "", ttftMs: null, payload: { error: "missing body" } };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let ttftMs: number | null = null;
  let usage: unknown = null;
  let lastEvent: Record<string, unknown> = {};
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(data) as Record<string, unknown>;
      } catch {
        continue;
      }
      lastEvent = ev;
      if (ev.usage) usage = ev.usage;
      const choice0 = Array.isArray(ev.choices) ? ev.choices[0] : null;
      const choice =
        choice0 && typeof choice0 === "object" ? (choice0 as Record<string, unknown>) : {};
      const delta = (choice.delta ?? {}) as Record<string, unknown>;
      const piece = firstVisiblePiece(delta);
      if (piece) {
        if (ttftMs == null) ttftMs = Date.now() - started;
        text += piece;
      }
    }
  }
  return {
    text: text.trim(),
    ttftMs,
    payload: { ...lastEvent, usage: usage ?? lastEvent.usage ?? null },
  };
}

async function callOnce(opts: {
  system: string;
  user: string;
  arm: ThinkingBenchArm;
}): Promise<{
  httpStatus: number | null;
  text: string;
  ttftMs: number | null;
  latencyMs: number;
  payload: unknown;
  requestBody: Record<string, unknown>;
  error?: string;
}> {
  const requestBody = buildThinkingBenchChatBody({
    system: opts.system,
    user: opts.user,
    arm: opts.arm,
    stream: true,
  });
  const started = Date.now();
  try {
    const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: buildCheaperInferenceHeaders(),
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(THINKING_BENCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return {
        httpStatus: res.status,
        text: "",
        ttftMs: null,
        latencyMs: Date.now() - started,
        payload: { error: errText.slice(0, 800) },
        requestBody,
        error: `http ${res.status}`,
      };
    }
    const streamed = await readSse(res, started);
    const latencyMs = Date.now() - started;
    return {
      httpStatus: res.status,
      text: streamed.text,
      ttftMs: streamed.ttftMs,
      latencyMs,
      payload: streamed.payload,
      requestBody,
      error: streamed.text ? undefined : `http ${res.status} empty=true`,
    };
  } catch (error) {
    return {
      httpStatus: null,
      text: "",
      ttftMs: null,
      latencyMs: Date.now() - started,
      payload: null,
      requestBody,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function numericOrEmpty(value: number | "unavailable"): number[] {
  return typeof value === "number" ? [value] : [];
}

function qualityErrorCount(record: ThinkingBenchCallRecord): number {
  return (
    (record.parseSuccess ? 0 : 1) +
    record.actionOmissions +
    record.diceContradictions +
    record.stateErrors +
    record.agencyErrors
  );
}

function summarize(records: ThinkingBenchCallRecord[]): Record<string, unknown> {
  const on = records.filter((r) => r.arm === "on");
  const off = records.filter((r) => r.arm === "true_off");
  const mis = records.filter((r) => r.arm === "misconfigured_disabled");
  const reasoningRate = (rows: ThinkingBenchCallRecord[]) => {
    const known = rows.filter((r) => typeof r.usage.reasoning_tokens === "number");
    if (known.length === 0) return "unavailable";
    const withReasoning = known.filter((r) => (r.usage.reasoning_tokens as number) > 0).length;
    return `${withReasoning}/${known.length}`;
  };
  const onTtft = on.map((r) => r.ttftMs).filter((n): n is number => n != null);
  const offTtft = off.map((r) => r.ttftMs).filter((n): n is number => n != null);
  return {
    PROVIDER_TRUE_OFF_CONTRACT: "thinking.disabled + reasoning_effort.none",
    MISCONFIGURED_DISABLED_NOTE:
      "thinking.disabled without reasoning_effort.none is not an OFF sample",
    MISCONFIGURED_DISABLED_CALLS: mis.length,
    THINKING_BENCH_CASES: new Set(records.map((r) => r.caseId)).size,
    GM_ON_COMPLEX_CASES: `${on.filter((r) => r.success).length}/${on.length}`,
    GM_TRUE_OFF_COMPLEX_CASES: `${off.filter((r) => r.success).length}/${off.length}`,
    GM_ON_MEDIAN_TTFT: median(onTtft),
    GM_TRUE_OFF_MEDIAN_TTFT: median(offTtft),
    GM_ON_MEDIAN_TOTAL_LATENCY: median(on.map((r) => r.wallLatencyMs)),
    GM_TRUE_OFF_MEDIAN_TOTAL_LATENCY: median(off.map((r) => r.wallLatencyMs)),
    ON_REASONING_RATE: reasoningRate(on),
    TRUE_OFF_REASONING_RATE: reasoningRate(off),
    MISCONFIGURED_DISABLED_REASONING_RATE: mis.length ? reasoningRate(mis) : "not_run_this_harness",
    ON_AVG_VISIBLE_CHARS: average(on.map((r) => r.responseChars)),
    OFF_AVG_VISIBLE_CHARS: average(off.map((r) => r.responseChars)),
    ON_AVG_VISIBLE_COMPLETION_TOKENS: average(on.flatMap((r) => numericOrEmpty(r.usage.visible_completion_tokens))),
    OFF_AVG_VISIBLE_COMPLETION_TOKENS: average(off.flatMap((r) => numericOrEmpty(r.usage.visible_completion_tokens))),
    ON_PARSE_FAILURES: on.filter((r) => !r.parseSuccess).length,
    OFF_PARSE_FAILURES: off.filter((r) => !r.parseSuccess).length,
    ON_ACTION_OMISSIONS: on.reduce((n, r) => n + r.actionOmissions, 0),
    OFF_ACTION_OMISSIONS: off.reduce((n, r) => n + r.actionOmissions, 0),
    ON_DICE_CONTRADICTIONS: on.reduce((n, r) => n + r.diceContradictions, 0),
    OFF_DICE_CONTRADICTIONS: off.reduce((n, r) => n + r.diceContradictions, 0),
    ON_STATE_ERRORS: on.reduce((n, r) => n + r.stateErrors, 0),
    OFF_STATE_ERRORS: off.reduce((n, r) => n + r.stateErrors, 0),
    ON_AGENCY_ERRORS: on.reduce((n, r) => n + r.agencyErrors, 0),
    OFF_AGENCY_ERRORS: off.reduce((n, r) => n + r.agencyErrors, 0),
    GM_ON_QUALITY_ERRORS: on.reduce((n, r) => n + qualityErrorCount(r), 0),
    GM_TRUE_OFF_QUALITY_ERRORS: off.reduce((n, r) => n + qualityErrorCount(r), 0),
  };
}

async function main(): Promise<void> {
  loadEnvLocal();
  const args = parseArgs(process.argv.slice(2));
  ensureDirs();
  const selectedIds = args.caseIds
    ? args.caseIds
    : args.all
      ? THINKING_BENCH_CASES.map((row) => row.id)
      : [...THINKING_BENCH_COMPLEX_CASE_IDS];
  const cases = THINKING_BENCH_CASES.filter((row) => selectedIds.includes(row.id));
  if (cases.length === 0) throw new Error("no matching cases");
  const arms: ThinkingBenchArm[] = args.includeMisconfigured
    ? ["on", "true_off", "misconfigured_disabled"]
    : ["on", "true_off"];

  const fixtureDump = cases.map((row) => ({
    id: row.id,
    title: row.title,
    systemChars: row.system.length,
    userChars: row.user.length,
    expectedNames: row.expectedNames,
    resolutionOrder: row.resolutionOrder.map((e) => e.name),
    opening: row.opening,
    hasScenarioPlan: row.user.includes("[SCENARIO PLAN]"),
    hasResolutionOrder: row.user.includes("[RESOLUTION ORDER]"),
  }));
  writeBoth("fixtures_meta.json", JSON.stringify(fixtureDump, null, 2));

  if (args.dryRun) {
    for (const row of cases) {
      writeBoth(`${row.id}.system.txt`, row.system);
      writeBoth(`${row.id}.user.txt`, row.user);
      writeBoth(
        `${row.id}.true_off.body.json`,
        JSON.stringify(buildThinkingBenchChatBody({ system: row.system, user: row.user, arm: "true_off", stream: true }), null, 2)
      );
    }
    console.log(`dry-run wrote ${cases.length} fixtures; arms=${arms.join(",")}`);
    return;
  }

  const records: ThinkingBenchCallRecord[] = [];
  const blindKey: Record<string, { A: ThinkingBenchArm; B: ThinkingBenchArm }> = {};
  let pairFlip = false;

  for (const fixture of cases) {
    const pair: Partial<Record<ThinkingBenchArm, string>> = {};
    for (const arm of arms) {
      console.log(`calling ${fixture.id} arm=${arm}`);
      const result = await callOnce({
        system: fixture.system,
        user: fixture.user,
        arm,
      });
      const quality = evaluateThinkingBenchOutput({ fixture, rawText: result.text });
      const record: ThinkingBenchCallRecord = {
        caseId: fixture.id,
        arm,
        thinking: thinkingModeForArm(arm),
        httpStatus: result.httpStatus,
        success: Boolean(result.httpStatus === 200 && result.text && !result.error),
        ttftMs: result.ttftMs,
        wallLatencyMs: result.latencyMs,
        responseChars: result.text.length,
        koreanChars: countKoreanChars(result.text),
        usage: extractRawUsage(result.payload),
        parseSuccess: quality.parseSuccess,
        actionOmissions: quality.actionOmissions.length,
        diceContradictions: quality.diceContradictions.length,
        stateErrors: quality.stateErrors.length,
        agencyErrors: quality.agencyErrors.length,
        quality,
        error: result.error,
      };
      records.push(record);
      pair[arm] = result.text;
      writeBoth(
        `${fixture.id}.${arm}.json`,
        JSON.stringify(
          {
            record,
            requestThinking: result.requestBody.thinking,
            requestReasoningEffort: result.requestBody.reasoning_effort ?? null,
            rawUsage: (result.payload as { usage?: unknown } | null)?.usage ?? null,
            text: result.text,
          },
          null,
          2
        )
      );
      writeBoth("partial_summary.json", JSON.stringify({ records, summary: summarize(records) }, null, 2));
    }

    const labels: { A: ThinkingBenchArm; B: ThinkingBenchArm } = pairFlip
      ? { A: "true_off", B: "on" }
      : { A: "on", B: "true_off" };
    pairFlip = !pairFlip;
    blindKey[fixture.id] = labels;
    writeBoth(
      `${fixture.id}.blind_A.md`,
      `# ${fixture.title}\n\n- label: hidden\n- score 1-5: korean, coherence, weave, tension, repetition, setting, next-action room, overall\n\n${pair[labels.A] ?? ""}\n`
    );
    writeBoth(
      `${fixture.id}.blind_B.md`,
      `# ${fixture.title}\n\n- label: hidden\n- score 1-5: korean, coherence, weave, tension, repetition, setting, next-action room, overall\n\n${pair[labels.B] ?? ""}\n`
    );
  }

  writeBoth("blind_key.json", JSON.stringify(blindKey, null, 2));
  const summary = summarize(records);
  writeBoth("results.json", JSON.stringify({ records, summary }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

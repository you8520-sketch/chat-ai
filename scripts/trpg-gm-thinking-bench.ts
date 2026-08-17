/**
 * Isolated TRPG GM Thinking ON/OFF harness.
 * Does not write campaign state, HP, inventory, billing, rewards, or memory.
 * Does not import or call the production GM runtime (callTrpgGm / adaptTrpgGmChatBody).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, buildCheaperInferenceHeaders } from "@/lib/cheaperInferenceConfig";
import { THINKING_BENCH_CASES } from "@/lib/trpg/thinkingBench/fixtures";
import { evaluateThinkingBenchOutput } from "@/lib/trpg/thinkingBench/quality";
import { average, countKoreanChars, extractRawUsage, median } from "@/lib/trpg/thinkingBench/usage";
import type { ThinkingBenchCallRecord, ThinkingMode } from "@/lib/trpg/thinkingBench/types";
import { TRPG_GM_MAX_TOKENS, TRPG_GM_MODEL } from "@/lib/trpg/types";
import { loadEnvLocal } from "./load-env-local";

const TIMEOUT_MS = 180_000;
const TEMPERATURE = 0.7;
const ARTIFACT_DIR = "/opt/cursor/artifacts/trpg_gm_thinking_bench";
const LOCAL_DIR = resolve(process.cwd(), "tmp-trpg-gm-thinking-bench");

function parseArgs(argv: string[]): { dryRun: boolean; caseIds: string[] | null } {
  let dryRun = false;
  let caseIds: string[] | null = null;
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
    if (arg.startsWith("--cases=")) {
      caseIds = arg
        .slice("--cases=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return { dryRun, caseIds };
}

function ensureDirs(): void {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  mkdirSync(LOCAL_DIR, { recursive: true });
}

function writeBoth(name: string, body: string): void {
  writeFileSync(resolve(ARTIFACT_DIR, name), body, "utf8");
  writeFileSync(resolve(LOCAL_DIR, name), body, "utf8");
}

function buildBody(opts: { system: string; user: string; thinking: ThinkingMode }): Record<string, unknown> {
  return {
    model: TRPG_GM_MODEL,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    stream: false,
    temperature: TEMPERATURE,
    max_tokens: TRPG_GM_MAX_TOKENS,
    thinking: { type: opts.thinking },
  };
}

async function callOnce(opts: {
  system: string;
  user: string;
  thinking: ThinkingMode;
}): Promise<{
  httpStatus: number | null;
  text: string;
  latencyMs: number;
  payload: unknown;
  error?: string;
}> {
  const started = Date.now();
  try {
    const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: buildCheaperInferenceHeaders(),
      body: JSON.stringify(buildBody(opts)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const latencyMs = Date.now() - started;
    const payload = (await res.json().catch(async () => ({ raw: await res.text().catch(() => "") }))) as Record<
      string,
      unknown
    >;
    const text =
      typeof (payload as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ===
      "string"
        ? String((payload as { choices: { message?: { content?: string } }[] }).choices[0].message?.content ?? "").trim()
        : "";
    return {
      httpStatus: res.status,
      text,
      latencyMs,
      payload,
      error: res.ok && text ? undefined : `http ${res.status} empty=${text.length === 0}`,
    };
  } catch (error) {
    return {
      httpStatus: null,
      text: "",
      latencyMs: Date.now() - started,
      payload: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function numericOrEmpty(value: number | "unavailable"): number[] {
  return typeof value === "number" ? [value] : [];
}

function summarize(records: ThinkingBenchCallRecord[]): Record<string, unknown> {
  const on = records.filter((r) => r.thinking === "enabled");
  const off = records.filter((r) => r.thinking === "disabled");
  const onLat = on.map((r) => r.wallLatencyMs);
  const offLat = off.map((r) => r.wallLatencyMs);
  const onMed = median(onLat);
  const offMed = median(offLat);
  const latencyChangePercent =
    onMed != null && offMed != null && onMed > 0 ? ((offMed - onMed) / onMed) * 100 : null;
  const onReasoning = on.map((r) => r.usage.reasoning_tokens);
  const offReasoning = off.map((r) => r.usage.reasoning_tokens);
  const reasoningSummary = (values: Array<number | "unavailable">) => {
    if (values.every((v) => v === "unavailable")) return "unavailable";
    const nums = values.filter((v): v is number => typeof v === "number");
    return {
      available: nums.length,
      unavailable: values.length - nums.length,
      average: average(nums),
    };
  };
  return {
    THINKING_BENCH_CASES: THINKING_BENCH_CASES.length,
    THINKING_ON_CALLS: on.length,
    THINKING_OFF_CALLS: off.length,
    ON_SUCCESS: `${on.filter((r) => r.success).length}/${on.length}`,
    OFF_SUCCESS: `${off.filter((r) => r.success).length}/${off.length}`,
    ON_MEDIAN_LATENCY_MS: onMed,
    OFF_MEDIAN_LATENCY_MS: offMed,
    LATENCY_CHANGE_PERCENT: latencyChangePercent,
    ON_AVG_VISIBLE_CHARS: average(on.map((r) => r.responseChars)),
    OFF_AVG_VISIBLE_CHARS: average(off.map((r) => r.responseChars)),
    ON_AVG_COMPLETION_TOKENS: average(on.flatMap((r) => numericOrEmpty(r.usage.completion_tokens))),
    OFF_AVG_COMPLETION_TOKENS: average(off.flatMap((r) => numericOrEmpty(r.usage.completion_tokens))),
    ON_REASONING_TOKENS: reasoningSummary(onReasoning),
    OFF_REASONING_TOKENS: reasoningSummary(offReasoning),
    ON_PARSE_FAILURES: on.filter((r) => !r.parseSuccess).length,
    OFF_PARSE_FAILURES: off.filter((r) => !r.parseSuccess).length,
    ON_ACTION_OMISSIONS: on.reduce((n, r) => n + r.quality.actionOmissions.length, 0),
    OFF_ACTION_OMISSIONS: off.reduce((n, r) => n + r.quality.actionOmissions.length, 0),
    ON_DICE_CONTRADICTIONS: on.reduce((n, r) => n + r.quality.diceContradictions.length, 0),
    OFF_DICE_CONTRADICTIONS: off.reduce((n, r) => n + r.quality.diceContradictions.length, 0),
    ON_STATE_ERRORS: on.reduce((n, r) => n + r.quality.stateErrors.length, 0),
    OFF_STATE_ERRORS: off.reduce((n, r) => n + r.quality.stateErrors.length, 0),
    ON_AGENCY_ERRORS: on.reduce((n, r) => n + r.quality.agencyErrors.length, 0),
    OFF_AGENCY_ERRORS: off.reduce((n, r) => n + r.quality.agencyErrors.length, 0),
  };
}

async function main(): Promise<void> {
  loadEnvLocal();
  const args = parseArgs(process.argv.slice(2));
  ensureDirs();
  const cases = args.caseIds
    ? THINKING_BENCH_CASES.filter((row) => args.caseIds?.includes(row.id))
    : THINKING_BENCH_CASES;
  if (cases.length === 0) throw new Error("no matching cases");

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
    }
    console.log(`dry-run wrote ${cases.length} fixtures`);
    return;
  }

  const records: ThinkingBenchCallRecord[] = [];
  const blindKey: Record<string, { A: ThinkingMode; B: ThinkingMode }> = {};
  let pairFlip = false;

  for (const fixture of cases) {
    const pair: Record<ThinkingMode, string> = { enabled: "", disabled: "" };
    for (const thinking of ["enabled", "disabled"] as const) {
      console.log(`calling ${fixture.id} thinking=${thinking}`);
      const result = await callOnce({
        system: fixture.system,
        user: fixture.user,
        thinking,
      });
      const quality = evaluateThinkingBenchOutput({ fixture, rawText: result.text });
      const record: ThinkingBenchCallRecord = {
        caseId: fixture.id,
        thinking,
        httpStatus: result.httpStatus,
        success: Boolean(result.httpStatus === 200 && result.text && !result.error),
        wallLatencyMs: result.latencyMs,
        responseChars: result.text.length,
        koreanChars: countKoreanChars(result.text),
        usage: extractRawUsage(result.payload),
        parseSuccess: quality.parseSuccess,
        quality,
        error: result.error,
      };
      records.push(record);
      pair[thinking] = result.text;
      writeBoth(
        `${fixture.id}.${thinking}.json`,
        JSON.stringify(
          {
            record,
            rawUsage: (result.payload as { usage?: unknown } | null)?.usage ?? null,
            text: result.text,
          },
          null,
          2
        )
      );
      writeBoth("partial_summary.json", JSON.stringify({ records, summary: summarize(records) }, null, 2));
    }

    const labels: { A: ThinkingMode; B: ThinkingMode } = pairFlip
      ? { A: "disabled", B: "enabled" }
      : { A: "enabled", B: "disabled" };
    pairFlip = !pairFlip;
    blindKey[fixture.id] = labels;
    writeBoth(
      `${fixture.id}.blind_A.md`,
      `# ${fixture.title}\n\n- label: hidden\n- score 1-5: korean, coherence, weave, tension, repetition, setting, next-action room, overall\n\n${pair[labels.A]}\n`
    );
    writeBoth(
      `${fixture.id}.blind_B.md`,
      `# ${fixture.title}\n\n- label: hidden\n- score 1-5: korean, coherence, weave, tension, repetition, setting, next-action room, overall\n\n${pair[labels.B]}\n`
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

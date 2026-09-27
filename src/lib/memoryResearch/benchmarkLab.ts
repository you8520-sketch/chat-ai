/**
 * Experiment lab: A/B of a candidate `BenchmarkMode` against current main
 * (`BASELINE_MODE`) on the canonical deterministic benchmark. Every run is
 * wrapped in a network guard — any HTTP attempt fails the arm, so a research
 * cycle can never make paid provider calls. In-memory SQLite only; production
 * DB and runtime are never touched.
 */
import {
  BASELINE_MODE,
  runBenchmarkCases,
  type BenchmarkMode,
  type BenchmarkRun,
} from "@/lib/memory/memory-rp-benchmark-suite";
import type { EpisodicEmbedder } from "@/lib/memory/memory-episodic-semantic-jobs";
import type { LabRunSummary } from "@/lib/memoryResearch/gates";

export type LabArmResult =
  | { status: "RAN"; summary: LabRunSummary }
  | { status: "FAILED"; label: string; error: string; httpCallsAttempted: number };

type GuardState = { attempts: number };

async function withNetworkGuard<T>(state: GuardState, fn: () => Promise<T>): Promise<T> {
  const saved = globalThis.fetch;
  globalThis.fetch = (async () => {
    state.attempts += 1;
    throw new Error("memory research lab forbids network access during benchmark runs");
  }) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = saved;
  }
}

function summarize(run: BenchmarkRun, label: string, embedCalls: { query: number; index: number }, httpCalls: number, wallClockMs: number): LabRunSummary {
  const finalHitByCase: Record<string, boolean> = {};
  for (const o of run.outcomes) {
    if (!o.final || o.final.expectedAnswerIds.length === 0) continue;
    finalHitByCase[o.caseId] = o.final.expectedAnswerIds.every((id) => o.final!.injectedFactIds.includes(id));
  }
  return {
    label,
    metrics: run.metrics,
    invariantViolations: run.invariantViolations,
    evaluatedTurns: run.evaluatedTurns,
    promptTokensInjected: run.promptTokensInjected,
    httpCallsObserved: httpCalls,
    embeddingCalls: embedCalls,
    wallClockMs,
    finalHitByCase,
  };
}

export async function runLabArm(mode: BenchmarkMode): Promise<LabArmResult> {
  const embedCalls = { query: 0, index: 0 };
  const counted: BenchmarkMode = mode.semantic
    ? {
        ...mode,
        semantic: {
          model: mode.semantic.model,
          embed: (async (inputs, model, purpose) => {
            if (purpose === "query") embedCalls.query += 1;
            else embedCalls.index += 1;
            return mode.semantic!.embed(inputs, model, purpose);
          }) as EpisodicEmbedder,
        },
      }
    : mode;
  const guard: GuardState = { attempts: 0 };
  try {
    return await withNetworkGuard(guard, async () => {
      const probe = { snapshot: () => ({ httpCallsObserved: guard.attempts, jevCallsObserved: 0 }) };
      const started = performance.now();
      const run = await runBenchmarkCases(counted, probe);
      const wallClockMs = performance.now() - started;
      if (guard.attempts > 0) {
        throw new Error(`arm attempted ${guard.attempts} network call(s)`);
      }
      return { status: "RAN" as const, summary: summarize(run, mode.label, embedCalls, guard.attempts, wallClockMs) };
    });
  } catch (error) {
    return {
      status: "FAILED",
      label: mode.label,
      error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      httpCallsAttempted: guard.attempts,
    };
  }
}

export function runLabBaseline(): Promise<LabArmResult> {
  return runLabArm(BASELINE_MODE);
}

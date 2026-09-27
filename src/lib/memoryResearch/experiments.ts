/**
 * Experiment adapter contract for the memory research lab.
 *
 * An adapter ports ONE researched technique into a `BenchmarkMode` arm of the
 * canonical deterministic benchmark (`memory-rp-benchmark-suite.ts`) so it can
 * be A/B-compared against current main. Adapters live only here, are never
 * imported by production runtime, and must be deleted when their candidate is
 * REJECTED (the cycle report lists them under `cleanupCandidates`).
 *
 * The registry is intentionally empty on main: adding an adapter is the
 * reviewed "new evidence" event that moves a WATCH_NO_EXPERIMENT_ADAPTER
 * candidate to EXPERIMENT_ELIGIBLE on the next cycle.
 */
import { createHash } from "node:crypto";
import type { BenchmarkMode } from "@/lib/memory/memory-rp-benchmark-suite";
import type { MemoryOwnerId } from "@/lib/memoryResearch/ownerMap";

/**
 * Production-side costs the deterministic benchmark cannot observe. Values are
 * the adapter author's declared estimates and are reported as DECLARED, never
 * as measured.
 */
export type DeclaredProductionEfficiency = {
  providerCallsPerTurn: number;
  embeddingCallsPerTurn: number;
  p95LatencyMsPerTurn: number;
  costUsdPer1kTurns: number;
  storageBytesPerFact: number;
  backgroundCallsPerSealedBatch: number;
};

export type ArchitectureDelta = {
  before: string;
  proposed: string;
  after: string;
  removed: readonly string[];
  newDb: readonly string[];
  newFlags: readonly string[];
  newProviders: readonly string[];
  newDependencies: readonly string[];
  newSchedulers: readonly string[];
  /** Net change in canonical owner count (negative = consolidation). */
  ownerCountDelta: number;
  /** Net change in runtime paths per turn. */
  runtimePathDelta: number;
};

export type ExperimentAdapter = {
  candidateKey: string;
  adapterVersion: string;
  targetOwner: MemoryOwnerId;
  description: string;
  /** Returns a fresh non-strict arm; the lab wraps its embedder for call counting. */
  buildMode(): BenchmarkMode;
  declaredEfficiency: DeclaredProductionEfficiency;
  architectureDelta: ArchitectureDelta;
};

export const EXPERIMENT_ADAPTERS: readonly ExperimentAdapter[] = [];

export function adapterFingerprint(adapter: ExperimentAdapter | undefined): string | null {
  if (!adapter) return null;
  return createHash("sha256")
    .update(
      JSON.stringify({
        candidateKey: adapter.candidateKey,
        adapterVersion: adapter.adapterVersion,
        targetOwner: adapter.targetOwner,
        declaredEfficiency: adapter.declaredEfficiency,
      })
    )
    .digest("hex")
    .slice(0, 16);
}

export function findAdapter(
  adapters: readonly ExperimentAdapter[],
  candidateKey: string
): ExperimentAdapter | undefined {
  return adapters.find((a) => a.candidateKey === candidateKey);
}

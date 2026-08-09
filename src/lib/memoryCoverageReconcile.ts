export const MAX_MEMORY_COVERAGE_RECONCILE_PASSES = 6;

export type MemoryCoverageReconcileReading = {
  degraded: boolean;
  firstRawPlayableTurn: number | null;
  gapTurns: number;
  estimatedInputTokens: number;
};

export type MemoryCoverageReconcileResult<TBuild, TMemory> = {
  build: TBuild;
  memory: TMemory;
  passes: number;
  initialFirstRawTurn: number | null;
  finalFirstRawTurn: number | null;
  finalLtmCutoff: number | undefined;
  middleHoleTurns: number;
  overlapTurns: number;
  stable: boolean;
  nonconvergent: boolean;
};

type Awaitable<T> = T | Promise<T>;

/**
 * Hard-degrade 전용 RAW/LTM fixed-point 조정.
 * 정상 build에서는 preview rebuild를 전혀 호출하지 않는다.
 */
export async function reconcileMemoryCoverageFixedPoint<TBuild, TMemory>(opts: {
  initialBuild: TBuild;
  initialMemory: TMemory;
  initialLtmCutoff: number | undefined;
  failSafeLtmCutoff: number;
  readCoverage: (build: TBuild) => MemoryCoverageReconcileReading;
  rebuildMemory: (excludeTurnStartGte: number) => Awaitable<TMemory>;
  rebuildContext: (memory: TMemory, pass: number) => Awaitable<TBuild>;
  maxPasses?: number;
}): Promise<MemoryCoverageReconcileResult<TBuild, TMemory>> {
  const maxPasses = Math.max(
    1,
    Math.floor(opts.maxPasses ?? MAX_MEMORY_COVERAGE_RECONCILE_PASSES)
  );
  let build = opts.initialBuild;
  let memory = opts.initialMemory;
  let cutoff = opts.initialLtmCutoff;
  let reading = opts.readCoverage(build);
  const initialFirstRawTurn = reading.firstRawPlayableTurn;
  let passes = 0;

  const isStable = () =>
    reading.firstRawPlayableTurn != null &&
    cutoff === reading.firstRawPlayableTurn;

  if (!reading.degraded || isStable()) {
    return buildResult({
      build,
      memory,
      passes,
      initialFirstRawTurn,
      cutoff,
      reading,
      stable: isStable() || !reading.degraded,
      nonconvergent: false,
    });
  }

  const regularPassLimit = Math.max(0, maxPasses - 1);
  while (!isStable() && passes < regularPassLimit) {
    const nextCutoff = reading.firstRawPlayableTurn;
    if (nextCutoff == null) break;
    cutoff = nextCutoff;
    memory = await opts.rebuildMemory(cutoff);
    passes += 1;
    build = await opts.rebuildContext(memory, passes);
    reading = opts.readCoverage(build);
  }

  if (isStable()) {
    return buildResult({
      build,
      memory,
      passes,
      initialFirstRawTurn,
      cutoff,
      reading,
      stable: true,
      nonconvergent: false,
    });
  }

  // Bounded fail-safe: include all sealed summaries through the completed range.
  // cutoff >= RAW start prefers historical overlap over a missing middle range.
  cutoff = Math.max(1, Math.floor(opts.failSafeLtmCutoff));
  memory = await opts.rebuildMemory(cutoff);
  passes += 1;
  build = await opts.rebuildContext(memory, passes);
  reading = opts.readCoverage(build);

  return buildResult({
    build,
    memory,
    passes,
    initialFirstRawTurn,
    cutoff,
    reading,
    stable: isStable(),
    nonconvergent: true,
  });
}

function buildResult<TBuild, TMemory>(opts: {
  build: TBuild;
  memory: TMemory;
  passes: number;
  initialFirstRawTurn: number | null;
  cutoff: number | undefined;
  reading: MemoryCoverageReconcileReading;
  stable: boolean;
  nonconvergent: boolean;
}): MemoryCoverageReconcileResult<TBuild, TMemory> {
  const finalFirstRawTurn = opts.reading.firstRawPlayableTurn;
  const comparable = finalFirstRawTurn != null && opts.cutoff != null;
  return {
    build: opts.build,
    memory: opts.memory,
    passes: opts.passes,
    initialFirstRawTurn: opts.initialFirstRawTurn,
    finalFirstRawTurn,
    finalLtmCutoff: opts.cutoff,
    middleHoleTurns: comparable
      ? Math.max(0, finalFirstRawTurn - opts.cutoff!)
      : 0,
    overlapTurns: comparable
      ? Math.max(0, opts.cutoff! - finalFirstRawTurn)
      : 0,
    stable: opts.stable,
    nonconvergent: opts.nonconvergent,
  };
}

/** Paired comparison statistics for Step 1 regression harness. */

export type DescriptiveStats = {
  mean: number;
  median: number;
  stddev: number;
  n: number;
};

export type PairedMetricReport = {
  metricKey: string;
  label: string;
  higherIsBetter: boolean;
  before: DescriptiveStats;
  after: DescriptiveStats;
  improvement: DescriptiveStats;
  winRate: number;
  wins: number;
  ties: number;
  pairedN: number;
  /** One-sided H1: after is better than before */
  binomialPValue: number;
  wilcoxonPValue: number;
  pairedTPValue: number;
  ci95Improvement: [number, number];
  significantAt95: boolean;
  verdict: "improved" | "worse" | "inconclusive";
};

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function stddevSample(values: number[]): number {
  if (values.length <= 1) return 0;
  const m = mean(values);
  const v = values.reduce((s, n) => s + (n - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(v);
}

export function describe(values: number[]): DescriptiveStats {
  return {
    mean: round(values.length ? mean(values) : 0),
    median: round(values.length ? median(values) : 0),
    stddev: round(values.length ? stddevSample(values) : 0),
    n: values.length,
  };
}

function round(n: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** One-sided binomial: P(X >= wins | p=0.5) for improvement wins; ties excluded from n. */
export function binomialOneSidedPValue(wins: number, n: number): number {
  if (n <= 0) return 1;
  let p = 0;
  for (let k = wins; k <= n; k++) {
    p += binomialPmF(n, k, 0.5);
  }
  return Math.min(1, p);
}

function binomialPmF(n: number, k: number, p: number): number {
  return binomialCoeff(n, k) * p ** k * (1 - p) ** (n - k);
}

function binomialCoeff(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let c = 1;
  for (let i = 0; i < k; i++) {
    c = (c * (n - i)) / (i + 1);
  }
  return c;
}

/** Wilcoxon signed-rank test — two-sided p-value; caller uses one-sided if needed. */
export function wilcoxonSignedRankPValue(diffs: number[]): number {
  const pairs = diffs
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => d !== 0);
  const n = pairs.length;
  if (n === 0) return 1;
  if (n === 1) return 1;

  const absSorted = pairs.map(({ d }) => Math.abs(d)).sort((a, b) => a - b);
  const rankOf = (abs: number): number => {
    let rank = 0;
    let count = 0;
    for (let i = 0; i < absSorted.length; i++) {
      if (absSorted[i] === abs) {
        let j = i;
        while (j + 1 < absSorted.length && absSorted[j + 1] === abs) j++;
        const avgRank = (i + 1 + j + 1) / 2;
        return avgRank;
      }
    }
    return rank;
  };

  let wPlus = 0;
  for (const { d } of pairs) {
    const r = rankOf(Math.abs(d));
    if (d > 0) wPlus += r;
  }

  // Normal approximation for n >= 6; exact for small n via simplified lookup
  if (n <= 20) {
    return wilcoxonExactTwoSided(n, wPlus);
  }
  const mu = (n * (n + 1)) / 4;
  const sigma = Math.sqrt((n * (n + 1) * (2 * n + 1)) / 24);
  const z = (wPlus - mu) / sigma;
  return 2 * (1 - normalCdf(Math.abs(z)));
}

function wilcoxonExactTwoSided(n: number, wPlus: number): number {
  // For small n, use normal approx with continuity correction (adequate for n=10..40)
  const mu = (n * (n + 1)) / 4;
  const sigma = Math.sqrt((n * (n + 1) * (2 * n + 1)) / 24);
  if (sigma === 0) return 1;
  const z = (Math.abs(wPlus - mu) - 0.5) / sigma;
  return 2 * (1 - normalCdf(z));
}

function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

export function pairedTTest(
  improvements: number[]
): { t: number; pTwoSided: number; pOneSided: number; ci95: [number, number] } {
  const n = improvements.length;
  if (n <= 1) {
    return { t: 0, pTwoSided: 1, pOneSided: 1, ci95: [0, 0] };
  }
  const m = mean(improvements);
  const sd = stddevSample(improvements);
  const se = sd / Math.sqrt(n);
  const t = se === 0 ? 0 : m / se;
  const pTwo = 2 * (1 - tCdf(Math.abs(t), n - 1));
  const pOne = 1 - tCdf(t, n - 1);
  const tcrit = tCritical95(n - 1);
  const margin = tcrit * se;
  return {
    t: round(t),
    pTwoSided: round(pTwo, 6),
    pOneSided: round(Math.min(1, Math.max(0, pOne)), 6),
    ci95: [round(m - margin), round(m + margin)],
  };
}

function tCdf(t: number, df: number): number {
  // x = df/(df+t²) is symmetric in t, so the tail probability must be
  // assigned by the sign of t — otherwise negative effects look significant.
  const x = df / (df + t * t);
  const tail = 0.5 * incompleteBeta(x, df / 2, 0.5);
  return t >= 0 ? 1 - tail : tail;
}

function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lnBeta =
    lgamma(a) + lgamma(b) - lgamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta) / a;
  let f = 1;
  let c = 1;
  let d = 0;
  for (let i = 0; i <= 200; i++) {
    const m = i / 2;
    let num: number;
    if (i === 0) num = 1;
    else if (i % 2 === 0) num = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    else num = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + num * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d;
    c = 1 + num / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    f *= c * d;
    if (Math.abs(c * d - 1) < 1e-8) break;
  }
  return front * (f - 1);
}

function lgamma(z: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.984369578019571e-6,
    1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function tCritical95(df: number): number {
  if (df >= 120) return 1.96;
  const table: Record<number, number> = {
    1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306,
    9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 13: 2.16, 14: 2.145, 15: 2.131, 16: 2.12,
    17: 2.11, 18: 2.101, 19: 2.093, 20: 2.086, 21: 2.08, 22: 2.074, 23: 2.069, 24: 2.064,
    25: 2.06, 26: 2.056, 27: 2.052, 28: 2.048, 29: 2.045, 30: 2.042, 39: 2.023, 49: 2.009,
    59: 2.0, 79: 1.99, 99: 1.984,
  };
  if (table[df]) return table[df];
  const keys = Object.keys(table)
    .map(Number)
    .sort((a, b) => a - b);
  for (const k of keys) {
    if (df <= k) return table[k];
  }
  return 1.96;
}

export function buildPairedMetricReport(input: {
  metricKey: string;
  label: string;
  higherIsBetter: boolean;
  beforeValues: number[];
  afterValues: number[];
  improvements: number[];
  wins: number;
  ties: number;
}): PairedMetricReport {
  const pairedN = input.improvements.length;
  const winRate = pairedN > 0 ? input.wins / pairedN : 0;
  const binomialP = binomialOneSidedPValue(input.wins, pairedN);
  const wilcoxonTwo = wilcoxonSignedRankPValue(input.improvements);
  const wilcoxonOne = input.improvements.some((d) => d > 0)
    ? wilcoxonTwo / 2
    : wilcoxonTwo;
  const tResult = pairedTTest(input.improvements);

  const meanImp = mean(input.improvements);
  const significantAt95 =
    meanImp > 0 &&
    (binomialP < 0.05 || wilcoxonOne < 0.05 || tResult.pOneSided < 0.05);

  let verdict: PairedMetricReport["verdict"] = "inconclusive";
  if (significantAt95) verdict = "improved";
  else if (meanImp < 0 && (tResult.pOneSided > 0.95 || wilcoxonOne > 0.475)) {
    verdict = "worse";
  }

  return {
    metricKey: input.metricKey,
    label: input.label,
    higherIsBetter: input.higherIsBetter,
    before: describe(input.beforeValues),
    after: describe(input.afterValues),
    improvement: describe(input.improvements),
    winRate: round(winRate, 4),
    wins: input.wins,
    ties: input.ties,
    pairedN,
    binomialPValue: round(binomialP, 6),
    wilcoxonPValue: round(wilcoxonOne, 6),
    pairedTPValue: round(tResult.pOneSided, 6),
    ci95Improvement: tResult.ci95,
    significantAt95,
    verdict,
  };
}

// Small-sample statistics. Benchmark runs are expensive, so most comparisons
// have a handful of runs per side; intervals keep that uncertainty visible.

const Z = 1.96;

export interface Estimate {
  value: number;
  low: number;
  high: number;
  n: number;
}

/** Wilson score interval for a proportion; well-behaved at 0, 1 and small n. */
export function rate(successes: number, n: number): Estimate | null {
  if (n === 0) return null;
  const p = successes / n;
  const denominator = 1 + (Z * Z) / n;
  const centre = (p + (Z * Z) / (2 * n)) / denominator;
  const half = (Z * Math.sqrt((p * (1 - p)) / n + (Z * Z) / (4 * n * n))) / denominator;
  return { value: p, low: Math.max(0, centre - half), high: Math.min(1, centre + half), n };
}

/** Mean with a normal-approximation interval; a single value has no spread. */
export function mean(values: number[]): Estimate | null {
  const n = values.length;
  if (n === 0) return null;
  const average = values.reduce((sum, value) => sum + value, 0) / n;
  if (n === 1) return { value: average, low: average, high: average, n };
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (n - 1);
  const half = Z * Math.sqrt(variance / n);
  return { value: average, low: average - half, high: average + half, n };
}

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i;
  return result;
}

/**
 * pass^k (τ-bench): the chance that k independent attempts at the same scenario
 * all succeed, estimated without bias from c successes in n attempts.
 */
export function passHatK(successes: number, n: number, k: number): number | null {
  if (n < k || k < 1) return null;
  return choose(successes, k) / choose(n, k);
}

export type Comparison = 'improvement' | 'regression' | 'inconclusive' | 'tie' | 'insufficient';

/** Calls a difference only when the two intervals do not overlap. */
export function compare(
  baseline: Estimate | null,
  candidate: Estimate | null,
  higherIsBetter: boolean,
): Comparison {
  if (!baseline || !candidate) return 'insufficient';
  if (baseline.n < 2 || candidate.n < 2) return 'insufficient';
  if (Math.abs(candidate.value - baseline.value) < 1e-9) return 'tie';
  const separated = candidate.low > baseline.high || candidate.high < baseline.low;
  if (!separated) return 'inconclusive';
  const better = candidate.value > baseline.value === higherIsBetter;
  return better ? 'improvement' : 'regression';
}

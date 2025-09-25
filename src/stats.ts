import * as d3 from 'd3';
import type { BreakMode, LegendBreaks, MetricKey, PlaceKey, RegressionResult, WeightConfig } from './types';

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function normalizeWeights(weights: WeightConfig, active: Record<PlaceKey, boolean>): WeightConfig {
  const filteredEntries = Object.entries(weights).filter(([key]) => active[key as PlaceKey]);
  const total = filteredEntries.reduce((sum, [, value]) => sum + clamp01(value), 0);
  if (total === 0) {
    const size = filteredEntries.length || 1;
    const uniform = 1 / size;
    return Object.fromEntries(Object.keys(weights).map((key) => [key, active[key as PlaceKey] ? uniform : 0])) as WeightConfig;
  }
  return Object.fromEntries(
    Object.entries(weights).map(([key, value]) => [key, active[key as PlaceKey] ? clamp01(value) / total : 0])
  ) as WeightConfig;
}

export function minMax(values: number[]): { min: number; max: number } {
  return { min: d3.min(values) ?? 0, max: d3.max(values) ?? 0 };
}

export function normalizeSeries(values: (number | null)[]): (number | null)[] {
  const valid = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (valid.length === 0) {
    return values.map(() => null);
  }
  const { min, max } = minMax(valid);
  const range = max - min;
  if (range === 0) {
    return values.map((v) => (v == null ? null : 0.5));
  }
  return values.map((v) => (v == null ? null : (v - min) / range));
}

export function computeZScores(values: (number | null)[]): (number | null)[] {
  const valid = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (valid.length === 0) {
    return values.map(() => null);
  }
  const mean = d3.mean(valid) ?? 0;
  const variance = d3.mean(valid.map((v) => (v - mean) ** 2)) ?? 0;
  const std = Math.sqrt(variance);
  if (std === 0) {
    return values.map((v) => (v == null ? null : 0));
  }
  return values.map((v) => (v == null ? null : (v - mean) / std));
}

export function percentileRanks(values: (number | null)[]): (number | null)[] {
  const valid = values
    .map((value, index) => ({ value, index }))
    .filter((d): d is { value: number; index: number } => d.value != null && Number.isFinite(d.value))
    .sort((a, b) => a.value - b.value);
  if (valid.length === 0) {
    return values.map(() => null);
  }
  const ranks = new Array(values.length).fill(null) as (number | null)[];
  valid.forEach((entry, i) => {
    ranks[entry.index] = (i / (valid.length - 1)) * 100;
  });
  if (valid.length === 1) {
    ranks[valid[0].index] = 100;
  }
  return ranks;
}

export function linearRegression(x: number[], y: number[]): RegressionResult {
  if (x.length !== y.length) {
    throw new Error('Input lengths must match');
  }
  const n = x.length;
  const meanX = d3.mean(x) ?? 0;
  const meanY = d3.mean(y) ?? 0;
  let numerator = 0;
  let denominator = 0;
  let ssTot = 0;
  let ssRes = 0;
  let slope = 0;
  let intercept = meanY;
  if (n > 1) {
    for (let i = 0; i < n; i += 1) {
      const dx = x[i] - meanX;
      numerator += dx * (y[i] - meanY);
      denominator += dx * dx;
    }
    slope = denominator === 0 ? 0 : numerator / denominator;
    intercept = meanY - slope * meanX;
    for (let i = 0; i < n; i += 1) {
      const predicted = intercept + slope * x[i];
      const resid = y[i] - predicted;
      ssRes += resid * resid;
      ssTot += (y[i] - meanY) ** 2;
    }
  }
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  return { slope, intercept, r2 };
}

export function equalIntervalBreaks(values: number[], k = 5): number[] {
  if (values.length === 0) {
    return [];
  }
  const sorted = [...values].sort((a, b) => a - b);
  const { min, max } = minMax(sorted);
  if (min === max) {
    return [min, max];
  }
  const step = (max - min) / k;
  const breaks = [min];
  for (let i = 1; i < k; i += 1) {
    breaks.push(min + step * i);
  }
  breaks.push(max);
  return breaks;
}

export function quantileBreaks(values: number[], k = 5): number[] {
  if (values.length === 0) {
    return [];
  }
  const sorted = [...values].sort((a, b) => a - b);
  const breaks = [sorted[0]];
  for (let i = 1; i < k; i += 1) {
    const q = d3.quantileSorted(sorted, i / k) ?? sorted[sorted.length - 1];
    breaks.push(q);
  }
  breaks.push(sorted[sorted.length - 1]);
  return breaks;
}

function initialiseCentroids(values: number[], k: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const centroids: number[] = [];
  for (let i = 0; i < k; i += 1) {
    const q = i / (k - 1);
    const position = q * (sorted.length - 1);
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    const value = lower === upper ? sorted[lower] : (sorted[lower] + sorted[upper]) / 2;
    centroids.push(value);
  }
  return centroids;
}

export function jenksBreaks(values: number[], k = 5, iterations = 200): number[] {
  if (values.length === 0) {
    return [];
  }
  const centroids = initialiseCentroids(values, k);
  const assignments = new Array(values.length).fill(0);
  const sortedValues = [...values].sort((a, b) => a - b);
  const data = sortedValues;
  for (let iter = 0; iter < iterations; iter += 1) {
    let moved = false;
    for (let i = 0; i < data.length; i += 1) {
      let bestCluster = 0;
      let bestDist = Infinity;
      for (let c = 0; c < k; c += 1) {
        const dist = Math.abs(data[i] - centroids[c]);
        if (dist < bestDist) {
          bestDist = dist;
          bestCluster = c;
        }
      }
      if (assignments[i] !== bestCluster) {
        assignments[i] = bestCluster;
        moved = true;
      }
    }
    const clusterSums = new Array(k).fill(0);
    const clusterCounts = new Array(k).fill(0);
    for (let i = 0; i < data.length; i += 1) {
      const cluster = assignments[i];
      clusterSums[cluster] += data[i];
      clusterCounts[cluster] += 1;
    }
    for (let c = 0; c < k; c += 1) {
      if (clusterCounts[c] > 0) {
        centroids[c] = clusterSums[c] / clusterCounts[c];
      }
    }
    if (!moved) {
      break;
    }
  }
  const clusterValues: number[][] = Array.from({ length: k }, () => []);
  for (let i = 0; i < data.length; i += 1) {
    clusterValues[assignments[i]].push(data[i]);
  }
  const breaks = [Math.min(...data)];
  for (let c = 0; c < k - 1; c += 1) {
    const cluster = clusterValues[c];
    if (cluster.length === 0) {
      breaks.push(breaks[breaks.length - 1]);
    } else {
      breaks.push(cluster[cluster.length - 1]);
    }
  }
  breaks.push(Math.max(...data));
  return breaks;
}

export function formatBreaks(breaks: number[]): LegendBreaks {
  if (breaks.length < 2) {
    return { bins: [], labels: [] };
  }
  const labels: string[] = [];
  for (let i = 0; i < breaks.length - 1; i += 1) {
    const start = breaks[i];
    const end = breaks[i + 1];
    labels.push(`${d3.format('.2f')(start)} – ${d3.format('.2f')(end)}`);
  }
  return { bins: breaks, labels };
}

export function computeBreaks(values: number[], mode: BreakMode): LegendBreaks {
  const filtered = values.filter((v) => Number.isFinite(v));
  if (filtered.length === 0) {
    return { bins: [], labels: [] };
  }
  let breaks: number[] = [];
  if (mode === 'equal') {
    breaks = equalIntervalBreaks(filtered, 5);
  } else if (mode === 'jenks') {
    breaks = jenksBreaks(filtered, 5);
  } else {
    breaks = quantileBreaks(filtered, 5);
  }
  const deduped = [breaks[0]];
  for (let i = 1; i < breaks.length; i += 1) {
    const current = breaks[i];
    if (current !== deduped[deduped.length - 1]) {
      deduped.push(current);
    }
  }
  return formatBreaks(deduped);
}

export function computeResiduals(hbi: (number | null)[], exposure: (number | null)[]) {
  const paired: { hbi: number; exposure: number; index: number }[] = [];
  for (let i = 0; i < hbi.length; i += 1) {
    const h = hbi[i];
    const e = exposure[i];
    if (h == null || e == null) continue;
    paired.push({ hbi: h, exposure: e, index: i });
  }
  if (paired.length < 2) {
    return {
      residuals: hbi.map(() => null as number | null),
      expected: hbi.map(() => null as number | null),
      regression: { slope: 0, intercept: 0, r2: 0 }
    };
  }
  const regression = linearRegression(
    paired.map((d) => d.exposure),
    paired.map((d) => d.hbi)
  );
  const residuals = new Array(hbi.length).fill(null) as (number | null)[];
  const expected = new Array(hbi.length).fill(null) as (number | null)[];
  for (const item of paired) {
    const predicted = regression.intercept + regression.slope * item.exposure;
    expected[item.index] = predicted;
    residuals[item.index] = item.hbi - predicted;
  }
  return { residuals, expected, regression };
}

export function symmetricBreaks(values: number[], classes = 5): number[] {
  if (values.length === 0) {
    return [];
  }
  const maxAbs = d3.max(values, (v) => Math.abs(v)) ?? 0;
  const step = (maxAbs * 2) / classes;
  const breaks = [-maxAbs];
  for (let i = 1; i < classes; i += 1) {
    breaks.push(-maxAbs + step * i);
  }
  breaks.push(maxAbs);
  return breaks;
}

export function formatPercent(value: number | null): string {
  if (value == null || Number.isNaN(value)) {
    return '—';
  }
  return `${d3.format('.1f')(value)}%`;
}

export function formatNumber(value: number | null): string {
  if (value == null || Number.isNaN(value)) {
    return '—';
  }
  return d3.format('.2f')(value);
}

export function metricLabel(metric: MetricKey): string {
  if (metric === 'hbi') return 'Health Burden Index';
  if (metric === 'exposure') return 'Exposure Index';
  if (metric === 'residual') return 'Residual (HBI – Expected)';
  return 'Residual (Expected – HBI)';
}

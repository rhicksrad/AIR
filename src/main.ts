import './styles.css';
import { combineData, loadGeography, loadPlaces, loadPm } from './data';
import type { AppState, BreakMode, CountyDatum, MetricKey, Outlier, PlaceKey, WeightConfig } from './types';
import { PLACE_KEYS } from './types';
import {
  computeBreaks,
  computeResiduals,
  computeZScores,
  formatBreaks,
  formatNumber,
  metricLabel,
  normalizeSeries,
  percentileRanks,
  symmetricBreaks
} from './stats';
import { CountyMap } from './map';
import { UIController } from './ui';

interface DerivedData {
  counties: CountyDatum[];
  regressionR2: number;
}

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('App container not found');
}

app.className = 'flex min-h-screen flex-col gap-6 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 p-4 text-slate-100';

const layout = document.createElement('div');
layout.className = 'mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-4 lg:flex-row';
app.appendChild(layout);

const controlPanel = document.createElement('aside');
const mapPanel = document.createElement('section');
mapPanel.className = 'relative flex-1 overflow-hidden rounded-2xl bg-slate-200/20 shadow-2xl ring-1 ring-slate-100/10 dark:bg-slate-900/40';
controlPanel.className = 'w-full lg:w-96';
layout.appendChild(controlPanel);
layout.appendChild(mapPanel);

const loading = document.createElement('div');
loading.className = 'flex h-full items-center justify-center text-sm text-slate-400';
loading.textContent = 'Loading datasets…';
mapPanel.appendChild(loading);

const { weights: initialWeights, active: initialActive } = UIController.initialWeights();

const ui = new UIController(controlPanel, { ...initialWeights }, { ...initialActive }, {
  onMetricChange: (metric) => {
    state.metric = metric;
    updateVisualization();
  },
  onBreakModeChange: (mode) => {
    state.breakMode = mode;
    updateVisualization();
  },
  onWeightsChange: (weights, active) => {
    state.weights = weights;
    state.activeMeasures = active;
    recalculate();
  },
  onSearch: (fips) => {
    if (!mapInstance) return;
    mapInstance.focusOnCounty(fips);
    mapInstance.flashCounty(fips);
  },
  onOutlierSelect: (fips) => {
    if (!mapInstance) return;
    mapInstance.focusOnCounty(fips);
    mapInstance.flashCounty(fips);
  },
  onPmLabelChange: (label) => {
    state.pmYearLabel = label || '2016–2024';
    updateVisualization();
  }
});

const state: AppState = {
  metric: 'hbi',
  breakMode: 'quantile',
  weights: initialWeights,
  activeMeasures: initialActive,
  legend: { bins: [], labels: [] },
  pmYearLabel: '2016–2024'
};

let derived: DerivedData | null = null;
let baseCounties: CountyDatum[] = [];
let mapInstance: CountyMap | null = null;
let regressionBadge: HTMLDivElement | null = null;

function withPercent(value: number | null): string {
  const formatted = formatNumber(value);
  return formatted === '—' ? formatted : `${formatted}%`;
}

function tooltipTemplate(datum: CountyDatum, metric: MetricKey): string {
  const metricValue = metric === 'hbi' ? datum.hbi : metric === 'exposure' ? datum.exposure : datum.residual;
  const metricPercentile = datum.percentile[metric] ?? null;
  const base = `
    <div class="flex flex-col gap-1">
      <div class="flex items-center justify-between gap-4">
        <h3 class="text-base font-semibold text-white">${datum.county}, ${datum.state}</h3>
        <span class="text-xs font-mono text-slate-400">${datum.fips}</span>
      </div>
      <div class="rounded bg-slate-900/60 px-3 py-2 text-xs text-slate-200">
        <div class="font-semibold">${metricLabel(metric)}</div>
        <div>Value: ${formatNumber(metricValue)}</div>
        <div>Percentile: ${withPercent(metricPercentile)}</div>
      </div>
      <div class="grid grid-cols-2 gap-2 text-xs text-slate-200">
        <div class="flex flex-col gap-0.5">
          <span class="font-semibold">${metricLabel('hbi')}</span>
          <span>Index: ${formatNumber(datum.hbi)}</span>
          <span>Z: ${formatNumber(datum.hbiZ)}</span>
          <span>Percentile: ${withPercent(datum.percentile.hbi)}</span>
        </div>
        <div class="flex flex-col gap-0.5">
          <span class="font-semibold">${metricLabel('exposure')}</span>
          <span>Index: ${formatNumber(datum.exposure)}</span>
          <span>Z: ${formatNumber(datum.exposureZ)}</span>
          <span>Percentile: ${withPercent(datum.percentile.exposure)}</span>
        </div>
      </div>
      <div class="text-xs text-slate-300">PM₂.₅ window: ${state.pmYearLabel}</div>
      ${datum.residual != null ? `<div class="text-xs text-orange-300">Residual: ${formatNumber(datum.residual)} (${withPercent(datum.percentile.residual)})</div>` : ''}
      ${datum.hasDataGap ? '<div class="text-[11px] text-amber-300">One or more PLACES inputs missing.</div>' : ''}
    </div>
  `;
  return base;
}

function computeIndices(data: CountyDatum[], weights: WeightConfig, active: Record<PlaceKey, boolean>): DerivedData {
  const measureArrays: Record<PlaceKey, (number | null)[]> = PLACE_KEYS.reduce(
    (acc, key) => ({
      ...acc,
      [key]: data.map((d) => d[key])
    }),
    {} as Record<PlaceKey, (number | null)[]>
  );

  const normalizedMeasures: Record<PlaceKey, (number | null)[]> = PLACE_KEYS.reduce(
    (acc, key) => ({
      ...acc,
      [key]: normalizeSeries(measureArrays[key])
    }),
    {} as Record<PlaceKey, (number | null)[]>
  );

  const exposureSeries = normalizeSeries(data.map((d) => d.pm25));

  const hbiValues: (number | null)[] = data.map((_d, index) => {
    let sum = 0;
    let hasMissing = false;
    for (const key of PLACE_KEYS) {
      if (!active[key]) continue;
      const value = normalizedMeasures[key][index];
      if (value == null) {
        hasMissing = true;
        break;
      }
      sum += value * weights[key];
    }
    if (hasMissing) return null;
    return sum;
  });

  const { residuals, expected, regression } = computeResiduals(hbiValues, exposureSeries);

  const hbiZ = computeZScores(hbiValues);
  const exposureZ = computeZScores(exposureSeries);
  const hbiPct = percentileRanks(hbiValues);
  const exposurePct = percentileRanks(exposureSeries);
  const residualPct = percentileRanks(residuals);

  const counties = data.map((datum, index) => ({
    ...datum,
    hbi: hbiValues[index],
    exposure: exposureSeries[index],
    residual: residuals[index],
    expectedHbi: expected[index],
    hbiZ: hbiZ[index],
    exposureZ: exposureZ[index],
    percentile: {
      hbi: hbiPct[index],
      exposure: exposurePct[index],
      residual: residualPct[index]
    },
    hasDataGap: PLACE_KEYS.some((key) => active[key] && normalizedMeasures[key][index] == null)
  }));

  return { counties, regressionR2: regression.r2 };
}

function computeLegend(metric: MetricKey, data: CountyDatum[], mode: BreakMode) {
  const values = data
    .map((d) => {
      if (metric === 'hbi') return d.hbi;
      if (metric === 'exposure') return d.exposure;
      return d.residual;
    })
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (values.length === 0) {
    return { bins: [], labels: [] };
  }
  if (metric === 'residual') {
    const breaks = symmetricBreaks(values, 5);
    return formatBreaks(breaks);
  }
  return computeBreaks(values, mode);
}

function updateOutliers(data: CountyDatum[]): Outlier[] {
  const residuals = data
    .filter((d) => d.residual != null && d.residual > 0)
    .sort((a, b) => (b.residual ?? 0) - (a.residual ?? 0))
    .slice(0, 25);
  return residuals.map((d) => ({
    fips: d.fips,
    county: d.county,
    state: d.state,
    residual: d.residual ?? 0,
    exposure: d.exposure,
    hbi: d.hbi
  }));
}

function updateVisualization() {
  if (!derived || !mapInstance) return;
  const legend = computeLegend(state.metric, derived.counties, state.breakMode);
  state.legend = legend;
  mapInstance.update(derived.counties, state.metric, legend);
  if (state.metric === 'residual') {
    ui.updateOutliers(updateOutliers(derived.counties));
  } else {
    ui.updateOutliers([]);
  }
  if (regressionBadge && derived) {
    regressionBadge.innerHTML = `<span class="font-semibold">OLS fit R²</span> <span class="font-mono">${formatNumber(derived.regressionR2)}</span>`;
  }
}

function recalculate() {
  if (!baseCounties.length) return;
  derived = computeIndices(baseCounties, state.weights, state.activeMeasures);
  ui.updateData(derived.counties);
  updateVisualization();
}

Promise.all([loadPlaces(), loadPm(), loadGeography()])
  .then(([places, pm, geography]) => {
    baseCounties = combineData(places, pm);
    derived = computeIndices(baseCounties, state.weights, state.activeMeasures);
    ui.updateData(derived.counties);

    mapPanel.removeChild(loading);
    const mapContainer = document.createElement('div');
    mapContainer.className = 'relative h-[600px] min-h-[420px] w-full';
    mapPanel.appendChild(mapContainer);

    regressionBadge = document.createElement('div');
    regressionBadge.className = 'pointer-events-none absolute bottom-4 left-4 z-10 flex items-center gap-2 rounded-lg bg-slate-900/80 px-3 py-2 text-xs font-medium text-slate-100 shadow-lg';
    mapPanel.appendChild(regressionBadge);

    mapInstance = new CountyMap(
      mapContainer,
      geography,
      tooltipTemplate,
      {
        onHover: () => {},
        onSelect: () => {}
      }
    );

    updateVisualization();
  })
  .catch((error) => {
    console.error(error);
    loading.textContent = 'Failed to load datasets.';
  });

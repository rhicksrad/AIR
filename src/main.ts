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

app.className = 'relative mx-auto flex min-h-screen w-full max-w-none flex-col gap-10 px-5 py-10 text-white xl:px-12';

const glow = document.createElement('div');
glow.className =
  'pointer-events-none absolute inset-0 -z-10 rounded-[48px] border border-white/10 bg-gradient-to-br from-white/5 via-transparent to-primary/20 shadow-[0_60px_160px_-70px_rgba(53,94,59,0.8)]';
app.appendChild(glow);

const header = document.createElement('header');
header.className = 'flex flex-col gap-4 text-white/80';
header.innerHTML = `
  <span class="section-heading">Air &amp; health</span>
  <h1 class="text-4xl font-semibold leading-tight text-white">Where dirty air and chronic illness overlap</h1>
  <p class="max-w-3xl text-base leading-relaxed text-white/80">
    Use this explorer to see how long-term fine particle pollution relates to chronic disease burdens. Pick a map view below,
    then click a county to read its numbers in the table under the map.
  </p>
`;
app.appendChild(header);

const layout = document.createElement('div');
layout.className = 'relative flex flex-1 flex-col gap-8';
app.appendChild(layout);

const mapColumn = document.createElement('section');
mapColumn.className = 'relative flex flex-col gap-6';
layout.appendChild(mapColumn);

const metricTabs = document.createElement('div');
metricTabs.className = 'metric-tabs';
mapColumn.appendChild(metricTabs);

const metricButtons = new Map<MetricKey, HTMLButtonElement>();
const metricDetails: Record<MetricKey, string> = {
  hbi: 'Health',
  exposure: 'Pollution',
  residual: 'Health minus pollution',
  pollutionMinusHealth: 'Pollution minus health'
};
(
  [
    { key: 'hbi', helper: 'Weighted mix of chronic disease measures' },
    { key: 'exposure', helper: 'Average fine particle levels' },
    { key: 'residual', helper: 'Places where illness is higher than pollution alone predicts' },
    { key: 'pollutionMinusHealth', helper: 'Places where illness is lower than pollution alone predicts' }
  ] as { key: MetricKey; helper: string }[]
).forEach(({ key, helper }) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'metric-tab';
  button.innerHTML = `
    <span class="metric-tab-label">${metricDetails[key]}</span>
    <span class="metric-tab-helper">${helper}</span>
  `;
  button.addEventListener('click', () => {
    if (state.metric === key) return;
    setMetric(key);
  });
  metricTabs.appendChild(button);
  metricButtons.set(key, button);
});

const mapPanel = document.createElement('div');
mapPanel.className =
  'relative flex min-h-[640px] flex-1 overflow-hidden rounded-[48px] border border-white/10 bg-black/70 shadow-[0_80px_200px_-90px_rgba(15,35,24,0.9)] backdrop-blur-2xl xl:min-h-[760px]';
mapColumn.appendChild(mapPanel);

const controlPanel = document.createElement('aside');
controlPanel.className = 'relative z-10 w-full';

const loading = document.createElement('div');
loading.className = 'flex h-full w-full items-center justify-center text-sm font-medium text-white/70';
loading.textContent = 'Loading county and pollution data…';
mapPanel.appendChild(loading);

const overlay = document.createElement('div');
overlay.className = 'map-panel-overlay';
mapPanel.appendChild(overlay);

const detailsCard = document.createElement('div');
detailsCard.className = 'card flex flex-col gap-4';
detailsCard.innerHTML = `
  <div class="flex flex-col gap-1">
    <span class="section-heading">County snapshot</span>
    <h2 class="text-lg font-semibold text-white">Click a county to read the data</h2>
  </div>
  <div class="county-details" data-role="county-details"></div>
`;
mapColumn.appendChild(detailsCard);

mapColumn.appendChild(controlPanel);

const detailsBody = detailsCard.querySelector('[data-role="county-details"]') as HTMLDivElement;

const { weights: initialWeights, active: initialActive } = UIController.initialWeights();

const state: AppState = {
  metric: 'hbi',
  breakMode: 'quantile',
  weights: initialWeights,
  activeMeasures: initialActive,
  legend: { bins: [], labels: [] },
  pmYearLabel: '2016–2024',
  selectedCounty: null
};

const ui = new UIController(controlPanel, { ...initialWeights }, { ...initialActive }, {
  onBreakModeChange: (mode) => {
    state.breakMode = mode;
    updateVisualization();
  },
  onWeightsChange: (weights, active) => {
    state.weights = weights;
    state.activeMeasures = active;
    recalculate();
  },
  onOutlierSelect: (fips) => {
    if (!mapInstance) return;
    mapInstance.focusOnCounty(fips);
    mapInstance.flashCounty(fips);
    if (derived) {
      const target = derived.counties.find((county) => county.fips === fips);
      if (target) {
        state.selectedCounty = target;
        renderCountyDetails(target);
        mapInstance.setSelectedCounty(target.fips);
      }
    }
  },
  onPmLabelChange: (label) => {
    state.pmYearLabel = label || '2016–2024';
    renderCountyDetails(state.selectedCounty);
  }
});

const aboutPanel = document.createElement('section');
aboutPanel.className = 'panel-surface flex flex-col gap-6 text-sm leading-relaxed text-white/80';
aboutPanel.innerHTML = `
  <div class="flex flex-col gap-2">
    <span class="section-heading">About this explorer</span>
    <h2 class="text-lg font-semibold text-white">How to read &amp; data notes</h2>
  </div>
  <div class="grid gap-6 md:grid-cols-2">
    <div>
      <p class="text-sm font-semibold text-white">How to read this view</p>
      <ul class="mt-2 list-disc space-y-1 pl-5">
        <li>Tabs above the map switch between Health, air pollution, and two gap views showing where illness runs higher or lower than expected.</li>
        <li>Click any county to update the table and keep the numbers visible while you explore.</li>
        <li>Use the controls on the right to change the color groupings or tweak the blended index weights.</li>
      </ul>
    </div>
    <div>
      <p class="text-sm font-semibold text-white">Data notes</p>
      <ul class="mt-2 list-disc space-y-1 pl-5">
        <li>CDC PLACES 2024 release (crude prevalence) for chronic conditions.</li>
        <li>EPA Air Quality System PM₂.₅ monitor annual means averaged across available monitors.</li>
        <li>Residuals derive from an ordinary least squares fit of HBI on pollution.</li>
        <li>Methodology and limitations described in the README.</li>
      </ul>
    </div>
  </div>
`;
layout.appendChild(aboutPanel);
let derived: DerivedData | null = null;
let baseCounties: CountyDatum[] = [];
let mapInstance: CountyMap | null = null;
let regressionBadge: HTMLDivElement | null = null;

ui.setBreakMode(state.breakMode);
ui.setBuilderVisibility(state.metric === 'hbi');
ui.setOutlierVisibility(false);
setMetric(state.metric);

function withPercent(value: number | null): string {
  const formatted = formatNumber(value);
  return formatted === '—' ? formatted : `${formatted}%`;
}

function renderCountyDetails(county: CountyDatum | null) {
  if (!detailsBody) return;
  if (!county) {
    detailsBody.innerHTML = `
      <p class="text-sm leading-relaxed text-white/70">
        Click any county on the map to see its chronic disease burdens, pollution levels, and percentile ranks.
      </p>
    `;
    return;
  }

  const metricRows: { key: MetricKey; helper: string; value: number | null; percentile: number | null }[] = [
    {
      key: 'hbi',
      helper: 'Weighted combination of the measures you turned on',
      value: county.hbi,
      percentile: county.percentile.hbi
    },
    {
      key: 'exposure',
      helper: `Average PM₂.₅ (µg/m³) across ${state.pmYearLabel}`,
      value: county.exposure,
      percentile: county.percentile.exposure
    },
    {
      key: 'residual',
      helper: `Positive values mean more illness than the pollution-only model predicted. Expected HBI: ${formatNumber(county.expectedHbi)}`,
      value: county.residual,
      percentile: county.percentile.residual
    },
    {
      key: 'pollutionMinusHealth',
      helper: `Positive values mean less illness than the pollution-only model predicted. Expected HBI: ${formatNumber(county.expectedHbi)}`,
      value: county.pollutionMinusHealth,
      percentile: county.percentile.pollutionMinusHealth
    }
  ];

  const placeLabels: Record<PlaceKey, string> = {
    asthma_pct: 'Adults with asthma',
    copd_pct: 'Adults with COPD',
    diabetes_pct: 'Adults with diabetes',
    hypertension_pct: 'Adults with high blood pressure',
    obesity_pct: 'Adults with obesity',
    smoking_pct: 'Adults who smoke'
  };

  detailsBody.innerHTML = `
    <div class="rounded-2xl border border-white/10 bg-black/40 p-4 text-white/80 shadow-inner backdrop-blur">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h3 class="text-xl font-semibold text-white">${county.county}, ${county.state}</h3>
        <span class="text-xs font-mono text-white/60">${county.fips}</span>
      </div>
      <p class="text-xs text-white/60">PM₂.₅ averaging window: ${state.pmYearLabel}</p>
      ${county.hasDataGap ? '<p class="mt-1 text-xs text-amber-500">One or more health measures are missing for this county.</p>' : ''}
    </div>
    <div class="overflow-hidden rounded-2xl border border-white/10 bg-black/40 shadow-inner backdrop-blur">
      <table class="county-table">
        <thead>
          <tr>
            <th scope="col">Measure</th>
            <th scope="col">Value</th>
            <th scope="col">Percentile</th>
          </tr>
        </thead>
        <tbody>
          ${metricRows
            .map((row) => {
              const isActive = row.key === state.metric;
              return `
                <tr class="${isActive ? 'metric-row-active' : ''}">
                  <th scope="row">
                    <div class="flex flex-col gap-0.5">
                      <span>${metricDetails[row.key]}</span>
                      <span class="metric-row-helper">${row.helper}</span>
                    </div>
                  </th>
                  <td>${formatNumber(row.value)}</td>
                  <td>${withPercent(row.percentile)}</td>
                </tr>
              `;
            })
            .join('')}
        </tbody>
      </table>
    </div>
    <div class="panel-surface flex flex-col gap-2">
      <p class="text-sm font-semibold text-white">Chronic disease inputs</p>
      <ul class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        ${PLACE_KEYS.map((key) => `
          <li class="flex flex-col gap-0.5 text-sm text-white/70">
            <span class="font-semibold text-white">${placeLabels[key]}</span>
            <span>${withPercent((county[key] as number | null) ?? null)}</span>
          </li>
        `).join('')}
      </ul>
    </div>
  `;
}

function setMetric(metric: MetricKey) {
  state.metric = metric;
  metricButtons.forEach((button, key) => {
    const isActive = key === metric;
    button.classList.toggle('metric-tab-active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
  ui.setBuilderVisibility(metric === 'hbi');
  ui.setOutlierVisibility(metric === 'residual');
  updateVisualization();
  renderCountyDetails(state.selectedCounty);
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
  const pollutionMinusHealthValues = residuals.map((value) => (value == null ? null : -value));
  const residualPct = percentileRanks(residuals);
  const pollutionMinusHealthPct = percentileRanks(pollutionMinusHealthValues);

  const counties = data.map((datum, index) => ({
    ...datum,
    hbi: hbiValues[index],
    exposure: exposureSeries[index],
    residual: residuals[index],
    pollutionMinusHealth: pollutionMinusHealthValues[index],
    expectedHbi: expected[index],
    hbiZ: hbiZ[index],
    exposureZ: exposureZ[index],
    percentile: {
      hbi: hbiPct[index],
      exposure: exposurePct[index],
      residual: residualPct[index],
      pollutionMinusHealth: pollutionMinusHealthPct[index]
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
      if (metric === 'residual') return d.residual;
      return d.pollutionMinusHealth;
    })
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (values.length === 0) {
    return { bins: [], labels: [] };
  }
  if (metric === 'residual' || metric === 'pollutionMinusHealth') {
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
  mapInstance.setSelectedCounty(state.selectedCounty ? state.selectedCounty.fips : null);
  if (state.metric === 'residual') {
    ui.updateOutliers(updateOutliers(derived.counties));
  } else {
    ui.updateOutliers([]);
  }
  if (regressionBadge && derived) {
    regressionBadge.innerHTML = `<span class="font-semibold">OLS fit R²</span> <span class="font-mono">${formatNumber(derived.regressionR2)}</span>`;
  }
  renderCountyDetails(state.selectedCounty);
}

function recalculate() {
  if (!baseCounties.length) return;
  derived = computeIndices(baseCounties, state.weights, state.activeMeasures);
  if (state.selectedCounty) {
    const updated = derived.counties.find((county) => county.fips === state.selectedCounty?.fips);
    state.selectedCounty = updated ?? null;
  }
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
    mapContainer.className = 'relative h-[640px] min-h-[420px] w-full';
    mapPanel.appendChild(mapContainer);

    regressionBadge = document.createElement('div');
    regressionBadge.className = 'pointer-events-none absolute bottom-4 left-4 z-10 flex items-center gap-2 rounded-lg bg-black/70 px-3 py-2 text-xs font-medium text-white/80 shadow-lg';
    mapPanel.appendChild(regressionBadge);

    mapInstance = new CountyMap(mapContainer, geography, undefined, {
      onSelect: (datum) => {
        state.selectedCounty = datum;
        renderCountyDetails(datum);
        mapInstance?.setSelectedCounty(datum.fips);
      }
    });

    updateVisualization();
  })
  .catch((error) => {
    console.error(error);
    loading.textContent = 'Failed to load datasets.';
  });

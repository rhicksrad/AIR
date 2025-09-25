import * as d3 from 'd3';
import type { BreakMode, CountyDatum, MetricKey, Outlier, PlaceKey, WeightConfig } from './types';
import { PLACE_KEYS } from './types';
import { formatNumber, normalizeWeights } from './stats';

interface UIOptions {
  onMetricChange: (metric: MetricKey) => void;
  onBreakModeChange: (mode: BreakMode) => void;
  onWeightsChange: (weights: WeightConfig, active: Record<PlaceKey, boolean>) => void;
  onSearch: (query: string) => void;
  onOutlierSelect: (fips: string) => void;
  onPmLabelChange: (label: string) => void;
}

interface HashState {
  weights: Partial<Record<PlaceKey, number>>;
  active: Partial<Record<PlaceKey, boolean>>;
}

function parseHash(): HashState {
  const hash = window.location.hash.replace('#', '');
  const state: HashState = { weights: {}, active: {} };
  if (!hash) return state;
  const segments = hash.split('&');
  for (const segment of segments) {
    const [key, rawValue] = segment.split('=');
    if (!key || !rawValue) continue;
    if (key === 'weights') {
      rawValue.split(',').forEach((entry) => {
        const [k, v] = entry.split(':');
        if (!k || v == null) return;
        const value = Number(v);
        if (Number.isFinite(value)) {
          state.weights[k as PlaceKey] = value;
        }
      });
    }
    if (key === 'active') {
      rawValue.split(',').forEach((entry) => {
        const [k, v] = entry.split(':');
        if (!k || v == null) return;
        state.active[k as PlaceKey] = v === '1';
      });
    }
  }
  return state;
}

function updateHash(weights: WeightConfig, active: Record<PlaceKey, boolean>) {
  const weightString = PLACE_KEYS.map((key) => `${key}:${Number(weights[key].toFixed(3))}`).join(',');
  const activeString = PLACE_KEYS.map((key) => `${key}:${active[key] ? 1 : 0}`).join(',');
  const hash = `weights=${weightString}&active=${activeString}`;
  if (window.location.hash !== `#${hash}`) {
    window.location.hash = hash;
  }
}

function createWeightControls(
  container: HTMLElement,
  weights: WeightConfig,
  active: Record<PlaceKey, boolean>,
  onChange: (nextWeights: WeightConfig, nextActive: Record<PlaceKey, boolean>) => void
) {
  const wrapper = d3.select(container).append('div').attr('class', 'flex flex-col gap-3');
  PLACE_KEYS.forEach((key) => {
    const row = wrapper.append('div').attr('class', 'flex flex-col gap-1');
    const labelRow = row.append('label').attr('class', 'flex items-center justify-between gap-3 text-sm font-medium');
    const label = key
      .replace('_pct', '')
      .replace('copd', 'COPD')
      .replace('hbi', 'HBI');
    labelRow
      .append('span')
      .attr('class', 'capitalize')
      .text(label.replace(/_/g, ' '));
    const toggle = labelRow
      .append('input')
      .attr('type', 'checkbox')
      .attr('class', 'h-4 w-4 accent-primary')
      .property('checked', active[key])
      .on('change', (event) => {
        active[key] = (event.currentTarget as HTMLInputElement).checked;
        const normalized = normalizeWeights(weights, active);
        onChange(normalized, { ...active });
      });

    const controlRow = row.append('div').attr('class', 'flex items-center gap-3');
    const slider = controlRow
      .append('input')
      .attr('type', 'range')
      .attr('min', 0)
      .attr('max', 100)
      .attr('step', 1)
      .attr('class', 'w-full accent-primary')
      .property('value', Math.round(weights[key] * 100))
      .property('disabled', !active[key])
      .on('input', (event) => {
        const raw = Number((event.currentTarget as HTMLInputElement).value) / 100;
        weights[key] = raw;
        const normalized = normalizeWeights(weights, active);
        onChange(normalized, { ...active });
      });
    controlRow
      .append('span')
      .attr('class', 'w-10 text-right text-xs font-semibold tabular-nums text-slate-500')
      .text(`${Math.round(weights[key] * 100)}%`);

    toggle.on('change.weight', () => {
      slider.property('disabled', !active[key]);
      slider.property('value', Math.round(weights[key] * 100));
      controlRow.select('span').text(`${Math.round(weights[key] * 100)}%`);
    });
  });
}

function searchMatches(data: CountyDatum[], query: string): CountyDatum[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return data
    .filter((county) =>
      county.county.toLowerCase().includes(q) ||
      county.state.toLowerCase().includes(q) ||
      county.fips.includes(q)
    )
    .slice(0, 10);
}

export class UIController {
  private container: HTMLElement;

  private options: UIOptions;

  private metricSelect: HTMLSelectElement;

  private breakSelect: HTMLSelectElement;

  private weightPanel: HTMLElement;

  private searchInput: HTMLInputElement;

  private searchResults: HTMLElement;

  private outlierList: HTMLElement;

  private outlierSection: HTMLElement;

  private outlierButton: HTMLButtonElement;

  private pmLabelInput: HTMLInputElement;

  private weights: WeightConfig;

  private active: Record<PlaceKey, boolean>;

  private data: CountyDatum[] = [];

  private currentOutliers: Outlier[] = [];

  constructor(container: HTMLElement, weights: WeightConfig, active: Record<PlaceKey, boolean>, options: UIOptions) {
    this.container = container;
    this.weights = weights;
    this.active = active;
    this.options = options;
    this.container.classList.add('card', 'flex', 'max-w-sm', 'flex-col', 'gap-6');
    this.container.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'flex flex-col gap-1';
    title.innerHTML = `
      <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-100">County Health vs Air Quality</h1>
      <p class="text-sm text-slate-600 dark:text-slate-300">Explore CDC PLACES chronic disease burdens alongside PM₂.₅ exposure.</p>
    `;
    this.container.appendChild(title);

    const metricGroup = document.createElement('div');
    metricGroup.className = 'flex flex-col gap-2';
    metricGroup.innerHTML = `
      <label class="text-sm font-semibold">Map metric</label>
      <select class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
        <option value="hbi">Health Burden Index</option>
        <option value="exposure">Exposure Index</option>
        <option value="residual">Residual (HBI - Expected)</option>
      </select>
    `;
    this.metricSelect = metricGroup.querySelector('select') as HTMLSelectElement;
    this.metricSelect.addEventListener('change', () => {
      const metric = this.metricSelect.value as MetricKey;
      this.options.onMetricChange(metric);
      this.toggleOutliers(metric === 'residual');
    });
    this.container.appendChild(metricGroup);

    const breakGroup = document.createElement('div');
    breakGroup.className = 'flex flex-col gap-2';
    breakGroup.innerHTML = `
      <label class="text-sm font-semibold">Class breaks</label>
      <select class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
        <option value="quantile">Quantile (quintiles)</option>
        <option value="equal">Equal interval</option>
        <option value="jenks">Jenks (k-means)</option>
      </select>
    `;
    this.breakSelect = breakGroup.querySelector('select') as HTMLSelectElement;
    this.breakSelect.addEventListener('change', () => {
      this.options.onBreakModeChange(this.breakSelect.value as BreakMode);
    });
    this.container.appendChild(breakGroup);

    const pmLabelGroup = document.createElement('div');
    pmLabelGroup.className = 'flex flex-col gap-2';
    pmLabelGroup.innerHTML = `
      <label class="text-sm font-semibold">PM₂.₅ averaging window</label>
      <input type="text" class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="2016–2024" value="2016–2024" />
    `;
    this.pmLabelInput = pmLabelGroup.querySelector('input') as HTMLInputElement;
    this.pmLabelInput.addEventListener('input', () => this.options.onPmLabelChange(this.pmLabelInput.value || '2016–2024'));
    this.container.appendChild(pmLabelGroup);

    const builder = document.createElement('div');
    builder.className = 'flex flex-col gap-3';
    builder.innerHTML = `
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold">Health Burden Builder</h2>
        <button type="button" class="text-xs font-medium text-primary hover:underline">Reset weights</button>
      </div>
      <p class="text-xs text-slate-500 dark:text-slate-400">Select CDC PLACES measures and adjust their influence on the index. Weights re-normalize automatically.</p>
    `;
    const resetButton = builder.querySelector('button') as HTMLButtonElement;
    resetButton.addEventListener('click', () => {
      const uniform = 1 / PLACE_KEYS.length;
      PLACE_KEYS.forEach((key) => {
        this.weights[key] = uniform;
        this.active[key] = true;
      });
      updateHash(this.weights, this.active);
      this.emitWeightChange();
      this.renderWeightPanel();
    });
    this.container.appendChild(builder);

    this.weightPanel = document.createElement('div');
    this.weightPanel.className = 'flex flex-col gap-3';
    this.container.appendChild(this.weightPanel);
    this.renderWeightPanel();

    const searchGroup = document.createElement('div');
    searchGroup.className = 'flex flex-col gap-2';
    searchGroup.innerHTML = `
      <label class="text-sm font-semibold">Search counties</label>
      <input type="search" class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="Type a county or FIPS" />
      <div class="flex flex-col gap-1 text-xs text-slate-500"></div>
    `;
    this.searchInput = searchGroup.querySelector('input') as HTMLInputElement;
    this.searchResults = searchGroup.querySelector('div') as HTMLElement;
    this.searchInput.addEventListener('input', () => {
      const query = this.searchInput.value;
      if (!query) {
        this.searchResults.innerHTML = '';
        return;
      }
      const matches = searchMatches(this.data, query);
      this.searchResults.innerHTML = matches
        .map((county) => `<button type="button" data-fips="${county.fips}" class="rounded px-2 py-1 text-left hover:bg-slate-200/70 dark:hover:bg-slate-800/70">${county.county}, ${county.state} <span class="font-mono text-[11px] text-slate-400">${county.fips}</span></button>`)
        .join('');
    });
    this.searchResults.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const button = target.closest('button[data-fips]') as HTMLButtonElement | null;
      if (!button) return;
      this.options.onSearch(button.dataset.fips ?? '');
      this.searchResults.innerHTML = '';
    });
    this.container.appendChild(searchGroup);

    this.outlierSection = document.createElement('div');
    this.outlierSection.className = 'flex flex-col gap-3';
    this.outlierSection.innerHTML = `
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold">High-burden outliers</h2>
        <button type="button" class="rounded bg-primary px-3 py-1 text-xs font-semibold text-white shadow hover:bg-blue-600">Export CSV</button>
      </div>
      <p class="text-xs text-slate-500 dark:text-slate-400">Counties whose observed burden exceeds the regression expectation given PM₂.₅.</p>
      <div class="flex max-h-64 flex-col gap-1 overflow-y-auto"></div>
    `;
    this.outlierButton = this.outlierSection.querySelector('button') as HTMLButtonElement;
    this.outlierList = this.outlierSection.querySelector('div.flex.max-h-64') as HTMLElement;
    this.outlierButton.addEventListener('click', () => this.exportOutliers());
    this.container.appendChild(this.outlierSection);
    this.toggleOutliers(false);

    const notes = document.createElement('div');
    notes.className = 'rounded-lg bg-slate-100/60 p-3 text-xs leading-relaxed text-slate-600 dark:bg-slate-800/60 dark:text-slate-300';
    notes.innerHTML = `
      <p class="font-semibold">Data notes</p>
      <ul class="mt-1 list-disc space-y-1 pl-4">
        <li>CDC PLACES 2024 release (crude prevalence) for chronic conditions.</li>
        <li>EPA Air Quality System PM₂.₅ monitor annual means averaged across available monitors.</li>
        <li>Residuals derive from an ordinary least squares fit of HBI on PM₂.₅ exposure.</li>
        <li>Methodology and limitations described in the README.</li>
      </ul>
    `;
    this.container.appendChild(notes);
    updateHash(this.weights, this.active);
  }

  private renderWeightPanel() {
    this.weightPanel.innerHTML = '';
    createWeightControls(this.weightPanel, { ...this.weights }, { ...this.active }, (weights, active) => {
      this.weights = weights;
      this.active = active;
      updateHash(this.weights, this.active);
      this.emitWeightChange();
      this.renderWeightPanel();
    });
  }

  private emitWeightChange() {
    this.options.onWeightsChange(this.weights, this.active);
  }

  updateData(data: CountyDatum[]) {
    this.data = data;
  }

  updateWeights(weights: WeightConfig, active: Record<PlaceKey, boolean>) {
    this.weights = weights;
    this.active = active;
    updateHash(this.weights, this.active);
    this.renderWeightPanel();
  }

  setMetric(metric: MetricKey) {
    this.metricSelect.value = metric;
    this.toggleOutliers(metric === 'residual');
  }

  setBreakMode(mode: BreakMode) {
    this.breakSelect.value = mode;
  }

  updateOutliers(outliers: Outlier[]) {
    this.currentOutliers = outliers;
    if (!outliers.length) {
      this.outlierList.innerHTML = '<p class="text-xs text-slate-500">No counties exceed the expected burden for the selected configuration.</p>';
      return;
    }
    this.outlierList.innerHTML = outliers
      .map(
        (item) => `
        <button type="button" data-fips="${item.fips}" class="flex flex-col gap-1 rounded border border-slate-200 px-3 py-2 text-left text-xs hover:border-primary hover:bg-slate-100/70 dark:border-slate-700 dark:hover:border-primary/70 dark:hover:bg-slate-800/70">
          <div class="flex items-center justify-between"><span class="font-semibold">${item.county}, ${item.state}</span><span class="font-mono text-[11px] text-slate-400">${item.fips}</span></div>
          <div class="flex flex-wrap gap-x-3">
            <span>Residual: <strong>${formatNumber(item.residual)}</strong></span>
            <span>Exposure: ${formatNumber(item.exposure)}</span>
            <span>HBI: ${formatNumber(item.hbi)}</span>
          </div>
        </button>
      `
      )
      .join('');
    this.outlierList.querySelectorAll('button[data-fips]').forEach((button) => {
      button.addEventListener('click', () => {
        this.options.onOutlierSelect(button.getAttribute('data-fips') ?? '');
      });
    });
  }

  private toggleOutliers(show: boolean) {
    this.outlierSection.style.display = show ? 'flex' : 'none';
  }

  private exportOutliers() {
    if (!this.currentOutliers.length) return;
    const header = ['fips', 'county', 'state', 'residual', 'exposure', 'hbi'];
    const formatCsv = (value: number | null | undefined) => {
      if (value == null || Number.isNaN(value)) return '';
      return value.toFixed(4);
    };
    const rows = this.currentOutliers.map((row) => [
      row.fips,
      row.county,
      row.state,
      formatCsv(row.residual),
      formatCsv(row.exposure ?? null),
      formatCsv(row.hbi ?? null)
    ]);
    const csv = [header.join(','), ...rows.map((row) => row.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'residual_outliers.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  static initialWeights(): { weights: WeightConfig; active: Record<PlaceKey, boolean> } {
    const base: WeightConfig = {
      asthma_pct: 1 / PLACE_KEYS.length,
      copd_pct: 1 / PLACE_KEYS.length,
      diabetes_pct: 1 / PLACE_KEYS.length,
      hypertension_pct: 1 / PLACE_KEYS.length,
      obesity_pct: 1 / PLACE_KEYS.length,
      smoking_pct: 1 / PLACE_KEYS.length
    };
    const active: Record<PlaceKey, boolean> = PLACE_KEYS.reduce(
      (acc, key) => ({
        ...acc,
        [key]: true
      }),
      {} as Record<PlaceKey, boolean>
    );
    const hashState = parseHash();
    PLACE_KEYS.forEach((key) => {
      if (hashState.weights[key] != null) {
        base[key] = Number(hashState.weights[key]);
      }
      if (hashState.active[key] != null) {
        active[key] = Boolean(hashState.active[key]);
      }
    });
    const normalized = normalizeWeights(base, active);
    return { weights: normalized, active };
  }
}

export { parseHash };

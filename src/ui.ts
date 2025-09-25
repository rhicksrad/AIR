import * as d3 from 'd3';
import type { BreakMode, CountyDatum, Outlier, PlaceKey, WeightConfig } from './types';
import { PLACE_KEYS } from './types';
import { formatNumber, normalizeWeights } from './stats';

interface UIOptions {
  onBreakModeChange: (mode: BreakMode) => void;
  onWeightsChange: (weights: WeightConfig, active: Record<PlaceKey, boolean>) => void;
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
  const wrapper = d3.select(container).append('div').attr('class', 'flex flex-col gap-4');
  PLACE_KEYS.forEach((key) => {
    const row = wrapper.append('div').attr('class', 'group panel-surface flex flex-col gap-3');
    const labelRow = row
      .append('label')
      .attr('class', 'flex items-center justify-between gap-3 text-sm font-semibold text-white/80');
    const label = key
      .replace('_pct', '')
      .replace('copd', 'COPD')
      .replace('hbi', 'HBI');
    labelRow
      .append('span')
      .attr('class', 'text-base font-semibold capitalize text-white')
      .text(label.replace(/_/g, ' '));
    const toggle = labelRow
      .append('input')
      .attr('type', 'checkbox')
      .attr('class', 'h-4 w-4 rounded border border-white/30 bg-black/40 text-primary shadow-sm transition focus-visible:ring-2 focus-visible:ring-primary/40')
      .property('checked', active[key])
      .on('change', (event) => {
        active[key] = (event.currentTarget as HTMLInputElement).checked;
        const normalized = normalizeWeights(weights, active);
        onChange(normalized, { ...active });
      });

    const controlRow = row.append('div').attr('class', 'flex items-center gap-4');
    const slider = controlRow
      .append('input')
      .attr('type', 'range')
      .attr('min', 0)
      .attr('max', 100)
      .attr('step', 1)
      .attr('class', 'w-full')
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
      .attr('class', 'weight-percent')
      .text(`${Math.round(weights[key] * 100)}%`);

    toggle.on('change.weight', () => {
      slider.property('disabled', !active[key]);
      slider.property('value', Math.round(weights[key] * 100));
      controlRow.select('span').text(`${Math.round(weights[key] * 100)}%`);
    });
  });
}

export class UIController {
  private container: HTMLElement;

  private options: UIOptions;

  private breakButtons = new Map<BreakMode, HTMLButtonElement>();

  private weightPanel: HTMLElement;

  private outlierList: HTMLElement;

  private outlierSection: HTMLElement;

  private outlierButton: HTMLButtonElement;

  private pmLabelInput: HTMLInputElement;

  private weights: WeightConfig;

  private active: Record<PlaceKey, boolean>;

  private data: CountyDatum[] = [];

  private currentOutliers: Outlier[] = [];

  private builderSection: HTMLElement;

  constructor(container: HTMLElement, weights: WeightConfig, active: Record<PlaceKey, boolean>, options: UIOptions) {
    this.container = container;
    this.weights = weights;
    this.active = active;
    this.options = options;
    this.container.classList.add('card', 'flex', 'w-full', 'flex-col', 'gap-8', 'text-white');
    this.container.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'flex flex-col gap-2';
    title.innerHTML = `
      <span class="section-heading">Environmental health explorer</span>
      <h1 class="text-3xl font-semibold leading-tight text-transparent bg-gradient-to-r from-white via-[#4c8f60] to-[#1b3925] bg-clip-text">County Health vs Air Quality</h1>
      <p class="input-description">Explore CDC PLACES chronic disease burdens alongside pollution to spot elevated health burdens across the United States.</p>
    `;
    this.container.appendChild(title);

    const contentGrid = document.createElement('div');
    contentGrid.className = 'grid gap-6 xl:grid-cols-12';
    this.container.appendChild(contentGrid);

    const breakGroup = document.createElement('div');
    breakGroup.className = 'panel-surface flex flex-col gap-3 xl:col-span-4';
    breakGroup.innerHTML = `
      <label class="control-label">Color steps</label>
      <div class="segmented" data-role="break-buttons"></div>
      <p class="input-description">Choose how the colors are grouped. Quantile splits counties into even-sized groups.</p>
    `;
    const breakButtonRow = breakGroup.querySelector('[data-role="break-buttons"]') as HTMLElement;
    const breakModes: { mode: BreakMode; label: string }[] = [
      { mode: 'quantile', label: 'Even groups' },
      { mode: 'equal', label: 'Equal ranges' },
      { mode: 'jenks', label: 'Natural breaks' }
    ];
    breakModes.forEach(({ mode, label }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'segmented-button';
      button.textContent = label;
      button.addEventListener('click', () => {
        this.setBreakMode(mode);
        this.options.onBreakModeChange(mode);
      });
      breakButtonRow.appendChild(button);
      this.breakButtons.set(mode, button);
    });
    this.setBreakMode('quantile');
    contentGrid.appendChild(breakGroup);

    const pmLabelGroup = document.createElement('div');
    pmLabelGroup.className = 'panel-surface flex flex-col gap-2 xl:col-span-4';
    pmLabelGroup.innerHTML = `
      <label class="control-label">PM₂.₅ averaging window</label>
      <input type="text" class="form-control" placeholder="2016–2024" value="2016–2024" />
    `;
    this.pmLabelInput = pmLabelGroup.querySelector('input') as HTMLInputElement;
    this.pmLabelInput.addEventListener('input', () => this.options.onPmLabelChange(this.pmLabelInput.value || '2016–2024'));
    contentGrid.appendChild(pmLabelGroup);

    this.builderSection = document.createElement('div');
    this.builderSection.className = 'flex flex-col gap-4 xl:col-span-8';
    this.builderSection.innerHTML = `
      <div class="flex items-start justify-between gap-3">
        <div class="flex flex-col gap-1">
          <span class="section-heading">Custom index</span>
          <h2 class="text-lg font-semibold text-white">Blend the health measures</h2>
        </div>
        <button type="button" class="btn-pill">Reset</button>
      </div>
      <p class="input-description">Turn measures on or off and adjust their weights. The sliders always add up to 100%.</p>
    `;
    const resetButton = this.builderSection.querySelector('button') as HTMLButtonElement;
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
    this.weightPanel = document.createElement('div');
    this.weightPanel.className = 'flex flex-col gap-4';
    this.builderSection.appendChild(this.weightPanel);
    contentGrid.appendChild(this.builderSection);
    this.renderWeightPanel();

    this.outlierSection = document.createElement('div');
    this.outlierSection.className = 'panel-surface flex flex-col gap-4 xl:col-span-4';
    this.outlierSection.innerHTML = `
      <div class="flex items-start justify-between gap-3">
        <div class="flex flex-col gap-1">
          <span class="section-heading">Signal counties</span>
          <h2 class="text-lg font-semibold text-white">High-burden outliers</h2>
        </div>
        <button type="button" class="btn-primary">Export CSV</button>
      </div>
      <p class="input-description">Counties whose observed burden exceeds the regression expectation given PM₂.₅.</p>
      <div class="flex max-h-64 flex-col gap-2 overflow-y-auto pr-1" data-role="outlier-list"></div>
    `;
    this.outlierButton = this.outlierSection.querySelector('button') as HTMLButtonElement;
    this.outlierList = this.outlierSection.querySelector('[data-role="outlier-list"]') as HTMLElement;
    this.outlierButton.addEventListener('click', () => this.exportOutliers());
    contentGrid.appendChild(this.outlierSection);
    this.setOutlierVisibility(false);

    const notes = document.createElement('div');
    notes.className =
      'rounded-2xl border border-white/10 bg-white/5 p-4 text-xs leading-relaxed text-white/80 shadow-inner backdrop-blur xl:col-span-4';
    notes.innerHTML = `
      <p class="text-sm font-semibold text-white">Data notes</p>
      <ul class="mt-2 list-disc space-y-1 pl-4">
        <li>CDC PLACES 2024 release (crude prevalence) for chronic conditions.</li>
        <li>EPA Air Quality System PM₂.₅ monitor annual means averaged across available monitors.</li>
        <li>Residuals derive from an ordinary least squares fit of HBI on pollution.</li>
        <li>Methodology and limitations described in the README.</li>
      </ul>
    `;
    contentGrid.appendChild(notes);
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

  setBreakMode(mode: BreakMode) {
    this.breakButtons.forEach((button, key) => {
      const isActive = key === mode;
      button.classList.toggle('segmented-button-active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  setBuilderVisibility(show: boolean) {
    this.builderSection.style.display = show ? 'flex' : 'none';
  }

  updateOutliers(outliers: Outlier[]) {
    this.currentOutliers = outliers;
    if (!outliers.length) {
      this.outlierList.innerHTML = '<p class="input-description">No counties exceed the expected burden for the selected configuration.</p>';
      return;
    }
    this.outlierList.innerHTML = outliers
      .map(
        (item) => `
        <button type="button" data-fips="${item.fips}" class="group flex flex-col gap-2 rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-left text-xs text-white/80 shadow-sm transition hover:border-primary/60 hover:bg-primary/20">
          <div class="flex items-center justify-between gap-2">
            <span class="text-sm font-semibold">${item.county}, ${item.state}</span>
            <span class="font-mono text-[11px] text-white/50">${item.fips}</span>
          </div>
          <div class="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/60 transition group-hover:text-white">
            <span>Residual: <strong class="text-white">${formatNumber(item.residual)}</strong></span>
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

  setOutlierVisibility(show: boolean) {
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

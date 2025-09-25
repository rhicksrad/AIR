import * as d3 from 'd3';
import { createChoropleth } from '../viz/choropleth';
import { createLegend } from '../viz/legend';
import { createScatter, computeScatterStats, ScatterPoint } from '../viz/scatter';
import type { DerivedData, CuisineMetrics, CancerMetrics, GeoFeatureCollection } from '../data/types';

interface ViewProps {
  container: HTMLElement;
  data: DerivedData;
  geo: GeoFeatureCollection;
}

const CUISINE_METRICS: { key: keyof CuisineMetrics; label: string; accessor: (row: CuisineMetrics) => number | null }[] = [
  { key: 'pct_veg', label: '% vegetarian dishes', accessor: row => row.pct_veg },
  { key: 'pct_lentil_like', label: '% lentil-forward', accessor: row => row.pct_lentil_like },
  { key: 'pct_red_meat_like', label: '% red meat mentions', accessor: row => row.pct_red_meat_like },
  { key: 'pct_poultry', label: '% poultry mentions', accessor: row => row.pct_poultry },
  { key: 'pct_fish', label: '% fish mentions', accessor: row => row.pct_fish },
  { key: 'pct_turmeric', label: '% turmeric mentions', accessor: row => row.pct_turmeric },
  { key: 'avg_prep_time', label: 'Avg prep time (min)', accessor: row => row.avg_prep_time },
  { key: 'avg_cook_time', label: 'Avg cook time (min)', accessor: row => row.avg_cook_time }
];

const CANCER_METRICS: { key: keyof CancerMetrics; label: string; accessor: (row: CancerMetrics) => number | null }[] = [
  { key: 'incidence_2019', label: 'Incidence 2019', accessor: row => row.incidence_2019 },
  { key: 'incidence_2020', label: 'Incidence 2020', accessor: row => row.incidence_2020 },
  { key: 'incidence_2021', label: 'Incidence 2021', accessor: row => row.incidence_2021 },
  { key: 'incidence_2022', label: 'Incidence 2022', accessor: row => row.incidence_2022 },
  { key: 'incidence_cagr_19_22', label: 'Incidence CAGR 2019-2022', accessor: row => row.incidence_cagr_19_22 }
];

export function renderCompareView({ container, data, geo }: ViewProps) {
  container.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'view-container';
  container.appendChild(wrapper);

  const mapWrapper = document.createElement('div');
  mapWrapper.className = 'map-wrapper';
  wrapper.appendChild(mapWrapper);

  const panel = document.createElement('div');
  panel.className = 'panel';
  wrapper.appendChild(panel);

  const heading = document.createElement('h2');
  heading.textContent = 'Cuisine × Cancer comparison';
  panel.appendChild(heading);

  const controls = document.createElement('div');
  controls.style.display = 'grid';
  controls.style.gap = '0.75rem';
  panel.appendChild(controls);

  const cuisineSelect = document.createElement('select');
  cuisineSelect.className = 'metric-dropdown';
  CUISINE_METRICS.forEach(metric => {
    const option = document.createElement('option');
    option.value = metric.key as string;
    option.textContent = metric.label;
    cuisineSelect.appendChild(option);
  });
  controls.appendChild(cuisineSelect);

  const cancerSelect = document.createElement('select');
  cancerSelect.className = 'metric-dropdown';
  CANCER_METRICS.forEach(metric => {
    const option = document.createElement('option');
    option.value = metric.key as string;
    option.textContent = metric.label;
    cancerSelect.appendChild(option);
  });
  controls.appendChild(cancerSelect);

  const statsBlock = document.createElement('div');
  statsBlock.className = 'metric-card';
  panel.appendChild(statsBlock);

  const legendContainer = document.createElement('div');
  panel.appendChild(legendContainer);

  const scatterContainer = document.createElement('div');
  scatterContainer.style.height = '320px';
  panel.appendChild(scatterContainer);

  const residualsContainer = document.createElement('div');
  residualsContainer.className = 'metric-card';
  panel.appendChild(residualsContainer);

  const tooltip = document.createElement('div');
  tooltip.className = 'tooltip';
  tooltip.style.display = 'none';
  document.body.appendChild(tooltip);

  const baseScale = d3.scaleSequential(d3.interpolateRdBu).domain([1, -1]) as unknown as d3.ScaleSequential<number, string>;

  const legend = createLegend({
    element: legendContainer,
    colorScale: baseScale,
    title: 'Residuals',
    format: d3.format('.2f')
  });

  const choropleth = createChoropleth({
    element: mapWrapper,
    features: geo,
    colorScale: baseScale.copy(),
    getValue: () => null,
    onHover: (state, event) => {
      if (!state) {
        tooltip.style.display = 'none';
        return;
      }
      const current = lastResiduals.get(state);
      if (!current) {
        tooltip.style.display = 'none';
        return;
      }
      tooltip.style.display = 'block';
      tooltip.textContent = `${state}: residual ${current.residual.toFixed(2)} (actual ${current.actual.toFixed(2)}, predicted ${current.predicted.toFixed(2)})`;
      tooltip.style.left = `${event.pageX + 12}px`;
      tooltip.style.top = `${event.pageY + 12}px`;
    }
  });

  const scatter = createScatter({
    element: scatterContainer,
    points: [],
    xLabel: CUISINE_METRICS[0].label,
    yLabel: CANCER_METRICS[0].label
  });

  const lastResiduals = new Map<string, { residual: number; actual: number; predicted: number }>();

  function update() {
    const cuisineMetric = CUISINE_METRICS.find(m => m.key === (cuisineSelect.value as keyof CuisineMetrics))!;
    const cancerMetric = CANCER_METRICS.find(m => m.key === (cancerSelect.value as keyof CancerMetrics))!;

    const points: ScatterPoint[] = data.joined
      .map(row => {
        const cuisine = row.cuisine ? cuisineMetric.accessor(row.cuisine) : null;
        const cancer = row.cancer ? cancerMetric.accessor(row.cancer) : null;
        if (cuisine == null || cancer == null) return null;
        return { state: row.state, x: cuisine, y: cancer };
      })
      .filter((d): d is ScatterPoint => d != null);

    scatter.update(points, cuisineMetric.label, cancerMetric.label);

    const stats = computeScatterStats(points);
    statsBlock.innerHTML = `<strong>Correlation summary</strong>
      <span>Pearson r: ${stats.r != null ? stats.r.toFixed(3) : 'N/A'}</span>
      <span>Linear fit: y = ${stats.slope != null ? stats.slope.toFixed(3) : 'N/A'} · x + ${stats.intercept != null ? stats.intercept.toFixed(3) : 'N/A'}</span>`;

    lastResiduals.clear();
    if (stats.slope != null && stats.intercept != null) {
      points.forEach(point => {
        const predicted = stats.slope! * point.x + stats.intercept!;
        const residual = point.y - predicted;
        lastResiduals.set(point.state, { residual, actual: point.y, predicted });
      });
    }

    const residualValues = [...lastResiduals.values()].map(d => d.residual);
    const maxAbs = residualValues.length ? d3.max(residualValues, d => Math.abs(d)) ?? 1 : 1;
    const colorScale = d3.scaleSequential(d3.interpolateRdBu).domain([maxAbs, -maxAbs]) as unknown as d3.ScaleSequential<number, string>;
    choropleth.updateColorScale(colorScale);
    choropleth.updateGetValue(state => lastResiduals.get(state)?.residual ?? null);
    legend.update(colorScale, 'Residuals');

    const sortedResiduals = [...lastResiduals.entries()].sort((a, b) => b[1].residual - a[1].residual);
    const positive = sortedResiduals.slice(0, 5);
    const negative = sortedResiduals.slice(-5).reverse();
    residualsContainer.innerHTML = `<strong>Residuals</strong>
      <span>Top positive:</span>
      ${positive
        .map(([state, info]) => `<span>${state}: ${info.residual.toFixed(2)}</span>`)
        .join('')}
      <span>Top negative:</span>
      ${negative
        .map(([state, info]) => `<span>${state}: ${info.residual.toFixed(2)}</span>`)
        .join('')}`;
  }

  update();

  cuisineSelect.addEventListener('change', update);
  cancerSelect.addEventListener('change', update);

  return () => {
    choropleth.destroy();
    legendContainer.innerHTML = '';
    tooltip.remove();
  };
}

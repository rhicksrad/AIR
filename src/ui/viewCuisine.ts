import * as d3 from 'd3';
import { createChoropleth } from '../viz/choropleth';
import { createLegend } from '../viz/legend';
import type { DerivedData, CuisineMetrics, GeoFeatureCollection } from '../data/types';

interface ViewProps {
  container: HTMLElement;
  data: DerivedData;
  geo: GeoFeatureCollection;
}

const METRICS: { key: keyof CuisineMetrics; label: string; format: (value: number) => string; domain: [number, number] | null }[] = [
  { key: 'pct_veg', label: '% vegetarian dishes', format: v => `${(v * 100).toFixed(0)}%`, domain: [0, 1] },
  { key: 'pct_sweet', label: '% sweet dishes', format: v => `${(v * 100).toFixed(0)}%`, domain: [0, 1] },
  { key: 'pct_lentil_like', label: '% lentil-forward', format: v => `${(v * 100).toFixed(0)}%`, domain: [0, 1] },
  { key: 'pct_red_meat_like', label: '% red meat mentions', format: v => `${(v * 100).toFixed(0)}%`, domain: [0, 1] },
  { key: 'pct_poultry', label: '% poultry mentions', format: v => `${(v * 100).toFixed(0)}%`, domain: [0, 1] },
  { key: 'pct_fish', label: '% fish mentions', format: v => `${(v * 100).toFixed(0)}%`, domain: [0, 1] },
  { key: 'pct_turmeric', label: '% turmeric mentions', format: v => `${(v * 100).toFixed(0)}%`, domain: [0, 1] },
  { key: 'avg_prep_time', label: 'Avg prep time (min)', format: v => `${v.toFixed(0)} min`, domain: null },
  { key: 'avg_cook_time', label: 'Avg cook time (min)', format: v => `${v.toFixed(0)} min`, domain: null },
  { key: 'dish_count', label: 'Number of dishes', format: v => `${v.toFixed(0)}`, domain: null }
];

export function renderCuisineView({ container, data, geo }: ViewProps) {
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
  heading.textContent = 'Cuisine fingerprints';
  panel.appendChild(heading);

  const select = document.createElement('select');
  select.className = 'metric-dropdown';
  METRICS.forEach(metric => {
    const option = document.createElement('option');
    option.value = metric.key as string;
    option.textContent = metric.label;
    select.appendChild(option);
  });
  panel.appendChild(select);

  const legendContainer = document.createElement('div');
  panel.appendChild(legendContainer);

  const listContainer = document.createElement('div');
  listContainer.className = 'metric-list';
  panel.appendChild(listContainer);

  const tooltip = document.createElement('div');
  tooltip.className = 'tooltip';
  tooltip.style.display = 'none';
  document.body.appendChild(tooltip);

  const cuisineByState = new Map<string, CuisineMetrics>(data.cuisine.map(row => [row.state, row]));

  const baseScale = d3.scaleSequential(d3.interpolateGnBu).domain([0, 1]) as unknown as d3.ScaleSequential<number, string>;

  const legend = createLegend({
    element: legendContainer,
    colorScale: baseScale,
    title: METRICS[0].label,
    format: value => `${(value * 100).toFixed(0)}%`
  });

  const choropleth = createChoropleth({
    element: mapWrapper,
    features: geo,
    colorScale: baseScale.copy(),
    getValue: state => {
      const metric = METRICS.find(m => m.key === (select.value as keyof CuisineMetrics))!;
      const entry = cuisineByState.get(state);
      const value = entry ? (entry[metric.key] as number | null) : null;
      return value ?? null;
    },
    onHover: (state, event) => {
      if (!state) {
        tooltip.style.display = 'none';
        return;
      }
      const entry = cuisineByState.get(state);
      if (!entry) {
        tooltip.style.display = 'none';
        return;
      }
      const metric = METRICS.find(m => m.key === (select.value as keyof CuisineMetrics))!;
      const raw = entry[metric.key];
      tooltip.style.display = 'block';
      tooltip.textContent = `${state}: ${raw != null ? metric.format(Number(raw)) : 'N/A'}`;
      tooltip.style.left = `${event.pageX + 12}px`;
      tooltip.style.top = `${event.pageY + 12}px`;
    }
  });

  function updateMetric() {
    const metric = METRICS.find(m => m.key === (select.value as keyof CuisineMetrics))!;
    const values = data.cuisine
      .map(row => ({ state: row.state, value: row[metric.key] as number | null }))
      .filter((d): d is { state: string; value: number } => d.value != null);

    let scale: d3.ScaleSequential<number, string>;
    if (metric.domain) {
      scale = d3.scaleSequential(d3.interpolateGnBu).domain(metric.domain) as unknown as d3.ScaleSequential<number, string>;
    } else {
      const extent = d3.extent(values, d => d.value);
      const min = extent[0] ?? 0;
      const maxRaw = extent[1] ?? min + 1;
      const max = maxRaw === min ? min + 1 : maxRaw;
      scale = d3.scaleSequential(d3.interpolateGnBu).domain([min, max]) as unknown as d3.ScaleSequential<number, string>;
    }

    choropleth.updateColorScale(scale);
    choropleth.updateGetValue(state => {
      const entry = cuisineByState.get(state);
      return entry ? ((entry[metric.key] as number | null) ?? null) : null;
    });
    legend.update(scale, metric.label);

    listContainer.innerHTML = '';
    const sorted = [...values].sort((a, b) => b.value - a.value);
    const top5 = sorted.slice(0, 5);
    const bottom5 = sorted.slice(-5).reverse();

    const topCard = document.createElement('div');
    topCard.className = 'metric-card';
    topCard.innerHTML = `<strong>Highest</strong>${top5
      .map(item => `<span>${item.state}: ${metric.format(item.value)}</span>`)
      .join('')}`;
    listContainer.appendChild(topCard);

    const bottomCard = document.createElement('div');
    bottomCard.className = 'metric-card';
    bottomCard.innerHTML = `<strong>Lowest</strong>${bottom5
      .map(item => `<span>${item.state}: ${metric.format(item.value)}</span>`)
      .join('')}`;
    listContainer.appendChild(bottomCard);
  }

  updateMetric();

  select.addEventListener('change', () => {
    updateMetric();
  });

  return () => {
    choropleth.destroy();
    legendContainer.innerHTML = '';
    tooltip.remove();
  };
}

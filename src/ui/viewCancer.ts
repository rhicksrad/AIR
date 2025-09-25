import * as d3 from 'd3';
import { createChoropleth } from '../viz/choropleth';
import { createLegend } from '../viz/legend';
import type { DerivedData, GeoFeatureCollection, CancerMetrics } from '../data/types';

interface ViewProps {
  container: HTMLElement;
  data: DerivedData;
  geo: GeoFeatureCollection;
}

type CancerYearKey = 'incidence_2019' | 'incidence_2020' | 'incidence_2021' | 'incidence_2022';

const YEAR_KEY: Record<number, CancerYearKey> = {
  2019: 'incidence_2019',
  2020: 'incidence_2020',
  2021: 'incidence_2021',
  2022: 'incidence_2022'
};

export function renderCancerView({ container, data, geo }: ViewProps) {
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
  heading.textContent = 'Cancer incidence';
  panel.appendChild(heading);

  const select = document.createElement('select');
  select.className = 'year-select';
  [2019, 2020, 2021, 2022].forEach(year => {
    const option = document.createElement('option');
    option.value = String(year);
    option.textContent = String(year);
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

  const cancerByState = new Map<string, CancerMetrics>(data.cancer.map(row => [row.state, row]));

  const getYearValue = (state: string, year: number) => {
    const entry = cancerByState.get(state);
    if (!entry) return null;
    const key = YEAR_KEY[year];
    return key ? entry[key] ?? null : null;
  };

  const baseScale = d3.scaleSequential(d3.interpolateOrRd).domain([0, 1]) as unknown as d3.ScaleSequential<number, string>;

  const legend = createLegend({
    element: legendContainer,
    colorScale: baseScale,
    title: 'Incidence'
  });

  const choropleth = createChoropleth({
    element: mapWrapper,
    features: geo,
    colorScale: baseScale.copy(),
    getValue: state => getYearValue(state, Number(select.value)),
    onHover: (state, event) => {
      if (!state) {
        tooltip.style.display = 'none';
        return;
      }
      const value = getYearValue(state, Number(select.value));
      tooltip.style.display = 'block';
      tooltip.textContent = `${state}: ${value != null ? value.toLocaleString() : 'N/A'}`;
      tooltip.style.left = `${event.pageX + 12}px`;
      tooltip.style.top = `${event.pageY + 12}px`;
    }
  });

  function updatePanel(year: number) {
    const values = data.cancer
      .map(row => ({ state: row.state, value: getYearValue(row.state, year) }))
      .filter((d): d is { state: string; value: number } => d.value != null);

    const extent = d3.extent(values, d => d.value);
    const min = extent[0] ?? 0;
    const maxRaw = extent[1] ?? 1;
    const max = maxRaw === min ? min + 1 : maxRaw;
    const scale = d3.scaleSequential(d3.interpolateOrRd).domain([min, max]) as unknown as d3.ScaleSequential<number, string>;

    choropleth.updateColorScale(scale);
    choropleth.updateGetValue(state => getYearValue(state, year));
    legend.update(scale, `Incidence ${year}`);

    const sorted = [...values].sort((a, b) => b.value - a.value);
    const top5 = sorted.slice(0, 5);
    const bottom5 = sorted.slice(-5).reverse();

    listContainer.innerHTML = '';

    const topCard = document.createElement('div');
    topCard.className = 'metric-card';
    topCard.innerHTML = `<strong>Highest incidence</strong>${top5
      .map(item => `<span>${item.state}: ${item.value.toLocaleString()}</span>`)
      .join('')}`;
    listContainer.appendChild(topCard);

    const bottomCard = document.createElement('div');
    bottomCard.className = 'metric-card';
    bottomCard.innerHTML = `<strong>Lowest incidence</strong>${bottom5
      .map(item => `<span>${item.state}: ${item.value.toLocaleString()}</span>`)
      .join('')}`;
    listContainer.appendChild(bottomCard);
  }

  updatePanel(Number(select.value));

  select.addEventListener('change', () => {
    updatePanel(Number(select.value));
  });

  return () => {
    choropleth.destroy();
    legendContainer.innerHTML = '';
    tooltip.remove();
  };
}

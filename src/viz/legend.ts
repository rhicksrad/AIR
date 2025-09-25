import * as d3 from 'd3';

export interface LegendParams {
  element: HTMLElement;
  colorScale: d3.ScaleSequential<number, string>;
  title: string;
  format?: (value: number) => string;
}

export interface LegendHandle {
  update: (colorScale: d3.ScaleSequential<number, string>, title: string) => void;
}

export function createLegend(params: LegendParams): LegendHandle {
  const { element } = params;
  const width = element.clientWidth || 280;
  const height = 60;

  const svg = d3
    .select(element)
    .append('svg')
    .attr('class', 'legend')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  const titleEl = svg.append('text').attr('class', 'legend-title').attr('x', 0).attr('y', 12);
  const gradientId = `legend-gradient-${Math.random().toString(36).slice(2)}`;
  const defs = svg.append('defs');
  const gradient = defs.append('linearGradient').attr('id', gradientId);
  gradient.attr('x1', '0%').attr('x2', '100%').attr('y1', '0%').attr('y2', '0%');

  const rect = svg.append('rect').attr('class', 'legend-bar').attr('x', 0).attr('y', 20).attr('height', 12).attr('width', width - 20).attr('fill', `url(#${gradientId})`);

  const axisGroup = svg.append('g').attr('class', 'legend-axis').attr('transform', `translate(0, 40)`);

  function apply(colorScale: d3.ScaleSequential<number, string>, title: string) {
    const domain = colorScale.domain();
    const [min, max] = domain.length === 2 ? domain : [domain[0], domain[domain.length - 1]];

    titleEl.text(title);

    const stops = d3.range(0, 1.0001, 0.2).map(t => ({ offset: t, color: colorScale(min + (max - min) * t) }));
    gradient.selectAll('stop').remove();
    gradient
      .selectAll('stop')
      .data(stops)
      .enter()
      .append('stop')
      .attr('offset', d => `${d.offset * 100}%`)
      .attr('stop-color', d => d.color);

    const axisScale = d3.scaleLinear().domain([min, max]).range([0, width - 20]);
    const formatter = params.format ?? d3.format('.2~s');
    const axis = d3.axisBottom(axisScale).ticks(4).tickFormat(value => formatter(Number(value)));
    axisGroup.call(axis as any);
  }

  apply(params.colorScale, params.title);

  return {
    update(colorScale, title) {
      apply(colorScale, title);
    }
  };
}

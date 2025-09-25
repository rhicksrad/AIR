import * as d3 from 'd3';

export interface ScatterPoint {
  state: string;
  x: number;
  y: number;
}

export interface ScatterParams {
  element: HTMLElement;
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
}

export interface ScatterHandle {
  update: (points: ScatterPoint[], xLabel: string, yLabel: string) => void;
}

export interface ScatterStats {
  r: number | null;
  slope: number | null;
  intercept: number | null;
}

export function computeScatterStats(points: ScatterPoint[]): ScatterStats {
  const finite = points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  const n = finite.length;
  if (n === 0) return { r: null, slope: null, intercept: null };
  const meanX = d3.mean(finite, p => p.x)!;
  const meanY = d3.mean(finite, p => p.y)!;
  const cov = d3.sum(finite, p => (p.x - meanX) * (p.y - meanY))!;
  const varX = d3.sum(finite, p => (p.x - meanX) ** 2)!;
  const varY = d3.sum(finite, p => (p.y - meanY) ** 2)!;
  const slope = varX === 0 ? null : cov / varX;
  const intercept = slope == null ? null : meanY - slope * meanX;
  const r = varX === 0 || varY === 0 ? null : cov / Math.sqrt(varX * varY);
  return { r, slope, intercept };
}

export function createScatter(params: ScatterParams): ScatterHandle {
  const { element } = params;
  const width = element.clientWidth || 480;
  const height = element.clientHeight || 360;
  const margin = { top: 20, right: 20, bottom: 50, left: 60 };

  const svg = d3
    .select(element)
    .append('svg')
    .attr('class', 'scatter')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const plot = svg
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  const xAxisGroup = plot.append('g').attr('transform', `translate(0,${plotHeight})`);
  const yAxisGroup = plot.append('g');
  const pointsGroup = plot.append('g').attr('class', 'points');
  const lineGroup = plot.append('g').attr('class', 'regression');

  const xLabelEl = svg
    .append('text')
    .attr('class', 'axis-label')
    .attr('text-anchor', 'middle')
    .attr('x', margin.left + plotWidth / 2)
    .attr('y', height - 5);

  const yLabelEl = svg
    .append('text')
    .attr('class', 'axis-label')
    .attr('text-anchor', 'middle')
    .attr('transform', `translate(15, ${margin.top + plotHeight / 2}) rotate(-90)`);

  function draw(points: ScatterPoint[], xLabel: string, yLabel: string) {
    const finite = points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
    const xExtent = d3.extent(finite, p => p.x) as [number, number] | [undefined, undefined];
    const yExtent = d3.extent(finite, p => p.y) as [number, number] | [undefined, undefined];
    if (!xExtent[0] || !xExtent[1] || !yExtent[0] || !yExtent[1]) {
      xAxisGroup.selectAll('*').remove();
      yAxisGroup.selectAll('*').remove();
      pointsGroup.selectAll('*').remove();
      lineGroup.selectAll('*').remove();
      return;
    }

    const xScale = d3.scaleLinear().domain([xExtent[0], xExtent[1]]).nice().range([0, plotWidth]);
    const yScale = d3.scaleLinear().domain([yExtent[0], yExtent[1]]).nice().range([plotHeight, 0]);

    xAxisGroup.call(d3.axisBottom(xScale).ticks(5));
    yAxisGroup.call(d3.axisLeft(yScale).ticks(5));

    const stats = computeScatterStats(finite);
    pointsGroup
      .selectAll<SVGCircleElement, ScatterPoint>('circle')
      .data(finite, d => d.state)
      .join('circle')
      .attr('cx', d => xScale(d.x))
      .attr('cy', d => yScale(d.y))
      .attr('r', 4)
      .attr('class', 'scatter-point')
      .append('title')
      .text(d => `${d.state}\n${xLabel}: ${d.x.toFixed(2)}\n${yLabel}: ${d.y.toFixed(2)}`);

    lineGroup.selectAll('*').remove();
    if (stats.slope != null && stats.intercept != null) {
      const line = d3
        .line<number>()
        .x(d => xScale(d))
        .y(d => yScale(stats.slope! * d + stats.intercept!));
      lineGroup
        .append('path')
        .datum([xScale.domain()[0], xScale.domain()[1]])
        .attr('d', line as any)
        .attr('class', 'regression-line');
    }

    xLabelEl.text(xLabel);
    yLabelEl.text(yLabel);
  }

  draw(params.points, params.xLabel, params.yLabel);

  return {
    update(points, xLabel, yLabel) {
      draw(points, xLabel, yLabel);
    }
  };
}

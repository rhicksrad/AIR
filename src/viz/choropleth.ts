import * as d3 from 'd3';
import type { GeoFeatureCollection } from '../data/types';

export interface ChoroplethParams {
  element: HTMLElement;
  features: GeoFeatureCollection;
  colorScale: d3.ScaleSequential<number, string>;
  getValue: (state: string) => number | null | undefined;
  onHover?: (state: string | null, event: MouseEvent) => void;
}

export interface ChoroplethHandle {
  updateColorScale: (colorScale: d3.ScaleSequential<number, string>) => void;
  updateGetValue: (getValue: (state: string) => number | null | undefined) => void;
  destroy: () => void;
}

export function createChoropleth(params: ChoroplethParams): ChoroplethHandle {
  const { element, features } = params;
  const width = element.clientWidth || 480;
  const height = element.clientHeight || 520;

  const svg = d3
    .select(element)
    .append('svg')
    .attr('class', 'choropleth')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  const projection = d3.geoMercator().fitSize([width, height], features);
  const path = d3.geoPath(projection);

  const g = svg.append('g');

  let currentColorScale = params.colorScale;
  let currentGetValue = params.getValue;

  const fillFor = (state: string) => {
    const value = currentGetValue(state);
    return value == null ? '#ddd' : currentColorScale(value);
  };

  const draw = () => {
    const paths = g.selectAll('path').data(features.features, d => (d as any).properties.name);

    paths
      .enter()
      .append('path')
      .attr('d', path as any)
      .attr('data-state', d => (d as any).properties.name)
      .attr('class', 'state')
      .attr('fill', d => fillFor((d as any).properties.name))
      .on('mouseenter', (event, d: any) => {
        params.onHover?.(d.properties.name, event);
      })
      .on('mousemove', (event, d: any) => {
        params.onHover?.(d.properties.name, event);
      })
      .on('mouseleave', event => {
        params.onHover?.(null, event as MouseEvent);
      });

    paths
      .attr('d', path as any)
      .attr('fill', d => fillFor((d as any).properties.name));

    paths.exit().remove();
  };

  draw();

  return {
    updateColorScale(colorScale) {
      currentColorScale = colorScale;
      g.selectAll('path').attr('fill', d => fillFor((d as any).properties.name));
    },
    updateGetValue(getValue) {
      currentGetValue = getValue;
      g.selectAll('path').attr('fill', d => fillFor((d as any).properties.name));
    },
    destroy() {
      svg.remove();
    }
  };
}

import * as d3 from 'd3';
import type { GeoPermissibleObjects } from 'd3';
import type { GeographyData } from './data';
import type { CountyDatum, LegendBreaks, MetricKey } from './types';
import { metricLabel } from './stats';

interface TooltipFormatter {
  (datum: CountyDatum, metric: MetricKey): string;
}

interface MapCallbacks {
  onHover?: (datum: CountyDatum | null) => void;
  onSelect?: (datum: CountyDatum) => void;
}

interface InsetDefinition {
  code: string;
  label: string;
}

const INSETS: InsetDefinition[] = [
  { code: '02', label: 'Alaska' },
  { code: '15', label: 'Hawaii' },
  { code: '72', label: 'Puerto Rico' }
];

const DEFAULT_COLORS = {
  background: '#f1f5f9',
  border: '#0f172a',
  noData: '#94a3b8'
};

function featureCollection(features: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features };
}

function getStateCode(fips: string | number | undefined): string {
  if (typeof fips === 'number') {
    return fips.toString().padStart(5, '0').slice(0, 2);
  }
  return (fips ?? '').toString().padStart(5, '0').slice(0, 2);
}

export class CountyMap {
  private container: HTMLElement;

  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;

  private mainLayer: d3.Selection<SVGGElement, unknown, null, undefined>;

  private statesLayer: d3.Selection<SVGGElement, unknown, null, undefined>;

  private insetLayers: Map<string, d3.Selection<SVGGElement, unknown, null, undefined>> = new Map();

  private tooltip: d3.Selection<HTMLDivElement, unknown, null, undefined> | null = null;

  private legend: d3.Selection<HTMLDivElement, unknown, null, undefined>;

  private projection = d3.geoAlbersUsa();

  private path = d3.geoPath(this.projection);

  private zoomBehavior = d3.zoom<SVGSVGElement, unknown>().scaleExtent([1, 12]);

  private data = new Map<string, CountyDatum>();

  private tooltipFormatter: TooltipFormatter | null;

  private callbacks: MapCallbacks;

  private countyPaths: d3.Selection<SVGPathElement, GeoJSON.Feature, SVGGElement, unknown> | null = null;

  private hatchId = `hatch-${Math.random().toString(36).slice(2)}`;

  private currentMetric: MetricKey = 'hbi';

  private currentLegend: LegendBreaks = { bins: [], labels: [] };

  private width = 960;

  private height = 640;

  private selectedFips: string | null = null;

  constructor(
    container: HTMLElement,
    geography: GeographyData,
    tooltipFormatter?: TooltipFormatter,
    callbacks: MapCallbacks = {}
  ) {
    this.container = container;
    this.tooltipFormatter = tooltipFormatter ?? null;
    this.callbacks = callbacks;
    this.svg = d3
      .select(container)
      .append('svg')
      .attr('role', 'img')
      .attr('aria-label', 'Map of U.S. counties')
      .attr('class', 'h-full w-full');

    const defs = this.svg.append('defs');
    const pattern = defs
      .append('pattern')
      .attr('id', this.hatchId)
      .attr('patternUnits', 'userSpaceOnUse')
      .attr('width', 6)
      .attr('height', 6)
      .attr('patternTransform', 'rotate(45)');
    pattern.append('rect').attr('width', 6).attr('height', 6).attr('fill', 'rgba(148, 163, 184, 0.4)');
    pattern
      .append('line')
      .attr('x1', 0)
      .attr('y1', 0)
      .attr('x2', 0)
      .attr('y2', 6)
      .attr('stroke', 'rgba(15, 23, 42, 0.4)')
      .attr('stroke-width', 1);

    this.mainLayer = this.svg.append('g').attr('class', 'counties');
    this.statesLayer = this.svg.append('g').attr('class', 'states');

    if (this.tooltipFormatter) {
      this.tooltip = d3
        .select(container)
        .append('div')
        .attr('class', 'map-tooltip');
    }

    this.legend = d3
      .select(container)
      .append('div')
      .attr('class', 'map-legend');

    this.setupZoom();
    this.prepareLayers(geography);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private setupZoom() {
    this.zoomBehavior.on('zoom', (event) => {
      this.mainLayer.attr('transform', event.transform.toString());
      this.statesLayer.attr('transform', event.transform.toString());
    });
    this.svg.call(this.zoomBehavior as any);
  }

  private prepareLayers(geography: GeographyData) {
    const contiguous = geography.counties.features.filter((feature) => !INSETS.some((inset) => getStateCode(feature.id as string) === inset.code));
    this.countyPaths = this.mainLayer
      .selectAll('path')
      .data(contiguous as GeoJSON.Feature[])
      .join('path')
      .attr('class', 'stroke-slate-900/40 dark:stroke-slate-100/30')
      .attr('stroke-width', 0.35)
      .attr('fill', DEFAULT_COLORS.noData)
      .on('mousemove', (event, datum) => this.handleHover(event, datum))
      .on('mouseleave', () => this.hideTooltip())
      .on('click', (_event, datum) => {
        const data = this.data.get((datum.id as string) ?? '');
        if (data && this.callbacks.onSelect) {
          this.callbacks.onSelect(data);
        }
      });

    this.statesLayer
      .append('path')
      .datum(geography.statesMesh as GeoPermissibleObjects)
      .attr('class', 'fill-none stroke-slate-900/50 dark:stroke-slate-100/50 pointer-events-none')
      .attr('stroke-width', 0.7)
      .attr('d', this.path);

    for (const inset of INSETS) {
      const group = this.svg.append('g').attr('class', `inset inset-${inset.code}`);
      this.insetLayers.set(inset.code, group);
      const label = group
        .append('text')
        .attr('class', 'fill-slate-700 text-[10px] dark:fill-slate-200')
        .attr('text-anchor', 'end')
        .text(inset.label);
      label.attr('dy', '-0.3em');

      const insetCounties = geography.counties.features.filter((feature) => getStateCode(feature.id as string) === inset.code);
      const insetPaths = group
        .selectAll('path')
        .data(insetCounties as GeoJSON.Feature[])
        .join('path')
        .attr('class', 'stroke-slate-900/40 dark:stroke-slate-100/30')
        .attr('stroke-width', 0.35)
        .attr('fill', DEFAULT_COLORS.noData)
        .on('mousemove', (event, datum) => this.handleHover(event, datum))
        .on('mouseleave', () => this.hideTooltip())
        .on('click', (_event, datum) => {
          const data = this.data.get((datum.id as string) ?? '');
          if (data && this.callbacks.onSelect) {
            this.callbacks.onSelect(data);
          }
        });

      group.append('rect').attr('class', 'inset-border fill-none stroke-slate-900/20 dark:stroke-slate-100/20');
      group.append('g').attr('class', 'inset-label');
      this.insetLayers.set(inset.code, group);
      insetPaths.append('title').text(`${inset.label}`);
    }
  }

  private resize() {
    const bounds = this.container.getBoundingClientRect();
    this.width = bounds.width || 960;
    this.height = bounds.height || 640;
    this.svg.attr('viewBox', `0 0 ${this.width} ${this.height}`);
    const mainFeatures = this.countyPaths?.data();
    if (mainFeatures && mainFeatures.length > 0) {
      this.projection.fitExtent(
        [
          [16, 16],
          [this.width - 220, this.height - 16]
        ],
        featureCollection(mainFeatures as GeoJSON.Feature[])
      );
      this.path = d3.geoPath(this.projection);
      this.countyPaths?.attr('d', this.path);
      this.statesLayer.selectAll('path').attr('d', this.path);
    }
    this.updateInsets();
  }

  private updateInsets() {
    const insetWidth = 180;
    const insetHeight = 120;
    const padding = 16;
    let offsetY = this.height - padding - insetHeight;
    const offsetX = this.width - padding - insetWidth;
    for (const inset of INSETS) {
      const group = this.insetLayers.get(inset.code);
      if (!group) continue;
      group.attr('transform', `translate(${offsetX},${offsetY})`);
      const counties = group.selectAll<SVGPathElement, GeoJSON.Feature>('path');
      const features = counties.data();
      if (features.length === 0) continue;
      const projection = d3.geoMercator().fitExtent(
        [
          [8, 12],
          [insetWidth - 8, insetHeight - 12]
        ],
        featureCollection(features as GeoJSON.Feature[])
      );
      const path = d3.geoPath(projection as any);
      counties.attr('d', path as any);
      group
        .selectAll<SVGRectElement, unknown>('rect.inset-border')
        .attr('width', insetWidth)
        .attr('height', insetHeight)
        .attr('rx', 8)
        .attr('ry', 8);
      group
        .selectAll<SVGTextElement, unknown>('text')
        .attr('x', insetWidth)
        .attr('y', 12);
      offsetY -= insetHeight + 12;
    }
  }

  private handleHover(event: MouseEvent, feature: GeoJSON.Feature) {
    const fips = (feature.id as string) ?? '';
    const datum = this.data.get(fips);
    if (!datum) {
      this.hideTooltip();
      return;
    }
    if (this.callbacks.onHover) {
      this.callbacks.onHover(datum);
    }
    if (this.tooltip && this.tooltipFormatter) {
      this.tooltip
        .classed('hidden', false)
        .html(this.tooltipFormatter(datum, this.currentMetric));
      const [x, y] = d3.pointer(event, this.container);
      this.tooltip.style('transform', `translate(${x + 16}px, ${y + 16}px)`);
    }
  }

  private hideTooltip() {
    if (this.tooltip) {
      this.tooltip.classed('hidden', true);
    }
    if (this.callbacks.onHover) {
      this.callbacks.onHover(null);
    }
  }

  private colorScale(): d3.ScaleThreshold<number, string> {
    const bins = this.currentLegend.bins;
    if (bins.length === 0) {
      return d3.scaleThreshold().domain([0]).range([DEFAULT_COLORS.noData]);
    }
    const classes = Math.max(1, bins.length - 1);
    const usesDiverging = this.currentMetric === 'residual' || this.currentMetric === 'pollutionMinusHealth';
    const colors = usesDiverging
      ? d3.quantize(
          (t) => d3.interpolateRdBu(this.currentMetric === 'residual' ? 1 - t : t),
          classes
        )
      : d3.quantize((t) => d3.interpolateYlOrRd(t * 0.85 + 0.15), classes);
    return d3.scaleThreshold<number, string>().domain(bins.slice(1, -1)).range(colors);
  }

  update(data: CountyDatum[], metric: MetricKey, legend: LegendBreaks) {
    this.data = new Map(data.map((d) => [d.fips, d]));
    this.currentMetric = metric;
    this.currentLegend = legend;
    const bins = legend.bins;
    const scale = this.colorScale();

    const updateFill = (selection: d3.Selection<SVGPathElement, GeoJSON.Feature, SVGGElement, unknown>) => {
      selection.attr('fill', (feature) => {
        const datum = this.data.get((feature.id as string) ?? '');
        const value = datum ? this.getMetricValue(datum) : null;
        if (value == null) {
          return `url(#${this.hatchId})`;
        }
        return scale(value);
      });
      selection.attr('data-hatched', (feature) => {
        const datum = this.data.get((feature.id as string) ?? '');
        const value = datum ? this.getMetricValue(datum) : null;
        return value == null ? 'true' : null;
      });
    };

    if (this.countyPaths) {
      updateFill(this.countyPaths);
    }
    for (const inset of INSETS) {
      const group = this.insetLayers.get(inset.code);
      if (!group) continue;
      updateFill(group.selectAll<SVGPathElement, GeoJSON.Feature>('path'));
    }

    this.applySelection();
    this.renderLegend(scale);
  }

  private renderLegend(scale: d3.ScaleThreshold<number, string>) {
    this.legend.selectAll('*').remove();
    const header = this.legend.append('div').attr('class', 'flex items-center justify-between');
    header.append('span').attr('class', 'font-semibold').text(metricLabel(this.currentMetric));
    const resetButton = header
      .append('button')
      .attr('type', 'button')
      .attr('class', 'rounded bg-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 transition hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700')
      .text('Reset');
    resetButton.on('click', () => this.zoomReset());

    if (this.currentLegend.labels.length === 0) {
      this.legend.append('p').attr('class', 'text-xs text-slate-500').text('No data available');
      return;
    }

    const bins = this.currentLegend.bins;
    const labels = this.currentLegend.labels;

    const list = this.legend.append('div').attr('class', 'flex flex-col gap-1');
    labels.forEach((label, idx) => {
      const binStart = bins[idx];
      const binEnd = bins[idx + 1];
      const item = list
        .append('button')
        .attr('type', 'button')
        .attr('class', 'flex items-center gap-2 rounded px-2 py-1 text-left transition hover:bg-slate-200/70 dark:hover:bg-slate-800/70');
      const swatch = item
        .append('span')
        .attr('class', 'h-4 w-4 rounded-sm border border-slate-900/20 dark:border-slate-100/20')
        .style('background', scale((binStart + binEnd) / 2));
      item.append('span').text(label);

      item.on('mouseenter', () => this.highlightBin(idx));
      item.on('mouseleave', () => this.clearHighlight());
    });
  }

  private highlightBin(index: number) {
    const bins = this.currentLegend.bins;
    const [start, end] = [bins[index], bins[index + 1]];
    const highlight = (selection: d3.Selection<SVGPathElement, GeoJSON.Feature, SVGGElement, unknown>) => {
      selection.classed('opacity-30', (feature) => {
        const datum = this.data.get((feature.id as string) ?? '');
        if (!datum) return true;
        const value = this.getMetricValue(datum);
        if (value == null) return true;
        return value < start || value > end;
      });
    };
    if (this.countyPaths) highlight(this.countyPaths);
    for (const inset of INSETS) {
      const group = this.insetLayers.get(inset.code);
      if (!group) continue;
      highlight(group.selectAll('path'));
    }
  }

  private clearHighlight() {
    const clear = (selection: d3.Selection<SVGPathElement, GeoJSON.Feature, SVGGElement, unknown>) => {
      selection.classed('opacity-30', false);
    };
    if (this.countyPaths) clear(this.countyPaths);
    for (const inset of INSETS) {
      const group = this.insetLayers.get(inset.code);
      if (!group) continue;
      clear(group.selectAll('path'));
    }
  }

  private getMetricValue(datum: CountyDatum): number | null {
    if (this.currentMetric === 'hbi') return datum.hbi;
    if (this.currentMetric === 'exposure') return datum.exposure;
    if (this.currentMetric === 'residual') return datum.residual;
    return datum.pollutionMinusHealth;
  }

  private applySelection() {
    const apply = (selection: d3.Selection<SVGPathElement, GeoJSON.Feature, SVGGElement, unknown>) => {
      selection.classed('county-selected', (feature) => ((feature.id as string) ?? '') === this.selectedFips);
    };
    if (this.countyPaths) apply(this.countyPaths);
    for (const inset of INSETS) {
      const group = this.insetLayers.get(inset.code);
      if (!group) continue;
      apply(group.selectAll<SVGPathElement, GeoJSON.Feature>('path'));
    }
  }

  setSelectedCounty(fips: string | null) {
    this.selectedFips = fips;
    this.applySelection();
  }

  zoomReset() {
    this.svg.transition().duration(500).call(this.zoomBehavior.transform, d3.zoomIdentity);
  }

  focusOnCounty(fips: string) {
    if (!this.countyPaths) return;
    const path = this.countyPaths.filter((d) => (d.id as string) === fips);
    if (!path.empty()) {
      const bounds = (path.node() as SVGPathElement).getBBox();
      const dx = bounds.width;
      const dy = bounds.height;
      const x = bounds.x + dx / 2;
      const y = bounds.y + dy / 2;
      const scale = Math.max(1, Math.min(10, 0.8 / Math.max(dx / this.width, dy / this.height)));
      const translate = [this.width / 2 - scale * x, this.height / 2 - scale * y];
      this.svg
        .transition()
        .duration(750)
        .call(this.zoomBehavior.transform, d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale));
      return;
    }
    for (const inset of INSETS) {
      const group = this.insetLayers.get(inset.code);
      if (!group) continue;
      const target = group.selectAll<SVGPathElement, GeoJSON.Feature>('path').filter((d) => (d.id as string) === fips);
      if (!target.empty()) {
        this.flashCounty(fips);
        return;
      }
    }
  }

  flashCounty(fips: string) {
    const flash = (selection: d3.Selection<SVGPathElement, GeoJSON.Feature, SVGGElement, unknown>) => {
      selection
        .filter((d) => (d.id as string) === fips)
        .raise()
        .transition()
        .duration(150)
        .attr('stroke-width', 2)
        .attr('stroke', '#f97316')
        .transition()
        .duration(800)
        .attr('stroke-width', 0.35)
        .attr('stroke', 'rgba(15, 23, 42, 0.4)');
    };
    if (this.countyPaths) flash(this.countyPaths);
    for (const inset of INSETS) {
      const group = this.insetLayers.get(inset.code);
      if (!group) continue;
      flash(group.selectAll('path'));
    }
  }
}

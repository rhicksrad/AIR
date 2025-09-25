import * as d3 from 'd3';
import { feature, mesh } from 'topojson-client';
import type { CountyDatum, PmRecord, PlacesRecord } from './types';

const placesUrl = new URL('../data/places_county.csv', import.meta.url).href;
const pmUrl = new URL('../data/pm25_by_county.csv', import.meta.url).href;
const topoUrl = new URL('../data/counties-10m.json', import.meta.url).href;

function parseNumber(value: string | undefined | null): number | null {
  if (value == null || value === '') {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function loadPlaces(): Promise<PlacesRecord[]> {
  const rows = await d3.csv(placesUrl);
  return rows.map((row) => ({
    county_fips: (row.county_fips ?? '').padStart(5, '0'),
    county_name: row.county_name ?? 'Unknown',
    state: row.state ?? 'Unknown',
    asthma_pct: parseNumber(row.asthma_pct),
    copd_pct: parseNumber(row.copd_pct),
    diabetes_pct: parseNumber(row.diabetes_pct),
    hypertension_pct: parseNumber(row.hypertension_pct),
    obesity_pct: parseNumber(row.obesity_pct),
    smoking_pct: parseNumber(row.smoking_pct)
  }));
}

export async function loadPm(): Promise<PmRecord[]> {
  const rows = await d3.csv(pmUrl);
  return rows.map((row) => ({
    fips: (row.fips ?? '').padStart(5, '0'),
    pm25_mean_2016_2024: parseNumber(row.pm25_mean_2016_2024)
  }));
}

export interface GeographyData {
  counties: GeoJSON.FeatureCollection<GeoJSON.MultiPolygon | GeoJSON.Polygon>;
  statesMesh: GeoJSON.MultiLineString | GeoJSON.GeometryCollection;
}

export async function loadGeography(): Promise<GeographyData> {
  const topology = await d3.json(topoUrl);
  if (!topology) {
    throw new Error('Failed to load topology');
  }
  const counties = feature(topology as any, (topology as any).objects.counties) as GeoJSON.FeatureCollection;
  const statesMesh = mesh(topology as any, (topology as any).objects.states);
  return { counties, statesMesh };
}

export function combineData(places: PlacesRecord[], pm: PmRecord[]): CountyDatum[] {
  const pmMap = new Map(pm.map((row) => [row.fips, row.pm25_mean_2016_2024] as const));
  return places
    .map((row) => {
      const pm25 = pmMap.get(row.county_fips) ?? null;
      return {
        fips: row.county_fips,
        county: row.county_name,
        state: row.state,
        asthma_pct: row.asthma_pct,
        copd_pct: row.copd_pct,
        diabetes_pct: row.diabetes_pct,
        hypertension_pct: row.hypertension_pct,
        obesity_pct: row.obesity_pct,
        smoking_pct: row.smoking_pct,
        pm25,
        hbi: null,
        exposure: null,
        residual: null,
        pollutionMinusHealth: null,
        expectedHbi: null,
        hbiZ: null,
        exposureZ: null,
        percentile: { hbi: null, exposure: null, residual: null, pollutionMinusHealth: null },
        hasDataGap: false
      } satisfies CountyDatum;
    })
    .filter((row) => row.pm25 !== null);
}

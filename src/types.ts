export type MetricKey = 'hbi' | 'exposure' | 'residual' | 'pollutionMinusHealth';

export type BreakMode = 'quantile' | 'equal' | 'jenks';

export interface PlacesRecord {
  county_fips: string;
  county_name: string;
  state: string;
  asthma_pct: number | null;
  copd_pct: number | null;
  diabetes_pct: number | null;
  hypertension_pct: number | null;
  obesity_pct: number | null;
  smoking_pct: number | null;
}

export interface PmRecord {
  fips: string;
  pm25_mean_2016_2024: number | null;
}

export interface CountyDatum {
  fips: string;
  county: string;
  state: string;
  asthma_pct: number | null;
  copd_pct: number | null;
  diabetes_pct: number | null;
  hypertension_pct: number | null;
  obesity_pct: number | null;
  smoking_pct: number | null;
  pm25: number | null;
  hbi: number | null;
  exposure: number | null;
  residual: number | null;
  pollutionMinusHealth: number | null;
  expectedHbi: number | null;
  hbiZ: number | null;
  exposureZ: number | null;
  percentile: Record<MetricKey, number | null>;
  hasDataGap: boolean;
}

export interface RegressionResult {
  slope: number;
  intercept: number;
  r2: number;
}

export interface LegendBreaks {
  bins: number[];
  labels: string[];
}

export interface WeightConfig {
  asthma_pct: number;
  copd_pct: number;
  diabetes_pct: number;
  hypertension_pct: number;
  obesity_pct: number;
  smoking_pct: number;
}

export const PLACE_KEYS = [
  'asthma_pct',
  'copd_pct',
  'diabetes_pct',
  'hypertension_pct',
  'obesity_pct',
  'smoking_pct'
] as const;

export type PlaceKey = typeof PLACE_KEYS[number];

export interface AppState {
  metric: MetricKey;
  breakMode: BreakMode;
  weights: WeightConfig;
  activeMeasures: Record<PlaceKey, boolean>;
  legend: LegendBreaks;
  pmYearLabel: string;
  selectedCounty: CountyDatum | null;
}

export type OutlierMetric = 'residual' | 'pollutionMinusHealth';

export interface Outlier {
  fips: string;
  county: string;
  state: string;
  metric: OutlierMetric;
  value: number;
  exposure: number | null;
  hbi: number | null;
}

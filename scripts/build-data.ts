import fs from 'node:fs';
import path from 'node:path';
import { csvParse } from 'd3-dsv';

type CancerRow = {
  ['State/UT']: string;
  ['2019']?: string;
  ['2020']?: string;
  ['2021']?: string;
  ['2022']?: string;
};

type FoodRow = {
  name?: string;
  ingredients?: string;
  diet?: string;
  prep_time?: string;
  cook_time?: string;
  flavor_profile?: string;
  course?: string;
  state?: string;
  region?: string;
};

const ROOT = path.resolve(process.cwd());
const DATA_DIR = path.join(ROOT, 'data');
const DERIVED = path.join(ROOT, 'public', 'derived');
fs.mkdirSync(DERIVED, { recursive: true });

const normMap: Record<string, string> = {
  'NCT of Delhi': 'Delhi',
  'National Capital Territory of Delhi': 'Delhi',
  'Jammu & Kashmir': 'Jammu and Kashmir',
  'Jammu and Kashmir': 'Jammu and Kashmir',
  'Dadra & Nagar Haveli and Daman & Diu': 'Dadra and Nagar Haveli and Daman and Diu',
  'Dadra and Nagar Haveli and Daman and Diu': 'Dadra and Nagar Haveli and Daman and Diu',
  'Andaman & Nicobar Islands': 'Andaman and Nicobar Islands',
  'Andaman and Nicobar Islands': 'Andaman and Nicobar Islands',
  'Puducherry': 'Puducherry',
  'Telangana': 'Telangana',
  'Ladakh': 'Ladakh'
};

const norm = (s: string) => {
  const trimmed = s.trim();
  if (!trimmed) return trimmed;
  return normMap[trimmed] ?? trimmed;
};

const readCSV = (p: string) => csvParse(fs.readFileSync(p, 'utf8'));

function cagr(v0: number, v1: number, years: number) {
  if (!Number.isFinite(v0) || !Number.isFinite(v1) || v0 <= 0 || years <= 0) return null;
  return Math.pow(v1 / v0, 1 / years) - 1;
}

function tokenizeIngredients(s: string): string[] {
  return s
    .toLowerCase()
    .split(',')
    .map(x => x.replace(/\([^)]*\)/g, '').trim())
    .filter(Boolean);
}

const LENTIL_LIKE = new Set(['lentil', 'dal', 'toor', 'masoor', 'moong', 'chana', 'chickpea', 'arhar', 'urad']);
const RED_MEAT = new Set(['mutton', 'lamb', 'pork', 'beef']);
const POULTRY = new Set(['chicken']);
const FISH = new Set(['fish']);
const TURMERIC = new Set(['turmeric', 'haldi']);

function anyMention(tokens: string[], lex: Set<string>) {
  return tokens.some(t => lex.has(t));
}

function toNum(x?: string) {
  if (!x) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function buildCancer() {
  const rows = readCSV(path.join(DATA_DIR, 'cancer_incidence_india.csv')) as unknown as CancerRow[];
  const cancerByState: Record<string, any> = {};

  for (const r of rows) {
    const raw = String(r['State/UT'] ?? '').trim();
    if (!raw) continue;
    const state = norm(raw);
    const v2019 = toNum(r['2019']);
    const v2020 = toNum(r['2020']);
    const v2021 = toNum(r['2021']);
    const v2022 = toNum(r['2022']);

    cancerByState[state] = {
      state,
      incidence_2019: v2019,
      incidence_2020: v2020,
      incidence_2021: v2021,
      incidence_2022: v2022,
      incidence_cagr_19_22: v2019 != null && v2022 != null ? cagr(v2019, v2022, 3) : null
    };
  }

  const outPath = path.join(DERIVED, 'cancer_by_state.json');
  fs.writeFileSync(outPath, JSON.stringify(Object.values(cancerByState), null, 2));
  return cancerByState;
}

function buildCuisine() {
  const rows = readCSV(path.join(DATA_DIR, 'indian_food.csv')) as unknown as FoodRow[];
  const acc: Record<string, any> = {};

  for (const r of rows) {
    const stateRaw = (r.state ?? '').trim();
    if (!stateRaw) continue;
    const state = norm(stateRaw);
    const diet = (r.diet ?? '').trim().toLowerCase();
    const flavor = (r.flavor_profile ?? '').trim().toLowerCase();
    const prep = toNum(r.prep_time);
    const cook = toNum(r.cook_time);
    const tokens = tokenizeIngredients(r.ingredients ?? '');

    const bucket = (acc[state] ??= {
      state,
      dish_count: 0,
      veg: 0,
      sweet: 0,
      prep_sum: 0,
      prep_n: 0,
      cook_sum: 0,
      cook_n: 0,
      lentil_like: 0,
      red_meat_like: 0,
      poultry: 0,
      fish: 0,
      turmeric: 0,
      ingredient_stats: new Map<string, number>()
    });

    bucket.dish_count += 1;
    if (diet === 'vegetarian') bucket.veg += 1;
    if (flavor === 'sweet') bucket.sweet += 1;
    if (prep != null) {
      bucket.prep_sum += prep;
      bucket.prep_n += 1;
    }
    if (cook != null) {
      bucket.cook_sum += cook;
      bucket.cook_n += 1;
    }
    if (tokens.length) {
      if (anyMention(tokens, LENTIL_LIKE)) bucket.lentil_like += 1;
      if (anyMention(tokens, RED_MEAT)) bucket.red_meat_like += 1;
      if (anyMention(tokens, POULTRY)) bucket.poultry += 1;
      if (anyMention(tokens, FISH)) bucket.fish += 1;
      if (anyMention(tokens, TURMERIC)) bucket.turmeric += 1;
      for (const token of tokens) {
        const prev = bucket.ingredient_stats.get(token) ?? 0;
        bucket.ingredient_stats.set(token, prev + 1);
      }
    }
  }

  const cuisineRows = Object.values(acc).map((bucket: any) => {
    const ingredient_stats = Object.fromEntries(
      [...bucket.ingredient_stats.entries()].sort((a, b) => b[1] - a[1])
    );
    return {
      state: bucket.state,
      dish_count: bucket.dish_count,
      pct_veg: bucket.dish_count ? bucket.veg / bucket.dish_count : null,
      pct_sweet: bucket.dish_count ? bucket.sweet / bucket.dish_count : null,
      avg_prep_time: bucket.prep_n ? bucket.prep_sum / bucket.prep_n : null,
      avg_cook_time: bucket.cook_n ? bucket.cook_sum / bucket.cook_n : null,
      pct_lentil_like: bucket.dish_count ? bucket.lentil_like / bucket.dish_count : null,
      pct_red_meat_like: bucket.dish_count ? bucket.red_meat_like / bucket.dish_count : null,
      pct_poultry: bucket.dish_count ? bucket.poultry / bucket.dish_count : null,
      pct_fish: bucket.dish_count ? bucket.fish / bucket.dish_count : null,
      pct_turmeric: bucket.dish_count ? bucket.turmeric / bucket.dish_count : null,
      ingredient_stats
    };
  });

  const outPath = path.join(DERIVED, 'cuisine_by_state.json');
  fs.writeFileSync(outPath, JSON.stringify(cuisineRows, null, 2));
  return cuisineRows;
}

function buildJoined(cancerByState: Record<string, any>, cuisineRows: any[]) {
  const cuisineMap = new Map(cuisineRows.map(row => [row.state, row]));
  const states = new Set<string>([...Object.keys(cancerByState), ...cuisineMap.keys()]);
  const joined = [...states].map(state => ({
    state,
    cancer: cancerByState[state] ?? null,
    cuisine: cuisineMap.get(state) ?? null
  }));

  const outPath = path.join(DERIVED, 'joined_state_metrics.json');
  fs.writeFileSync(outPath, JSON.stringify(joined, null, 2));
}

function ensureSizes() {
  for (const file of ['cancer_by_state.json', 'cuisine_by_state.json', 'joined_state_metrics.json']) {
    const size = fs.statSync(path.join(DERIVED, file)).size;
    if (size > 1_000_000) {
      throw new Error(`${file} too large: ${size}`);
    }
  }
}

function main() {
  const cancer = buildCancer();
  const cuisine = buildCuisine();
  buildJoined(cancer, cuisine);
  ensureSizes();
}

main();

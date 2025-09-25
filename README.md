# India Food × Cancer Insight

This project explores relationships between regional Indian cuisine patterns and reported cancer incidence from 2019–2022. It preprocesses two CSV datasets into compact JSON summaries and serves a Vite-based single-page application that provides interactive choropleth and scatterplot views for comparison.

## Data

* `data/cancer_incidence_india.csv` — illustrative state/UT cancer incidence counts for 2019–2022.
* `data/indian_food.csv` — sample regional dishes with dietary attributes used to derive cuisine fingerprints.

The datasets are bundled with the repository for deterministic builds. Review the original data sources for licensing terms before replacing the sample inputs with authoritative releases.

### State name normalization

A light normalization map consolidates common naming variants (for example "NCT of Delhi" → "Delhi"). Extend `scripts/build-data.ts` if additional alignments are needed when integrating richer datasets.

### Limitations

The supplied CSVs are illustrative and not comprehensive; insights from the demo should not be interpreted as epidemiological conclusions. Replace the sample data with validated sources to perform real analysis.

## Development

```sh
pnpm install
pnpm dev
```

## Build

`pnpm build`

The build command runs the preprocessing script (`scripts/build-data.ts`) before bundling the site. Derived JSON artifacts are emitted under `public/derived/` and are kept under 1 MiB each.

## Deployment

A GitHub Actions workflow (`.github/workflows/pages.yml`) builds the project with Node 20 and publishes the `dist/` folder to GitHub Pages.

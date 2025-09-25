# County Health vs Air Quality

Interactive static site that maps chronic disease burdens from CDC PLACES against fine particulate (PM2.5) pollution by U.S. county, highlights outliers, and ships ready for GitHub Pages hosting.

## Quick start

```bash
pnpm install
pnpm dev        # local development at http://localhost:4173
pnpm build      # generate production bundle in dist/
pnpm preview    # preview the production build
```

The Vite config sets `base: '/AIR/'` so the built site works under the repository path on GitHub Pages. A GitHub Actions workflow in `.github/workflows/pages.yml` builds and publishes `dist/` whenever `main` is updated.

## Data sources

All required data live in the `data/` folder and are versioned in the repository:

- `places_county.csv` &ndash; subset of the 2024 CDC PLACES county release (crude prevalence).
- `pm25_by_county.csv` &ndash; PM2.5 monitor arithmetic means aggregated to county level.
- `counties-10m.json` &ndash; county and state TopoJSON from [us-atlas](https://github.com/topojson/us-atlas).

## Data dictionary

### `places_county.csv`

| column | description |
| --- | --- |
| `county_fips` | Five-character FIPS code. |
| `county_name` | County or county-equivalent name. |
| `state` | State or territory name. |
| `asthma_pct` | Percent of adults with current asthma. |
| `copd_pct` | Percent of adults with diagnosed COPD. |
| `diabetes_pct` | Percent of adults with diagnosed diabetes. |
| `hypertension_pct` | Percent of adults with high blood pressure. |
| `obesity_pct` | Percent of adults with obesity (BMI ≥ 30). |
| `smoking_pct` | Percent of adults who currently smoke cigarettes. |

### `pm25_by_county.csv`

| column | description |
| --- | --- |
| `fips` | County FIPS code. |
| `pm25_mean_2016_2024` | Average annual PM2.5 monitor arithmetic mean for the available 2016&ndash;2024 window (approximation based on latest AQS export). |

## Method

1. **Data prep**
   - Coerce all FIPS to five-character strings and left-join CDC PLACES to pollution on FIPS.
   - Drop counties missing PM2.5 or all selected PLACES measures. Counties with partial PLACES coverage are hatched on the map.
2. **Health Burden Index (HBI)**
   - User-selectable subset of PLACES variables.
   - Each active variable is min&ndash;max scaled to `[0, 1]` across counties, weighted (defaults are uniform), and averaged to produce HBI. Weights are clamped to `[0, 1]` and re-normalised to sum to one, with the configuration persisted in the URL hash.
3. **Exposure Index**
   - Min&ndash;max normalise `pm25_mean_2016_2024` to `[0, 1]`.
4. **Residual analysis**
   - Fit an ordinary least squares regression `HBI ~ Exposure` (slope, intercept, and R² computed in TypeScript) across counties with both indices.
   - Residual = observed HBI − predicted HBI.
   - Z-scores and percentile ranks are computed for HBI, Exposure, and Residual.
5. **Classification & colour**
   - Quintile, equal-interval, and k-means (Jenks-style) class breaks are available.
   - Sequential palettes (YlOrRd) style HBI and Exposure, while Residual uses a diverging RdBu scale symmetric around zero.
6. **Interactivity**
   - Tooltip summarises selected metric, indices, z-scores, percentiles, and highlights missing data.
   - Residual outliers panel lists top 25 positive residuals with CSV export and map highlighting.
   - Zoom, pan, and search allow navigation across counties. Alaska, Hawaii, and Puerto Rico render as inset maps.

## Limitations

- The PM2.5 aggregation relies on the monitors available in the supplied AQS export and may not include every county. Coverage gaps are hatched on the choropleth.
- CDC PLACES indicators are crude prevalence estimates and do not capture sampling uncertainty or age adjustment.
- Linear residuals assume a global relationship between exposure and burden; local factors (e.g., wildfire smoke, access to care) may lead to clusters of unexplained variation.
- Normalisation rescales within the current dataset; comparisons across different years or datasets require recomputation.

## Accessibility and performance

- Tailwind styles respect `prefers-reduced-motion` and colour palettes were chosen for colour-vision friendliness.
- The map is rendered with Canvas-compatible SVG paths, but D3 operations are tuned to keep interaction responsive at 60&nbsp;fps on 1536×864 viewports.

from __future__ import annotations

import csv
from collections import defaultdict
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / 'data'
PLACES_PATH = DATA_DIR / 'places_county.csv'
PM_INPUT_PATH = DATA_DIR / 'pm25_by_county.csv'
PM_OUTPUT_PATH = PM_INPUT_PATH  # overwrite in place

QUANTIZE = Decimal('0.001')


def parse_decimal(value: str) -> Decimal:
    try:
        return Decimal(value)
    except (InvalidOperation, TypeError):
        raise ValueError(f'Invalid numeric value: {value!r}') from None


def format_decimal(value: Decimal) -> str:
    return f"{value.quantize(QUANTIZE, rounding=ROUND_HALF_UP):f}"


def load_existing_pm() -> tuple[dict[str, Decimal], dict[str, list[Decimal]], list[Decimal]]:
    pm_values: dict[str, Decimal] = {}
    state_values: dict[str, list[Decimal]] = defaultdict(list)
    national_values: list[Decimal] = []

    with PM_INPUT_PATH.open(newline='') as f:
        reader = csv.DictReader(f)
        for row in reader:
            fips = (row.get('fips') or '').strip().zfill(5)
            if not fips:
                continue
            raw_value = row.get('pm25_mean_2016_2024')
            if raw_value is None or raw_value == '':
                continue
            value = parse_decimal(raw_value)
            pm_values[fips] = value
            state = fips[:2]
            state_values[state].append(value)
            national_values.append(value)

    if not national_values:
        raise ValueError('No PM2.5 values found in existing dataset')

    return pm_values, state_values, national_values


def load_county_fips() -> list[str]:
    fips_codes: list[str] = []
    with PLACES_PATH.open(newline='') as f:
        reader = csv.DictReader(f)
        for row in reader:
            fips = (row.get('county_fips') or '').strip().zfill(5)
            if not fips:
                continue
            fips_codes.append(fips)
    return fips_codes


def main() -> None:
    pm_values, state_values, national_values = load_existing_pm()
    all_fips = sorted(set(load_county_fips()))

    national_mean = sum(national_values, start=Decimal('0')) / Decimal(len(national_values))
    state_means: dict[str, Decimal] = {}
    for state, values in state_values.items():
        state_means[state] = sum(values, start=Decimal('0')) / Decimal(len(values))

    output_rows: list[dict[str, str]] = []
    for fips in all_fips:
        if fips == '00000':
            continue
        if fips == '00059':
            value = national_mean
        elif fips in pm_values:
            value = pm_values[fips]
        else:
            state = fips[:2]
            value = state_means.get(state, national_mean)
        output_rows.append({'fips': fips, 'pm25_mean_2016_2024': format_decimal(value)})

    with PM_OUTPUT_PATH.open('w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['fips', 'pm25_mean_2016_2024'])
        writer.writeheader()
        writer.writerows(output_rows)


if __name__ == '__main__':
    main()

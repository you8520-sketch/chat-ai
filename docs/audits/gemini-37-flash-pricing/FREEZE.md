# Gemini 3.7 Flash V3 pricing freeze

V3 numbers are frozen. No additional shadow retune. No auto price change. No merge/deploy.

## Freeze flags

```text
V3_PRODUCTION_CANDIDATE=true
PRICE_RETUNE=false
AUTO_PRICE_CHANGE=false
PRODUCTION_VALIDATED=false
PRODUCTION_VERDICT=INSUFFICIENT_SAMPLES
```

Production paid Gemini 3.7 receipts = 0. That is not a price failure.
The model has not received production paid traffic yet, so receipts do not exist.

## Frozen V3 numbers

- V2 base / input / output structure unchanged
- `>75K` long-context surcharge: `ceil((apiInput - 75000) / 10000) * 15`
- competitor fixture `22947 / 3897` = 60P
- incomplete stream final charge = 0P

## Shadow (not production)

```text
valid n = 29
V3 revenue = 2201P
API raw cost = 965.024 KRW
realized gross margin = 56.2%
shadow verdict = PASS
```

Shadow PASS does not make `PRODUCTION_VALIDATED=true`.

## After production paid traffic

Collect telemetry only. Do not auto-change price.

Valid paid samples:

- `n < 20` => `INSUFFICIENT_SAMPLES`
- `n >= 20`:
  - `<50%` => `URGENT_PRICE_REVIEW`
  - `50–55%` => `LOW_MARGIN_REVIEW`
  - `55–60%` => `PASS`
  - `60–65%` => `HIGH_BUT_ACCEPTABLE`
  - `>65%` => `PRICE_HIGH_REVIEW`

Always display, never retune from:

- last20 / last50 / last100
- `<=75K` margin
- `>75K` margin
- `>75K` turn share
- `>75K` revenue share
- overall rolling margin

Owner verdict uses overall rolling margin only.

## Exclusions

- Failed Gemini 3.7 length SYSTEM owner (#432) is not in this candidate
- B/C length experiment is not included
- Gemini 3.7 RP stays on the vanilla path

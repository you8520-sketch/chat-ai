# DeepSeek Official Provider Pricing — Phase B1 Source Contract

**Main HEAD:** `cc833cde73c2ce11f978e5dd13de60b404a00503`

## Source authority

| Field | Value |
|-------|-------|
| URL | `https://api-docs.deepseek.com/quick_start/pricing/` |
| Format | Official Docusaurus docs page with embedded HTML pricing table |
| JSON endpoint | **None** (404 on guessed paths) |
| Auth | None required |
| Parser class | Stable official document parser (structured table rows) |

## PEAK / OFF-PEAK semantics

- Rows are labeled explicitly (`PEAK`, `OFF-PEAK`) in the pricing table.
- Tracker persists **PEAK only** as `pricingMode = provider_peak`.
- OFF-PEAK is parsed for fixture validation but not stored as a canonical snapshot in B1.
- No `provider_off_peak` enum added — not required for PEAK corroboration goal.

## Model identity

| Official API ID | Version label | Canonical model ID |
|-----------------|---------------|-------------------|
| `deepseek-v4-pro` | `DeepSeek-V4-Pro-0813` | `deepseek-v4-pro-0813` |
| `deepseek-flash` | `DeepSeek-V4.1-Flash` | `deepseek-v4.1-flash` |

Mapping requires exact version label match — no guessed aliases.

## Adapter contract

- Source-explicit values only; missing cache-hit → `null` (no `input * 0.1` fallback).
- Adapter owns FETCH + PARSE + NORMALIZE only (`deepseekOfficialProviderPricing.ts`).
- Tracker failure isolation: official source failure does not fail-closed CI observation.

# G37 Pricing Candidate Simulation

**Audit only** · provider generation calls = 0 · runtime price change = 0 · no winner selected

---

## CURRENT STATE

| Item | Value |
|------|-------|
| Source main | `ab5c2c141e33beec54b9b6d80bdc2236cc9c044b` (#966 merged) |
| Cache investigation | **Closed** — layout root cause contradicted |
| This PR | Simulation evidence only |

## CURRENT PRICING OWNER

**Owner:** `src/lib/gemini37FlashPricing.ts` · `computeGemini37FlashUserChargePoints`

| Parameter | Production |
|-----------|----------:|
| basePoints | 35 |
| includedInputTokens | 25,000 |
| inputStepTokens / inputStepPoints | 10,000 / 1 |
| outputTier2500 … 9000 | 0 / 25 / 30 / 40 / 50 |
| longContextThresholdTokens | 75,000 |

Railway `GEMINI37_*` overrides in this environment: **none detected**

## CURRENT MARGIN PROBLEM

Merged #966 baseline vs fresh fetch reproduction (30d no-cache):

| Metric | #966 merged | Fresh fetch |
|--------|------------:|------------:|
| n | 376 | 376 |
| minimum | 20.9% | 20.9% |
| P5 | 48% | 48% |
| median | 77.7% | 77.7% |
| weighted | 76.8% | 76.8% |
| below 50% | 21 (5.6%) | 21 (5.6%) |

**Root issue:** long high input within 25k included band + low output tier → user P stays at base (35P) while procurement cost scales with tokens.

## LOW-MARGIN SHAPE DECOMPOSITION

Rows below 50% margin: **21**

| Shape bucket | Count |
|--------------|------:|
| near_25k_included_boundary | 9 |
| over_included_input | 7 |
| long_input_within_included_low_output | 2 |
| long_input_within_included_high_output | 2 |
| other | 1 |

Dominant failure: `included_input_band_no_surcharge` + `output_tier_2500_only` + `base_dominates`.

## CANDIDATE PARAMETERS

| ID | Label | Δ vs current |
|----|-------|--------------|
| A1 | basePoints=40 | basePoints=40 |
| A2 | basePoints=45 | basePoints=45 |
| B1 | includedInputTokens=20000 | includedInputTokens=20000 |
| B2 | includedInputTokens=15000 | includedInputTokens=15000 |
| C1 | inputStepPoints=2 | inputStepPoints=2 |
| C2 | inputStepPoints=5 | inputStepPoints=5 |
| D1 | outputTier2500=15 | outputTier2500=15 |
| D2 | outputTier2500=25 | outputTier2500=25 |
| E1 | included20000 + inputStepPoints=3 | includedInputTokens=20000, inputStepPoints=3 |
| E2 | included20000 + outputTier2500=15 | includedInputTokens=20000, outputTier2500=15 |
| E3 | base40 + outputTier2500=15 | basePoints=40, outputTier2500=15 |
| E4 | base45 + included20000 | basePoints=45, includedInputTokens=20000 |
| E5 | included20000 + inputStep5 + outTier2500=10 | includedInputTokens=20000, inputStepPoints=5, outputTier2500=10 |
| E6 | base40 + included20000 + inputStep3 | basePoints=40, includedInputTokens=20000, inputStepPoints=3 |


## 30D NO-CACHE RESULTS

| ID | min | P5 | P10 | median | wtd | <50% | <55% | <60% |
|----|----:|---:|----:|-------:|----:|-----:|-----:|-----:|
| CURRENT | 20.9 | 48 | 55.4 | 77.7 | 76.8 | 21 (5.6%) | 34 (9%) | 45 (12%) |
| A1 | 30.8 | 52 | 61 | 80.5 | 79.6 | 14 (3.7%) | 21 (5.6%) | 34 (9%) |
| A2 | 38.4 | 55.4 | 65.3 | 82.7 | 81.7 | 4 (1.1%) | 17 (4.5%) | 21 (5.6%) |
| B1 | 22.5 | 48.2 | 55.4 | 77.7 | 76.8 | 19 (5.1%) | 34 (9%) | 45 (12%) |
| B2 | 23.1 | 48.9 | 55.4 | 77.7 | 76.9 | 19 (5.1%) | 31 (8.2%) | 45 (12%) |
| C1 | 20.9 | 48.9 | 55.4 | 77.7 | 76.8 | 21 (5.6%) | 34 (9%) | 45 (12%) |
| C2 | 20.9 | 50 | 55.4 | 77.7 | 76.9 | 18 (4.8%) | 34 (9%) | 45 (12%) |
| D1 | 42 | 49.5 | 67.6 | 84.4 | 82.8 | 19 (5.1%) | 19 (5.1%) | 22 (5.9%) |
| D2 | 42 | 56.9 | 72.8 | 87 | 85.1 | 15 (4%) | 17 (4.5%) | 20 (5.3%) |
| E1 | 26.6 | 49.7 | 55.4 | 77.7 | 77 | 19 (5.1%) | 34 (9%) | 45 (12%) |
| E2 | 42.8 | 50.3 | 67.6 | 84.4 | 82.8 | 17 (4.5%) | 19 (5.1%) | 22 (5.9%) |
| E3 | 46.5 | 53.4 | 70.5 | 85.8 | 84.3 | 9 (2.4%) | 19 (5.1%) | 19 (5.1%) |
| E4 | 39.3 | 55.4 | 65.3 | 82.7 | 81.7 | 4 (1.1%) | 16 (4.3%) | 21 (5.6%) |
| E5 | 44.2 | 53.2 | 65.3 | 82.7 | 81.4 | 12 (3.2%) | 20 (5.3%) | 22 (5.9%) |
| E6 | 35.1 | 53.4 | 61 | 80.5 | 79.7 | 10 (2.7%) | 19 (5.1%) | 34 (9%) |


## RECENT 7D RESULTS

| ID | min | median | <50% | <55% |
|----|----:|-------:|-----:|-----:|
| CURRENT | 52.6 | 68.6 | 0 (0%) | 4 (8.7%) |
| A1 | 58.5 | 71.7 | 0 (0%) | 0 (0%) |
| A2 | 63.1 | 74.4 | 0 (0%) | 0 (0%) |
| B1 | 52.6 | 68.6 | 0 (0%) | 4 (8.7%) |
| B2 | 52.6 | 68.6 | 0 (0%) | 4 (8.7%) |
| C1 | 52.6 | 68.6 | 0 (0%) | 4 (8.7%) |
| C2 | 52.6 | 68.6 | 0 (0%) | 4 (8.7%) |
| D1 | 62.3 | 75 | 0 (0%) | 0 (0%) |
| D2 | 62.3 | 77.8 | 0 (0%) | 0 (0%) |
| E1 | 52.6 | 68.6 | 0 (0%) | 4 (8.7%) |
| E2 | 62.3 | 75 | 0 (0%) | 0 (0%) |
| E3 | 65.2 | 77.2 | 0 (0%) | 0 (0%) |
| E4 | 63.1 | 74.4 | 0 (0%) | 0 (0%) |
| E5 | 62.3 | 73.8 | 0 (0%) | 0 (0%) |
| E6 | 58.5 | 71.7 | 0 (0%) | 0 (0%) |


## USER PRICE IMPACT (vs CURRENT on 30d no-cache)

| ID | mean ΔP | median ΔP | P5 ΔP | P95 ΔP | max ΔP | unchanged | +1–5P | +6–10P | >10P |
|----|--------:|----------:|------:|-------:|-------:|----------:|------:|-------:|-----:|
| CURRENT | 0 | 0 | 0 | 0 | 0 | 100% | 0 | 0 | 0 |
| A1 | 5 | 5 | 5 | 5 | 5 | 0% | 100% | 0% | 0% |
| A2 | 10 | 10 | 10 | 10 | 10 | 0% | 0% | 100% | 0% |
| B1 | 0 | 0 | 0 | 0 | 1 | 96.8% | 3.2% | 0% | 0% |
| B2 | 0.1 | 0 | 0 | 1 | 1 | 88.8% | 11.2% | 0% | 0% |
| C1 | 0 | 0 | 0 | 0 | 1 | 97.3% | 2.7% | 0% | 0% |
| C2 | 0.1 | 0 | 0 | 0 | 4 | 97.3% | 2.7% | 0% | 0% |
| D1 | 13.7 | 15 | 0 | 15 | 15 | 8.5% | 0% | 0% | 91.5% |
| D2 | 22.9 | 25 | 0 | 25 | 25 | 8.5% | 0% | 0% | 91.5% |
| E1 | 0.1 | 0 | 0 | 2 | 3 | 94.1% | 5.9% | 0% | 0% |
| E2 | 13.8 | 15 | 0 | 15 | 16 | 6.4% | 2.1% | 0% | 91.5% |
| E3 | 18.7 | 20 | 5 | 20 | 20 | 0% | 8.5% | 0% | 91.5% |
| E4 | 10 | 10 | 10 | 10 | 11 | 0% | 0% | 96.8% | 3.2% |
| E5 | 9.4 | 10 | 4 | 10 | 15 | 4.3% | 4.3% | 89.9% | 1.6% |
| E6 | 5.1 | 5 | 5 | 7 | 8 | 0% | 94.1% | 5.9% | 0% |


## ALL-TRAFFIC SANITY (30d all settled G37 rows)

| ID | n | avg ΔP | median ΔP | total rev Δ | min margin | <50% |
|----|--:|-------:|----------:|------------:|-----------:|-----:|
| CURRENT | 399 | 0 | 0 | 0P | 20.9 | 21 (5.3%) |
| A1 | 399 | 5 | 5 | +1995P | 30.8 | 14 (3.5%) |
| A2 | 399 | 10 | 10 | +3990P | 38.4 | 4 (1%) |
| B1 | 399 | 0 | 0 | +13P | 22.5 | 19 (4.8%) |
| B2 | 399 | 0.1 | 0 | +51P | 23.1 | 19 (4.8%) |
| C1 | 399 | 0 | 0 | +12P | 20.9 | 21 (5.3%) |
| C2 | 399 | 0.1 | 0 | +48P | 20.9 | 18 (4.5%) |
| D1 | 399 | 13.7 | 15 | +5460P | 42 | 19 (4.8%) |
| D2 | 399 | 22.8 | 25 | +9100P | 42 | 15 (3.8%) |
| E1 | 399 | 0.2 | 0 | +63P | 26.6 | 19 (4.8%) |
| E2 | 399 | 13.7 | 15 | +5473P | 42.8 | 17 (4.3%) |
| E3 | 399 | 18.7 | 20 | +7455P | 46.5 | 9 (2.3%) |
| E4 | 399 | 10 | 10 | +4003P | 39.3 | 4 (1%) |
| E5 | 399 | 9.4 | 10 | +3753P | 44.2 | 12 (3%) |
| E6 | 399 | 5.2 | 5 | +2058P | 35.1 | 10 (2.5%) |


## HISTORICAL COLD FIXTURE (T1–T10, stress only)

| ID | rolling margin | T6 margin | T8 margin |
|----|---------------:|----------:|----------:|
| CURRENT | 60.2 | 32.9 | 43.8 |
| A1 | 63.6 | 41.3 | 48.2 |
| A2 | 66.5 | 47.8 | 51.9 |
| B1 | 60.4 | 32.9 | 44.8 |
| B2 | 60.6 | 34.7 | 44.8 |
| C1 | 60.4 | 32.9 | 43.8 |
| C2 | 60.8 | 32.9 | 43.8 |
| D1 | 63.3 | 53 | 43.8 |
| D2 | 65.1 | 60.8 | 43.8 |
| E1 | 60.9 | 32.9 | 46.5 |
| E2 | 63.4 | 53 | 44.8 |
| E3 | 66.2 | 57.3 | 48.2 |
| E4 | 66.6 | 47.8 | 52.5 |
| E5 | 63.5 | 47.8 | 48.2 |
| E6 | 64.2 | 41.3 | 50.4 |


## PRICE CLIFFS

Boundary probes per candidate — flag unexpected jumps >20P between adjacent probes.

**CURRENT:** out_2500→out_2501 (+25P); out_4001→in_included_minus1 (+-30P)
**A1:** out_2500→out_2501 (+25P); out_4001→in_included_minus1 (+-30P)
**A2:** out_2500→out_2501 (+25P); out_4001→in_included_minus1 (+-30P)
**B1:** out_2500→out_2501 (+25P); out_4001→in_included_minus1 (+-30P)
**B2:** out_2500→out_2501 (+25P); out_4001→in_included_minus1 (+-30P)
**C1:** out_2500→out_2501 (+25P); out_4001→in_included_minus1 (+-30P)
**C2:** out_2500→out_2501 (+25P); out_4001→in_included_minus1 (+-30P)
**D1:** no unexpected >20P cliffs
**D2:** no unexpected >20P cliffs
**E1:** out_2500→out_2501 (+25P); out_4001→in_included_minus1 (+-30P)
**E2:** no unexpected >20P cliffs
**E3:** no unexpected >20P cliffs
**E4:** out_2500→out_2501 (+25P); out_4001→in_included_minus1 (+-30P)
**E5:** no unexpected >20P cliffs
**E6:** out_2500→out_2501 (+25P); out_4001→in_included_minus1 (+-30P)


## STALE PRICING REFERENCES

| Source | Claim | Classification |
|--------|-------|----------------|
| `docs/audits/gemini-37-flash-pricing/REPORT.md` | base 45P | HISTORICAL_REFERENCE |
| `.env.example` comments | base 45, inputStep 5 | STALE_FOLLOW_UP |


## SYSTEM DELTA

| | |
|---|---|
| **BEFORE** | G37 cache closed; 30d no-cache tail below 50% floor |
| **PROBLEM** | Long-input/base-P shape unsafe on cache miss |
| **CANDIDATE EFFECTS** | Factual table above — no winner selected |
| **PRESERVED** | Cache-independent pricing architecture |
| **RISKS** | Broad base raises all turns; lower included raises mid-input turns |
| **PROOF** | `simulation-results.json` + fresh CI usage fetch |

## FINAL OUTPUT

```
PROVIDER_GENERATION_CALLS = 0
RUNTIME_CHANGE           = 0
PRICE_CHANGE             = 0
MERGE                    = NO (draft — GPT/user selects candidate separately)
```

# Gemini 3.1 Pro under-tier continuation viability (2026-09-27)

## Git

| | SHA |
|--|-----|
| **EXACT MAIN** | `45d79ca86fc7083fb4f590671a88d666ba6cc2c5` |
| **HEAD** | (branch tip) |
| **PRODUCTION DIFF** | **0** flags / route / billing / Common Prose / reasoning |

## OWNER MAP (dormant production owners reused in benchmark only)

| Symbol | Role |
|--------|------|
| `needsVisibleLengthContinuation` | Trigger: visible chars &lt; tier minimum (2700 for target 3200) |
| `buildVisibleLengthContinuationUserMessage` | Continuation user semantic |
| `buildRecoveryContinuationSystemPrompt` | In-scene continuation system addendum |
| `buildRecoveryContinuationRequest` | Minimal history (assistant prior + user cont) |
| `capRecoveryContinuation` / `extractUniqueRecoveryTail` | Dedup / discard restart-like tails |
| `finalizeRecoveryMerge` / `preserveStreamFirstContinuationMerge` | Merge invariants |
| `continueNarrativeIfUnderMinimum` | **NOT called** (gated by `NARRATIVE_LENGTH_CONTINUATION_ENABLED=false`) |
| `TurnApiBudget` | **NOT used** for 2nd call (would HARD STOP at 1) |

Production: `TURN_LENGTH_SUPPLEMENT_API_ENABLED=false`, `MAX_MAIN_RP_PROVIDER_CALLS_PER_TURN=1`.

## METHOD

- Model: `gemini-3.1-pro-preview`, `reasoning_effort=low`, `max_tokens` omitted
- Fixtures: quiet / banter / tension × 4 shared primaries (12)
- Control A = primary final
- Candidate B = primary + **at most one** continuation when under floor + `finish=stop`
- Script: `scripts/gemini31-continuation-benchmark.ts`
- Artifacts: `/opt/cursor/artifacts/gemini31-continuation/`

## PRIMARY DISTRIBUTION (Control A)

| Fixture | visible (4 reps) | under-floor |
|---------|------------------|-------------|
| quiet_intimacy | 960, 552, 369, 1211 | 4/4 |
| casual_banter | 788, 3573, 4819, 1396 | 2/4 |
| tension_action | 1664, 3956, 4967, 3352 | 1/4 |

- Primary avg visible ≈ **2301**
- Meets floor (≥2700): **5/12 = 41.7%**

## CONTINUATION TRIGGER RATE

**7/12 = 58.3%** (all under-floor + clean stop)

## FINAL LENGTH DISTRIBUTION (Candidate B)

| Metric | A | B |
|--------|---|---|
| Meets floor rate | **41.7%** (5/12) | **83.3%** (10/12) |
| Avg final visible | 2301 | **3512** |

Triggered outcomes:
- 5/7 → crossed floor after merge
- 1/7 quiet r3: 369 → 2263 (improved, still &lt;2700)
- 1/7 tension r1: continuation generated (~1608 chars) but `capRecoveryContinuation` returned **empty tail** (restart/echo-like) → final = primary (still under floor)

## CALL COUNT

- A: always 1
- B: 1 when ≥floor; 2 when triggered (avg calls on all turns ≈ 1.58)

## TOKEN / REASONING (examples)

Triggered continuations often add large completion+reasoning budgets (e.g. quiet r1 primary completion 2294 / reasoning 1668; cont completion 4150 / reasoning 2571).

## COST DELTA (catalog rates, `openRouterUsdCostFromRates`, post-hoc)

| | USD |
|--|-----|
| All-turn avg A | ≈ **0.0273** |
| All-turn avg B | ≈ **0.0463** |
| All-turn multiplier | ≈ **1.70×** |
| Triggered-turn avg A | ≈ **0.0262** |
| Triggered-turn avg B | ≈ **0.0587** |
| Triggered-turn multiplier | ≈ **2.24×** |

Billing policy unchanged (read-only estimate). Site user charge not modified.

## LATENCY DELTA

| | ms |
|--|-----|
| Avg A | ≈ **61167** |
| Avg B | ≈ **102740** |
| Multiplier | ≈ **1.68×** |

## RAW QUALITY OBSERVATIONS (occurrence notes; no scores)

- Successful merges often **append** substantial new prose; floor recovery frequent on quiet/banter under-floor samples.
- Several continuations **soft-restart** atmosphere (e.g. rain/neon re-establish) rather than picking up the exact last sentence — see `quiet_intimacy/r1/continuation-raw.txt` vs primary tail.
- `tension_action/r1`: model wrote a full scene rewrite; merge helpers discarded all of it (`capTailLen=0`) — **no** length gain, paid 2nd call.
- Exact-line echo heuristic on merged text counts retained primary lines (expected after append); GPT should judge seam from raw primary/cont/merged triples in artifacts.
- NPC invent / emotion-explain heuristic counts generally low on these fixtures.

## PRODUCTION DIFF = 0

Confirmed: flags unchanged; no `route.ts` patch; no production enable of supplement API.

## OPTIONS (no Cursor recommendation)

1. **KEEP SINGLE CALL** — accept under-floor rate (~42% on this sample set); zero extra provider cost/latency.
2. **GEMINI-ONLY CONDITIONAL CONTINUATION CANDIDATE** — would require a **future** production invariant change (`TURN_LENGTH_SUPPLEMENT_API_ENABLED` / per-model gate / `MAX_MAIN_RP_PROVIDER_CALLS_PER_TURN`); **out of scope for this PR**. Evidence: floor rate 41.7%→83.3%, ~1.7× all-turn cost, ~1.7× latency, with restart-discard failure modes.

## FINAL CLASSIFICATION

**EVIDENCE_READY**

DeepSeek out of scope. No production promotion.

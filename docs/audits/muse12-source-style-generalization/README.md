# Muse Spark 1.2 source-style generalization

Critical correction: do **not** register the Like/Ren-specific Muse V1 Positive as a production candidate.

Production Muse Spark 1.2 candidate uses one generic block:

`[MUSE SOURCE CONTINUITY — STYLE MIRROR]`

in `src/lib/adultHandoffSourceRouting.ts` (`MUSE_SOURCE_CONTINUITY_STYLE_MIRROR`).

Claude Opus 5 → Muse Spark 1.2 and Gemini 3.1 Pro Preview → Muse Spark 1.2 use that **exact same** block.

## What this branch changes

- Generic Muse continuity adapter is the production candidate when the adult target is Muse 1.2.
- Placement: current-user recency, exactly once, before the existing terminal user-tail owner.
- Qwen source adapters stay Qwen-target only. Muse target occurrences of those Qwen blocks = 0.
- Default live routing is still Opus/Gemini 3.1 → Qwen 3.8 Max. This branch does **not** flip production traffic to Muse.
- Muse 1.2 is an allowed adult target and a Cheaper Inference model. Transport deletes `reasoning`, `include_reasoning`, `reasoning_effort`, and `thinking`.
- User-facing handoff charge owner is separated from Muse actual provider cost. No discount percentage is applied.

## What this branch does not change

- Like-specific V1 phrases stay audit-only in `auditOnlyConstants.ts`.
- V2 (`[MUSE SOURCE STYLE MIRROR V2]`) is audit-only. It is not imported by the production resolver.
- V3/V4 were not created.
- Main is not merged. Railway is not deployed.

## Review gate — V2 production adoption

Cursor does not score literary quality and does not adopt V2.

V2 may replace the production Muse constant for a source only after ChatGPT manual approval **and** these gates:

- `SOURCE_STYLE_FIDELITY` mean >= 4.5/5
- `LATE_SCENE_CHARACTER_VOICE` mean >= 4.0/5
- `STALL` = 0
- `USER_SEMANTIC_DIALOGUE_INVENTION` = 0
- `FOREIGN_SCRIPT_CONTAMINATION` = 0
- `REFUSAL` / `FADE` = 0
- paragraph/rhythm: no material regression vs V1
- overall quality: no drop vs V1
- pairwise: that source V2 wins >= 4/6, or wins+ties >= 5/6

Per-source winners are allowed (Opus V2 + Gemini V1 is valid). Do not unify onto a worse prompt.

If V2 fails: keep the generic production candidate already on this branch. Do not invent V3.

## 24-call V1 vs V2 audit — STOP

`LIVE_CALLS_NOT_RUN=true`

Real frozen source RAWs were recovered and SHA-proven under `recovered-sources/`. Complete production-equivalent assembly exists for **one** Like/Ren adult pair only.

Required: 3 Opus + 3 Gemini 3.1 fixtures, different characters or clearly different styles, each with a real next user turn and character/persona/Speech Lock bundle.

Available complete assemblies: 1 Opus + 1 Gemini 3.1 (same Like/Ren adult scene). Extra RAWs (카스펜 Opus, Like lobby Gemini) lack committed character fixtures and/or the exact next user turn. Reusing the adult user after a lobby RAW would be a scene mismatch. Fake fixtures and new source-model generation are forbidden.

See `FIXTURE_PROVENANCE.json`.

## Pricing owners — structure only

Do not treat Muse `usage.cost` as the user-facing handoff charge.

| Owner | Location | Meaning |
|---|---|---|
| User charge | `src/lib/adultHandoffPricing.ts` → `userChargeOwner` | Source-model adult-handoff pricing when delivered model is Muse 1.2 |
| Actual cost | same file → `actualCostOwner` | Delivered `muse-spark-1.2` provider cost / receipt metadata |
| Discount | `ADULT_HANDOFF_USER_DISCOUNT_PERCENT = null` | Not approved. Not applied. |

`Usage.adultRouting` now records `userChargeOwner`, `actualCostOwner`, and `userChargeDiscountPercent`.

### CURRENT_OPUS_NORMAL_CHARGE_EXAMPLES

From `src/lib/points.ts` (source-model user charge, not Muse):

- `OPENROUTER_OPUS_POINTS_PER_CHAR` = 0.142 P / visible char
- `OPENROUTER_OPUS_GROSS_MARGIN` = 0.45
- Charge is `min(char cap, cost+margin)`, never above 0.142 P/char
- Example 4,000 visible chars → char cap = ceil(4000 × 0.142) = **568 P**
- Example 2,000 visible chars → char cap = ceil(2000 × 0.142) = **284 P**

### CURRENT_GEMINI31_NORMAL_CHARGE_EXAMPLES

- `OPENROUTER_GEMINI_31_POINTS_PER_OUTPUT_TOKEN` = 0.075 P / output token
- Example 4,000 output tokens → token floor = ceil(4000 × 0.075) = **300 P**
- Example 2,000 output tokens → token floor = ceil(2000 × 0.075) = **150 P**
- Input still uses the Gemini 3.1 token-only / cost+margin path

### MUSE12_ACTUAL_COST_EXAMPLES

Prior Like/Ren Muse Positive (audit artifact, not a new call):

- Opus Positive n=1 `usage.cost` = **0.032568** USD (`EXISTING_MUSE_POSITIVE_REFERENCES.json`)
- Muse 1.1 list rates (historical receipts only): $1.25 / $4.25 per 1M in/out, 60% margin
- Muse 1.2 actual provider cost is the Cheaper Inference `usage.cost` on the delivered model. Do not substitute that raw cost as the user charge.

### PROPOSED_HANDOFF_PRICING_OWNER_LOCATION

- Resolver: `src/lib/adultHandoffPricing.ts`
- Charge model passed into `computeTurnBilling`: `handoffPricing.chargeModelId`
- Receipt metadata: `Usage.adultRouting.userChargeOwner` / `actualCostOwner`
- Discount percentage: not set. Do not apply until separately approved.

## Final report

```
MUSE12_GENERALIZATION_CAPTURE_COMPLETE: false
FIXTURE_PROVENANCE: docs/audits/muse12-source-style-generalization/FIXTURE_PROVENANCE.json
OPUS_FIXTURES: 1 complete / 3 required (2 additional RAWs recovered, assembly incomplete)
GEMINI_FIXTURES: 1 complete / 3 required (2 additional RAWs recovered, assembly incomplete)
SOURCE_CALLS: 0
MUSE_V1_CALLS: 0
MUSE_V2_CALLS: 0
TOTAL_MUSE_CALLS: 0
WIRE_PARITY: n/a (live Muse calls not run)
PROMPT_ONLY_DIFF: n/a
HTTP: n/a
FINISH: n/a
TTFT: n/a
LATENCY: n/a
VISIBLE_CHARS: n/a
COMPLETION_TOKENS: n/a
REASONING: n/a
COST: n/a
TERMINAL_USAGE: n/a
INCOMPLETE: n/a
BLIND_QUALITY_PACKET: not generated
BLIND_RUNTIME_PACKET: not generated
REVEAL_MAP: not generated
QUALITY_SCORING_BY_CURSOR: false
QUALITY_REVIEW_STATUS: PENDING_CHATGPT_MANUAL_REVIEW
PRODUCTION_PROMPT_CHANGED: false
  (generic Muse candidate added; V1 not registered; V2 not wired; default routing still Qwen)
MAIN_MERGED: false
RAILWAY_DEPLOYED: false
LIVE_CALLS_NOT_RUN: true
```

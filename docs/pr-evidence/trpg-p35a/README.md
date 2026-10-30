# TRPG P3-5A — sealed summary prompt budget (public evidence)

Synthetic fixtures only. No scenario lore, personas, or GM narrations.

## Bug

When combined sealed summaries exceeded `TRPG_SEALED_PROMPT_MAX_CHARS` (2500), `clipTrpgChars` kept the **oldest** text. Newer round summaries disappeared from `[SEALED CAMPAIGN SUMMARY]`.

## Fix (owner: `src/lib/trpg/memory.ts`)

- `formatSealedSummariesForPrompt`: keep a **contiguous suffix** from the newest sealed summary backward; stop when the next older segment no longer fits (no skipping a long middle to add a shorter older line); output remains chronological.
- `loadSealedSummaries` / `persistRoundSummary` / `trpg_campaign_memories.recent_summary` use the same policy.
- `trpg_round_summaries` rows are unchanged (no migration).

## Regression (deterministic)

See `src/lib/trpg/memorySealedPrompt.test.ts`.

Example synthetic case (20 segments × ~200 chars, budget 2500):

| Policy | Includes `SYN_R0_` | Includes `SYN_R19_` | Output chars |
|--------|-------------------|---------------------|--------------|
| Legacy head-clip | yes | no | 2500 |
| Newest-first segments | no | yes | ≤ 2500 |

## Input token impact

This change only affects the sealed-summary substring inside the GM memory block. For campaigns under the budget, text is unchanged. Over-budget campaigns swap dropped **oldest** sealed lines for **newest** lines at similar character count (no budget increase).

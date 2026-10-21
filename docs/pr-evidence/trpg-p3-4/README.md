# TRPG P3-4 public evidence (PR #1704)

This folder intentionally excludes private scenario lore, GM-only world text, player personas, sealed campaign summaries, and full GM narrations.

## Public files

- [`director-contract-snippets.md`](director-contract-snippets.md) — baseline vs treatment `[DIRECTOR DELTA CONTRACT]` wire text only
- [`ab-metrics-public.json`](ab-metrics-public.json) — same-wire replay and forward-chain **metrics** (tokens, USD, `storyPhase`, thread counts, narration length)
- [`server-state-anonymized.md`](server-state-anonymized.md) — round-indexed phase progression table (no location/quest strings)

## Provenance

- Metrics were derived from the P3-4 A/B runs recorded at commit `c4fe54eb` (fixture TRPG tree `94639d6e`, private template-4 exploration harness).
- Commit `c2e802cd` initially added full GM inputs and narrations here; a follow-up commit removes them from the branch tip. **Deleting files does not erase git history** — see PR discussion for exposure scope.

## Not included (private / out of scope for public repo)

- Full final user inputs, `[WORLD]` / `[SCENARIO PLAN]` blocks, `[PLAYER PERSONA]`, `[SEALED CAMPAIGN SUMMARY]`, `[RECENT ROUNDS — RAW]`
- Event-density or literary quality scoring (GPT review only)

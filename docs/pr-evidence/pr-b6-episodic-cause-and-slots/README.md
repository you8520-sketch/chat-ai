# B6 evidence: past-event cause preservation and repeated-record slots

Provider-free, synthetic fixtures only (0 paid calls, no production DB access).
Baseline = `main` `8b93bbc3`; PR = this branch.

## Probes

- `injury-history-probe.mts`: T30 wolf bite, T80 treated and recovered. Horizons 200/500/1000, four questions, three row shapes (verified `injury`, verified `action`, legacy without source). Prints the failing stage per row: `INJECTED#rank`, `CANDIDATE_MISS`, `RECONCILED_OUT`, `DROPPED`.
- `repeated-record-probe.mts`: 1000-turn chat with same-source duplicates (A), identical gloss without source (B), real repeats from different source messages (C), plus an old important betrayal (T25) and the #1648 T300 letter.

## Logs (`logs/`)

- `injury-{base,pr}-stages.log`, `injury-{base,pr}.json`: B6-1 stage tables.
- `wire-injury-before-after.txt`: injected memory lines before and after.
- `repeated-{base,pr}-stages.log`, `repeated-{base,pr}.json`: B6-2 slot tables.
- `latency-{base,pr}.log`: #1648 latency probe at 1,332 and 5,332 rows.
- `b5-probe-{base,pr}.stages.log`: #1648 old-event probe, stages identical.

## Conclusions

- B6-1 ROOT_CAUSE_FIXED. Failure stage: reconcile (`reconcileGlobalStateLikeFacts` replaced a state-like T30 row by the latest row of the same logical key, which was the T80 completed row) and, secondarily, `resolveLatestFactsByLogicalKey`. Question 3 also had a lexical miss on the verb ending (`회복했어`).
- B6-2 INTENTIONAL_BEHAVIOR. Type A is already removed by `duplicate_same_evidence`. B and C cannot be proven identical without regex, similarity or LLM, so they are preserved.

## Known limits

- Legacy rows without a verified source and `CHARACTER_CLAIM` rows keep latest-wins (T30 stays reconciled out). No cause is invented for them.
- If the closing completed row is neither a candidate nor the fetched latest row of the key, the old row is still replaced.
- With more real repeats than the 8 fact slots, the oldest repeats can fall out and the block carries no repeat count.

# B63-R1 — memory comparison corrections (analysis only)

Status: **analysis-only Draft. No runtime code changes. No paid calls. No RP model calls.**

This document corrects the B63 100-turn A/B/C/D report. The full evidence, reconstructed
final messages, 24-response audit, cadence audit, and integrity manifests are in the
private evidence PR:

- https://github.com/you8520-sketch/hav-rp-evidence-private/pull/52
- Path: `cases/elin/results/B63-simple-memory-window/R1/`
- Evidence head at R1 submission: `5ac5113d9c61aa2701ac61b9098b77a0dd2e3341`
- Original evidence head reviewed by GPT: `2bb5a7fbba1636f604bed7c80ed1add93bc65e1e`

## What was wrong

1. **A was a controlled fixture, not a production baseline.** Every arm received the
   unmerged B62 T80 prompt block and a manual relationship ledger. T80 therefore does
   not isolate summary architecture.
2. **The 8/8 score was a keyword predicate, not grounded recall.** The checker accepted
   T71 with only `{"instruction":"감시","promise":"","kept":"yes"}`, accepted generic T50
   ownership wording, and the T20 question itself supplied the quote and binary choices.
3. **B had no past retrieval.** Its recent and old summaries competed inside the existing
   10,000-character Global projection. The test measured eviction, not the requested
   “recent 20-turn detail + older retrieval” structure.
4. **B/C had a T95–96 gap.** B covered summaries T56–94 and RAW T97–100. C requested
   RAW T95–100 but the 10k history budget trimmed the final wire to T97–100.
5. **Per-turn summaries were generated from 5-turn batch input.** This is record
   granularity, not causal per-turn extraction; later turns were visible.
6. **The original per-call JSON did not save the final history array.** R1 reconstructed
   it provider-free and verified systemPrompt byte-equality plus history count/chars.

## Reconstructed final inputs

| arm | RAW final | summary coverage | detail | past retrieval | missing turns | duplicate turns |
|---|---|---|---|---|---|---|
| A | T97–100 | T1–100 (5-turn ×20) | none | none | none | summary T96–100 partially overlaps RAW T97–100 |
| B | T97–100 | T56–94 | none | none | **T95–96** | none |
| C | T97–100 (requested T95–100) | T56–94 | none | none | **T95–96** | none |
| D | T97–100 | T1–100 + detail T75–94 | T75–94 | none | none | **T76–94** duplicated (Global + detail) |

Reconstruction verification: A/B/C/D systemPrompt byte-equal; historyMessages 9/9;
historyChars 40,431/40,431.

## Audit result (24 responses)

A/B/D × 8 structured questions. “Grounded” means the answer fact is present in the
identified input span; a correct answer without evidence is not counted as recall.

| arm | summary-grounded | partial/misaligned | B62 common | RAW | abstention | no-evidence correct |
|---|---:|---:|---:|---:|---:|---:|
| A | 3 (T20/T50/T60) | 1 (T71) | 1 (T80) | 2 (T99/T100) | 1 (T120) | 0 |
| B | 2 (T60/T71) | 0 | 1 (T80) | 2 (T99/T100) | 1 (T120) | 2 (T20/T50) |
| D | 3 (T20/T50/T60) | 1 (T71) | 1 (T80) | 2 (T99/T100) | 1 (T120) | 0 |

Key findings:

- **T71**: A/D rely on the `[66~70]` summary, which contains the T71 instruction
  (future-information leakage). B’s T71 is grounded in per-turn `[71]`/`[72]`.
- **T50**: A/D have the specific T50 desire in `[46~50]`; B has only generic ownership
  wording and no T50 span.
- **T80**: all arms answer from the B62 common injection, so this question is not
  architecture-sensitive.
- **T99/T100**: all arms answer from RAW T97–100.
- **T120**: all arms abstain; this is correct refusal, not recall success.

## Cadence findings

- A `[66~70]` summary contains the T71 instruction (source `messages.jsonl` T71
  assistant, line 142). This is a block misalignment / future-information leak.
- B per-turn summaries were generated from 5-turn batches; B73/B74 contain later-turn
  information (“다음 날 …”). Manual samples, not a full 24-summary audit.
- The 40-turn Ren/Nine reference is a summary-only reference for a different RP, not
  the Elin 100-turn dialogue and not an answer key.
- The 24-turn detail experiment does not establish a 100-turn per-turn structure.

## Next paid comparison (design only, not executed)

Stratify by distance (RAW / recent summary / older) × question type (explicit recall /
implicit cue / no-recall control), 18 items × 2 arms + 2 RP continuations = 38 calls.
Same RAW and same memory-token budget; pre-register grounded-recall, unnecessary
injection, false-answer, and token-delta criteria. Estimated $0.4–$0.8. No 500/1,000-turn
history is fabricated from the 100-turn source. Full design:
`docs/b63-r1/next-comparison-design.md`.

## What this PR does not do

- No runtime prompt, DB, scorer, or owner change.
- No memory-solved claim.
- No paid RP revalidation.
- No 500/1,000-turn claim.

## Files

- `docs/b63-r1/owner-map.md` — current owner map plus R1 verified details
- `docs/b63-r1/next-comparison-design.md` — stratified design and pre-registered criteria
- `docs/b63-r1/README.md` — this correction summary

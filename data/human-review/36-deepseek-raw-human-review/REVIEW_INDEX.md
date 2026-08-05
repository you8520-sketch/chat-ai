# Review index

Human raw review packet for PR #242 / #243 DeepSeek dense-internal outputs.

## Hold verdicts (mandatory until review)

```text
NPC quality: UNVERIFIED_BY_HUMAN_RAW_REVIEW
dialogue quality: UNVERIFIED_BY_HUMAN_RAW_REVIEW
prose quality: UNVERIFIED_BY_HUMAN_RAW_REVIEW
reaction quality: UNVERIFIED_BY_HUMAN_RAW_REVIEW
gesture quality: UNVERIFIED_BY_HUMAN_RAW_REVIEW
```

Automatic metrics are reference-only.

## Attempt table

| attempt_id | slug | phase | run/turn | chat | round | status | raw | finish |
|---|---|---|---|---|---|---|---|---|
| S242-01 | screening-attempt1-turn1 | screening_pr242 | 1/1 | 643 | original | screening_first_attempt_completed_turn | 3783 | 'stop' |
| S242-02 | screening-attempt1-turn2-capture-incomplete | screening_pr242 | 1/2 | 643 | original | capture_incomplete_timeout | 0 | None |
| S242-03 | screening-valid-run1-turn1 | screening_pr242 | 1/1 | 644 | replacement_rescreen | valid | 2650 | 'stop' |
| S242-04 | screening-valid-run1-turn2 | screening_pr242 | 1/2 | 644 | replacement_rescreen | valid | 3621 | 'stop' |
| S242-05 | screening-valid-run2-turn1 | screening_pr242 | 2/1 | 645 | replacement_rescreen | valid | 2986 | 'stop' |
| S242-06 | screening-valid-run2-turn2 | screening_pr242 | 2/2 | 645 | replacement_rescreen | valid | 3100 | 'stop' |
| C243-01 | confirm-original-run1-turn1 | confirmation_pr243 | 1/1 | 646 | original | valid | 1610 | 'stop' |
| C243-02 | confirm-original-run1-turn2 | confirmation_pr243 | 1/2 | 646 | original | valid | 2802 | 'stop' |
| C243-03 | confirm-original-run2-turn1 | confirmation_pr243 | 2/1 | 647 | original | valid | 3333 | 'stop' |
| C243-04 | confirm-original-run2-turn2 | confirmation_pr243 | 2/2 | 647 | original | valid | 6017 | 'stop' |
| C243-05 | confirm-original-run3-turn1 | confirmation_pr243 | 3/1 | 648 | original | original_turn_ok_chat_later_truncated | 3189 | 'stop' |
| C243-06 | confirm-original-run3-turn2-truncation | confirmation_pr243 | 3/2 | 648 | original | truncation | 1347 | None |
| C243-07 | confirm-replacement1-run1-turn1 | confirmation_pr243 | 1/1 | 649 | replacement_round_1 | replacement_turn_ok_chat_later_truncated | 2728 | 'stop' |
| C243-08 | confirm-replacement1-run1-turn2-truncation | confirmation_pr243 | 1/2 | 649 | replacement_round_1 | truncation | 99 | None |
| C243-09 | confirm-replacement2-run1-turn1 | confirmation_pr243 | 1/1 | 650 | replacement_round_2 | valid | 3420 | 'stop' |
| C243-10 | confirm-replacement2-run1-turn2 | confirmation_pr243 | 1/2 | 650 | replacement_round_2 | valid | 2585 | 'stop' |

## Files

- `RAW_OUTPUTS_FULL.md` — full user + provider_raw + SSE + DB
- `RAW_OUTPUTS_FULL.json` — same structured
- `RAW_DB_SSE_PARITY.json` — parity matrix
- `BLIND_VALID_OUTPUTS.md` — shuffled valid-only blind review
- `_HIDDEN_OUTPUT_MAP.json` — blind label → attempt map (do not show to blind reviewer)

## Counts

- total attempts exported: 16
- valid outputs: 10
- truncation outputs: 2
- capture-incomplete: 1
- replacement outputs (round>0): 8
- RAW/SSE/DB mismatches: 1

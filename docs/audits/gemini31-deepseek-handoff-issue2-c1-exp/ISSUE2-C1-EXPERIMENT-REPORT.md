# Issue 2 — C1 terminal dialogue budget experiment report

**STOP for human/ChatGPT review.**

## Single change (frozen harness only)

Replaced terminal dialogue budget **line 2** only. Production `renderTerminalDialogueBudgetOwner()` unchanged.
Original accepted handoff owner unchanged.

## Metrics

| Metric | C1 experiment |
|---|---:|
| visible_chars | 1995 |
| paragraph_count | 19 |
| dialogue_blocks | 9 |
| dialogue_ratio | 0.474 |
| finish_reason | stop |
| requested_progression_completed | false |
| redundant_confirmation_candidate | true |
| turn_ending_user_checkpoint_candidate | false |
| user_preemption_candidate | false |
| user_agency_consistency_candidate | true |
| repetition_candidate | false |
| canon_contradiction_candidate | false |

## SHAs

- frozen_base_request_sha: `e558990d8eeff541176046d568b163f2a146a34068ed72145ce5251acbd3b11d`
- experimental_request_sha: `413280a28b99496b352c7ecb6b91c8c00f7eac53c8fe7f6911a86c457672888e`
- raw_sha: `17a0fca46a7a334bbf5bf14b81b93dc118efa3d2727238287f9b9c6d439fc06a`

## Baseline comparison (Phase-1 B2, original terminal line 2)

| Metric | Run 1 | Run 2 | #609 handoff exp | C1 |
|---|---:|---:|---:|---:|
| visible_chars | 1701 | 2346 | 2569 | 1995 |
| dialogue_blocks | 8 | 10 | 14 | 9 |
| requested_progression | no | yes | no | no |
| redundant_confirmation | — | — | yes | yes |
| turn_ending_checkpoint | yes | yes | yes | no |

## Interpretation (do not implement)

C1 isolation changed **only** terminal dialogue line 2 in the frozen harness. Production code untouched.

### vs acceptance criteria

| Signal | Phase-1 / #609 baseline | C1 | Material change? |
|---|---|---|---|
| `turn_ending_user_checkpoint_candidate` | yes (run1/run2/#609 all end on user-directed hook) | **no** | **Yes — turn no longer ends on checkpoint question** |
| `redundant_confirmation_candidate` | yes (#609; run1 ends on “갈 거지?” while proceeding) | **yes** | **No — mid-scene confirmation dialogue remains** (“끝까지?”, “어때, 여기?”) |
| `requested_progression_completed` | mixed (run2 yes, run1/#609 no) | **no** | **No — orgasm/destination not reached** |

### Conclusion (preliminary, human review required)

- **Partial C1 signal:** Turn-ending user checkpoint **improved** (yes → no). Output ends on continued action (“끝까지 버텨”) rather than a final consent/question hook (“괜찮아?”, “갈 거지?”).
- **Not sufficient alone:** `redundant_confirmation_candidate` **still true**; `requested_progression_completed` **still false**.
- **Separate issues remain:** dialogue_blocks **9 > 4** (compliance); visible_chars **1995 < 3200** (length compliance); possible **C2 / 티키타카** contribution to mid-scene dialogue.

**Do not modify production `renderTerminalDialogueBudgetOwner()` yet.**  
**Do not proceed automatically to C2.** STOP for human/ChatGPT review.

## Artifacts

- `requests/B-DEEPSEEK-input-c1.json`
- `raw/B-DEEPSEEK-C1-RAW.txt`
- `raw/B-DEEPSEEK-C1-WIRE.txt`
- `meta/B-DEEPSEEK-C1-provider.json`
- `scripts/repro-b2-c1-once.mjs`

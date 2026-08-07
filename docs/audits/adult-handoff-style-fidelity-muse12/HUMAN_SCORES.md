# HUMAN_SCORES — Blind ChatGPT Review (pre-reveal)

```text
reviewer: ChatGPT
hidden_map_opened_at_scoring: NO
HUMAN_SCORES_SEALED_BEFORE_MAP_REVEAL = true
HUMAN_SCORES_SHA256 = 2f15d973693824f18c6f91848119b703a97e034abae646c1045dc5f58e3038f0
HIDDEN_MAP_SEAL_VERIFIED = true
comparison_unit: PRODUCTION_CONFIG_BUNDLE_COMPARISON
private_artifact: data/human-review/adult-handoff-style-fidelity-muse12/ADULT_HANDOFF_BLIND_HUMAN_SCORES_CHATGPT.json
```

Private raw scores are gitignored. This page publishes aggregates and blind X/Y results only.

## Blind winners

| Source | Formal human-approved anchor | Blind winner |
|---|---|---|
| Opus 5 (Arm E) | YES | **X** |
| GPT-5.6 Terra | YES | **Y** |
| Gemini 3.1 Pro | NO | **X** |

```text
raw pair wins: X = 2, Y = 1
human-approved-only wins: X = 1, Y = 1
```

## Dimension scores (blind labels)

MODEL_SWITCH_NOTICEABILITY is 0–4 (lower better). Other dimensions are 1–5.

### Opus — Winner X

| Dimension | X | Y |
|---|---:|---:|
| Source Style Continuity | 4.7 | 3.8 |
| MODEL_SWITCH_NOTICEABILITY | 0.8 | 2.0 |
| SAME_AUTHOR_ILLUSION | 4.6 | 3.4 |
| Sentence/Paragraph Rhythm | 4.7 | 4.0 |
| Character Voice / Honorific | 4.6 | 3.8 |
| Narration/Dialogue Balance | 4.6 | 4.0 |
| Scene Continuity | 4.6 | 4.5 |
| User Agency | 4.3 | 4.2 |

### Terra — Winner Y

| Dimension | X | Y |
|---|---:|---:|
| Source Style Continuity | 2.8 | 4.7 |
| MODEL_SWITCH_NOTICEABILITY | 3.2 | 0.8 |
| SAME_AUTHOR_ILLUSION | 2.5 | 4.7 |
| Sentence/Paragraph Rhythm | 3.3 | 4.6 |
| Character Voice / Honorific | 3.0 | 4.7 |
| Narration/Dialogue Balance | 2.4 | 4.8 |
| Scene Continuity | 2.3 | 4.8 |
| User Agency | 1.3 | 3.4 |

Terra is **not** a near-tie.

### Gemini — Winner X

| Dimension | X | Y |
|---|---:|---:|
| Source Style Continuity | 4.5 | 3.7 |
| MODEL_SWITCH_NOTICEABILITY | 1.1 | 2.3 |
| SAME_AUTHOR_ILLUSION | 4.4 | 3.3 |
| Sentence/Paragraph Rhythm | 4.4 | 3.6 |
| Character Voice / Honorific | 4.8 | 3.5 |
| Narration/Dialogue Balance | 4.5 | 3.8 |
| Scene Continuity | 4.6 | 4.3 |
| User Agency | 4.2 | 3.9 |

Gemini formal human PASS anchor = NO (limitation retained).

## Provisional verdict (recorded before map reveal)

```text
MIXED_PRODUCTION_HANDOFF_RESULT
NO_REPLACEMENT
```

## Common finding (not used for A/B winner)

```text
COMMON_HANDOFF_SUBJECT_OBJECT_INVERSION_RISK
```

Adult entry waist-wrap fixture was often inverted (character→user contact misread as user→character). Observed across candidates; does not decide winner. Fixture/prompt not changed in this step.

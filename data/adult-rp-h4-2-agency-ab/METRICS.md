# H4.2 deterministic metrics

All assistant numbers are computed from `raw/control-r*.txt` and `raw/strict-r*.txt`. They are not estimates.

Character-count definitions match H4.1:

- `CHARS_WITH_WHITESPACE` = Unicode code-point length, including spaces and newlines. Python/JS `len()` for this BMP Hangul text.
- `CHARS_WITHOUT_WHITESPACE` = same string after removing Unicode whitespace (`\s`).
- `RAW_BYTES_UTF8` = UTF-8 byte length. Hangul is 3 bytes.

Length is **observation only**. This packet does not tune RP length.

## Counting algorithm

Same rules as H4.1 `data/adult-rp-h4-chat736/METRICS.md`.

### Paragraphs

Split on `\n\s*\n`. Drop empty parts.

### Sentences

Split each paragraph on `(?<=[.!?。！？])\s+`. A leftover fragment with no terminal punctuation is one sentence.

`UNIQUE_SENTENCE_RATIO` = unique exact sentence strings / sentence count.

### Dialogue / narration

1. Strip the paragraph.
2. Whole-paragraph `^[\"“「『].+[\"”」』](?:[.!?…⋯。！？]*)?$` → dialogue.
3. Else find inline quoted spans. Quoted lengths → dialogue; remainder → narration.
4. No quotes → narration.

`DIALOGUE_CHAR_RATIO` = dialogue_chars / (dialogue + narration + ambiguous).

### N-grams

Tokenize `[가-힣A-Za-z0-9]+`. Build 3/4/5-token windows. Drop windows that are only stopwords or length-1 tokens. Within-sample “top repeated” lists require count ≥ 2.

## Shared Turn C user input

| Metric | Value |
|---|---|
| Exact text | `*잠시 숨을 고르고 얼굴을 바라본다.* 괜찮아? 너무 빨랐으면 말해.` |
| RAW_BYTES_UTF8 | 88 |
| CHARS_WITH_WHITESPACE | 38 |
| CHARS_WITHOUT_WHITESPACE | 30 |
| SHA-256 | `68aef6988882172656b84269d727424fcd87660b14c16abee9da2913cc609eae` |

This hash matches H4.1 `raw/turn-c-user.txt`.

## Assistant length / shape

| Metric | C-r1 | C-r2 | C-r3 | S-r1 | S-r2 | S-r3 |
|---|---:|---:|---:|---:|---:|---:|
| RAW_BYTES_UTF8 | 13616 | 11419 | 8422 | 10470 | 7321 | 12388 |
| CHARS_WITH_WHITESPACE | 5740 | 4727 | 3616 | 4396 | 3071 | 5146 |
| CHARS_WITHOUT_WHITESPACE | 4373 | 3589 | 2761 | 3335 | 2314 | 3881 |
| HANGUL_SYLLABLE_COUNT | 3932 | 3226 | 2434 | 2998 | 2064 | 3506 |
| LINE_COUNT | 69 | 39 | 73 | 45 | 33 | 31 |
| NONEMPTY_LINE_COUNT | 35 | 20 | 37 | 23 | 17 | 16 |
| PARAGRAPH_COUNT | 35 | 20 | 37 | 23 | 17 | 16 |
| SENTENCE_COUNT | 116 | 79 | 106 | 87 | 60 | 83 |
| UNIQUE_SENTENCE_RATIO | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 |
| EXACT_SENTENCE_REPEATS | 0 | 0 | 0 | 0 | 0 | 0 |
| DIALOGUE_BLOCK_COUNT | 9 | 4 | 14 | 6 | 3 | 5 |
| DIALOGUE_CHAR_COUNT | 139 | 78 | 115 | 145 | 42 | 139 |
| NARRATION_CHAR_COUNT | 5532 | 4614 | 3456 | 4207 | 2997 | 4972 |
| DIALOGUE_CHAR_RATIO | 0.0245 | 0.0166 | 0.0322 | 0.0333 | 0.0138 | 0.0272 |
| NARRATION_CHAR_RATIO | 0.9755 | 0.9834 | 0.9678 | 0.9667 | 0.9862 | 0.9728 |
| SHA-256 prefix | `6e5587530fd6` | `c478e22e0d70` | `20a67bd696e2` | `439b65fb9af2` | `dd264b5b4be1` | `8d12e711366c` |

Medians (`CHARS_WITH_WHITESPACE`): CONTROL `4727`, STRICT `4396`.

H4.1 production Turn C reference: `5274` / `4031` / 20 paragraphs. Replay CONTROL spans both sides of that length. STRICT-r3 (`5146`) shows that a PASS agency sample can still be ~5k.

## Provider metadata

| Sample | HTTP | Seconds | Prompt tok | Completion tok | Reasoning tok | Cost USD | Refusal |
|---|---:|---:|---:|---:|---:|---:|---|
| control-r1 | 200 | 105.521 | 9149 | 9490 | 5610 | 0.1233772 | no |
| control-r2 | 200 | 108.953 | 9149 | 9671 | 6519 | 0.1232332 | no |
| control-r3 | 200 | 46.077 | 9149 | 2434 | 0 | 0.0363892 | no |
| strict-r1 | 200 | 94.295 | 9329 | 8149 | 5316 | 0.1053292 | no |
| strict-r2 | 200 | 70.971 | 9329 | 4997 | 3022 | 0.0698212 | no |
| strict-r3 | 200 | 114.355 | 9329 | 10916 | 7566 | 0.1385332 | no |

Model sent and provider model are `google/gemini-3.1-pro-preview` on every call. Temperature `0.95`. Reasoning `{effort:low}`. `max_tokens` unset (production Gemini Pro path). DeepSeek calls: `0`. Retries: `0`.

STRICT prompt tokens are `+180` versus CONTROL (`9329` vs `9149`). That matches the larger absolute-lock wrapper, not a history or memory change.

## Agency cluster scores

Human-scored. Definitions in `REPORT.md`.

| Sample | CLUSTER_1_RESUME | CLUSTER_2_ESCALATE | CLUSTER_3_CONSENT_PACE | ENDING_FUNCTION |
|---|---|---|---|---|
| control-r1 | FAIL | FAIL | FAIL | MODEL_AUTHORED_USER_CONTINUATION |
| control-r2 | FAIL | FAIL | FAIL | MODEL_AUTHORED_USER_CONTINUATION |
| control-r3 | FAIL | FAIL | FAIL | MODEL_AUTHORED_USER_CONTINUATION |
| strict-r1 | PASS | PASS | PASS | CHARACTER_PROPOSITION |
| strict-r2 | PASS | PASS | PASS | USER_REACTION_POINT |
| strict-r3 | PASS | PASS | PASS | CHARACTER_PROPOSITION |

| Arm | C1 fails | C2 fails | C3 fails | Active [A] |
|---|---:|---:|---:|---|
| CONTROL | 3 | 3 | 3 | PASS |
| STRICT | 0 | 0 | 0 | PASS |

## Within-sample repeated ngrams

No sample produced a repeated 3/4/5-gram at count ≥ 2 after stopword filtering. Exact-sentence repetition is also empty. Repetition evidence in this packet is therefore motif-level (name leak `H4Mina062138`, darkness / breath / mattress / check-in restatement), not duplicate sentences.

## Cross-arm shared 5-grams

Present in at least one CONTROL sample and one STRICT sample. Ranked by `min(control, strict)`. These are mostly identity/scene tokens, not a CONTROL-only escalation motif.

See `metrics.json` → `shared_5grams_control_and_strict_top`.

## Inspect delta

From `harness-inspect.json`:

| Field | CONTROL | STRICT |
|---|---|---|
| lastUserChars | 855 | 1626 |
| lastUserHasLock | false | true |
| lastUserHasCollaborativeWrapper | true | false |
| lastUserHasPastAssistantRule | false | true |
| systemHasStandardOwner | true | true |
| systemHasGemini31Supplement | true | true |
| systemHasDelegatedOwner | false | false |
| runtimeMode | interactive | interactive |
| estimatedInputTokens | 14248 | 14942 |

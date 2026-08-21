# H4.3 NARROW metrics

Counting rules match H4.1 / H4.2. Length is observation only. Do not judge H4.3 PASS/FAIL from length.

## Shared Turn C user input

| Metric | Value |
|---|---|
| Exact text | `*잠시 숨을 고르고 얼굴을 바라본다.* 괜찮아? 너무 빨랐으면 말해.` |
| RAW_BYTES_UTF8 | 88 |
| CHARS_WITH_WHITESPACE | 38 |
| CHARS_WITHOUT_WHITESPACE | 30 |
| SHA-256 | `68aef6988882172656b84269d727424fcd87660b14c16abee9da2913cc609eae` |

Matches H4.1 `raw/turn-c-user.txt` and H4.2 `raw/user-c.txt`.

## Assistant length / shape

| Metric | r1 | r2 | r3 |
|---|---:|---:|---:|
| RAW_BYTES_UTF8 | 6136 | 10505 | 7830 |
| CHARS_WITH_WHITESPACE | 2590 | 4417 | 3318 |
| CHARS_WITHOUT_WHITESPACE | 1962 | 3358 | 2503 |
| HANGUL_SYLLABLE_COUNT | 1770 | 3043 | 2246 |
| PARAGRAPH_COUNT | 17 | 26 | 24 |
| SENTENCE_COUNT | 58 | 91 | 67 |
| DIALOGUE_BLOCK_COUNT | 5 | 7 | 5 |
| DIALOGUE_CHAR_RATIO | 0.0579 | 0.0394 | 0.0371 |
| NARRATION_CHAR_RATIO | 0.9421 | 0.9606 | 0.9629 |
| SHA-256 | `9a9c45060c74f75a…` | `e9fde4fe22025102…` | `c73b675707ee21e1…` |

Median `CHARS_WITH_WHITESPACE`: `3318`.

H4.2 CONTROL median was `4727`. H4.2 STRICT median was `4396`. Do not treat the drop as a length fix.

## Provider metadata

| Sample | HTTP | Seconds | Prompt tok | Completion tok | Reasoning tok | Cost USD | Refusal |
|---|---:|---:|---:|---:|---:|---:|---|
| narrow-r1 | 200 | 84.473 | 9206 | 5851 | 4156 | 0.0798232 | no |
| narrow-r2 | 200 | 113.7 | 9206 | see `metrics.json` | see `metrics.json` | see `metrics.json` | no |
| narrow-r3 | 200 | 73.7 | 9206 | see `metrics.json` | see `metrics.json` | see `metrics.json` | no |

Model: `google/gemini-3.1-pro-preview`. Temperature `0.95`. Reasoning `{effort:low}`. DeepSeek 0. Retries 0.

H4.2 CONTROL prompt tokens were `9149`. NARROW is `9206` (`+57`). That is the added boundary sentence, not a history/memory change.

## Cluster scores

| Sample | C1 | C2 | C3 | ENDING_FUNCTION |
|---|---|---|---|---|
| narrow-r1 | PASS | PASS | PASS | CHARACTER_PROPOSITION |
| narrow-r2 | PASS | PASS | PASS | CHARACTER_PROPOSITION |
| narrow-r3 | FAIL | FAIL | FAIL | MODEL_AUTHORED_USER_CONTINUATION |

Fails: C1=1, C2=1, C3=1.

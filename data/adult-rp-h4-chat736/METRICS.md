# H4.1 deterministic metrics — chat 736

All numbers below are computed from the frozen `raw/turn-*-assistant.txt` strings. They are not estimates.

Character-count definitions are **not** interchangeable:

- `CHARS_WITH_WHITESPACE` / `KOREAN_DISPLAY_CHARS_WITH_WHITESPACE` = Unicode code-point length of the frozen string, including spaces and newlines. This matches the H4 SSE `chars` field and Python/JS `len()` for this BMP Hangul text.
- `CHARS_WITHOUT_WHITESPACE` = same string after removing Unicode whitespace (`\s`).
- `RAW_BYTES_UTF8` = UTF-8 byte length. Larger than display chars because Hangul is 3 bytes.

When comparing to RP length targets, this packet uses `CHARS_WITH_WHITESPACE` unless a sentence explicitly names another definition.

## Counting algorithm

### Paragraphs

Split on `\n\s*\n`. Drop empty parts. This matches the blank-line paragraphing in the Gemini outputs.

Paragraph IDs: `A-P01` … in that order. IDs are labels only; paragraph bodies are unmodified.

### Sentences

Split each paragraph on `(?<=[.!?。！？])\s+`. A leftover fragment with no terminal punctuation is kept as one sentence. Isolated quote-only paragraphs are split the same way (so `"빠르지 않아. 오히려……"` can be more than one sentence).

`UNIQUE_SENTENCE_RATIO` = unique exact sentence strings / sentence count. Exact-string repeats only; near-paraphrase is **not** counted here.

### Hangul syllables

Count of code points in `\uAC00-\uD7A3`.

### Lines

`LINE_COUNT` = `text.split("\n")` length (a string with no trailing newline still has N lines if it contains N-1 `\n`).
`NONEMPTY_LINE_COUNT` = lines whose `strip()` is non-empty.

### Dialogue / narration parser

Heuristic, documented so it can be challenged:

1. Strip the paragraph.
2. If the whole paragraph matches `^[\"“「『].+[\"”」』](?:[.!?…⋯。！？]*)?$` → **dialogue**.
3. Else find inline quoted spans `["“「『] … ["”」』]`.
   - If quotes exist and non-quoted remainder is non-empty → **mixed**. Quoted span lengths go to `DIALOGUE_CHAR_COUNT`; the rest of the paragraph goes to `NARRATION_CHAR_COUNT`. Each inline span counts as one dialogue block.
   - If quotes exist and remainder is empty → **dialogue**.
   - If no quotes → **narration**.
4. Anything the heuristic cannot classify would be **ambiguous** and counted in `AMBIGUOUS_DIALOGUE_CHARS`. These four outputs produced **0** ambiguous chars.

This parser treats a quote-only line such as `"알았어."` as dialogue. Narration that *describes* speech without quotes (example: C-P02 `너무 빨랐으면 말하라는 낮고 차분한 음성이`) is narration, not a dialogue block.

`DIALOGUE_CHAR_RATIO` = dialogue_chars / (dialogue + narration + ambiguous).
`NARRATION_CHAR_RATIO` = narration_chars / same denominator.

### N-grams

1. Tokenize with `[가-힣A-Za-z0-9]+`.
2. Build contiguous 3/4/5-token windows.
3. Drop windows that are only stopwords or length-1 tokens (`그의`, `그리고`, `다시`, `것`, …).
4. Within-turn “top repeated” lists include ngrams with count ≥ 2.
5. C↔D shared lists include any ngram present in both turns (count ≥ 1 each), ranked by `min(count_c, count_d)`.

Exact-sentence repetition is empty in all four turns. Repetition evidence is therefore ngram + human motif, not duplicate sentences.

## Assistant length / shape

| Metric | A | B | C | D |
|---|---:|---:|---:|---:|
| RAW_BYTES_UTF8 | 2715 | 6132 | 12478 | 12085 |
| CHARS_WITH_WHITESPACE | 1173 | 2626 | 5274 | 5105 |
| CHARS_WITHOUT_WHITESPACE | 898 | 1995 | 4031 | 3911 |
| HANGUL_SYLLABLE_COUNT | 771 | 1752 | 3595 | 3470 |
| LINE_COUNT | 19 | 33 | 39 | 39 |
| NONEMPTY_LINE_COUNT | 10 | 17 | 20 | 20 |
| PARAGRAPH_COUNT | 10 | 17 | 20 | 20 |
| SENTENCE_COUNT | 30 | 60 | 101 | 102 |
| AVERAGE_PARAGRAPH_CHARS | 115.500 | 152.588 | 261.800 | 253.350 |
| MEDIAN_PARAGRAPH_CHARS | 127.5 | 171 | 295.0 | 276.5 |
| MAX_PARAGRAPH_CHARS | 214 | 255 | 471 | 420 |
| MIN_PARAGRAPH_CHARS | 6 | 6 | 5 | 28 |
| DIALOGUE_BLOCK_COUNT | 3 | 4 | 4 | 4 |
| DIALOGUE_CHAR_COUNT | 31 | 39 | 78 | 127 |
| NARRATION_CHAR_COUNT | 1124 | 2555 | 5158 | 4940 |
| AMBIGUOUS_DIALOGUE_CHARS | 0 | 0 | 0 | 0 |
| DIALOGUE_CHAR_RATIO | 0.026840 | 0.015035 | 0.014897 | 0.025064 |
| NARRATION_CHAR_RATIO | 0.973160 | 0.984965 | 0.985103 | 0.974936 |
| DIALOGUE_PARAGRAPHS | 3 | 4 | 4 | 4 |
| NARRATION_PARAGRAPHS | 7 | 13 | 16 | 16 |
| MIXED_PARAGRAPHS | 0 | 0 | 0 | 0 |
| FIRST_PARAGRAPH_TYPE | narration | narration | narration | narration |
| LAST_PARAGRAPH_TYPE | narration | narration | narration | narration |
| UNIQUE_SENTENCE_RATIO | 1.0 | 1.0 | 1.0 | 1.0 |
| REPEATED_EXACT_SENTENCES | 0 | 0 | 0 | 0 |

C and D are 5274 and 5105 **display chars with whitespace**, not “about 5k” as an undefined unit. Without whitespace they are 4031 and 3911.

## Within-turn repeated ngrams (count ≥ 2)

### A / B

None after stopword filter.

### C

| N | Ngram | Count |
|---|---|---:|
| 3 | `H4Mina062138의 두 손이` | 2 |
| 3 | `손끝을 통해 생생하게` | 2 |
| 3 | `통해 생생하게 전해졌다` | 2 |
| 4 | `손끝을 통해 생생하게 전해졌다` | 2 |

### D

| N | Ngram | Count |
|---|---|---:|
| 3 | `H4Mina062138의 몸이 매트리스` | 2 |

## C ↔ D shared ngrams

Exact-sentence overlap: none.

Shared 5-word ngrams (strongest deterministic reuse):

| Ngram | C | D |
|---|---:|---:|
| `H4Mina062138은 눈을 지그시 감은 채` | 1 | 1 |
| `H4Mina062138의 허리가 활처럼 크게 휘어지며` | 1 | 1 |
| `감싸고 있던 손을 천천히 아래로` | 1 | 1 |
| `굳어지는 것이 손끝을 통해 생생하게` | 1 | 1 |
| `뒷목을 감싸고 있던 손을 천천히` | 1 | 1 |
| `빳빳하게 굳어지는 것이 손끝을 통해` | 1 | 1 |
| `허리가 활처럼 크게 휘어지며 침대` | 1 | 1 |

Shared 4-word ngrams include the same stems plus `눈을 지그시 감은 채`, `활처럼 크게 휘어지며 침대`, `있던 손을 천천히 아래로`.

Shared 3-word ngrams also include stock phrases such as `도윤의 단단한 어깨를`, `도윤의 커다란 손이`, `두 사람의 가쁜`, `방 안의 공기가`.

`C_D_REPETITION_EVIDENCE`: **PRESENT** (shared 5-grams + motif recycling). Not exact-sentence duplication.

## User-input lengths (for context only)

| Turn | CHARS_WITH_WHITESPACE | RAW_BYTES_UTF8 |
|---|---:|---:|
| A | 57 | 133 |
| B | 83 | 197 |
| C | 38 | 88 |
| D | 44 | 100 |

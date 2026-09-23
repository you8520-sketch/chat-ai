# 05_STATIC_TESTS

**Runner:** `node --conditions=react-server --import tsx --test src/lib/webnovelOutputFormat.layoutCompact.test.ts`  
**API calls:** 0

## Results

| gate | status |
|---|---|
| L1 semantic paragraph owner under `[OUTPUT LAYOUT]` | PASS |
| L2 sentence-per-paragraph prohibition | PASS |
| L3 intentional single-sentence emphasis | PASS |
| L4 speaker change boundary | PASS |
| L5 time/place transition boundary | PASS |
| L6 dialogue own paragraph | PASS |
| L7 blank line (`\\n\\n`) | PASS |
| L8 narration+dialogue same-line prohibition | PASS |
| L9 mid-utterance narration fragmentation prohibition | PASS |
| L10 user-tail layout echo unchanged / not in candidate | PASS |
| L11 no duplicate `[DIALOGUE & NARRATION]` / `[SEMANTIC PARAGRAPHING]` | PASS |
| L12 no Wrong/Right production example | PASS |
| token reduction ≥ 30% (A=670, B=281 → 58.1%) | PASS |
| OPUS_ARM_E_TERMINAL hash frozen | PASS |
| replace helper swaps only layout block | PASS |

```text
tests = 15
pass = 15
fail = 0
```

## Offline hard gate

See `C1_OFFLINE_GATE.json`:

```text
semantic_parity = PASS
layout_reduction_percent = 58.1
live_ab_allowed = true
```

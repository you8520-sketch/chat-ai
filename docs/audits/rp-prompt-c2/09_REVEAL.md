# 09_REVEAL

Hidden map (`08_HIDDEN_MAP.json`):

| Pair | X | Y |
|------|---|---|
| Gemini_Q | B | A |
| Gemini_D | A | B |
| Gemini_T | B | A |
| DeepSeek_Q | A | B |
| DeepSeek_D | A | B |
| DeepSeek_T | A | B |

Arm meanings:
- **A** = production `PROSE_STYLE_SECTION`
- **B** = `PROSE_STYLE_SECTION_C2_MICRO` (M1+M2 only)

## Mapped human winners

| Pair | A score | B score | Winner |
|------|---------|---------|--------|
| Gemini_Q | 77 | 81 | **B** |
| Gemini_D | 83 | 85 | **B** |
| Gemini_T | 76 | 88 | **B** |
| DeepSeek_Q | 86 | 80 | **A** |
| DeepSeek_D | 83 | 78 | **A** |
| DeepSeek_T | 84 | 80 | **A** |

Tally: **A wins 3 / B wins 3 / ties 0** → `B wins + ties >= A wins` (3 ≥ 3).

## Provider input deltas (prompt_tokens A→B)

| Pair | A input | B input | Δ | A cached | B cached |
|------|---------|---------|---|----------|----------|
| Gemini_Q | 3576 | 3563 | −13 | 0 | 0 |
| Gemini_D | 4611 | 4598 | −13 | 0 | 0 |
| Gemini_T | 3818 | 3809 | −9 | 0 | 0 |
| DeepSeek_Q | 4402 | 4384 | −18 | 0 | 1024 |
| DeepSeek_D | 5702 | 5684 | −18 | 0 | 0 |
| DeepSeek_T | 4655 | 4637 | −18 | 0 | 0 |

Actual provider input saving ≈ **9–18 tokens/pair** (matches tiny est. prose Δ). Cached input not consistently reduced (DeepSeek_Q B showed 1024 cached once — not a stable saving signal).

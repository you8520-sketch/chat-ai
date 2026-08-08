# 10_REVEAL

Sealed map (`09_HIDDEN_MAP.json` / `09_HIDDEN_MAP_cheap.json`):

```json
{
  "Gemini_D": { "X": "A", "Y": "B" },
  "Gemini_N": { "X": "A", "Y": "B" },
  "DeepSeek_D": { "X": "B", "Y": "A" },
  "DeepSeek_N": { "X": "A", "Y": "B" }
}
```

Arm meanings:

- **A** = production `buildWebnovelOutputLayoutRecencyBlock()`
- **B** = `OUTPUT_LAYOUT_SEMANTIC_COMPACT_CANDIDATE`

## Mapped winners

| pair | preferred blind | maps to |
|---|---|---|
| Gemini_D | Y | **B** |
| Gemini_N | X | **A** |
| DeepSeek_D | Y | **A** |
| DeepSeek_N | X | **A** |

```text
A wins = 3
B wins = 1
ties = 0
B wins + ties >= A wins ? NO (1 >= 3)
```

## Cheap gate after reveal

| requirement | result |
|---|---|
| semantic parity offline | PASS |
| layout reduction ≥ 30% | PASS (58.1%) |
| Gemini hard format regression | 0 glued (refined) |
| DeepSeek hard format / completion | **FAIL** — Fixture N Arm B incomplete + user-dialogue echo |
| Gemini quality non-inferior | **FAIL** — Fixture N Arm B materially weaker |
| DeepSeek quality non-inferior | **FAIL** — Fixture N Arm B |
| Stage 2 Opus/Terra | **NOT_RUN** |

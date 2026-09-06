# 07 Model-Specific Prompt Diff

## NORMAL model-specific instruction tokens

| Model | MODEL_SPECIFIC bucket | TERMINAL on user turn | Notes |
|---|---|---|---|
| Opus | 0 | Arm E ≈ 1134 | Largest specialized terminal |
| Gemini | 0 | common length only | Most “free” / least specialized prompt surface |
| DeepSeek | 0 | common length + DS extras if active | XML/style/boundary may appear in system or user |
| Terra | 0 | Terra terminal contract | Length-focused terminal |

## Why Gemini looks freer

Gemini 3.1 Pro path in this fixture: common House Style + collaborative agency + CURRENT USER wrapper + generic length owner. No Arm-E-scale terminal, no DeepSeek XML bundle.

```text
Gemini model-specific instruction tokens ≈ 0
Opus model-specific (+ Arm E user terminal) ≈ 1134
```

## DeepSeek adapters — production vs experimental

| Adapter | Status (code-path audit) | Count in NORMAL tokens? |
|---|---|---|
| DeepSeek XML structure grouping | production path when DS model | YES if present in tracked sections |
| style-only reminder | production when enabled for DS | YES if injected |
| future-instruction boundary | production for DS interactive | YES if injected |
| optional momentum | gate/flag dependent | only if active |
| appearance rules | gate/flag dependent | only if active |
| historical experiment length adapters | default OFF / canary | NO unless active |

Past experiment code existence alone does **not** add production tokens.

## REGEN overhead sections

Typical regen-only additions:

```text
regenerate-divergence base rules
regen attempt line
regen diverge axis
rejected draft compact summary (default) OR full draft (opt-in)
```

Check NORMAL vs REGEN section diffs in MEASUREMENTS.json — other prose/agency/canon sections should remain stable aside from regenerate block insertion.

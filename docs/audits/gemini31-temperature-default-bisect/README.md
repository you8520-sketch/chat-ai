# Gemini 3.1 — temperature default vs legacy 0.95

Investigation only until evidence. Main RP = exactly 1 provider call.

## Exact main

`a8c343fc4b9f3bb1180d628707aa87218e77433b`

## Arms (identical frozen prompt)

| Arm | Model | Temperature |
|---|---|---|
| A | `gemini-3.1-pro-preview` | `0.95` |
| B | `gemini-3.1-pro-preview` | **OMITTED** |
| C | `gemini-3.1-pro` | **OMITTED** + `reasoning_effort=low` |

## Run

```bash
PHASE1_RUNS=5 node --conditions=react-server --import tsx scripts/gemini31-temperature-default-bisect.ts
```

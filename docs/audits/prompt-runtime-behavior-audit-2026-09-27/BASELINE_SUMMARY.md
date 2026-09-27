# MODEL BASELINE — objective annotations only

Cursor does **not** score models. Gemini 3.1 Pro = preservation reference.

| fixture | model | ok | chars | prompt_tok | facial/phys | habit | env | spatial | sensory | dialogue_exchange | inner_markers | abstract_emotion | micro_action |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|
| quiet_intimacy | `deepseek-v4-pro-0813` | True | 600 | 6414 | 5 | 2 | 14 | 3 | 8 | True | 0 | 0 | 0 |
| casual_banter | `deepseek-v4-pro-0813` | True | 1220 | 6308 | 7 | 3 | 12 | 4 | 5 | True | 0 | 1 | 1 |
| tension_action | `deepseek-v4-pro-0813` | True | 1657 | 6386 | 3 | 1 | 21 | 24 | 14 | True | 1 | 0 | 0 |
| quiet_intimacy | `deepseek-v4.1-flash` | True | 2131 | 6415 | 14 | 10 | 38 | 21 | 14 | True | 1 | 2 | 0 |
| casual_banter | `deepseek-v4.1-flash` | True | 1029 | 6309 | 6 | 4 | 12 | 5 | 6 | True | 0 | 0 | 0 |
| tension_action | `deepseek-v4.1-flash` | True | 2121 | 6387 | 7 | 4 | 21 | 19 | 20 | True | 0 | 6 | 0 |
| quiet_intimacy | `gemini-3.1-pro-preview` | True | 3999 | 5493 | 16 | 16 | 46 | 14 | 21 | True | 0 | 10 | 1 |
| casual_banter | `gemini-3.1-pro-preview` | True | 2870 | 5394 | 18 | 11 | 24 | 9 | 18 | True | 1 | 5 | 0 |
| tension_action | `gemini-3.1-pro-preview` | True | 3724 | 5470 | 12 | 9 | 37 | 19 | 33 | True | 0 | 8 | 0 |
| quiet_intimacy | `gemini-3.7-flash` | True | 1390 | 5336 | 6 | 8 | 22 | 7 | 9 | True | 0 | 2 | 1 |
| casual_banter | `gemini-3.7-flash` | True | 2114 | 5237 | 15 | 11 | 36 | 10 | 6 | True | 0 | 1 | 0 |
| tension_action | `gemini-3.7-flash` | True | 1540 | 5313 | 3 | 6 | 18 | 16 | 11 | True | 1 | 1 | 0 |
| quiet_intimacy | `gpt-5.6-terra` | True | 2549 | 5459 | 10 | 8 | 50 | 21 | 25 | True | 0 | 1 | 0 |
| casual_banter | `gpt-5.6-terra` | True | 3547 | 5362 | 12 | 4 | 37 | 14 | 18 | True | 2 | 7 | 2 |
| tension_action | `gpt-5.6-terra` | True | 2803 | 5440 | 10 | 4 | 37 | 30 | 30 | True | 0 | 7 | 0 |
| quiet_intimacy | `claude-opus-5.5` | True | 2532 | 8971 | 10 | 9 | 40 | 18 | 14 | True | 2 | 4 | 0 |
| casual_banter | `claude-opus-5.5` | True | 2870 | 8817 | 11 | 6 | 34 | 8 | 13 | True | 1 | 8 | 0 |
| tension_action | `claude-opus-5.5` | True | 2831 | 8938 | 6 | 3 | 37 | 20 | 24 | True | 1 | 8 | 0 |

## Notes

- Gemini 3.1 Pro uses production `reasoning_effort=low`; visible length varies with reasoning token share. Quiet intimacy was re-captured after an empty first stream.
- Provider `prompt_tokens` (A): DeepSeek ~6.3–6.4k, Gemini/Terra ~5.2–5.5k, Opus ~8.8–9.0k. Local assembled system estimate (C) ~8.0–8.3k. Receipt system row (B) = proportional allocation of A, not C.
- Full raw texts: `baseline/<fixture>/<model>/raw.txt`.

# Past-fact invention triage (automated assist — GPT reads full responses)

**Canonical memory:** stored Global/Episodic for T50 do **not** contain 지환’s last words to 렌 (see `input-precheck.md`).

| Run | Variant | Legacy B10-1 exact quote (`가이드님…감사…`) | Ungrounded last speech as fact | Ungrounded death-moment eyewitness | Wrong past denial | Known comfort facts | Chars | apiRawCostKrw |
|---|---|---|---|---|---|---|---:|---:|
| t50-A-1 | A | no | no | **yes** | no | no | 2213 | 5.9 |
| t50-A-2 | A | no | **yes** | **yes** | no | no | 4534 | 9.7 |
| t50-A-3 | A | no | **yes** (`죄송해요` / `도망쳐요`) | **yes** | no | no | 4403 | 9.5 |
| t50-B-1 | B | no | **yes** | **yes** | no | no | 4132 | 9.3 |
| t50-B-2 | B | no | no | no | no | yes (귤/위로 맥락) | 2816 | 6.5 |
| t50-B-3 | B | no | no | **yes** | no | no | 3569 | 7.9 |

**Symptom reproduction (A):** 3/3 runs flagged `symptomPastFactInvention` (heuristic). **Not** the same as B10-1’s exact quoted string (0/3 `legacyExactQuoteB101`).

**B vs A (n=3 each, not statistical):** B-2 automated labels clean on speech/eyewitness; B-1/B-3 still flagged. **Do not** treat as permanent fix.

## GPT regression review candidates

Compare B runs against the seven manual checks in the task brief using `responses/t50-B-*.txt`:

- **Possible improvement signal:** `t50-B-2.txt` (shorter, uncertainty + known facts; no automated speech/eyewitness flags).
- **Possible B regressions / unchanged failure:** `t50-B-1.txt`, `t50-B-3.txt` (still assert death-moment knowledge or quoted last words in places).
- **A baseline for diff:** `t50-A-3.txt` (explicit `'죄송해요', '도망쳐요'` lock).

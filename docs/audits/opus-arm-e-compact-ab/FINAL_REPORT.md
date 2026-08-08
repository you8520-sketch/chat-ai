# FINAL — Opus Arm E Compact A/B

## Token / parity

| | |
|---|---|
| Arm A | 1134 est. tokens (frozen production) |
| Arm B | 424 est. tokens (`OPUS_ARM_E_COMPACT_CANDIDATE`) |
| Reduction | 62.6% |
| Semantic parity | PASS |

## Live results

Fixture L literary (`신입 ...맞아.나 본적있어?(갸웃)나는 렌이라고 부르면 돼.`, c18):
- A 3225 / B 2959 display chars
- Blind literary + premium → **A**
- Parser leak `(갸웃)` absent in both outbound user turns

Fixture A agency (`시키는 대로 할게요. 뭘 하면 돼요?`, c9 Audit 58 s2 T1):
- A 2257 / B 2746
- Compact performed NPC-requested stand-up → **severe agency fail**
- Blind agency → **A**

## Decision

```text
CURRENT_ARM_E_KEEP
COMPACT_PROMISING = false
STAGE_1_COMPACT_WIN = false
MIXED = false (both fixtures Arm A)
Stage 2 = NOT_RUN
```

Production `OPUS_ARM_E_TERMINAL` remains the only wired Opus interactive terminal.

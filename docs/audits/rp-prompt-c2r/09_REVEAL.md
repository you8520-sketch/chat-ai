# 09_REVEAL — C2-R Stage1 T

## Hidden map

| Set | W | X | Y | Z |
|-----|---|---|---|---|
| Gemini_T | M1 | AB | A | M2 |
| DeepSeek_T | AB | M2 | A | M1 |

## Mapped scores

### Gemini_T

| Arm | /100 | Hard | Rank |
|-----|------|------|------|
| A | — | YES (density collapse) | DQ |
| M1 | 85 | no | 2 |
| M2 | 87 | no | **1** |
| AB | 83 | no | 3 |

Winner (valid): **M2** (not AB). Δ(M2−M1)=+2; Δ(M2−AB)=+4. A sample unusable.

### DeepSeek_T

| Arm | /100 | Hard | Rank |
|-----|------|------|------|
| A | 85 | no | **1** |
| M1 | — | YES (density collapse) | DQ |
| M2 | 80 | no | 2 |
| AB | — | YES (incomplete) | DQ |

Winner (valid): **A**. Δ(A−M2)=+5.

## Split reproduced?

Original C2 on T: Gemini AB 88 > A 76; DeepSeek A 84 > AB 80.

C2-R:
- Gemini prefers non-A among valid arms (M2 best), but **A hard-failed** (stochastic short sample) so AB>A cannot be re-tested on this draw.
- DeepSeek **A confirmed** among valid arms; AB hard-failed; M2 loses to A by 5 pts without hard fail.

**split reproduced: PARTIAL / NO (not clean)** — identified cause: **NOT_IDENTIFIED** for adapter purposes.

## Causal pattern

Not Pattern A/B/C cleanly:
- M2 is the best *surviving* Gemini arm, but without a valid A baseline this draw, cannot claim M2 is the reproducible Gemini win.
- M1 also strong on Gemini (−2 vs M2) → rhythm wording alone is not uniquely causal.
- DeepSeek defaults to A; M2 is mild regression (−5), not catastrophic when it completes.

→ **Confirmation stage: NOT_RUN** (Stage1 unclear; STOP at 8).

# 10_FINAL_VERDICT — STEP C2-Micro

```text
C2 verdict: PROSE_MICRO_MIXED
```

## Why MIXED (not ACCEPT)

1. **Token reduction insufficient for ACCEPT band**  
   NSFW ON 1709 → 1679 (−30, **1.8%**). Allowed M1+M2 exact/near-exact duplicates only; stretch deletion forbidden. Acceptance hoped for ~8% / 1450–1550 band — not reached without cutting protected semantics.

2. **Model split on literary preference**  
   - Gemini: B wins 3/3 (no hard fails, no density collapse)  
   - DeepSeek: A wins 3/3 (gaps 4–6 pts; B still completed, no hard fails)  
   Aggregate B+tie ≥ A (3=3) → cheap gate **PASS**, but DeepSeek non-inferiority is soft / contested.

3. **Stage 2 Opus + Terra = NOT_RUN**  
   `CHEAPER_INFERENCE_API_KEY` empty in this environment. Production Opus Arm E / Terra terminal paths require CheaperInference. OpenRouter Claude Opus 4.5 is **not** the Arm E owner path — not substituted. Without Opus premium distinctiveness + Terra checks, final ACCEPT is blocked.

## Why not REJECT

- Semantic matrix **PASS** (no MISSING / NEW_MEANING / WEAKENED)
- M1/M2 applied; M3 kept separate; breath/sensation/dialogue frozen
- Stage 1: **0 hard fails**, **0 density collapse**, **0 agency severe**, **0 echo/metadata regression**
- Quiet fixture (Q) did not collapse under B
- Production prose default **unchanged**

## Stops (binding)

```text
production prose replacement = NOT_RUN
merge = NOT_RUN
deploy = NO
C2-S = NOT_RUN
C3 = NOT_RUN
PR #271 = remains REJECTED experiment (do not merge)
```

## Behavioral-anchor reminder

Semantic parity was a **live-entry condition only**, not behavioral safety proof (C1 lesson retained).

# D7-A — API=0 Pre-Audit (Selective Repair)

**NEW PRIMARY CALLS:** 0
**REPAIR CALLS PLANNED:** 3
**PRIMARY PRODUCTION CHANGES:** 0
**LIVE_CALL_READY:** YES

| case | flag | fixture | chars | source |
|---|---|---|---:|---|
| R1 | RESPONSE_OVERLOAD | G3 | 3887 | D6-C1 production A Gemini_G3_A_D1 (docs/audits/rp-gemini-dialogue-economy-d6c1/raw) |
| R2 | CANON_RECITAL | G5 | 3475 | D6-A production A Gemini_G5_A_D2 (docs/audits/rp-gemini-layered-canon-d6a/raw) |
| R3 | CURRENT_INPUT_REPLAY | G6T1 | 2699 | D5-A production A G6T1_D2 (docs/audits/rp-gemini-production-stability-d5a/d5a/raw) |

Production recovery flags untouched (still false).
Repair architecture: production context + `[DRAFT ASSISTANT RESPONSE]` + private internal repair control (1 flag).

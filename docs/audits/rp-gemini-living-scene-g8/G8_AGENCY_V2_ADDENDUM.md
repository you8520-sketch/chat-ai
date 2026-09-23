# G8.1 — Agency Rubric V2 Addendum

**API CALLS:** 0 (reuse G8 Stage1 raw outputs only)  
**PHASE_G8_FINAL:** unchanged (`GEMINI_LIVING_SCENE_CONTRACT_FAIL` preserved)  
**PR #288:** historical evidence only  

## Rubric V2 (INTENT HORIZON)

`DOES THIS REQUIRE A NEW USER INTENTION?`  
- YES → control returns to user (SEVERE if AI decides)  
- NO → minor continuity may be co-narrated (ALLOWED_CONTINUITY)

| Class | Meaning |
|---|---|
| ALLOWED_CONTINUITY | requested/started completion; declared ongoing intent; immediate physical reaction; trivial handling |
| MODERATE | one undeclared reversible micro-action; does not redirect scene |
| SEVERE | new dialogue / goal / consent / relationship / major undeclared move / chain crossing a **new decision** boundary |

`USER_DIALOGUE_RESTAGE` is scored **separately** from agency.

---

## Per-cell re-score (Arm B)

### N1 B D1 (1814)
| Track | V1 (G8) | V2 |
|---|---|---|
| USER_DIALOGUE_RESTAGE | folded into severe | **FAIL** — user line restaged as in-scene speech |
| Water receive / sip | folded into severe | **ALLOWED_CONTINUITY** (explicit water request) |
| Relief-breath assignment | — | **MODERATE** |
| Agency overall | SEVERE | **MODERATE** (no new decision takeover once replay separated) |

### N1 B D2 (4177)
| Track | V1 | V2 |
|---|---|---|
| USER_DIALOGUE_RESTAGE | no | PASS |
| Water sip under control | — | **ALLOWED_CONTINUITY** |
| Abort rest → countdown leave → corridor follow presence | SEVERE | **SEVERE** — current cue is rest; leave/follow is a **new destination/goal decision** not in intent horizon |

### N2 B D1 (3124)
| Track | V1 | V2 |
|---|---|---|
| Pull back / short follow underground / hide / quiet breath | SEVERE (multi-step chain length) | **ALLOWED_CONTINUITY** |

Evidence: N2 history already has ongoing follow + silence compliance (`발소리만 따라와` → nod/`…응.`). Short following, being pressed into cover, and holding breath are immediate reactions inside that declared survival-follow intent — not a new destination choice. Alley rejection + subway path are **AI** decisions.  
**Reclassified: SEVERE → ALLOWED_CONTINUITY.**

### N2 B D2 (1913)
| Track | V1 | V2 |
|---|---|---|
| Shoulder press / path dictate | MODERATE | **MODERATE** |
| NPC/world motion | — | n/a (not agency) |

### N3 B D1 (2283)
| Track | V1 | V2 |
|---|---|---|
| Battery take/fix/return | ALLOWED | **ALLOWED_CONTINUITY** |
| Closing “따라와” without narrating Ren steps | — | **ALLOWED** (AI speech only) |

### N3 B D2 (2209)
| Track | V1 | V2 |
|---|---|---|
| Hold light through stalker pass | MODERATE | **MODERATE** (item gate; no Ren dialogue/move invented) |

---

## Summary

| | Old (G8 V1) | New (V2) |
|---|---:|---:|
| B SEVERE decision takeover | 3 | **1** (N1_B_D2 only) |
| B USER_DIALOGUE_RESTAGE FAIL | (merged) | **1** (N1_B_D1) |
| Reclassified cases | | **N2_B_D1** SEVERE→ALLOWED_CONTINUITY; **N1_B_D1** SEVERE→MODERATE + separate REPLAY FAIL |

### Implication for G8 verdict

G8 Stage1 remains **FAIL** under original sealed rubric (not revised).  
Under V2, agency alone would not have been the sole blocker — **quiet-scene threat escalation** and flat blind mean remain open questions for G9-A.

`G8_AGENCY_V2_NOTE:` Intent-horizon co-narration was over-penalized on N2 world-motion; N1 rest→forced leave still SEVERE; dialogue restage is a continuity/replay defect, not agency.

# G8-0 / Preaudit — Gemini Living Scene Architecture

**latest main:** `7f0c54b60e7ace11bc6e4eea9c820caadde24853`  
**branch:** `cursor/gemini-living-scene-contract-g8-96c2`  
**API CALLS:** 0  
**LIVE_CALL_READY:** YES  
**PRODUCTION WIRE / MERGE:** NOT_RUN  
**SOLE VARIABLE:** `GEMINI_CREATIVE_OWNER_ARCHITECTURE`

Failed PRs #283–#287 not stacked. Fresh from main.

---

## Prompt health (NORMAL fixture, real buildContext + assemblePrimaryRpRequest)

| | A (production) | B (living scene) |
|---|---:|---:|
| system chars | 6568 | 4469 |
| system tokens≈ | 3284 | 2235 |
| fixed instruction≈ | 3284 | 2235 |
| current-user instruction≈ | 282 | 186 |
| fixed reduction | | **31.9%** (within 25–40% band) |
| negative surface hits | 39 | 23 |
| negative semantic clauses | 35 | 19 (−45.7%) |
| agency owners | collab + wrapper | **living-scene SoT = 1** |
| layout owners | OUTPUT LAYOUT + terminal | **form inside living-scene = 1** |
| living-scene owner | 0 | 1 |
| immersive/prose owner | 1 | 0 (folded) |
| collaborative owner | 1 | 0 (folded) |
| canon/data SHA | | **equal** |
| history SHA | | **equal** |
| length owner | BYTE_IDENTICAL | BYTE_IDENTICAL |
| runtime (temp/reasoning/provider) | equal | equal |

Hygiene / speech metadata / POV / persona-reference retained (G9 compression candidates).

---

## Negative-directive audit

Arm A stacks prohibition across CORE RP, collab owner, webnovel layout, immersive prose, hygiene, speech metadata, POV, and the legacy CURRENT USER wrapper.

Arm B removes collab + WEBNOVEL + PROSE_STYLE + OUTPUT LAYOUT creative family and does **not** add new NEVER/DO-NOT/quota lists. Residual negatives are mostly hard invariants (canon leak, hygiene, speech lock, POV) — not creative suppression.

Overlap families reduced on B: AGENCY, LAYOUT, STYLE (creative). META/HYGIENE left intact for G9.

---

## Agency contradiction matrix

| Topic | Collab owner (A) | CURRENT USER wrapper (A) | Desired / B |
|---|---|---|---|
| Brief gaze/expression | allowed | often reads tighter | CO-NARRATABLE |
| Involuntary reaction | allowed | allowed-ish | CO-NARRATABLE |
| Finish started action | allowed | ambiguous | CO-NARRATABLE |
| Minor move/contact/object | allowed | often over-conservative | CO-NARRATABLE |
| New user dialogue | USER | USER | USER |
| Consent / major choice | USER | USER | USER |
| Relation/goal/identity | USER | USER | USER |

**Contract target:** IMPORTANT AGENCY = USER OWNED · MINOR CONTINUITY = CO-NARRATABLE  
Arm B places agency SoT only in `[GEMINI RP — LIVING SCENE]`; wrapper V2 is data-boundary (`COMPLETED CUE`) only.

---

## Scene capacity (positive channels)

| Channel | A | B |
|---|---|---|
| AI character action | EXPLICITLY_ALLOWED | EXPLICITLY_ALLOWED |
| AI character perception | IMPLICIT | EXPLICITLY_ALLOWED |
| AI character inner judgment | IMPLICIT | EXPLICITLY_ALLOWED |
| relevant memory/association | IMPLICIT | EXPLICITLY_ALLOWED |
| relationship movement | IMPLICIT | EXPLICITLY_ALLOWED |
| environment reaction | IMPLICIT | EXPLICITLY_ALLOWED |
| NPC autonomous action | CONSTRAINED | EXPLICITLY_ALLOWED |
| new immediate information | CONSTRAINED | EXPLICITLY_ALLOWED |
| local world event | CONSTRAINED | EXPLICITLY_ALLOWED |
| short spatial progression | CONSTRAINED | EXPLICITLY_ALLOWED |
| short temporal progression | CONSTRAINED | EXPLICITLY_ALLOWED |
| minor user co-narration | EXPLICITLY_ALLOWED | EXPLICITLY_ALLOWED |

A leaves world/NPC/time/space motion constrained or implicit; B opens them as living-scene channels without adding suppression lists.

---

## Clause class notes (Gemini payload)

- **HARD_INVARIANT (kept):** canon priority, knowledge boundary, Korean output, hygiene, speech lock, POV, major user agency, gender/name.
- **CREATIVE_GUIDANCE (replaced on B):** collab wording, immersive prose, webnovel/layout verbose owners → one living-scene contract.
- **CONTEXT_DATA (untouched):** CHARACTER CANON, persona facts, history.
- **SERVER_ENFORCEABLE:** runtime contamination sanitizer remains; not deleted in G8.
- **DUPLICATE / LEGACY:** layout terminal + OUTPUT LAYOUT collapsed on B; agency wrapper prose removed on B.

---

## Offline gates

- CANON / PERSONA / MEMORY / HISTORY / runtime / length owner parity: PASS  
- No new anti-replay / anti-recital / dialogue quota / DO-NOT stacking: PASS  
- DeepSeek / Opus / Terra path: untouched (harness Gemini-only apply)  
- Ready for Stage 1 live: N1/N2/N3 × A/B × 2 draws = 12 calls  

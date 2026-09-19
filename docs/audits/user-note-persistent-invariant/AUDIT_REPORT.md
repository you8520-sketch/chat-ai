# User Note Persistent Invariant Hardening

**Base commit:** `260a8e21e125fb5b46160e5be6584cb6084816f7` (#959 merged)  
**Branch:** `cursor/user-note-persistent-invariant-163d`

## Classification

| Subproblem | Result |
|---|---|
| **Overall** | `USER_NOTE_PERSISTENT_INVARIANT = ROOT_CAUSE_FIXED` |
| Focus injection path | `NO_MATERIAL_DEFECT_FOUND` (focus 1K always-on verified) |
| Authority semantics gap (pre-patch) | `ROOT_CAUSE_FIXED` |
| User-agency precedence conflict | `ROOT_CAUSE_FIXED` |
| Reference zone RAG | `NO_MATERIAL_DEFECT_FOUND` (by design, not every-turn) |

## Root Cause

**B + C confirmed (deterministic prompt audit):**

- **B (AUTHORITY):** `[MANDATORY_RULES]` rendered user focus text but had no formal persistent-precedence contract.
- **C (OWNER CONFLICT):** Standard user-agency line allowed unconditional role/direction updates from latest input, without bounding against `[MANDATORY_RULES]`.

Not A (injection missing) — focus zone reaches `identity-and-rules` every turn.  
Not E (adapter-only) — all four Main RP models share OpenRouter assembly path; fix is canonical-owner level.

## Owner Map

| Responsibility | Owner |
|---|---|
| USER NOTE STORAGE | `chats.user_note` / `users.user_note`; zones via `USER_NOTE_ZONE_SEPARATOR` |
| FOCUS/REFERENCE SPLIT | `splitUserNotePromptZones()` — `userNoteStatusWindow.ts` |
| PERSISTENT CONSTRAINT SEMANTICS | `MANDATORY_RULES_PERSISTENT_CONSTRAINT_SEMANTIC` — `corePrompt.ts` |
| USER PERSONA | `[USER_PERSONA]` in `buildIdentityAndRulesBlock()` |
| CURRENT ROLE/DIRECTION | Collaborative interactive owner — `noGodmodding.ts` |
| STANDARD USER AGENCY | `[USER CONTROL — COLLABORATIVE INTERACTIVE]` |
| AUTO PROGRESSION | `[AUTO PROGRESSION — AI-FOCAL CO-NARRATION]` + short ref |
| OOC CO-NARRATION | `[USER CONTROL MODE - LIMITED CO-NARRATION]` + short ref |
| CURRENT-TURN DELEGATION | `[USER AUTHORING — CURRENT-TURN OOC DELEGATION]` + short ref |
| REGEN | `buildRegenerateSystemDirective()` — reuses same identity owner |
| MODEL ADAPTERS | Shared OpenRouter path; no model-specific role-lock patches |

## Authority Precedence

### Before

1. Latest user input could update role/direction unconditionally (user-agency owner).
2. `[MANDATORY_RULES]` = raw user text only.

### After

1. Explicit fixed/persistent/prohibited conditions in `[MANDATORY_RULES]` remain until User Note updated.
2. History, memory, scene, inference interpreted **within** those constraints.
3. Role/direction updates bounded: latest input applies **only within** `[MANDATORY_RULES]`.
4. Auto/delegation/co-narration: compact short-ref to mandatory bounds (no duplicated full semantic body).

## Patch (canonical owners only)

**Added once:** `MANDATORY_RULES_PERSISTENT_CONSTRAINT_SEMANTIC` appended under focus rules in `buildIdentityAndRulesBlock()`.

**Replaced:** unconditional role-direction precedence sentence in `COLLABORATIVE_INTERACTIVE_OWNER_BLOCK`.

**Short-ref added:** `MANDATORY_RULES_BOUNDED_AUTHORITY_SHORT_REF` in auto progression, OOC delegation, limited co-narration owners.

**Removed:** Nothing deleted; conflicting precedence sentence replaced in place.

## Focus vs Reference

| Zone | Max | Behavior |
|---|---|---|
| Focus (고집중) | 1,000 | Every turn → `[MANDATORY_RULES]` |
| Reference (확장) | 9,000 | Keyword RAG → `user-note-reference` (UNI-07) |

UI microcopy clarified: focus = always-on; reference = keyword-relevant only.

## Provider Call Delta

**+0**

## Proof

- `src/lib/userNotePersistentInvariant.test.ts` — UNI-01..13
- `userAgencyRoleBindingP0.test.ts`, `userAgencyRuntime.test.ts`, `autoProgression.prompt.test.ts`
- #958 SCOPE regression unchanged

## Follow-ups

- Historical top/bottom role-event continuity (separate task)
- Controlled live extractor salience eval (#959 follow-up)

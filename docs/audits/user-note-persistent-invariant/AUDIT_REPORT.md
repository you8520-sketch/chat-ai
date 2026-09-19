# User Note Persistent Invariant Hardening

**Base commit:** `260a8e21e125fb5b46160e5be6584cb6084816f7` (#959 merged)  
**Branch:** `cursor/user-note-persistent-invariant-163d`

## Classification

| Subproblem | Result |
|---|---|
| **Overall** | `USER_NOTE_PERSISTENT_INVARIANT = ROOT_CAUSE_FIXED` |
| Circular dependency (#960 follow-up) | `CIRCULAR_DEPENDENCY = ROOT_CAUSE_FIXED` |
| Focus injection path | `NO_MATERIAL_DEFECT_FOUND` |
| Authority semantics gap | `ROOT_CAUSE_FIXED` |
| User-agency precedence conflict | `ROOT_CAUSE_FIXED` |
| Empty mandatory-rules case | `ROOT_CAUSE_FIXED` (UNI-14) |

## Dependency Graph

### BEFORE (#960 head — cycle)

```
corePrompt.ts ──imports──> autoProgressionRules.ts
autoProgressionRules.ts ──imports──> corePrompt.ts  (MANDATORY_RULES_BOUNDED_AUTHORITY_SHORT_REF)
= circular dependency
```

### AFTER (amended)

```
userNoteMandatoryRulesPolicy.ts  (canonical constraint policy — dependency-neutral)
    ├── corePrompt.ts
    ├── noGodmodding.ts
    └── autoProgressionRules.ts

corePrompt.ts ──imports──> autoProgressionRules.ts  (pre-existing, unchanged)
autoProgressionRules.ts -X-> corePrompt.ts  (cycle removed)
```

## Policy Owner After

**File:** `src/lib/userNoteMandatoryRulesPolicy.ts`

| Constant | Role |
|---|---|
| `MANDATORY_RULES_PERSISTENT_CONSTRAINT_SEMANTIC` | Full persistent-constraint semantics (identity-and-rules) |
| `MANDATORY_RULES_BOUNDED_AUTHORITY_SHORT_REF` | Mode-owner short-ref (subject = 권한) |
| `MANDATORY_RULES_BOUNDED_ROLE_DIRECTION_PRECEDENCE` | Standard interactive role/direction update bound |

## Short-Ref Before / After

**Before (ambiguous direction):**
> `[MANDATORY_RULES]에 명시된 고정·지속·금지 조건은 본 권한 범위를 넘어서지 않는다.`

**After (positive, 권한 as subject, scoped when absent):**
> `이 집필/공동서술 권한은 [MANDATORY_RULES]가 있는 경우, 그 안에 명시된 고정·지속·금지 조건 안에서 행사하며, 그 조건을 변경하지 않는다.`

Role/direction precedence similarly scoped: `…[MANDATORY_RULES]가 있는 경우…`

## Root Cause

- **B + C:** Missing persistent-precedence contract; unconditional role/direction updates.
- **Follow-up:** Import cycle from placing short-ref in `corePrompt` while `corePrompt` already imports `autoProgressionRules`.

## Proof

- UNI-01..14 (`userNotePersistentInvariant.test.ts`)
- userAgencyRoleBindingP0, userAgencyRuntime, autoProgression.prompt
- SCOPE-1..12, episodic hardening, post-turn prompt regression
- `git diff --check`, lint, typecheck:app, build

## CI / Workflow Trigger Finding

PR #960 amended files (`corePrompt.ts`, `noGodmodding.ts`, `autoProgressionRules.ts`, `userNoteMandatoryRulesPolicy.ts`) are **not** in any workflow `pull_request.paths` filter (e.g. `validate-post-turn-luna-owner.yml`, `validate-memory-episodic.yml`). **0 GitHub Actions checks expected** unless workflow path lists are expanded separately — not modified in this PR.

## Provider Call Delta

**+0**

## Follow-ups (out of scope)

- Historical top/bottom role-event continuity
- Controlled live extractor salience eval
- Retrieval V2

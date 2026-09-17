# General Chat Party Mode Production Wiring Audit Report

**Main SHA (verified at start):** `0f13225b514a2f84105482f604ba7cb9c68b27c8`
**Branch:** `cursor/general-chat-party-wiring-audit-aa40`
**Baseline:** SceneDirective v1.2 + Standard COMPACT_SUFFICIENT (PR #924)
**Scope:** General Chat multi-character / party mode — **NOT TRPG**
**Status:** `FEATURE_NOT_PRESENT`

---

## 0. VERIFIED BASELINE

- `git fetch origin main` → `0f13225b514a2f84105482f604ba7cb9c68b27c8`
- Standard = compact `[SCENE PACING]` only (full SceneDirective block OFF)
- Auto / Simulation = full SceneDirective block
- SceneDirective engine supports `party: true` → `ensemble` cast (harness-ready, unwired)

---

## 1. OWNER MAP

| Key | Canonical Owner | Production Path Today |
|-----|-----------------|----------------------|
| **PARTY_SETTING_UI_OWNER** | *none* | No party UI in `ChatClient.tsx` or chat settings |
| **PARTY_SETTING_DATA_MODEL_OWNER** | *none* | No `party` field on `chats` or request body |
| **PARTY_SETTING_DB_OWNER** | *none* | Legacy `party_rooms` / `party_members` / `party_messages` tables exist but have **no read/write API** |
| **PARTY_SETTING_API_OWNER** | *none* | `/api/chat` does not parse `body.party` or similar |
| **PARTY_SETTING_REQUEST_OWNER** | *none* | Client sends no party flag |
| **PARTY_RUNTIME_BOOLEAN_OWNER** | `route.ts` hardcodes `party: false` | `sceneServerControls.party: false` (line ~3050) |
| **PARTY_ROOM_MODE_OWNER** | *none* | No General Chat room-mode enum persisted |
| **PARTY_CAST_OWNER** | `sceneDirective.resolveSceneCastFocus` (when `party: true`) | **Never reached** — route omits `party` on `buildSceneDirective` |
| **PARTY_SCENEDIRECTIVE_OWNER** | `sceneDirective.buildSceneDirective` | Engine ready; route never passes `party: true` |
| **PARTY_PROMPT_OWNER** | `contextBuilder.pushSceneDirective` gate (`!!input.party`) | Gate exists; `contextBuildInput` never includes `party` |
| **PARTY_REGEN_OWNER** | `buildContext` (inherits `input.party`) | Regen path omits party → defaults safe single |

### Separate systems (no overlap)

| Key | Owner | Notes |
|-----|-------|-------|
| **SIMULATION_MODE_OWNER** | `characters.content_kind === "simulation"` + `simulation_cast` | Uses `contentKind: "simulation"`, `sceneCastMode: "simulation"` — **not** `party` flag |
| **TRPG_PARTY_OWNER** | `src/lib/trpg/partyChat.ts` + `/api/trpg/campaigns/[id]/party-chat` | `postTrpgPartyChat`; no `buildSceneDirective`; **NO TOUCH** |

---

## 2. DATAFLOW TRACE

### Field inventory

| Field / concept | Writer | Reader | Default | Persistence | API serialize | API parse | Runtime consumer | Fallback | Tests |
|-----------------|--------|--------|---------|-------------|---------------|-----------|------------------|----------|-------|
| `party` (SceneDirectiveInput) | Harness only | `resolveSceneCastFocus`, pacing | `undefined` → single | N/A | N/A | N/A | `buildSceneDirective` | single_primary | W6, W10–W13 |
| `party` (ContextBuildInput) | None in prod | `contextBuilder`, `corePrompt` | `undefined` | N/A | N/A | N/A | prompt gate | no full block | W8, W9 |
| `party` (sceneServerControls) | `route.ts` hardcode | `scenePacingController` | `false` | N/A | N/A | hardcoded | wire controls | false | W4 |
| `content_kind` | character editor | route, contextBuilder | `"character"` | `characters` table | character API | route load | simulation vs character | character | W14 |
| `simulation_cast` | character editor | route (sim only) | `""` | `characters` table | character API | route load | `establishedActiveCastNames` | undefined | W14 |
| `establishedActiveCastNames` | route (sim cast extract) | sceneDirective, pacing | sim: cast names; char: undefined | N/A | N/A | derived | cast budget | undefined | W11 |
| `knownSupportingCastNames` | route (`undefined`) | sceneDirective NPC grounding | undefined | N/A | N/A | not set | grounding only | — | W11 |
| `party_rooms` (legacy) | *dead* | `deleteCharacter.ts` cleanup only | — | SQLite | — | — | delete cascade | — | W1 |
| TRPG `trpg_party_messages` | TRPG party chat | TRPG engine | — | SQLite | TRPG API | TRPG route | TRPG only | — | W15 |

### End-to-end path (General Chat)

```
UI/config          → NO party setting exists
DB/storage         → NO party column on chats; legacy party_* tables unused
reload             → character + chat load; no party state
request payload    → NO party field
API route          → party: false hardcoded; buildSceneDirective omits party
context build      → contextBuildInput omits party
scene server ctrl  → party: false, skipMotionCue: auto||sim only
buildSceneDirective→ party defaults undefined → single_primary
render             → Standard: [SCENE PACING] only (COMPACT_SUFFICIENT)
provider messages  → single-primary motion owner = 1
```

**Break point:** There is no upstream party state to propagate. The pipeline is intentionally single-chat today.

---

## 3. HYPOTHESIS AUDIT

| ID | Hypothesis | Verdict | Evidence |
|----|------------|---------|----------|
| **H1** | UI/DB party state exists but route drops it | **REJECTED** | No party state upstream; route hardcode matches absence |
| **H2** | Multiple owners infer party differently | **PARTIAL** | Simulation uses `content_kind`; party bool unused; cast count not used for party detection |
| **H3** | SceneDirective party param only; no prod config | **CONFIRMED** | W1: no UI, no DB column, no API parse; engine-only |
| **H4** | contextBuilder has party but wire drops | **REJECTED** | `contextBuildInput` never sets `party` |
| **H5** | Regen/reload loses party | **REJECTED** | Nothing to lose; W8/W9 show safe single defaults |
| **H6** | party=true causes dual motion owner | **CONFIRMED (harness)** | Without `skipMotionCue`, full block + `[SCENE PACING]` coexist — must not ship unwired |

---

## 4. CANONICAL MODEL (target when feature ships)

```
CANONICAL GENERAL CHAT ROOM MODE (persisted / request)
        ↓
RUNTIME PARTY FACT (route boundary — single materialization)
        ↓
SceneDirectiveInput.party
        ↓
resolveSceneCastFocus → ensemble
        ↓
full SceneDirective block + skipMotionCue: true
```

**Invariants to preserve when wiring (future work):**

- Do not infer `party=true` from message count, NPC count, or `knownSupportingCastNames` alone (W11)
- `party=true` ≠ auto-present supporting NPCs (#922 grounding — W12, W13)
- Room mode and active cast remain separate
- Standard single chat: full block = 0, `[SCENE PACING]` = 1
- General Chat party: full block = 1, `[SCENE PACING]` = 0 (`skipMotionCue: true`)

---

## 5. NORMAL / REGEN / RELOAD PARITY

| Path | party truth today | Safe? |
|------|-------------------|-------|
| Normal send | `false` (hardcoded) | Yes — single_primary |
| Regen | omitted → undefined | Yes — W8 |
| Auto progression | `false`; auto owns full block | Yes — unchanged |
| Continuation | same as normal | Yes |
| Reload/reconnect | no party in chat row | Yes — W9 |
| New room | no party field | Yes |
| Existing room load | no party field | Yes |
| Simulation | `content_kind`, not party | Yes — W14 |

No parity gap — all paths consistently non-party.

---

## 6. PROMPT OWNER INVARIANT

| Path | SceneDirective full block | [SCENE PACING] | pacing_sot_count |
|------|---------------------------|----------------|------------------|
| Standard single (prod) | 0 | 1 | 1 |
| Party harness (if wired correctly) | 1 | 0 | 1 |
| Party harness (miswired) | 1 | 1 | 2 — **must not ship** |
| Simulation (prod) | 1 | 0 | 1 |
| Auto (prod) | 1 | 0 | 1 |

---

## 7. REGRESSION FIXTURES (W1–W15)

| Fixture | Description | Result |
|---------|-------------|--------|
| W1 | No production party config source | PASS |
| W2 | Single chat: party=false, compact only | PASS |
| W3 | Harness party=true: full directive, skipMotionCue | PASS |
| W4 | Route hardcodes false; no request parse | PASS |
| W5 | buildSceneDirective call omits party | PASS |
| W6 | Engine party=true → ensemble | PASS |
| W7 | Final prompt owner count = 1 | PASS |
| W8 | Regen omits party → safe single | PASS |
| W9 | Reload without party → non-ensemble | PASS |
| W10 | Missing party → single_primary | PASS |
| W11 | knownSupportingCast alone ≠ party | PASS |
| W12 | party + no grounded support → no npc_action | PASS |
| W13 | Off-scene member not auto PRESENT_ACTOR | PASS |
| W14 | Simulation uses contentKind not party | PASS |
| W15 | TRPG party separate from General Chat | PASS |

File: `src/lib/generalChatPartyWiringAudit.test.ts`

---

## 8. LEGACY / EXISTING DATA

| Artifact | Writer | Reader | Stored values | Default |
|----------|--------|--------|---------------|---------|
| `party_rooms` | Unknown (legacy) | `deleteCharacter.ts` only | orphan rows possible | N/A |
| `party_members` | Unknown | delete cascade | — | N/A |
| `party_messages` | Unknown | delete cascade | — | N/A |
| `chats.party` | — | — | **column does not exist** | — |

No compatibility shim added. Missing party field safely defaults to single chat.

---

## 9. DEAD SYSTEM AUDIT

| Item | Classification | Rationale |
|------|----------------|-----------|
| `party_rooms` / `party_members` / `party_messages` | **FOLLOW-UP** | Schema exists; only deleteCharacter cleanup; uncertain prod history |
| `ContextBuildInput.party` | **KEEP** | Engine hook for future wiring |
| `sceneDirective.party` | **KEEP** | Canonical cast-mode switch |
| `route.ts party: false` | **KEEP** | Explicit safe default until feature exists |
| Participant-count party inference | **SAFE TO DELETE** (if found) | None found in General Chat path |
| `sceneDirectiveV2` party paths | **NO TOUCH** | Out of scope |
| `livingSceneDirective` | **NO TOUCH** | Out of scope |

---

## 10. CHANGE SUMMARY

### MUST FIX NOW

- **No code fix required** — feature not present in production product
- Audit + W1–W15 regression fixtures added

### NOT DONE (by design — STOP conditions)

- No new DB migration
- No speculative `partyV2` / parallel flags
- No route wiring without persisted party owner
- No TRPG changes

---

## FINAL REPORT

### BEFORE

Party motion policy exists in SceneDirective (`party: true` → ensemble + full block gate in contextBuilder/pacing), but **no General Chat product surface** creates, stores, or requests party state. Route hardcodes `party: false` and omits `party` on `buildSceneDirective`.

### PROBLEM

No production gap in the sense of “state exists but is dropped.” The gap is **missing product feature**, not a propagation bug.

### ROOT CAUSE

`FEATURE_NOT_PRESENT` — General Chat canonical party configuration (UI → DB → API) was never implemented. Engine hooks were added anticipatorily (PR #923 owner map noted “unwired”).

### AFTER

- Documented canonical owners (all party-setting owners = none)
- W1–W15 prove safe defaults and engine readiness
- Simulation and TRPG paths verified separate

### REMOVED

Nothing removed — no duplicate production party owners found (only dead legacy tables).

### PRESERVED

- Standard COMPACT_SUFFICIENT (single chat)
- Auto / simulation behavior
- Regen safe defaults
- NPC grounding (#922)
- Dialogue budget / length / speech lock
- TRPG untouched
- Provider call count / billing unchanged
- DB schema unchanged

### REGRESSION RISKS (if party wired incorrectly in future)

| Risk | Mitigation |
|------|------------|
| single→party mis-inference | Require explicit persisted flag; W11 |
| party state loss on regen | Pass same flag on regen path |
| dual motion prompt | `skipMotionCue: true` when full block injected; dual-motion guard test |
| NPC spam | W12 grounding |
| off-scene cast resurrection | W13 roster vs mention |
| legacy room behavior | Migration + explicit reader needed before enable |

### PROOF

- W1–W15: `src/lib/generalChatPartyWiringAudit.test.ts` (16 tests)
- Existing Q/O/P/F suites unchanged
- lint + typecheck:app + build

### FINAL STATUS

**`FEATURE_NOT_PRESENT`**

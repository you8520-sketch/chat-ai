# Track B — Local scene progress architecture (design review)

**Status:** DESIGN ONLY — no implementation, no schema migration.

## Problem statement

Audit #731: no durable owner for local multi-round scene continuity:

- current local dramatic objective
- durable progress / resolved obstacles
- open routes & opportunities
- scene transition readiness

**Global** `TrpgScenarioPlan` + Campaign Director (`storyPhase`, threads) must remain separate.

---

## B1 — Reuse evaluation

### activeThreads / resolvedThreads

| | |
|--|--|
| **CURRENT_SEMANTICS** | Narrative plot threads across campaign; GM adds/resolves via delta; serialized in director state |
| **WHY_INVALID** | Threads are story-scale dangling hooks, not structured obstacle/route state. No fields for "open route" vs "resolved barrier". Mixing local scene blobs into thread strings → unparseable, high semantic collision with global arc tracking |
| **TOKEN_IMPACT** | Low if misused as prose blobs |
| **PERSISTENCE** | `trpg_campaign_context` |
| **BACKWARD_COMPAT** | Old campaigns use threads sparingly |
| **SEMANTIC_COLLISION_RISK** | **High** |
| **VERDICT** | **REJECTED** for local scene owner |

### quests

| | |
|--|--|
| **CURRENT_SEMANTICS** | Named objectives (`questsAdd`/`Remove`); merge list max 12 |
| **WHY_PARTIAL** | Could encode "탈출 경로 확보" as quest, but no distinction active/completed obstacle vs opportunity; no blocker list; quests are player-facing labels not GM progress ledger |
| **TOKEN_IMPACT** | Low |
| **PERSISTENCE** | `trpg_campaign_state.quests_json` |
| **BACKWARD_COMPAT** | High — overloading quest strings changes player UI meaning |
| **SEMANTIC_COLLISION_RISK** | Medium–High |
| **VERDICT** | **REJECTED** as canonical owner; may mirror summaries only |

### flags

| | |
|--|--|
| **CURRENT_SEMANTICS** | Opaque string tags (`world_flags_json`), merge max 24 |
| **WHY_PARTIAL** | Could ad-hoc convention `route:vent:open`, `obstacle:fungus:resolved` — no schema, no monotonic rules, easy silent loss when GM omits flag carry-forward |
| **TOKEN_IMPACT** | Medium (list grows) |
| **PERSISTENCE** | ledger |
| **BACKWARD_COMPAT** | Unstructured — old campaigns have unrelated flags |
| **SEMANTIC_COLLISION_RISK** | Medium (convention drift) |
| **VERDICT** | **REJECTED** as canonical owner; acceptable as derived export only |

### location

| | |
|--|--|
| **CURRENT_SEMANTICS** | Single string place name |
| **WHY_INVALID** | Coarse; same building for 53 rounds; no objective/progress |
| **VERDICT** | **REJECTED** |

### nextRoundContext

| | |
|--|--|
| **CURRENT_SEMANTICS** | Short next-decision hint; **full replace** when GM emits new value; max 400 chars |
| **WHY_INVALID** | Wrong responsibility (#731); overwriting macro progress with local threat is documented failure mode |
| **VERDICT** | **REJECTED** — keep as immediate decision hint only |

### storyPhase

| | |
|--|--|
| **CURRENT_SEMANTICS** | Global campaign phase enum (INTRO → FINISHED) |
| **WHY_INVALID** | Too coarse for encounter-level stall detection |
| **VERDICT** | **REJECTED** for local scene |

---

## B2 — Required responsibilities mapping

| Question | Existing owner? |
|----------|-----------------|
| Current local objective? | **No** |
| Durable progress? | **No** (sealed memory episodic only) |
| Resolved obstacles? | **No** |
| Open routes? | **No** |
| Remaining blockers? | **No** |
| Scene exhausted / open outward? | **No** (prompt prose only) |
| What changed since last round? | Partial via 3 raw rounds + ledger deltas |

---

## B3 — Architecture options

### OPTION 1 — Reuse director threads

**REJECTED** — see B1. Would corrupt global thread semantics.

### OPTION 2 — Reuse ledger composition

Compose `flags` + `quests` + `location` + `nextRoundContext`.

**Pros:** No migration  
**Cons:** Ad-hoc conventions; no monotonic progress rules; GM must manually re-emit flags each round; indistinguishable from player quests; cannot answer structured queries; high collision risk

**VERDICT:** **REJECTED** as canonical owner

### OPTION 3 — Dedicated versioned local scene state (RECOMMENDED)

Compact structured contract (names TBD), e.g.:

```typescript
// Conceptual — not final schema
type TrpgLocalSceneProgress = {
  version: 1;
  objective: string;           // current local dramatic goal (≤120 chars)
  resolvedObstacles: string[]; // max N, stable ids/labels
  openRoutes: string[];        // opportunities, not taken movement
  remainingBlockers: string[]; // still active
  sceneState: "active" | "transition_ready" | "exhausted";
  lastChangedRound: number;
};
```

| Aspect | Proposal |
|--------|----------|
| **Persistence** | New nullable JSON column on `trpg_campaign_context` e.g. `local_scene_progress_json` OR separate keyed ledger table |
| **Writer** | GM delta extension parsed in `parseTrpgGmOutput` / `asDelta`, applied in `commitPendingGmResult` same transaction as ledger |
| **Reader** | Injected in GM user block (compact block, not full JSON dump) + optional bot omit |
| **Backward compat** | null → empty scene state; old campaigns unchanged |
| **DB change** | **Yes** — additive nullable column preferred |

**Monotonic rules (design):**

- `resolvedObstacles` / `openRoutes`: append-only unless explicit `*Remove` delta with causal justification field
- Reversal requires `explicitReversal: { target, reason }` in delta — not silent omit

**Agency (B7):** Delta may set `openRoutes: ["환풍구"]`; must NOT set player location to vent.

**VERDICT:** **RECOMMENDED** pending human review of schema + prompt contract

---

## B4 — Separation of responsibilities (target)

```text
TrpgScenarioPlan           → global campaign direction
Campaign Director state    → storyPhase, narrative threads, ending
Local Scene Progress       → multi-round encounter continuity (NEW)
nextRoundContext           → immediate next-decision hint (unchanged semantics)
Campaign Ledger            → location, quests, flags, inventory
```

---

## B5 — Data flow (no new model call)

```text
existing GM call
  → narration
  → <<<DELTA>>> (+ local scene progress fields)
  → commitPendingGmResult transaction
  → persist local scene progress
  → next GM prompt reads compact scene progress block
```

---

## B6 — Idempotency / commit boundary

Canonical transaction today: `commitPendingGmResult` → `db.transaction`:

1. `markGmGenerationCommitted` (lease)
2. GM message persist
3. sheets / mechanics
4. `trpg_state_change_log` INSERT OR IGNORE `delta:${roundId}`
5. `persistCampaignLedger`
6. `persistCampaignContext` (story progress)

**Writer placement:** same transaction after ledger, before phase change. Use same `idempotency_key` pattern — regen must not double-append resolved obstacles.

Regenerate path: `if (opts.regenerate) return` early in transaction skips ledger — scene progress must follow same rule.

---

## B7–B9 — Agency, monotonicity, transition

Design fixtures L1–L7 in `local-scene-design-fixtures.md` (conceptual acceptance).

No hard round caps. No auto-move. `sceneState: transition_ready` informs GM prompt only.

---

## B10 — Major events / clues consumption

```text
MAJOR_EVENT_CONSUMPTION_TRACKING: SEPARATE_FOLLOW_UP
CLUE_REVEAL_TRACKING: SEPARATE_FOLLOW_UP
PLAY_LENGTH_RUNTIME_OWNER: SEPARATE_FOLLOW_UP
```

Do not bundle into local scene progress. Optional future: `trpg_campaign_context.consumed_major_events_json` — global director concern.

---

## Recommendation summary

```text
ACTIVE_THREADS_REUSE: REJECTED
LEDGER_REUSE: REJECTED
NEXT_ROUND_CONTEXT_REUSE: REJECTED
DEDICATED_SCENE_STATE: RECOMMENDED
NEW_MODEL_CALL_REQUIRED: false
DB_CHANGE_REQUIRED: true (additive nullable JSON on campaign context)
OLD_CAMPAIGN_COMPATIBILITY: null = empty scene state
PLAYER_AGENCY_PRESERVED: yes (design constraint)
```

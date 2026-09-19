# Role-Event Direction Continuity Audit

Branch: `cursor/role-event-direction-continuity-163d`  
Base: `main` @ `8c70e217` (#960 merged)

## BEFORE

### USER-VISIBLE FAILURE

1. Past intimate scenes with explicit actor/target/direction (A receptive / B insertive) later narrated with inverted roles.
2. Prior shared intimate experience erased as "처음이었다" despite earlier canonical events.
3. Reversible couples (T1 A top/B bottom, T10 A bottom/B top) should both remain valid history — not collapsed into permanent role lock.

### OWNER MAP

| Responsibility | Canonical owner |
|---|---|
| RAW current/recent event | hybridMemory RAW4 pool |
| Rolling summary event | `memory-rolling-summary.ts` → `buildRollingSummarySystemPrompt` |
| Episodic extraction | `memory-episodic-prompt.ts` → `EPISODIC_FACTS_EXTRACT_INSTRUCTIONS` |
| Episodic temporal nature | `episodicMemoryTemporal.ts` → `classifyEpisodicFactTemporalNature` |
| Episodic state latest-wins | `episodicMemoryFacts.ts` → `resolveLatestFactsByLogicalKey` |
| Episodic retrieval/rank | `episodicMemoryFacts.ts` → `getEpisodicMemoryForPrompt` |
| First/never historical truth | `noGodmodding.ts` → `NO_FALSE_SHARED_MEMORY_RULE` + episodic prompt header |
| User Note current constraint | `userNoteMandatoryRulesPolicy.ts` (#960) |
| Regen canonical variant | Shared Initial regen scope in `buildSharedInitialEpisodicSectionInstructions` |
| Noncanon scope | `oocSceneRender.ts` (#958) |

## REPRODUCTION

Deterministic fixtures in `src/lib/memory/role-event-direction-continuity.test.ts`.

### FIRST FAILURE STAGE (pre-patch)

| Fixture | SOURCE | SUMMARY | EPISODIC | DB | RETRIEVAL | FINAL PROMPT |
|---|---|---|---|---|---|---|
| REC-09 latest-key collision | ✓ | n/a (stub) | ✓ | ✓ (2 rows) | **✗ T10 dropped** | **✗ inverted history** |
| REC-02 reversible couple | ✓ | n/a | ✓ | ✓ | **✗ one event** | **✗** |
| REC-07 summary wording | n/a | **risk: merge rule** | n/a | n/a | n/a | n/a |
| REC-04 false first | n/a | n/a | n/a | n/a | n/a | **✗ no absence≠proof rule** |

**Classification:** `EVENT_COLLAPSED_BY_LATEST_KEY` at retrieval (`resolveLatestFactsByLogicalKey`).

Key = `category:subject:attribute` (no value). T10 and T20 both `relationship:char_a_char_b:scene_event` → latest turn wins, T10 removed from prompt.

## ROOT CAUSE

### HISTORICAL_EVENT_LATEST_KEY_COLLISION = **ROOT_CAUSE_FIXED**

`resolveLatestFactsByLogicalKey()` applied latest-wins to all facts regardless of temporal nature. Distinct completed scene events with same logical key but different direction/value were collapsed.

**Fix:** Classify `explicit_scene_event` + completed-scene attributes as `historical_event`. In `resolveLatestFactsByLogicalKey`, preserve all distinct `historical_event` source turns per key; apply latest-wins only to state-like rows.

### ROLE_EVENT_DIRECTION_CONTINUITY = **ROOT_CAUSE_FIXED** (retrieval + prompt owners)

Primary user-visible inversion traced to REC-09 retrieval collapse. Rolling summary compression wording updated proactively (RS-2 risk). Episodic extraction example added for generic directional events.

### FALSE_FIRST_TIME_CONTINUITY = **ROOT_CAUSE_FIXED** (truth contract)

`NO_FALSE_SHARED_MEMORY_RULE` and episodic prompt header extended: absence of retrieved memory ≠ proof of "first time" / "never before". Live model compliance unverified (MODEL_COMPLIANCE_UNVERIFIED).

## PATCH

1. `episodicMemoryTemporal.ts` — `COMPLETED_SCENE_EVENT_ATTRIBUTES`, `evidence_type` input, classify completed scene events as `historical_event`.
2. `episodicMemoryFacts.ts` — split latest-wins vs historical preservation in `resolveLatestFactsByLogicalKey`; episodic header truth lines.
3. `memory-rolling-summary.ts` — replace compression rule that treated distinct directional events as "same relationship dynamic repetition".
4. `memory-episodic-prompt.ts` — generic `scene_event` allowed example (no dominance inference).
5. `noGodmodding.ts` — extend false shared memory rule for first/never claims.
6. Regression tests REC-01..15 subset + state latest-wins regression.

## REMOVED / CONSOLIDATED

- Removed: `같은 관계 역학의 반복은 최초 또는 가장 강한 전환점 한 번만 보존` (rolling summary).
- Consolidated: first/never truth into existing `NO_FALSE_SHARED_MEMORY_RULE` + episodic header (no new owner).

## PRESERVED

- RAW4/RAW5, summary interval, Shared Initial call count, schema, Relationship Ledger ownership, #958/#959/#960 invariants.
- Durable preference latest-wins (regression test included).

## PROVIDER CALL DELTA

0 (deterministic fixtures only).

## REGRESSION RISKS

- More historical events may appear in episodic prompt when same key has multiple scene_event turns (bounded by existing maxFacts/maxChars).
- Preference/state latest-wins unchanged for non-historical facts.

## PROOF

- `role-event-direction-continuity.test.ts` — REC-09 both T10+T20 in recall; REC-15 nonsexual; preference latest-wins regression.
- `episodicMemoryTemporal.test.ts` — scene_event → historical_event.
- `npm run lint`, `npm run typecheck:app`, `npm run build`, targeted test suite.

## HARDENING FOLLOW-UP (amend)

### BLOCKER 1 — FALSE_FIRST_TIME PRODUCTION MISS PATH

**Reproduction (REC-16):** `formatEpisodicMemoryPromptSection([])` → `""`; standard interactive had no episodic header on zero-recall path. `NO_FALSE_SHARED_MEMORY_RULE` was not in standard/auto/delegated/regen owners (co-narration only).

**Classification:** `FALSE_FIRST_TIME_PRODUCTION_MISS_PATH` = **ROOT_CAUSE_CONFIRMED** → **ROOT_CAUSE_FIXED**

**Fix:** New canonical owner `historicalTruthPolicy.ts` → `HISTORICAL_TRUTH_POLICY_BLOCK`, injected once via `contextBuilder` on all Main RP paths. Episodic header trimmed to retrieved-event interpretation only. Duplicate full bodies removed from co-narration, sceneDirective, livingSceneDirective, sceneDirectiveV2.

### BLOCKER 2 — SAME-TURN HISTORICAL COLLAPSE

**Reproduction (REC-20):** Same `source_turn` + same logical key + different `value` → pre-fix `Map<source_turn>` kept one row.

**Classification:** `SAME_TURN_HISTORICAL_COLLAPSE` = **ROOT_CAUSE_CONFIRMED** → **ROOT_CAUSE_FIXED**

**Fix:** Historical branch dedupes by `source_turn:category:subject:attribute:value` (aligned with persist `dedupeFactsWithinResponse`). REC-21: exact duplicate still single row at persist.

### PRODUCTION MODE OWNER MATRIX (historical truth full owner count)

| Mode | Count |
|---|---|
| STANDARD | 1 |
| AUTO | 1 |
| CO-NARRATION | 1 (common owner; mode block has no duplicate full body) |
| DELEGATED | 1 |
| REGEN | 1 |

## CLASSIFICATION SUMMARY

| Area | Status |
|---|---|
| ROLE_EVENT_DIRECTION_CONTINUITY | ROOT_CAUSE_FIXED |
| HISTORICAL_EVENT_LATEST_KEY_COLLISION | ROOT_CAUSE_FIXED |
| SAME_TURN_HISTORICAL_COLLAPSE | ROOT_CAUSE_FIXED |
| FALSE_FIRST_TIME_CONTINUITY | ROOT_CAUSE_FIXED (pipeline contract; MODEL_COMPLIANCE_UNVERIFIED) |

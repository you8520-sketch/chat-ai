# TRPG Bot-Seat Latency-Hiding Pipeline — Read-Only Feasibility Audit

Audit date: 2026-08-28  
Base SHA: `a61dee8446ae97e54af6cb8d996c8aafad1008e4` (origin/main at benchmark start)  
Scope: evidence-only architecture audit. **No implementation** in this task.

## CURRENT_PIPELINE

```
Human action locked (trpg_action_submissions)
  → phase ACTION_INPUT / BOT_ACTION
  → resolveTrpgRoundWork → generate_bots (engineAdvance.ts)
  → generateBotActions() sequential loop (engineAdvance.ts ~940)
       Bot1: buildTrpgBotActionUserBlock → callTrpgBot → upsertLockedAction
       Bot2: same, companionActions = [Bot1 canonical body]
  → acquire_gm_lock (roundLock.ts tryAcquireGmLock)
  → persistRolls() — ALL locked submissions, single transaction (engineAdvance.ts ~1077)
  → phase ROLLING + resolutionOrder persisted
  → runGmForRound / GM stream
```

Presentation (`roundPresentation.ts`):
- `isLiveRoundPresentationReady` = false during `BOT_ACTION` (cinematic blocked).
- Pre-cinematic declaration (`resolvePreCinematicDeclarationReveal`) can show persisted human + AI prose before liveReady.
- Cinematic dice (`TrpgDiceOverlay`, `diceRollUx.ts`) starts only when phase ∈ `{ROLLING, GENERATING_NARRATION, …}`.

## TARGET_PIPELINE

```
Human action submitted & visible
  ├─ Bot1 provider call starts
  └─ (optional) human roll presentation during Bot1 wait if mechanically safe

Bot1 canonical action persisted
  ├─ Bot2 provider call starts immediately (human + Bot1 ACTION only)
  └─ Bot1 declaration reveal → Bot1 roll animation → Bot1 RESULT_CONFIRM (parallel to Bot2 gen)

Bot2 canonical action ready → Bot2 reveal → Bot2 roll → RESULT_CONFIRM → GM consequence stream
```

**BOT2_TARGET_START_TRIGGER** = `BOT1_CANONICAL_ACTION_PERSISTED` (not dice/result/GM).

## Owner map (ONE_BEHAVIOR_ONE_OWNER)

| Concern | Owner |
| --- | --- |
| Human action lock/persistence | `upsertLockedAction` / action submission routes → `trpg_action_submissions` |
| Bot generation ordering | `orderTrpgBotsForRound` + `generateBotActions` loop (`botActions.ts`, `engineAdvance.ts`) |
| Bot1 canonical persistence | `upsertLockedAction` inside `generateBotActions` after each bot call |
| Bot2 provider start | Same loop: next iteration after Bot1 row persisted; `companionActions` from `earlier[]` |
| Declaration reveal | `resolvePreCinematicDeclarationReveal` (`roundPresentation.ts`) |
| Resolution order | `computeResolutionOrder` (`initiative.ts`) — stats/slots only |
| Roll creation/persistence | `persistRolls` (`engineAdvance.ts`) — sole dice row writer for a round |
| Dice presentation | `TrpgDiceOverlay` + `diceRollUx.ts` + `roundPresentation.ts` cinematic walker |
| Result-confirm timing | `roundPresentation.ts` phase `actor-result`, `diceRollUx.trpgResultConfirmPerDieMs` |
| GM generation eligibility | `tryAcquireGmLock` → `persistRolls` → `tryBeginGmGeneration` → `runGmForRound` |
| Pre-action mechanics snapshot | `ensurePreActionMechanics` (`mechanicsRound.ts`) — called at start of `persistRolls` |

## BOT2_CURRENT_START_TRIGGER

**`BOT1_CANONICAL_ACTION_PERSISTED`** — verified in `generateBotActions`:

```1054:1062:src/lib/trpg/engineAdvance.ts
    const { text, usage } = await botCall(TRPG_BOT_SYSTEM, user);
    const body = prepareTrpgBotActionBody(...);
    upsertLockedAction(db, opts.roundId, bot.id, body, ...);
    ...
    earlier.push({ name: bot.display_name, text: body });
```

Bot2's `companionActions` receives Bot1's full persisted body; `buildTrpgBotActionUserBlock` exposes **parsed intent only** to Bot2 (not dice/tier/GM). **Current backend already matches the Bot2 semantic contract.**

## Feasibility Q&A

### Q1. Can the human actor's authoritative roll be safely generated/persisted while Bot1 provider generation is still in flight?

**NOT_PROVEN / effectively NO under current owners.**

- `persistRolls` runs only on `acquire_gm_lock`, after all bots finish (`roundLock.ts` `nextTrpgRoundWork`).
- Early return if any dice row exists for the round (`if (existing) return`) — no partial roll sets.
- Human submission is already locked before `generate_bots`, but **roll RNG + `trpg_dice_rolls` insert** is deferred.

### Q2. If yes, which roll owner must be refactored? If no, what invariant prevents it?

**N/A (Q1 = no).** Blockers:
1. `persistRolls` owner is post-bot, pre-GM (`engineAdvance.ts` ~809–815).
2. `persistRolls` all-submissions loop + single-transaction insert (`~1107–1197`).
3. `isLiveRoundPresentationReady` excludes `BOT_ACTION` — cinematic roll UX cannot start even if rows existed.

### Q3. Can Bot1's authoritative roll be generated/persisted immediately after Bot1 canonical action persists, while Bot2 provider call is running?

**NOT_PROVEN — blocked by monolithic `persistRolls`.**

- Bot1 persistence and Bot2 call can overlap **today** (Bot2 starts after Bot1 upsert in-loop).
- Roll for Bot1 only would require splitting `persistRolls` per submission — not supported; function processes all `locked=1` subs and sets phase `ROLLING` once.

### Q4. Can Bot2 provider generation start immediately after Bot1 canonical persistence under CURRENT backend?

**YES — already true.** Bot2 call begins in the same `generateBotActions` loop iteration order after Bot1 `upsertLockedAction` + `earlier.push`.

### Q5. Does current `persistRolls()` require the entire action set to be final?

**YES.** It selects all `locked=1` submissions for the round and rolls in one pass; idempotent guard requires zero existing dice rows for the round.

### Q6. Does resolution-order computation require Bot2 action content?

**NO.** `computeResolutionOrder` uses participant sheets/stats/slots only (`initiative.ts`). Action bodies affect check necessity via `resolveTrpgActionCheckDecision` inside `persistRolls`, not resolution order.

### Q7. Would incremental roll creation risk duplicate RNG / rows / timing drift?

| Risk | Verdict | Owner |
| --- | --- | --- |
| Duplicate RNG consumption | **YES** if `persistRolls` invoked twice without idempotency per submission | `persistRolls` + `deps.rollD20` |
| Duplicate dice rows | **YES** — current guard is round-level `LIMIT 1` existence check, not per-submission | `persistRolls` ~1083 |
| Mechanics modifier timing changes | **YES** — `ensurePreActionMechanics` runs once at roll persist; mid-bot incremental rolls could see stale pre-action state | `mechanicsRound.ts` |
| Condition timing changes | **YES** — same pre-action snapshot | `ensurePreActionMechanics` |
| Result-order drift | **NOT_PROVEN** — order fixed before rolls today; incremental would need per-actor roll registration without recomputing | `initiative.ts`, `input_snapshot_json` |
| Recovery/idempotency races | **YES** — bot recovery replays `generateBotActions`; partial rolls + retry could diverge | `botGenerationRecovery.ts`, `persistRolls` guard |

### Q8. Can presentation safely show a roll while phase is still `BOT_ACTION`?

**NO for cinematic dice.** `isLiveRoundPresentationReady` returns false for `BOT_ACTION`. Human/AI **declaration prose** can show earlier via `preCinematicVisibleActionIds` / `incrementalPresentation.test.ts` T1–T2.

### Q9. MINIMAL architecture change for target pipeline without duplicating mechanics owners

1. **Split `persistRolls`** into idempotent `persistRollForSubmission(submissionId)` callable when each canonical action persists (human after lock, Bot1 after upsert, Bot2 after upsert).
2. **Defer phase transition** — do not set `ROLLING` until all expected rolls computed OR gate cinematic separately from phase.
3. **Extend presentation** — allow `actor-dice` for actors whose roll rows exist while phase remains `BOT_ACTION` / `GENERATING_NARRATION` for later bots (presentation-only; keep `computeResolutionOrder` unchanged).
4. **Keep single RNG owner** — inject `deps.rollD20` once per submission with DB uniqueness on `(round_id, submission_id)`.

### Q10. Simpler safe variant achieving most latency hiding?

**YES — partial GO without incremental rolls:**

- Already implemented: Bot2 starts after Bot1 canonical persist; declaration reveal can show Bot1 prose while Bot2 generates.
- **Not implemented:** overlapping human/Bot1 roll animation with Bot1 provider wait (requires Q9 roll split).
- **Lowest-risk win:** start Bot1 declaration reveal + readable copy immediately on Bot1 persist while Bot2 call runs (presentation-only tweak, no roll owner change).

## Summary fields

| Field | Value |
| --- | --- |
| BOT2_CURRENT_START_TRIGGER | `BOT1_CANONICAL_ACTION_PERSISTED` |
| BOT2_TARGET_START_TRIGGER | `BOT1_CANONICAL_ACTION_PERSISTED` (already met) |
| HUMAN_ROLL_DURING_BOT1_FEASIBLE | **NO** (current `persistRolls` + presentation gate) |
| BOT1_ROLL_DURING_BOT2_FEASIBLE | **NO** (same monolithic roll owner) |
| CURRENT_ROLL_OWNER | `persistRolls` in `engineAdvance.ts` |
| CURRENT_PRESENTATION_READY_GATE | `isLiveRoundPresentationReady` (`roundPresentation.ts`) |
| INCREMENTAL_ROLL_REQUIRED | **YES** for full target (human/Bot1 rolls during provider waits) |
| DUPLICATE_OWNER_RISK | **YES** if incremental rolls added without per-submission idempotency |
| MINIMAL_SAFE_CHANGE | Per-submission idempotent roll persist + presentation gate allowing actor-dice before round `ROLLING` |
| ARCHITECTURE_VERDICT | **GO_WITH_CONSTRAINTS** |

Bot2 timing semantics are already correct. Full latency hiding through early rolls requires a **focused `persistRolls` refactor** — not a second roll owner.

# Current-user false-canon recency — 2026-09-30

Status: **ROOT_CAUSE_FIXED**

## Scope

This audit is intentionally narrow.

It addresses the path where the **current USER message itself** contains a recall /
past presupposition such as:

> 내가 평소에 뭐 좋아하는지 기억하지?

and the model fills missing details as if there were confirmed prior shared history.

It is separate from:
- assistant-authored history contamination;
- rolling-summary / episodic provenance;
- relationship-memory persistence.

Those have separate owners and regressions.

## BEFORE

The canonical full owner already existed exactly once:

`[HISTORICAL TRUTH — CANONICAL MEMORY]`

It correctly said that premise-only questions such as `기억하지?`,
`평소에 뭐 좋아하는지`, and `전에 뭐였더라?` are not evidence of the
missing historical details.

However, that owner lived in earlier system context while the misleading USER
presupposition was the newest message.

The 2026-09-28 3-model qualification reproduced the failure with **zero injected
LTM / episodic / relationship memory**:

- DeepSeek V4.1 Flash: handled the explicit trap but had another bounded
  unsupported shared-event issue in a different production case.
- Gemini 3.7 Flash: invented several concrete prior shared events in the trap.
- Claude Opus 5.5: invented several highly specific prior shared events in the trap.

This proved the direct trap was not caused by memory persistence.

## ROOT CAUSE

**Recency/adherence conflict, not a missing truth owner.**

The last USER message carried a strong implicit premise while the historical
evidence rule was farther away in system context. Gemini/Opus in particular
preferred helpful completion of the premise over the earlier evidence boundary.

## AFTER

No second historical-truth owner was created.

Canonical owner:
`src/lib/historicalTruthPolicy.ts`

The same owner now also provides:
1. a narrow detector for recall/presupposition-shaped current USER inputs;
2. a compact **reference-only** recency pointer.

`contextBuilder.ts` places that pointer on the current USER turn immediately
before the existing terminal length owner.

The pointer does not duplicate the full semantics. It says the current USER
contains a historical premise and refers back to the canonical
`[HISTORICAL TRUTH — CANONICAL MEMORY]` owner.

Concrete user-authored past setup remains valid evidence and does not receive the
pointer merely for being past-tense.

## DETERMINISTIC PROOF

Regression coverage proves:

- one full historical-truth owner remains in system prompt;
- one compact current-user pointer is emitted for the risky recall shape;
- DeepSeek V4.1 / Gemini 3.7 / Opus 5.5 all receive the same pointer;
- concrete OOC past setup does not get an unnecessary pointer.

## LIVE RESMOKE

GitHub Actions run: `36718167905`

Case: `false_canon_trap`

Calls:
- DeepSeek V4.1 Flash: 1
- Gemini 3.7 Flash: 1
- Claude Opus 5.5: 1

Total provider calls: **3**
Retry/fallback: **0**

### DeepSeek V4.1 Flash — PASS

It explicitly rejected the premise:

> "기억은 무슨. 오늘 처음 보는 것 같은데."

It then guessed from the current scene rather than inventing shared history.

### Gemini 3.7 Flash — PASS for the historical-truth gate

It playfully claimed to know the preference in dialogue, but the narration
explicitly established that it was bluffing / guessing from current reactions.

No concrete prior shared meal, market trip, promise, or domestic routine was
asserted as objective history in this resmoke.

### Claude Opus 5.5 — PASS for the historical-truth gate

It did not assert a prior relationship as fact. It asked:

> "우리 전에 만난 적 있어?"

and treated the user's premise as uncertainty rather than reconstructing missing
shared events.

### Result

Targeted historical-truth gate: **3/3 PASS**

This does not mean all prose/canon issues in these models are solved. It proves
the specific current-user-presupposition failure path was removed under the
canonical fixture.

## PRESERVED

- concrete USER/OOC past facts remain usable;
- harmless independent user-backstory inference remains allowed;
- current-scene relationship progression remains allowed;
- memory architecture unchanged;
- COMMON PROSE unchanged;
- model routing/pricing unchanged;
- length owner remains terminal.

## REQUIRED CLEANUP

The one-shot live trigger was removed immediately after the resmoke.

## FOLLOW-UP

Continue with RP quality work in this order:
1. authorial-habit / prose-mechanics cleanup;
2. quiet / banter / tension scene quality regressions;
3. creator-defined narration style UX/runtime integration.

Do not reopen historical-truth prompt wording unless a new deterministic failure
shows this same path still failing.

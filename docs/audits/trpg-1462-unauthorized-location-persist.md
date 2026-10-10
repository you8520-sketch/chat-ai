# TRPG #1462 unauthorized location persist

Classification:
- LOCATION_PERSIST_ROOT_CAUSE_FIXED (this PR)
- GEMINI_NARRATION_ROOT_CAUSE_UNCONFIRMED
- #1480 MERGE_HOLD
- #1485 EXPERIMENT_COMPLETE
- HP DATAFLOW FOLLOW-UP

Provider POSTs: **0**. Production destructive DB writes: **0**.

This Draft is main-based and persist-only. It does not include #1480 prompt wording, #1485 experiment executor/approval, or stacked #1465 extras.

## OWNER MAP

- Action classification: `actionCheck` / `actionCheckContext` (`declaresTraversalIntent`, `actionReferencesOpenRoute`, frozen `routine_traversal`)
- Frozen movement verdict: `roundAdjudication.loadFrozenAdjudicationDecision`
- Location persist bind: `campaignLedger.bindGmLocationToSubmittedMovement`
- Campaign/player location write: `applyCampaignLedger` + sheet persist after bind
- GM structured parse: `parseTrpgGmOutput`
- Raw archive: `trpg_gm_messages.structured_json` stores the **unbound** parsed GM object
- Mechanics HP: `mergeMechanicsOwnedDelta` / `resolveParticipantHp`

## BEFORE

`commitPendingGmResult` wrote `parsed.location` / `parsed.delta.location` into the campaign ledger and player sheets. A talk/stand action such as `우측 환풍구 앞에서 사람에게 말을 걸어본다.` could persist an open-route destination the player did not traverse.

## PROBLEM

Unauthorized GM location became stored campaign/sheet state. Historical fail: #1468 F undeclared dock→tavern. User-reported fail: talk-in-front-of-vent → vent.

## ROOT CAUSE

Location persist had no dest authorization. Opening could set the start place; later rounds treated any GM location as canon.

## AFTER

`bindGmLocationToSubmittedMovement` runs before ledger/sheet apply. A later-round location sticks only when that participant has a non-failure locked action that already authorizes the dest: frozen `acceptedRoute` (exact or a more-specific same place), or a declared traversal whose body names that dest. Interior suffixes (`내부`) and parent-location tokens (`석등 골목`) do not block a named place. Sibling lookalikes still reject on conflicting directional qualifiers. Compare each sheet's previous location, not only the shared ledger.

Paid C regression: `열린 찻집 문으로 들어간다.` + Gemini `석등 골목 찻집 내부` (C_1465) / `석등 골목 찻집 안` (C_1480) now persist on ledger and sheet.

## REMOVED

Nothing from production GM retry, billing, prompt wording, or the paid-experiment executor.

## PRESERVED

Explicit walk/enter (`주점으로 간다.`, `주점으로 걸어간다.`, `우측 환풍구로 걸어간다.`, open-route `routine_traversal`), opening start location, regenerate (no second persist), failed movement, existing stored location, mechanics HP owner, C/D controls from the paid run.

## REGRESSION RISKS

World-forced relocation without a submitted traversal still has no persist owner (T9/L5). Raw `structured_json` still archives the GM-proposed location; ledger/sheets do not.

## HP DATAFLOW (D_1480)

Paid case D_1480 emitted `players[0].hp=8` with no input HP change. That run never called `commitPendingGmResult` (production DB writes 0). On the production commit path, raw `structured_json` keeps the GM HP, and `mergeMechanicsOwnedDelta` can apply a valid integer `hp` when mechanics is incomplete, or when complete mechanics does not own current-action HP. No campaign sheet was damaged by the paid run. No HP code in this PR. FOLLOW-UP on the existing mechanics owner.

## PROOF

Deterministic `unauthorizedLocationPersist.test.ts` and `campaignLedger.test.ts`: fail-before on main (talk-at-vent persists dest), pass-after bind (stays), adjacent walk/enter/opening/regenerate/failed-move preserved.

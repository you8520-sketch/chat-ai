# 02 — Source of Truth Matrix

Investigation of where each data class's current authority lives, and the recommended future SoT after the Numeric State System.

## Current SoT findings

### "Latest actual status value" — where is it read?

| Reader | Source | Notes |
|---|---|---|
| `loadPreviousStatusWidgetValuesDetailed` (`statusWidget/loadPrevious.ts:38`) | `messages.status_widget_values_json` column of latest finalized assistant row with `generation_status IN ('completed','ok','completed_with_postprocess_error')` | **Does NOT read variant snapshots.** Reads message column. |
| UI hydration (`messages/route.ts:71`, `page.tsx:366`, `message/route.ts:100`) | active variant snapshot `alternates[].statusWidgetValues` if key present, else `messages.status_widget_values_json` | Variant wins for UI when key exists (even null). |
| Trigger eval (`statusWidgetTriggers.ts:380`) | `mergeNamespacedStatusValues(values).creatorForTriggers` from the **current turn's** `statusWidgetValuesPayload` | Not the "latest" — the just-finalized turn's payload. Creator namespace only. |
| Background extract seed (`telemetry.ts:304`) | `loadPreviousStatusWidgetValuesDetailed` (message column) | Previous anchor for extract prompt. |

### Active variant switch — who wins?

`PATCH /api/chat/message/variant` (`variant/route.ts:71-93`) **copies the selected variant's `statusWidgetValues` into `messages.status_widget_values_json`**. So after a switch:
- The message column reflects the active variant.
- The anchor loader (message column) now reads the switched variant's snapshot.
- **Episodic facts and trigger events are NOT touched** by variant switch.

### message row vs variant snapshot divergence

- `finalizeAssistantMessage` writes both the message column AND the active variant's `statusWidgetValues` in `alternates` JSON from the same `statusWidgetValuesPayload`, so they are consistent at finalize.
- Manual edit (`message/route.ts:176`) collapses alternates to a single edited variant and writes the message column — per-variant snapshots are discarded.
- Variant switch keeps inactive variants' snapshots in `alternates` JSON untouched.

### Regeneration — which snapshot does the next-turn extractor read?

After regen finalize, the message column = new variant's payload. `loadPreviousStatusWidgetValuesDetailed` reads the message column → reads the **new variant's** snapshot. Correct for the immediate next turn. But stale trigger events from the old variant remain (see doc 05).

## Source of Truth Matrix (required format)

```text
DATA                         CURRENT SoT                              FUTURE RECOMMENDED SoT
---------------------------------------------------------------------------------------------------------
RP prose                     active variant (messages.content +       active variant
                             alternates[].content)
non-numeric status snapshot message row + active variant snapshot  message snapshot (display only)
numeric status              messages.status_widget_values_json       server state current
                             (char namespace, string-typed)          (rp_numeric_state_current)
episodic durable fact       episodic_memory_facts                    episodic_memory (event semantics only)
trigger condition           creator status snapshot (string parse)   server numeric / legacy split
trigger event               status_trigger_events                    status_trigger_events (+ reconcile)
current temporal snapshot   messages.status_widget_values_json       existing temporal status path
                             (time/place/situation fields)
manual numeric override     message PATCH (statusWidgetValues)       server state event (manual_override)
```

## `?` cells resolved

- **numeric status**: current SoT = `messages.status_widget_values_json` character namespace, string-typed, written by the background extractor and overwritable by manual edit. There is **no separate numeric authority** — the extractor's string output is treated as the value, parsed to number only at trigger-eval time.
- **current temporal snapshot**: current SoT = same `status_widget_values_json` column (time/place/situation/inner_thought fields), string-typed, last-writer = extractor or manual edit.
- **manual numeric override**: current SoT = `PATCH /api/chat/message` writing `statusWidgetValues.character` into `status_widget_values_json`. No ledger, no validation against min/max, no distinction between latest vs historical message.

## Implications for Numeric State design

1. `messages.status_widget_values_json` is currently **both** the display snapshot AND the de-facto numeric SoT. The future system must split these: snapshot stays for display; numeric SoT moves to `rp_numeric_state_current`.
2. Trigger evaluation currently parses strings from the creator snapshot. Future numeric triggers must read typed `rp_numeric_state_current`; legacy string triggers keep the existing path.
3. Manual edit currently writes directly to the snapshot with no validation. Future manual numeric edits must go through the reducer (validate, clamp, ledger `manual_override`).
4. Variant switch currently re-points the snapshot but does not reconcile numeric state, episodic facts, or triggers. Future system must decide whether numeric state follows the active variant (replay) or is turn-keyed only.

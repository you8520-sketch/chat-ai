# 01 — Current RP Status Pipeline Map

Read-only audit of the production pipeline that connects RP assistant output → status widget → episodic memory → triggers → next-turn prompt. No code changes.

## End-to-end flow

```text
user message
  ↓ src/app/api/chat/route.ts (POST)
main RP generation
  ↓ src/lib/openRouterAdult.ts streamOpenRouterWithLiveLiveStrip (~1649)
assistant prose finalization
  ↓ route.ts:2879 preStatusPartitionText = fullText
status widget resolution
  ↓ src/lib/statusWidget/resolve.ts resolveStatusWidgetTurn (22-92)
  ↓ route.ts:1290 statusWidgetActive = turn.active && !chatOocHtmlOutputTurn
background status extraction
  ↓ src/lib/statusWidget/telemetry.ts resolveStatusWidgetTurnValues (197-505)
  ↓   split_raw: src/lib/statusWidget/deepseekCapture.ts splitProseAndStatusWidgetValuesDeepSeek (182-229)
  ↓   v3 extract: src/lib/statusWidget/extract.ts extractStatusWidgetValuesForTurn (953-1414)
status normalization / sanitization
  ↓ src/lib/statusWidget/parseValues.ts normalizeParsedStatusWidgetValuesForTurn (259-273)
  ↓ src/lib/statusWidget/extractedFacts.ts sanitizeExtractedFacts (67-106)
character/user status values + extracted_facts (same JSON)
  ↓ ParsedStatusWidgetTurnValues { character, user, extracted_facts }
message + variant status snapshot save
  ↓ route.ts:4315-4334 build newVariant + serializeStatusWidgetValuesJson
  ↓ src/lib/streamingPersistence.ts finalizeAssistantMessage (429-493)
  ↓   UPDATE messages SET status_widget_values_json=?, alternates=?, ...
episodic fact persistence
  ↓ route.ts:4562-4618 (gated by extractedFactsForPersistence.length > 0)
  ↓ src/lib/episodicMemoryFacts.ts persistEpisodicMemoryFactsBestEffort (436-537)
status trigger evaluation
  ↓ route.ts:4627-4636 (gated by statusWidgetValuesHasContent)
  ↓ src/lib/statusWidgetTriggers.ts evaluateStatusWidgetTriggersBestEffort (531-541)
trigger event queue
  ↓ status_trigger_events (is_consumed=0)
next-turn trigger consumption
  ↓ route.ts:1382-1390 loadQueuedStatusTriggerEventsForPrompt
  ↓ route.ts:4621-4625 markStatusTriggerEventsConsumed (before next eval)
episodic recall
  ↓ route.ts:1407-1420 getEpisodicMemoryForPrompt
next prompt
  ↓ src/services/contextBuilder.ts buildContext
```

## Per-stage detail

| Stage | File | Function | Input | Output | DB write | Idempotency | Regen behavior | Failure behavior |
|---|---|---|---|---|---|---|---|---|
| Turn activation | `statusWidget/resolve.ts` | `resolveStatusWidgetTurn` (22) | widget json, chatMode | `ResolvedStatusWidgetTurn` | none | none | same | `active=false` → skip extract |
| RP capture | `openRouterAdult.ts` | `streamOpenRouterWithLiveStrip` (~1649) | stream tokens | `fullText`, `savedText` | `content` via throttler | `request_id` via `findTurnByRequestId` | reuse assistant row | partial content on abort |
| Widget resolve | `statusWidget/telemetry.ts` | `resolveStatusWidgetTurnValues` (197) | savedText, rawWidgetSourceText, widgets | `{ prose, values, usage, meta }` | none (reads anchor) | none | `excludeMessageId` prevents self-anchor | catch (430) → empty payload |
| split_raw parse | `statusWidget/deepseekCapture.ts` | `splitProseAndStatusWidgetValuesDeepSeek` (182) | raw text | `ParsedStatusWidgetTurnValues` | none | none | re-parse | JSON fail → null |
| V3 extract | `statusWidget/extract.ts` | `extractStatusWidgetValuesForTurn` (953) | prose, prev anchor, seed | values + facts + usage | none | none | stateless per call | `STATUS_WIDGET_EXTRACT_EXHAUSTED` |
| Normalize | `statusWidget/parseValues.ts` | `normalizeParsedStatusWidgetValuesForTurn` (259) | parsed, widgets | sanitized mapped values | none | none | deterministic | drop placeholders |
| Prev anchor | `statusWidget/loadPrevious.ts` | `loadPreviousStatusWidgetValuesDetailed` (38) | chatId, excludeMessageId | `{ values, anchorMessageId }` | SELECT only | none | excludes self | returns null |
| Snapshot save | `streamingPersistence.ts` | `finalizeAssistantMessage` (429) | row fields, alternates, statusWidgetValuesJson | UPDATE messages | `messages.status_widget_values_json`, `alternates` | if existing status in {completed,ok,completed_with_postprocess_error} → no-op (462) | regen: bootstrap clears `status_widget_values_json=''` (191), then append variant | partial |
| Episodic persist | `episodicMemoryFacts.ts` | `persistEpisodicMemoryFactsBestEffort` (436) | facts, metadata | INSERT count | `episodic_memory_facts` | `(assistant_message_id, request_id)` count>0 → no-op (457) | `replaceSourceTurn` → DELETE by source_turn then INSERT | best-effort try/catch |
| Trigger eval | `statusWidgetTriggers.ts` | `evaluateStatusWidgetTriggersBestEffift` (531) | statusValues, sourceTurn, genSeq | INSERT events | `status_trigger_events` | `fire_once` + `alreadyFired`/`alreadyQueuedForTurn` (418) | not keyed to regen — no reconcile | none |
| Trigger consume | `statusWidgetTriggers.ts` | `markStatusTriggerEventsConsumed` (589) | event ids | UPDATE is_consumed=1 | `status_trigger_events` | none | n/a | none |
| Episodic recall | `episodicMemoryFacts.ts` | `getEpisodicMemoryForPrompt` (747) | chatId, currentTurn, budgets | `{ facts, promptBlock }` | SELECT only | none | `source_turn < currentTurn`, min-age, latest-wins | empty if disabled |
| Prompt inject | `services/contextBuilder.ts` | `buildContext` (821) | triggered events, episodic block | system prompt | none | none | n/a | n/a |

## Key structural observations

1. **Values and facts are co-produced** in the same extraction JSON at every point (`parseValuesJson`, `runExtractAttempt`, `parseCombinedDualWidgetExtractResponse`). `ParsedStatusWidgetTurnValues` carries `character`, `user`, and `extracted_facts` together.
2. **`extracted_facts` are stored in `messages.status_widget_values_json`** (full payload) but stripped for the client via `stripExtractedFactsForClient`.
3. **Anchor loader reads the message column only** (`loadPreviousStatusWidgetValuesDetailed`), not variant snapshots. Hydration for UI prefers variant snapshot when the key exists.
4. **Stream-time widget capture is disabled** — `capturedStatusWidgetValues = null` in `openRouterAdult.ts`; route uses `preStatusPartitionText` for widget resolution instead.
5. **Usability gate ignores facts-only payloads** — `statusWidgetValuesHasContent` checks char/user only; facts persist only when bundled with usable status values.
6. **Trigger evaluation is not keyed to regeneration** — no DELETE/supersede on regen (see doc 05).
7. **Episodic persist is gated by raw array length** at the route layer (see doc 04) — empty-fact regen skips the library DELETE.

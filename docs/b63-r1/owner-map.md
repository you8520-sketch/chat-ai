# B63 owner map (main 9d190989 / memory-identical e42fdd9b)

## Turn / RAW

- Completed turn = `user` row + `assistant` row; link via `messages.user_message_id`, else nearest preceding user. `src/lib/memory/memory-turn-loader.ts:55-116`.
- Greeting (`model='greeting'`) is turn 0 and never counted. `memory-turn-loader.ts:72-81`; `src/lib/hybridMemory.ts:52-55`.
- Non-canon OOC pairs are dropped; adopted scene = assistant-only turn. `memory-turn-loader.ts:134`; `src/lib/oocSceneRender.ts:195-198,308-340`.
- Count owner: `memory-turn-loader.ts:244-300` `countMemoryEligibleCompletedTurnsCore`.
- Reset boundary: `memory_reset_after_message_id` / `memory_epoch`; `memory-turn-loader.ts:137-142,293`; `memory-source-boundary.ts:63-70`.
- RAW: `RAW_HISTORY_COMPLETE_EXCHANGES=4` (`memory-constants.ts:8`); lag-aware pool `hybridMemory.ts:145-160`; trim floor `:168-177`.

## Per-turn calls

| job | owner | call |
|---|---|---|
| Shared Initial relationship (+optional suggestions/widget) | `postTurnSharedInitial/run.ts:38-70`; route `7068-7117` | 1 physical call |
| Independent episodic | `memory/memory-episodic-independent.ts:93-154`; route `6994-7007` | 1 call |
| Conditional relationship scene re-check | `memory/postTurnRelationshipScene.ts:90-129`; route `7125-7144` | ≤1 call |
| Relationship merge / episodic persist / counters | `memory/memory-manager.ts:400-679` | 0 calls |
| Turn-tail barrier | route `7204-7208`; `turnTailWork.ts:21,43-64` | — |

## Every 5 turns

- Trigger: `messageCount >= summarizedTurnCount + 5` (`memory-rolling-summary.ts:1778-1785`).
- Post-turn never seals; seal is deferred to next request start. `memory-manager.ts:667-678`; route `1642-1688`; `memory-rolling-summary.ts:1882-2062`.
- Executor: `processRollingSummaryBatch` `memory-rolling-summary.ts:1509-1689`.
- One narrative LLM call per batch: `summarizeMainEntriesNarrative` `:603-650` → `summarizeTurnBatch` `:307-413`.
- System prompt 450/600 target: `:86-143`; constants `memory-constants.ts:10-13`.
- Output clamp: `:342-346`, 3 attempts `:352-409`.
- Persist: `memory-summary-persist.ts:148-200` → `upsertSummaryRowCore` `:60-142`.
- Model: `BACKGROUND_OPENROUTER_MODEL` = `gpt-6-luna` (`ai.ts:107-136`; `chatModels.ts:111`).
- Cost ledger: **no row** for the 5-turn summary call (`memory-rolling-summary.ts:347-350` calls without `ledgerContext`).

## Writers / readers / priority

| layer | storage | writer | reader | prompt label |
|---|---|---|---|---|
| 5-turn summary | `chat_turn_summaries` | `memory-summary-persist.ts` | `memory-turn-summary.ts:153-160,350-362` | `[현재기억]` via Global |
| Global | `chat_memories.recent_summary` + projection | mirror `memory-summary-persist.ts:337-355`; compact `memory-global-compaction-execution.ts:158-297`; manual `memory-manager.ts:715-746` | `memory-lorebook-resolve.ts:41-184` | `[현재기억]` |
| Medium | read-only `chat_turn_summaries` | none | `memory-medium-term.ts:126-181` (15 blocks) | `[최근 기억]` only when Global compact/manual |
| Archive | `chat_memories.archive_summary` | `memory-manager.ts:196-219` | `memory-injector.ts:48-57`; `archiveSelective.ts` | `[과거 기억]` |
| Episodic | `episodic_memory_facts` | `episodicMemoryFacts.ts:997-1206` | `:3282-3565` | `[EPISODIC MEMORY - RETRIEVED FACTS]` |
| Relationship | `chats.memory_meta` JSON | `memory-relationship-meta.ts:62-70,907-1036` | `:46-58`; `chatMemory.ts:579-597` | `[Memory — 참고, 우선순위 2순위 하위]` |

Caps: `MEMORY_META_MAX` honorifics 20, items 30, thoughts 8, promises 15 (`chatMemory.ts:25-30`); thoughts are not injected (`:583-593`).

## Final wire

`src/services/contextBuilder.ts:256-1760` `buildContext`.

Memory-relevant order:
```
archive -> rules -> core master -> character canon -> identity/persona
-> medium -> current memory (Global) -> episodic -> scenario events
-> relationship -> lorebooks -> scene directive -> canon
```

History:
- pool `route.ts:1694-1703`; `nextTurnAssemblyPreparation.ts:299-386`.
- budget `contextTrack.ts:15` 10,000 tok; floor 4; trim `providerHistoryPolicy.ts:137-189`.
- payload shrink loop `contextBuilder.ts:1539-1550`; binary floor `:1564-1591`; history + current user `:1657`.

## Normal / regen / continuation / refresh

- Normal: RAW4; Global cutoff `completed - keptRaw + 1`.
- Regen: target assistant + parent user removed from history; parent user re-sent; divergence section; sealed batch rebuilt; pending seal deferred; `memory_epoch` bumped.
- Continuation: OOC anchor may be dropped; `CONTINUE_USER_DISPLAY`; `buildContinueNarrativeCommand`.
- Refresh/reconnect: no prompt build; GET messages returns DB rows; next request waits for prior memory tail.

## Stored but not retrieved / dropped before prompt

- Inactive / empty_ooc / noncanon / closed branch: `memory-turn-summary.ts:163-174`.
- RAW-overlap cutoff: `record.turnStart < excludeTurnStartGte` only (`memory-turn-summary.ts:332-340`).
- Medium disabled under exact Global; capped to last 15 blocks.
- Episodic: recall kill-switch, min age 5, relevance gate, contamination/ledger/psychological guards, duplicate filters, max 8 facts/1000 chars/2500 dynamic.
- Global: emergency trim drops oldest blocks at 10,000 chars (`memory-lorebook-resolve.ts:192-202`; `memory-lorebook-trim.ts:16-59`).
- Archive: 3,000 trim.
- Episodic: whole fact skipped, never truncated.
- History: prefix chunk drop of 10 messages (`hybridMemory.ts:264-309`).

## Per-turn narrative summaries

**None.** Only 5-turn rows (`chat_turn_summaries`, UNIQUE(chat_id, turn_number), `turn_end=start+4`).
- No per-turn writer. Dead legacy `analyzeTurnMemory` has no callers.
- No summary retrieval owner. Retrieval exists for episodic facts and archive only.

## Long-horizon tests / flags

- `memory-50turn-lifecycle.test.ts` (50 turns, 10 seals, RAW4).
- `memory50TurnAbRunner.ts` (provider-free 50-turn A/B), `LUNA_SUMMARY_LIVE_EXECUTE_SHIPPED=false`.
- `memory-episodic-long-horizon.test.ts`; `memory-rp-benchmark.ts` (store-size matrix, not turns).
- `scripts/memory-verification-prod-server.ts` (baseline/pr isolated DATA_DIR).
- Env: `MEMORY_FEATURE_ENABLED`, `EPISODIC_MEMORY_*`, `DYNAMIC_MEMORY_TOTAL_MAX_CHARS`, `BACKGROUND_MEMORY_MODEL`; no env flag for RAW window or 5-turn interval.

## R1 verified details (B63-R1)

- A/B/C/D final systemPrompt was reconstructed byte-equal to the original saved `systemPrompt`; `historyMessages=9` and `historyChars=40,431` match the original per-call JSON. The original JSON did not contain the `built.history` array, so the array is labeled reconstructed, not recorded. See `R1/input_recovery.md`.
- B and C final RAW are T97-100. C requested T95-100 but the 10k history budget trimmed it back to T97-100; T95-96 are absent. This is an operational trim finding, not fixed in R1.
- B summary coverage is T56-94. T95-96 are absent from both summary and RAW.
- D injects A Global T1-100 plus detail T75-94; T76-94 is duplicated between Global 5-turn blocks and the detail projection.
- A `[66~70턴]` summary contains the T71 instruction. T68/T70 status windows already state the plan, so this is a **plan-as-event/temporal ambiguity** candidate, not proven future-turn leakage. See `R1/cadence_audit.md`.
- B per-turn summaries were generated from 5-turn batch input, so earlier turn summaries can contain later-turn material (B73/B74 samples). T74 already states the next-day plan, so this is also a plan-as-event/temporal ambiguity candidate, not proven leakage.
- 40-turn `ren9_40turn_summary_reference.txt` is a summary reference for a different RP, not the Elin 100-turn dialogue.

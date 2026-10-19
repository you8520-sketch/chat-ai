# B9-2: why the stored Global reached the final request only from `[336~340턴]`

Scope: provider calls 0, embedding calls 0, production DB writes 0. Every fetch in the traces below is answered by a local stub. No product code is changed in this PR. The product defect found on the way is in a separate Draft PR (#1676).

## Result

| Question | Answer |
|---|---|
| Was the stored 9,853-character compact valid when the run started? | Yes. `global_compact`, fingerprint equals the recomputed prefix fingerprint, covered through turn 495. |
| Did the product trim it? | No. It was overwritten before the resolver ran. |
| What overwrote it, and where? | `reconcileSummarizedTurnCountFromTable` (`memory-summary-persist.ts`, the `UPDATE chat_memories SET recent_summary=…` inside its transaction), called from `syncMemoryFromChat` (`memory-backfill.ts`) at `route.ts` T3 memory sync. It wrote the 30,069-character full rebuild into `recent_summary` and cleared `global_projection_kind`, `global_source_fingerprint`, `global_covered_through_turn`. |
| Why did `syncMemoryFromChat` run? | The reconstruction (`fill-snapshot.mts`) never set `chat_memories.message_count`; it stayed at the default 0. `syncMemoryFromChat` only does work when `message_count` is 0. |
| Where does the omission prefix first appear? | `emergencyFallbackTrimLorebookSync` (`memory-global-projection.ts`) -> `clampLorebookPreferRecentChars` (`memory-lorebook-trim.ts`), called from the last `failure_fallback` return of `resolveGlobalCurrentMemoryCore` (`memory-lorebook-resolve.ts`), reached from `buildMemoryContextForChat` at `route.ts` (initial memory injection). The resolver took that branch because the checkpoint it needs was already gone. |
| Cause A (reconstruction left checkpoint info incomplete) | Confirmed as the trigger of the original run. |
| Cause B (Luna block or failure handling changed state) | Ruled out as a writer. The blocked Luna completions (background compact, extract, rolling summary) all failed with `global compact skipped (background)` / `SUMMARY_EMPTY` and the DB state at the end of the run equals the state before them. The background compact was scheduled only because the resolver had already returned `needsBackgroundCompact: true`. |
| Cause C (product discards a valid checkpoint on a normal path) | Reproduced, separately from the original run: with `message_count` restored to 500, opening the memory panel (`GET /api/chat/memory`) runs the same count repair and drops the valid compact. That is the defect fixed in #1676. The chat request path itself (`syncMemoryFromChat` no-op, `prepareNonBlockingSummaryForMainRp`, resolver, injection, `buildContext`) preserved the compact when nothing else had overwritten it. |

The B9-1 statement that "the live lorebook fit dropped older blocks" of a valid stored compact was wrong. The L500 final requests were built from a Global that the reconstruction had made unreadable by the product.

## What this means for the B9-1 L500 findings

The two L500 questions (A5 injury, B3 서윤) were answered from requests whose `[현재기억]` block was the emergency trim of the full rebuild, with no medium-term block. A normally stored chat would have sent the 9,853-character compact plus a 4,953-character medium-term block (the restored runs below). So the B9-1 L500 statements that early facts were "absent from the final request" describe the reconstruction state, not a product state. They are input findings only for that state. The T50 request was not affected (its stored summary equals the rebuild). No re-evaluation was run: that would be a new paid call and needs approval.

## Preservation and reproducibility

- Preserved copy, outside the repo (contains private character data): `/tmp/b9-preserved` on the evaluation VM, read-only, with `preserved-manifest.sha256.txt` (130 files, SHA-256). It holds the two clean snapshots (`snap-50`, `snap-500`), the six post-run DBs, the six live run directories (requests, SSE, `meta.json`, logs), and the scripts. Nothing in it was modified by B9-2.
- The first B9-1 live attempt failed on all six runs before any paid POST (`Production DATA_DIR is not backed by a detected mounted volume`). Its logs were overwritten by the successful rerun and cannot be restored.
- Every B9-2 trace works on a fresh copy of a preserved snapshot (`run-trace.sh.txt`); the preserved files are never opened for writing.
- Check that the dry reproduction is the original run: the Main RP request body of the original live run and of the dry reproduction on the same code are byte-identical for all four L500 runs (`a5-sol` 34,509 bytes, `a5-gemini` 34,691, `b3-sol` 34,563, `b3-gemini` 34,745). So the traces below show the state the paid calls actually saw.
- Execution order used in B9-1 (scripts in `b9-2/scripts`, copies without secrets; private inputs are not in the repo): (1) isolated DB from a read-only production export (`setup-isolated-db.mts`, B7 owner); (2) `fill-snapshot.mts 50|500` fills messages, stored summaries, the compact checkpoint and episodic rows; (3) `run-live.sh` runs `one-turn.mts` once per call. B9-2 adds `trace.mts` / `run-trace.sh` (state probe + export proxy + SQL write hook, all fetches stubbed) and `stage-table.py`.
- Reconstruction gap, exactly: `fill-snapshot.mts` writes `recent_summary`, `archive_summary`, `summarized_turn_count`, `global_projection_kind`, `global_covered_through_turn` and `global_source_fingerprint` (computed with `buildPrefixFingerprintThroughTurn`), but not `message_count`. Provenance of the fingerprint was complete: the recomputed value matches in every stage until the overwrite.

## Stage trace

Columns: `recent_summary` length / SHA-256 prefix (12) / `global_projection_kind` / stored fingerprint vs the value computed from the current records / `global_covered_through_turn` / `message_count`. "Resolver output" is the text the resolver returned, with `projectionKind`, `needsBackgroundCompact`, the rebuilt body length and the `excludeTurnStartGte` the route passed. Raw trace JSON is in `b9-2/traces/`.

Label rules: `as-run` is the original state (original reconstruction, current main code). `restored-count` and `restored-count-panel` are separate verifications with `message_count` set to 500 on a copy (`UPDATE chat_memories SET message_count=500`), nothing else changed, no validity check disabled, no `manual_global`. `fixed-*` runs use the #1676 branch.

### as-run

| Stage | Value (len / sha256-12 / kind / fingerprint vs computed / covered / message_count) | Note |
|---|---|---|
| DB after preparation | 9853 / 2c760ac67ea0 / global_compact / fp match / covered 495 / msg_count 0 |  |
| After syncMemoryFromChat | 30069 / d54835b47207 / NULL / fp none / covered NULL / msg_count 500 | returned True |
| After summary preparation | 30069 / d54835b47207 / NULL / fp none / covered NULL / msg_count 500 | unsummarized 496~500 |
| Resolver output (POST) | 9826 / 218628e9703a / omit prefix True / first block 336~340 | projectionKind failure_fallback, needsBackgroundCompact True, rebuilt 30069, stored 30069, excludeTurnStartGte 496 |
| Memory injection | 9887 / 329c9adc547e / omit prefix True / first block 336~340 | recent 9826, medium-term 0 |
| contextBuilder longTermMemory | 9887 / 329c9adc547e / omit prefix True / first block 336~340 | medium-term 0 |
| Main request before send (blocked locally) | 34509 bytes / header True / omit prefix True / first block 336~340 |  |
| DB at end | 30069 / d54835b47207 / NULL / fp none / covered NULL / msg_count 500 |  |

First omission prefix: `emergencyFallbackTrimLorebookSync` input 30069 chars -> output 9826 chars, first block 336~340; call chain: resolveGlobalCurrentMemoryCore memory-lorebook-resolve.ts:176:11 <- resolveGlobalCurrentMemory memory-lorebook-resolve.ts:47:20 <- buildMemoryContextForChat memory-manager.ts:262:20

Completion calls seen by the local stub: 5 (models: gpt-6-luna, gpt-6-luna, gpt-6.1-sol, gpt-6-luna, gpt-6-luna); reached network: 0.

### restored-count

| Stage | Value (len / sha256-12 / kind / fingerprint vs computed / covered / message_count) | Note |
|---|---|---|
| DB after preparation | 9853 / 2c760ac67ea0 / global_compact / fp match / covered 495 / msg_count 500 |  |
| After syncMemoryFromChat | 9853 / 2c760ac67ea0 / global_compact / fp match / covered 495 / msg_count 500 | returned False |
| After summary preparation | 9853 / 2c760ac67ea0 / global_compact / fp match / covered 495 / msg_count 500 | unsummarized 496~500 |
| Resolver output (POST) | 9853 / 2c760ac67ea0 / omit prefix False / first block None | projectionKind global_compact, needsBackgroundCompact False, rebuilt 30069, stored 9853, excludeTurnStartGte 496 |
| Memory injection | 9914 / c033dc234573 / omit prefix False / first block None | recent 9853, medium-term 4953 |
| contextBuilder longTermMemory | 9914 / c033dc234573 / omit prefix False / first block None | medium-term 4953 |
| Main request before send (blocked locally) | 39472 bytes / header True / omit prefix False / first block None |  |
| DB at end | 9853 / 2c760ac67ea0 / global_compact / fp match / covered 495 / msg_count 500 |  |

No omission prefix produced (`emergencyFallbackTrimLorebookSync` never called).

Completion calls seen by the local stub: 4 (models: gpt-6-luna, gpt-6.1-sol, gpt-6-luna, gpt-6-luna); reached network: 0.

### restored-count-panel

| Stage | Value (len / sha256-12 / kind / fingerprint vs computed / covered / message_count) | Note |
|---|---|---|
| DB after preparation | 9853 / 2c760ac67ea0 / global_compact / fp match / covered 495 / msg_count 500 |  |
| Before memory panel GET | 9853 / 2c760ac67ea0 / global_compact / fp match / covered 495 / msg_count 500 |  |
| After memory panel GET | 9826 / 218628e9703a / NULL / fp none / covered NULL / msg_count 500 | first writer: reconcileSummarizedTurnCountFromTable <- prepareMemoryPanelView |
| After syncMemoryFromChat | 9826 / 218628e9703a / NULL / fp none / covered NULL / msg_count 500 | returned False |
| After summary preparation | 9826 / 218628e9703a / NULL / fp none / covered NULL / msg_count 500 | unsummarized 496~500 |
| Resolver output (POST) | 9826 / 218628e9703a / omit prefix True / first block 336~340 | projectionKind failure_fallback, needsBackgroundCompact True, rebuilt 30069, stored 9826, excludeTurnStartGte 496 |
| Memory injection | 9887 / 329c9adc547e / omit prefix True / first block 336~340 | recent 9826, medium-term 0 |
| contextBuilder longTermMemory | 9887 / 329c9adc547e / omit prefix True / first block 336~340 | medium-term 0 |
| Main request before send (blocked locally) | 34509 bytes / header True / omit prefix True / first block 336~340 |  |
| DB at end | 9826 / 218628e9703a / NULL / fp none / covered NULL / msg_count 500 |  |

First omission prefix: `emergencyFallbackTrimLorebookSync` input 30069 chars -> output 9826 chars, first block 336~340; call chain: resolveGlobalCurrentMemoryCore memory-lorebook-resolve.ts:176:11 <- resolveGlobalCurrentMemory memory-lorebook-resolve.ts:47:20 <- resolveLorebookFromRecords memory-lorebook-resolve.ts:203:20

Completion calls seen by the local stub: 5 (models: gpt-6-luna, gpt-6-luna, gpt-6.1-sol, gpt-6-luna, gpt-6-luna); reached network: 0.

### fixed-reconstruction-asis

| Stage | Value (len / sha256-12 / kind / fingerprint vs computed / covered / message_count) | Note |
|---|---|---|
| DB after preparation | 9853 / 2c760ac67ea0 / global_compact / fp match / covered 495 / msg_count 0 |  |
| After syncMemoryFromChat | 9853 / 2c760ac67ea0 / global_compact / fp match / covered 495 / msg_count 500 | returned True |
| After summary preparation | 9853 / 2c760ac67ea0 / global_compact / fp match / covered 495 / msg_count 500 | unsummarized 496~500 |
| Resolver output (POST) | 9853 / 2c760ac67ea0 / omit prefix False / first block None | projectionKind global_compact, needsBackgroundCompact False, rebuilt 30069, stored 9853, excludeTurnStartGte 496 |
| Memory injection | 9914 / c033dc234573 / omit prefix False / first block None | recent 9853, medium-term 4953 |
| contextBuilder longTermMemory | 9914 / c033dc234573 / omit prefix False / first block None | medium-term 4953 |
| Main request before send (blocked locally) | 39472 bytes / header True / omit prefix False / first block None |  |
| DB at end | 9853 / 2c760ac67ea0 / global_compact / fp match / covered 495 / msg_count 500 |  |

No omission prefix produced (`emergencyFallbackTrimLorebookSync` never called).

Completion calls seen by the local stub: 4 (models: gpt-6-luna, gpt-6.1-sol, gpt-6-luna, gpt-6-luna); reached network: 0.

### fixed-normal-panel

| Stage | Value (len / sha256-12 / kind / fingerprint vs computed / covered / message_count) | Note |
|---|---|---|
| DB after preparation | 9853 / 2c760ac67ea0 / global_compact / fp match / covered 495 / msg_count 500 |  |
| Before memory panel GET | 9853 / 2c760ac67ea0 / global_compact / fp match / covered 495 / msg_count 500 |  |
| After memory panel GET | 9853 / 2c760ac67ea0 / global_compact / fp match / covered 495 / msg_count 500 | first writer: none (no checkpoint write) |
| After syncMemoryFromChat | 9853 / 2c760ac67ea0 / global_compact / fp match / covered 495 / msg_count 500 | returned False |
| After summary preparation | 9853 / 2c760ac67ea0 / global_compact / fp match / covered 495 / msg_count 500 | unsummarized 496~500 |
| Resolver output (POST) | 9853 / 2c760ac67ea0 / omit prefix False / first block None | projectionKind global_compact, needsBackgroundCompact False, rebuilt 30069, stored 9853, excludeTurnStartGte 496 |
| Memory injection | 9914 / c033dc234573 / omit prefix False / first block None | recent 9853, medium-term 4953 |
| contextBuilder longTermMemory | 9914 / c033dc234573 / omit prefix False / first block None | medium-term 4953 |
| Main request before send (blocked locally) | 39472 bytes / header True / omit prefix False / first block None |  |
| DB at end | 9853 / 2c760ac67ea0 / global_compact / fp match / covered 495 / msg_count 500 |  |

No omission prefix produced (`emergencyFallbackTrimLorebookSync` never called).

Completion calls seen by the local stub: 4 (models: gpt-6-luna, gpt-6.1-sol, gpt-6-luna, gpt-6-luna); reached network: 0.


### How to read the panel run

In `restored-count-panel` the memory panel GET does two writes: `reconcileSummarizedTurnCountFromTable` (via `prepareMemoryPanelView`) replaces the compact with the 30,069-character rebuild and clears the checkpoint; then `syncAndCompressMemoryFromChat` stores the resolver's emergency trim (9,826 characters) back into `recent_summary`. After that, a normal chat request cannot recover the compact; it takes the `failure_fallback` path and schedules a background compact.

## Product follow-up

- #1676: `reconcileSummarizedTurnCountFromTable` keeps a compact whose prefix fingerprint still matches the records and only repairs the count. Stale or invalid checkpoints and manual Global keep their existing handling. Fail-before/pass-after tests are in that PR.
- Not changed here and not part of #1676: the invalid-checkpoint branch still stores the full rebuild (30,069 characters here) in `recent_summary`, above the 10,000 capacity. It is trimmed at prompt time. Capping it is a separate follow-up.
- Not done: a B9-1-style real-model recall run on the restored state. That needs a paid call and approval.

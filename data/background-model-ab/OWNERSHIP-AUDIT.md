# Background LLM ownership audit

Audit date: 2026-08-26. Purpose: background model A/B bench (`deepseek-v4-flash-0731` vs `gpt-5.6-luna` on CheaperInference).

## Central transport

| Location | Symbol | Classification |
|----------|--------|----------------|
| `src/lib/ai.ts` | `callBackgroundMemory` | **CURRENT_OWNER** |
| `src/lib/ai.ts` | `callGeminiOnce` | **CURRENT_OWNER** |
| `src/lib/ai.ts` | `callGeminiBackground` | **COMPATIBILITY_ONLY_OWNER** (alias) |
| `src/lib/openRouterCompletion.ts` | `callOpenRouterCompletion` | **CURRENT_OWNER** |
| `src/lib/deepseekProviderFailover.ts` | `executeDeepSeekBackgroundWithProviderFailover` | **CURRENT_OWNER** (production only; bench bypasses) |
| `src/lib/cheaperInferenceConfig.ts` | `adaptCheaperInferenceChatBody` | **CURRENT_OWNER** (reasoning/thinking adapt) |

## Task owners (production)

| Task | File | `requestKind` | Classification |
|------|------|---------------|----------------|
| 5-turn rolling summary | `memory-rolling-summary.ts` | `background-memory-extract` | **CURRENT_OWNER** |
| Lorebook compact | `memory-rolling-summary.ts` | `background-lorebook-compact` | **CURRENT_OWNER** |
| Episodic extract | `memory-episodic-extract.ts` | `background-episodic-extract` | **CURRENT_OWNER** |
| Relationship meta | `ai.ts` | default extract kind | **CURRENT_OWNER** |
| Status widget V3 | `statusWidget/extract.ts` | `background-status-widget-extract*` | **CURRENT_OWNER** |
| Status meta (legacy) | `statusMeta/extract.ts` | `background-status-meta-extract` | **CURRENT_OWNER** (feature-gated) |
| OOC / HTML flash | `htmlVisualCardRecovery.ts` | `background-html-visual-card` | **CURRENT_OWNER** |
| Suggested replies | `suggestedReplies/extract.ts` | `background-suggested-replies-extract` | **CURRENT_OWNER** |
| Prompt translation | `promptTranslation.ts` | `background-prompt-translation` | **CURRENT_OWNER** |
| Scene brief | `chatImageSceneBrief.ts` | `background-chat-image-scene-brief` | **CURRENT_OWNER** |
| Appearance compile | `appearanceCompiler.ts` | `background-appearance-compile` | **CURRENT_OWNER** |

## Legacy / duplicate (not used by bench)

| Location | Classification |
|----------|----------------|
| `ai.ts` `generateRollingSummary`, `summarizeTurnBatch` (duplicate) | **LEGACY_OWNER** / **DUPLICATE_OWNER** |
| `memoryProcessor.ts`, `hybridMemoryProcessor.ts` | **LEGACY_OWNER** |
| `memory-compressor.ts` `scheduleMemoryCompression` | **LEGACY_OWNER** (unreferenced scheduler) |
| Status widget vs Status meta | **DUPLICATE_OWNER** (mutually exclusive display paths) |

## Existing A/B harness scripts

| Script | Scope | Classification |
|--------|-------|----------------|
| `scripts/ab-dual-combined-status-extract-live.ts` | Status widget dual combined | **TEST_ONLY_OWNER** — reused for BENCH 3 patterns |
| `scripts/ab-combined-large-dual-budget-live.ts` | Large dual widget | **TEST_ONLY_OWNER** |
| `scripts/status-widget-repair-live-gate.ts` | Repair path | **TEST_ONLY_OWNER** |
| `scripts/ab-status-widget-deepseek.ts` | Main RP (not background) | **TEST_ONLY_OWNER** (out of scope) |
| `scripts/background-model-ab-bench.ts` | This bench | **TEST_ONLY_OWNER** |

## Production prompt reuse (bench)

| Bench | Production builders |
|-------|---------------------|
| BENCH 1 summary | `buildRollingSummarySystemPrompt`, `ROLLING_SUMMARY_EPISTEMIC_POLICY`, `__formatBatchDialogueForTests`, `validateSummaryNarrative`, `isRollingSummaryGroundedInDialogue` |
| BENCH 2 HTML | `buildHtmlFlashSystemPrompt`, `buildHtmlVisualCardFlashUserBlock`, `extractFencedHtmlBlock`, `oocFlashHtmlMustBeRejected` |
| BENCH 3 status | `buildCombinedDualWidgetExtractSystem`, `buildCombinedDualWidgetExtractUserBlock`, `parseCombinedDualWidgetExtractResponse` |

## Timeouts (production owners — bench uses unchanged)

| Task | Owner | Value |
|------|-------|-------|
| Memory extract | `resolveOpenRouterCompletionTimeoutMs` | 120s outer |
| HTML flash | `resolveOpenRouterCompletionTimeoutMs` | 240s outer |
| Status widget | `resolveBackgroundFlashProviderDeadlines` short bucket | 20s policy (capped by outer 120s) |

## Artifact convention

- `output/` is **gitignored** — raw bench artifacts stay local/CI only.
- Aggregate results committed under `data/background-model-ab/REPORT.md`.

## Bench constraints (this PR)

- `BENCH_ONLY=true` — no production routing/env/default changes.
- Direct CheaperInference only; `RETRY=0`, `PROVIDER_FAILOVER=0`, `DB_WRITES=0`, `POINT_CHARGE=0`.

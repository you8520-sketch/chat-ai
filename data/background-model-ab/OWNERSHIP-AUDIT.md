# Background LLM ownership audit

Audit date: 2026-08-26 (PR #659 pre-merge correction). Purpose: background model A/B bench (`deepseek-v4-flash-0731` vs `gpt-5.6-luna` on CheaperInference).

## Final gate counts (runtime reachability verified)

| Gate | Count | Evidence |
|------|------:|----------|
| **DUPLICATE_RUNTIME_OWNERS** | **0** | No two owners execute the same background task on the same turn in production |
| **CONFLICTING_POLICY_PATHS** | **0** | Status Widget vs Status Meta are feature-gated mutually exclusive |
| **STALE_LEGACY_RUNTIME_REFERENCES** | **0** | Legacy duplicate symbols have zero production `src/` callsites |

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

## Status Widget vs Status Meta — mutual exclusivity (not duplicate runtime owners)

Both symbols exist, but **only one path owns status extraction/display per turn**:

1. **`statusWidgetActive`** is computed in `src/app/api/chat/route.ts`:
   - `statusWidgetTurn = resolveStatusWidgetTurn(...)`
   - `statusWidgetActive = statusWidgetTurn.active && !chatOocHtmlOutputTurn`

2. **When `statusWidgetActive=true`:**
   - Production calls `extractStatusWidgetValuesForTurn` (`statusWidget/extract.ts`)
   - `chatUsesHtmlVisualStatusWindow({ statusWidgetActive: true })` returns **`false`** (`statusMeta/displayPolicy.ts:22`) — HTML visual status window is suppressed
   - Status Meta extraction is gated off when HTML visual card is enabled/standing (`resolveStatusMetaExtractionEnabled` returns false when `htmlVisualCardEnabled` or `htmlVisualCardStanding`)

3. **When `statusWidgetActive=false`:**
   - Status widget extract/render path is skipped
   - Status Meta may run if `resolveStatusMetaExtractionEnabled(...)` returns true

**Gate conclusion:** Same logical turn cannot have both widget extract and meta extract as active owners. Classification: **COMPATIBILITY_PATHS**, not conflicting duplicate owners.

## Legacy symbols — zero production callsites

| Location | Symbol | Callsites in `src/` (excluding definition) | Classification |
|----------|--------|---------------------------------------------|----------------|
| `ai.ts` | `generateRollingSummary` | **0** | **STALE_LEGACY** |
| `ai.ts` | `summarizeTurnBatch` (deprecated duplicate) | **0** | **STALE_LEGACY** |
| `hybridMemoryProcessor.ts` | entire module | **0 imports** | **STALE_LEGACY** |
| `memoryProcessor.ts` | entire module | **0 imports** | **STALE_LEGACY** |
| `memory-compressor.ts` | `scheduleMemoryCompression` | **0** | **STALE_LEGACY** |

**Production rolling summary owner:** `memory-rolling-summary.ts` → `summarizeTurnBatch()` (called from `composeRollingSummaryForSeal` path, not `ai.ts` duplicate).

Verification commands used:
- `rg 'generateRollingSummary|from "@/lib/hybridMemoryProcessor"|from "@/lib/memoryProcessor"' src/` → definitions only
- `rg 'hybridMemoryProcessor|memoryProcessor' .` → audit doc only

## Bench status pipeline (PR #659 correction)

| Concern | Owner (imported directly) |
|---------|---------------------------|
| Widget schema default | `DEFAULT_STATUS_WIDGET` from `src/lib/statusWidget/defaultTemplate.ts` (= `BUILTIN_STATUS_WIDGET_TEMPLATES.modern`, fields: 시간·장소·속마음·현재상황·의식의흐름) |
| Turn resolution | `resolveStatusWidgetTurn()` |
| Full extract pipeline | `extractStatusWidgetValuesForTurn()` — prompt → model → parse → normalize → echo filter → volatile repair → temporal → previous merge → displayPolicy |
| Display visibility | `shouldShowStatusWidgetOnMessage()` + `renderStatusWidgetsForTurn()` |

**Not used:** hardcoded `CHARACTER_WIDGET`/`USER_WIDGET`, parser-only `buildCombinedDualWidgetExtract*` → direct provider path.

## Production prompt reuse (bench)

| Bench | Production builders |
|-------|---------------------|
| BENCH 1 summary | `buildRollingSummarySystemPrompt`, `ROLLING_SUMMARY_EPISTEMIC_POLICY`, `__formatBatchDialogueForTests`, `validateSummaryNarrative`, `isRollingSummaryGroundedInDialogue` |
| BENCH 2 HTML | `buildHtmlFlashSystemPrompt`, `buildHtmlVisualCardFlashUserBlock`, `extractFencedHtmlBlock`, `oocFlashHtmlMustBeRejected` |
| BENCH 3 status | **Full** `extractStatusWidgetValuesForTurn` via injected CI caller (`fallbackModelId=null`) |

## Timeouts (production owners — bench uses unchanged)

| Task | Owner | Resolved timeout |
|------|-------|-----------------:|
| Memory extract | `resolveOpenRouterCompletionTimeoutMs` | 120000 ms |
| HTML flash | `resolveOpenRouterCompletionTimeoutMs` | 240000 ms |
| Status widget (CI DeepSeek) | `resolveBackgroundFlashProviderDeadlines` short bucket | 20000 ms |
| Status widget (Luna / non-DeepSeek) | outer timeout | 120000 ms |

Per-call `RESOLVED_TIMEOUT_MS` recorded in committed RAW.

## Artifact convention

- Local scratch: `output/background-model-ab/` (gitignored).
- **Committed RAW (human review):** `data/background-model-ab/raw/summary-results.json`, `html-results.json`, `status-results.json`
- Aggregate report: `data/background-model-ab/REPORT.md` (mechanical stats only; `QUALITY_JUDGMENT=NOT_PERFORMED`)

## Bench constraints (this PR)

- `BENCH_ONLY=true` — no production routing/env/default changes.
- Direct CheaperInference only; `RETRY=0`, `PROVIDER_FAILOVER=0`, `DB_WRITES=0`, `POINT_CHARGE=0`.
- Model isolation: A=DeepSeek CI, B=Luna CI; no cross-model fallback in status bench.

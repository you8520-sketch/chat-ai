# OOC HTML ownership audit — Luna vs DeepSeek V4 Pro bench

Audit date: 2026-08-26. Scope: creative OOC HTML-only path (`background-html-visual-card`).

## Gate counts (runtime reachability verified)

| Gate | Count |
|------|------:|
| DUPLICATE_RUNTIME_OWNERS | 0 |
| CONFLICTING_POLICY_PATHS | 0 |
| STALE_LEGACY_RUNTIME_REFERENCES | 0 |

## HTML production path owners

| Concern | Symbol / file | Classification |
|---------|---------------|----------------|
| HTML 2nd-call generator | `generateHtmlVisualCardWithFlash` (`htmlVisualCardRecovery.ts`) | **CURRENT_OWNER** |
| System prompt | `buildHtmlFlashSystemPrompt` | **CURRENT_OWNER** |
| User block | `buildHtmlVisualCardFlashUserBlock` | **CURRENT_OWNER** |
| Placement | `resolveHtmlFlashPlacement` | **CURRENT_OWNER** |
| OOC policy | `applyChatOocExclusiveHtmlPolicy` | **CURRENT_OWNER** |
| HTML-only routing | `isHtmlFlashOnlyTurn`, `chatOocRpUnrelated` (`chat/route.ts`) | **CURRENT_OWNER** |
| Background transport | `callBackgroundMemory` → `callGeminiOnce` → `callOpenRouterCompletion` | **CURRENT_OWNER** |
| CI body adapt | `adaptCheaperInferenceChatBody` | **CURRENT_OWNER** |
| Fence extract | `extractFencedHtmlBlock` | **CURRENT_OWNER** |
| Post-process / polish | `ensureHtmlVisualCardBlock`, `polishHtmlVisualCardInner` | **CURRENT_OWNER** |
| OOC validators | `oocFlashHtmlMustBeRejected`, `isOocCreativeHtmlRichEnough` | **CURRENT_OWNER** |
| Timeout (outer) | `resolveOpenRouterCompletionTimeoutMs` → 240000 ms for HTML | **CURRENT_OWNER** |
| Timeout (DeepSeek CI cap) | `resolveBackgroundFlashProviderDeadlines` longForm → 45000 ms | **CURRENT_OWNER** |
| Output budget | `HTML_ONLY_TURN_MAX_OUTPUT_TOKENS` (8000) for dedicated OOC HTML turn | **CURRENT_OWNER** |
| Default background model | `BACKGROUND_OPENROUTER_MODEL` / `BACKGROUND_MEMORY_MODEL` env | **CURRENT_OWNER** (not changed by bench) |

## HTML-only vs main RP — mutual exclusivity

On `htmlFlashOnlyTurn` (`chat/route.ts`):
- Main OpenRouter RP model call is **skipped**
- Only `generateHtmlVisualCardWithFlash` runs (HTML전용모델 2nd-call structure)
- `flashOwnedOutputFirewall` blocks main model HTML output on other turns

**Not duplicate owners:** main RP and HTML flash are gated; same turn does not run both.

## Status Widget vs HTML visual — mutual exclusivity

- `chatUsesHtmlVisualStatusWindow({ statusWidgetActive: true })` → false
- OOC HTML turn uses `applyChatOocExclusiveHtmlPolicy` — standing status window suspended

## Legacy / stale (zero production callsites for HTML path)

| Symbol | Callsites in `src/` | Classification |
|--------|---------------------|----------------|
| `hybridMemoryProcessor.ts` | 0 imports | **STALE_LEGACY** |
| `memoryProcessor.ts` | 0 imports | **STALE_LEGACY** |

## Bench isolation (this PR)

| Constraint | Value |
|------------|-------|
| Models | Luna `gpt-5.6-luna`, DeepSeek Pro `deepseek-v4-pro-0813` |
| Provider | CheaperInference only |
| RETRY | 0 |
| PROVIDER_FAILOVER | 0 |
| CROSS_MODEL_FALLBACK | 0 |
| RECOVERY_MODEL_CALL | 0 (no production OOC retry LLM calls in bench) |
| Production prompt/post-process owners | imported unchanged |
| QUALITY_JUDGMENT | NOT_PERFORMED |

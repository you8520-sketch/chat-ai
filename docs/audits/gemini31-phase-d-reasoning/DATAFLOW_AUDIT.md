# Phase D — Reasoning Dataflow Audit

**Main tip:** `2eacc0cc`  
**Production changed:** NO (diagnostic scripts/tests/docs only)

## Owner map (verified on main)

| Symbol | Owner file | Function / region |
|--------|------------|-------------------|
| `REASONING_POLICY_OWNER` | `src/lib/cheaperInferenceConfig.ts` | `applyCheaperInferenceModelReasoningPolicy` |
| `CI_REASONING_ADAPTER_OWNER` | `src/lib/cheaperInferenceConfig.ts` | `adaptCheaperInferenceChatBody` |
| `RAW_PROVIDER_STREAM_OWNER` | `src/lib/openRouterAdult.ts` | `streamOpenRouterAdult` SSE loop ~1488–1657 |
| `REASONING_DETAILS_PARSE_OWNER` | **NOT_FOUND** (production) | No `reasoning_details` parser in RP path |
| `ASSISTANT_RESPONSE_PERSISTENCE_OWNER` | `src/lib/streamingPersistence.ts` | `persistStreamCompleteContent` — `content` string only |
| `CHAT_HISTORY_RECONSTRUCTION_OWNER` | `src/lib/hybridMemory.ts` | `rawRecentTurnsToHistory` → `{ role, content }` |
| `PROVIDER_MESSAGE_SERIALIZATION_OWNER` | `src/lib/openRouterAdult.ts` | `buildOpenRouterMessages` / `convertToOpenRouterFormat` |
| `STREAM_RESPONSE_OWNER` | `src/lib/openRouterAdult.ts` | `extractOpenRouterStreamDelta` — visible text only |
| `MAX_OUTPUT_OWNER` | `src/lib/openRouterClient.ts` | `buildOpenRouterRequestBody` |
| `HISTORY_OWNER` | `src/lib/hybridMemory.ts` + `src/app/api/chat/route.ts` | `rawRecentTurnsToHistory`, `built.history` |
| `ASSISTANT_MESSAGE_OWNER` | `src/app/api/chat/route.ts` | stream persist + `persistStreamCompleteContent` |
| `FINAL_CI_WIRE_REASONING` | `src/lib/cheaperInferenceConfig.ts` | Gemini 3.1 Pro → `reasoning_effort: "low"`, deletes `thinking`/`reasoning` |

## Dataflow trace

```text
CheaperInference raw SSE
  choices[].delta keys observed (probe): content, reasoning, reasoning_details, role
    ↓
extractOpenRouterStreamDelta (openRouterAdult.ts:1069)
  FIELD_AVAILABLE: delta.content, delta.text, delta.reasoning (typed but unused)
  FIELD_SHAPE: string | unknown[] content; reasoning typed but not read
  PRESERVED: visible content/text only
  DROPPED: delta.reasoning, delta.reasoning_details, message.reasoning_details
  TRANSFORMED: prefill strip, degeneration guards on visible only
  LOGGED: DEBUG_STREAM visible slice only
    ↓
Stream yield → chat route → persistStreamCompleteContent
  PERSISTED: messages.content (visible prose only)
  DROPPED: all reasoning metadata
    ↓
rawRecentTurnsToHistory / convertToOpenRouterFormat
  RESENT_NEXT_TURN: { role: "assistant", content: string } only
  DROPPED: reasoning_details, thought signatures
```

### Per-stage matrix

| Stage | reasoning | reasoning_details | signature |
|-------|-----------|-------------------|-----------|
| CI SSE delta | AVAILABLE (streamed) | AVAILABLE (`reasoning.text`, `google-gemini-v1`) | NOT_FOUND |
| Stream parser | DROPPED | DROPPED | DROPPED |
| DB persist | NOT_STORED | NOT_STORED | NOT_STORED |
| History reload | NOT_LOADED | NOT_LOADED | NOT_LOADED |
| Next-turn wire | NOT_RESENT | NOT_RESENT | NOT_RESENT |

## Stream end-chunk audit

**Confirmed:** Many SSE chunks have `emptyContentChunk=true` while `reasoningPresent=true` and/or `reasoningDetailsPresent=true`. Current parser only enters yield path when `extractOpenRouterStreamDelta` returns non-empty visible text → **metadata-only chunks are ignored**.

```text
REASONING_CONTINUITY_DROP_POINT:
  src/lib/openRouterAdult.ts
    extractOpenRouterStreamDelta (lines ~1069–1089)
    stream loop (lines ~1555–1649) — skips chunk when delta empty
```

## Reasoning continuity code classification

| Identifier / pattern | Classification |
|---------------------|----------------|
| `applyCheaperInferenceModelReasoningPolicy` | ACTIVE_PRODUCTION |
| `adaptCheaperInferenceChatBody` | ACTIVE_PRODUCTION |
| `extractOpenRouterStreamDelta` | ACTIVE_PRODUCTION (drops reasoning) |
| `parseReasoningTokens` | ACTIVE_PRODUCTION (usage telemetry only) |
| `reasoning_content` (DeepSeek/TRPG) | ACTIVE_PRODUCTION (non–Gemini 3.1 RP path) |
| `reasoning_details` handling | NOT_FOUND in production RP path |
| `thoughtSignature` / `thought_signature` | NOT_FOUND |
| `scripts/probe-gemini-reasoning-cap.mjs` | AUDIT_ONLY |
| `thinkingBudget` legacy cap | DEAD (removed per openRouterClient comment) |

## Previous fix audit (main @ 2eacc0cc)

| Item | Status |
|------|--------|
| PR #718 summary nonblocking | CONNECTED — `scheduleSummaryCatchUpDurable` in `memory-rolling-summary.ts`; tests in `memory-summary-nonblocking.test.ts` |
| PR #724 reasoning LOW wire | CONNECTED — `cheaperInferenceConfig.ts` Gemini 3.1 Pro → `reasoning_effort: "low"` |
| PR #724 phase telemetry | CONNECTED — `turnPhaseLatencyAudit.ts`, `route.ts` `GEMINI_TTFT_PHASE_AUDIT` + `reasoning_tokens` sync |
| Phase C/C.1 stage decomposition | EVIDENCE ONLY on PR #736 branch (not merged to main) |

## Dead system check

| Item | Class |
|------|-------|
| Gemini 2.5 `thinkingBudget` cap in openRouterClient | DEAD — comment confirms removal |
| `reasoning_content` in deepseekProviderFailover | KEEP — DeepSeek path |
| `scripts/probe-gemini-reasoning-cap.mjs` | KEEP — audit reference |
| Unused `delta.reasoning` type in extractOpenRouterStreamDelta | FOLLOW_UP — typed but never consumed |

## Prompt complexity inventory (Phase E candidate — no changes)

Sections that may trigger meta-planning (inventory only):

- Scene directive / pacing: `sceneDirective.ts`, `scenePacingController.ts` — tactical_planning, consequence carriers
- Narrative leakage strip: `stripSceneAnalysisLeakage` — implies model emits scene-planning prose
- Layered canon + memory summaries — large system prefix (Phase C measured ~high prompt tokens)
- Quality-control duplicates — `promptAudit.ts` `detectSignatureDuplicates` (audit tooling)

No prompt edits in Phase D.

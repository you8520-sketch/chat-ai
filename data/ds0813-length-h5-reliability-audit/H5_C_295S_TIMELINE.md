# 10. H5 C 295-second latency — existing telemetry only

No new provider call for this section.

Source: production `GET /api/chat/message?messageId=3799` on 2026-08-22 (H5 canary user 59, chat 740). Frozen at `h5-c/message-3799-client.json`. Sampler packet from PR #552 recorded HTTP end-to-end `LATENCY_MS=295489`.

## Known timeline

| Event | Proven? | Value |
|---|---|---|
| sampler HTTP start → HTTP end | yes | `295489 ms` (H5 sampler, chat 740) |
| request_received | no | missing |
| turn_persisted | sampler event type only | no timestamp |
| prompt_assembly_start/end | no | missing |
| provider_fetch_start | no | missing |
| provider_headers_received | no | missing |
| provider_first_delta | no | missing |
| provider_last_delta | no | missing |
| provider_finish | no | missing |
| postprocess_start/end | no | missing |
| db_finalize | no | missing |
| SSE_done | sampler HTTP end only | no separate timestamp |

## Stored usage (message 3799) — not a stall clock

| Field | Value |
|---|---|
| `usage.input` / `apiInputTokens` | 10753 |
| `usage.output` / `apiContentOutputTokens` | 1481 |
| `usage.apiOutputTokens` | 8460 |
| `usage.apiReasoningOutputTokens` | **6979** |
| `usage.latencyMs` | **absent** |
| `usage.assembledPromptChars` | **absent** |
| `usage.assembledInputTokens` | 27071 |
| `stages[0].finishReason` | `stop` |
| `stages[0].lengthRecoveryPasses` | 0 |
| `stages[0].truncated` | false |
| sampler `REASONING_TOKENS` (PR #552 C_ADULT.json) | 0 |

Conflict (frozen, not re-litigated as a quality score): the H5 sampler packet stored `REASONING_TOKENS=0`; the persisted stage stores `apiReasoningOutputTokens=6979`. That does **not** by itself prove where the 295 seconds were spent.

Production request logs / Railway instance logs for chat 740 were **not** recovered in this run (`RAILWAY_TOKEN` unauthorized / GraphQL 403). `dbInspect` on the original H5 packet also failed.

## Classification

`H5_C_295S_CLASSIFICATION=UNKNOWN`

Not classified as `STALL_BEFORE_PROVIDER` / `STALL_IN_PROVIDER` / `STALL_AFTER_PROVIDER`. Fine-grained timestamps required for that claim are missing. No instrumentation added.

## Missing timestamps

`request_received`, `prompt_assembly_start`, `prompt_assembly_end`, `provider_fetch_start`, `provider_headers_received`, `provider_first_delta`, `provider_last_delta`, `provider_finish`, `postprocess_start`, `postprocess_end`, `db_finalize`, `SSE_done`, and `usage.latencyMs`.

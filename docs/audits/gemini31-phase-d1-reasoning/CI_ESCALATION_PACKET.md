# CI Escalation Packet (Draft — Phase D.1)

**Do not send private prompt text.** Use request hashes and aggregate metrics only.

## Question (narrow)

Does CheaperInference map `reasoning_effort="low"` for `gemini-3.1-pro-preview` to Google's Gemini `thinkingLevel="low"`? If yes, can the routed upstream/provider or normalization path explain the measured reasoning-token and first-visible latency difference versus equivalent LOW calls via OpenRouter (routed provider: **Google**)?

## Evidence summary

| Field | CI | OpenRouter LOW |
|-------|-----|----------------|
| Model | `gemini-3.1-pro-preview` | `google/gemini-3.1-pro-preview` |
| Reasoning control | `reasoning_effort: "low"` | `reasoning: { effort: "low" }`, `include_reasoning: false` |
| Paired reasoning P50 (8 prompts) | 1159 | 536 |
| Paired ratio | **2.02×** | 1× |
| First-visible P50 | 13301 ms | 6166 ms |
| OR routed provider | — | Google (all pairs) |

## CI LOW self-control (same endpoint)

| Variant | Reasoning P50 | First-visible P50 |
|---------|---------------|-------------------|
| L (`reasoning_effort=low`) | 1038 | 13634 ms |
| D (omit) | 1188 | 13613 ms |
| H (`reasoning_effort=high`) | 1121 | 13553 ms |

LOW ≈ HIGH (ratio 0.93); slight reduction vs DEFAULT only.

## Sample request IDs (no prompt bodies)

Extract from artifact `ci-or-comparator-parity.json` — field `provider_request_id` per pair.

## Request body semantic hash

See `request-parity.json` → `MESSAGES_HASH`, `SYSTEM_HASH` for frozen minimal prompt set.

## Timestamps

Audit window: 2026-08-30 UTC (Phase D.1 live runs).

## Comparison note

OpenRouter with `include_reasoning=false` exposes visible content in early SSE chunks; CI streams `delta.reasoning` / `reasoning_details` before visible content. Usage `reasoning_tokens` remain comparable; stream chunk timing is not apples-to-apples for `reasoning_to_visible_gap` alone. Primary KPI: **request_to_first_visible_ms**.

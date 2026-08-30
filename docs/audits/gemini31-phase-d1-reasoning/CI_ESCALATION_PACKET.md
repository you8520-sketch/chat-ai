# CI Escalation Packet (Phase D.2 — final draft)

**Do not send private prompt text, raw reasoning, or API keys.**

## Question (narrow)

Does CheaperInference explicitly normalize `reasoning_effort: "low"` for `gemini-3.1-pro-preview` into Google's Gemini `thinkingLevel: "low"` or an equivalent provider-native LOW control?

If the field is only forwarded, which upstream request field ultimately receives the LOW setting?

Can the selected CI route or parameter normalization explain, on paired identical prompts:

- CI ≈ **2.02×** OpenRouter reasoning tokens (OR routed provider: **Google**)
- CI ≈ **+6.4 s** first-visible latency (P50)
- CI LOW / default / high self-control showed **no clear separation** (Phase D.1)
- Phase D.2 alias: `reasoning_effort: "low"` ≈ `reasoning: { effort: "low" }` (both accepted; P50 reasoning 1077 vs 1155); omitted control slightly higher (1282)

Include request IDs and timing data below. Do not treat this as "CI bug confirmed."

---

## Model and audit window

| Field | Value |
|-------|-------|
| Model | `gemini-3.1-pro-preview` |
| Audit timestamps | 2026-08-30 UTC (D.1 comparator ~04:29–04:45; D.2 alias ~04:51–04:57) |
| Current production wire | `reasoning_effort: "low"` only (`reasoning` object stripped by adapter) |

---

## Paired CI vs OpenRouter (D.1, parity-correct, n=8)

| Metric | CI P50 | OR P50 |
|--------|--------|--------|
| Reasoning tokens | 1159 | 536 |
| Ratio | **2.02×** | 1× |
| First-visible | 13301 ms | 6166 ms |
| Delta | +6437 ms | — |
| OR routed provider | — | Google (all pairs) |

---

## CI LOW self-control (D.1, same endpoint)

| Variant | Reasoning P50 | First-visible P50 |
|---------|---------------|-------------------|
| L (`reasoning_effort=low`) | 1038 | 13634 ms |
| D (omit) | 1188 | 13613 ms |
| H (`reasoning_effort=high`) | 1121 | 13553 ms |

LOW ≈ HIGH (ratio 0.93).

---

## Alternative alias result (D.2, diagnostic direct calls, n=8 each)

| Variant | Wire | Reasoning P50 | First-visible P50 | Accepted |
|---------|------|---------------|-------------------|----------|
| A | `reasoning_effort: "low"` | 1077 | 13576 ms | yes |
| B | `reasoning: { effort: "low" }` | 1155 | 15354 ms | yes |
| C | omitted | 1282 | 14461 ms | yes |

**Result:** SUPPORTED equivalence between A and B (ratio 1.07). Not semantically proven by HTTP 200 alone, but token/latency profiles overlap within variance.

---

## CI usage API reconciliation (D.2)

- **Endpoint:** `GET /v1/usage/requests` — accessible with existing key
- **D.1 join:** 36/36 via token fingerprint (stream `gen-*` id ≠ usage UUID)
- **TTFT:** `time_to_first_token_ms` P50 **4336 ms** vs client first-SSE P50 **4389 ms** (Δ ≈ −55 ms) → empirically **first network/SSE**, not first-visible
- **Total latency:** P50 delta vs client stream complete ≈ **+98 ms**
- **Cache:** `cache_read_input_tokens` **recorded as 0** for all matched gemini-3.1 runs (not null)
- **Stream usage:** cache fields still absent in SSE chunks

---

## Sample CI usage request IDs (UUID)

From D.1 reconciliation (`usage-reconcile.json`):

- `10e56972-5f21-411d-a5f3-d49cff712e3d`
- `bcffc163-2567-4fb1-a8d0-4ede279a5e25`
- `37903dc1-5731-4da3-9655-14ea43f03358` (inspect sample)

From D.2 alias (`alias-usage-join.json`):

- `83777021-9c18-495b-9f72-c04111f6a8b6` (variant A)
- `2c3191ad-5d4b-4162-a2d8-e6fbfcbf81f6` (variant B)
- `014bffe8-4a5c-43d5-8665-74c58d6656e4` (variant C)

Stream `gen-*` ids in D.1 artifacts are **not** usage API keys.

---

## Request body semantic hash (frozen minimal set)

See D.1 `request-parity.json` — `MESSAGES_HASH`, `SYSTEM_HASH` only (no prompt bodies).

---

## Public contract notes

- OpenAPI `ChatCompletionRequest`: `additionalProperties: true` (extra fields forwarded)
- Platform docs: `reasoning`, `temperature`, `top_p`, etc. forwarded to serving provider
- **Forwarding ≠ Gemini thinkingLevel normalization** (separate claim)

---

## Headers observed

| Header | Value |
|--------|-------|
| `x-ci-request-id` | UUID — use for usage join |
| `x-ci-cache` | `miss` on alias runs (exact-match gateway cache; ≠ Gemini prefix cache) |

No `provider` / `route` / `seller` field in usage JSON or stream envelope for these runs.

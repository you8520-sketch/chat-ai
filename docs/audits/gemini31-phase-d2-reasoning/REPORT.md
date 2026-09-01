# Phase D.2 — CI Usage Reconciliation + Reasoning Parameter Contract Audit

**Production changed:** NO  
**Draft PR:** #738  
**Main tip (branch):** `df05a0b6` merged

## GEMINI31_PHASE_D2_CI_CONTRACT_AUDIT

```text
PRODUCTION_CHANGED: NO
CURRENT_MAIN_TIP: df05a0b6
CI_PUBLIC_REASONING_EFFORT_DOCUMENTED: YES (platform reasoning docs; not OpenAPI enum)
CI_ADDITIONAL_PROPERTIES_FORWARDING: YES (OpenAPI ChatCompletionRequest additionalProperties: true)
CI_USAGE_API_AVAILABLE: YES
D1_REQUESTS_MATCHED: 36/36
CI_USAGE_CACHE_FIELD: RECORDED_ZERO
STREAM_CACHE_REPORTING: UNAVAILABLE
CI_USAGE_TTFT_AVAILABLE: YES
CI_TTFT_CLOSEST_TO: FIRST_SSE
ALIAS_TEST
A_REASONING_EFFORT_LOW: reasoning_effort=low (8 calls)
B_REASONING_OBJECT_LOW: reasoning={effort:low} (8 calls, HTTP 200)
C_OMITTED: no reasoning control (8 calls)
A_REASONING_P50: 1077
B_REASONING_P50: 1155
C_REASONING_P50: 1281.5
A_FIRST_VISIBLE_P50: 13576 ms
B_FIRST_VISIBLE_P50: 15354 ms
C_FIRST_VISIBLE_P50: 14461 ms
LOW_FIELD_BEHAVIOR: A_B_SAME
CURRENT_CI_REASONING_FIELD_CONTRACT: SUPPORTED (A≈B); upstream separation still SUSPECT vs OR
CI_ESCALATION_PACKET: READY (updated)
PRIMARY_ROOT_CAUSE: CI_UPSTREAM_REASONING_BEHAVIOR (INCONCLUSIVE on normalization)
CACHE_OBSERVABILITY: RECOVERED_VIA_USAGE_API (history join proven; stream still incomplete)
PHASE_E_READY: NO
ROOT_CAUSE_STATUS: ROOT_CAUSE_UNCONFIRMED
NEXT_RECOMMENDATION: Provider escalation with usage UUIDs + TTFT; do not patch production adapter until CI answers normalization question
```

---

## §0 CI contract map

```text
CI_CONTRACT_MAP
PUBLIC_CHAT_FIELDS: model, messages, stream, max_tokens, temperature, top_p, tools, tool_choice (+ additionalProperties)
PUBLIC_REASONING_EFFORT_FIELD: DOCUMENTED (reasoning guide — honored on compatible models; not in OpenAPI property list)
ADDITIONAL_PROPERTIES_FORWARDING: YES (OpenAPI additionalProperties: true on ChatCompletionRequest)
OUR_FINAL_FIELD: reasoning_effort=low
KNOWN_NORMALIZATION_OWNER: src/lib/cheaperInferenceConfig.ts → applyCheaperInferenceModelReasoningPolicy (sets low, deletes reasoning/thinking)
```

**Important:** `additionalProperties` forwarding ≠ proven Gemini `thinkingLevel` normalization. Those are separate claims.

Public docs also document:
- `GET /v1/usage/requests` — `cache_read_input_tokens`, `cache_write_input_tokens`, `total_latency_ms`, `time_to_first_token_ms`, `billed_cost_usd`
- Response headers: `x-ci-request-id`, `x-ci-cache` (exact-match gateway cache, separate from Gemini prefix cache)

---

## §3 Production wire (metadata only)

Frozen via `assemblePrimaryRpRequest` → `adaptCheaperInferenceChatBody`:

| Field | Value |
|-------|-------|
| model | `gemini-3.1-pro-preview` |
| reasoning control | exactly one: `reasoning_effort: "low"` |
| reasoning object | stripped |
| adaptation_removed | `include_reasoning`, `reasoning` |
| temperature | 0.95 |
| max_tokens / top_p | null |

Full snapshot: `usage-reconcile.json` → `PRODUCTION_WIRE`

---

## §4–5 Usage API + D.1 reconciliation

- **Permission:** existing API key can call `GET /v1/usage/requests` (`usage:read`) — not blocked.
- **Join gap:** D.1 artifacts store stream `json.id` (`gen-*`); usage API uses UUID `request_id`. **0/36** by ID.
- **Fix:** token fingerprint join (`prompt_tokens` + `completion_tokens` + model + latency tie-break) → **36/36** matched.
- **Alias join:** `x-ci-request-id` header capture → **23/24** matched (1 preflight edge in window).

### Per-request fields (matched D.1, aggregate)

| Metric | P50 |
|--------|-----|
| CI `time_to_first_token_ms` | 4336 ms |
| Client `request_to_first_sse_ms` | 4389 ms |
| Client `request_to_first_visible_ms` | 13589 ms |
| TTFT − SSE delta | −55 ms |
| `total_latency_ms` − client stream complete | +98 ms |
| `cache_read_input_tokens` | 0 (all 36) |

---

## §6 Cache reporting

```text
Classification: C-B (CACHE_READ_RECORDED_ZERO) for all matched D.1 gemini-3.1 runs
STREAM: no cache_read in stream usage chunks (Phase C/D probes)
USAGE HISTORY: field present and explicitly 0 — not null/missing
CACHE_REPORTING_OWNER: CI_USAGE_API_AVAILABLE; STREAM_USAGE_INCOMPLETE
```

Phase C reassessment:

```text
OLD: CACHE_RATIO NOT_MEASURABLE
NEW:
  STREAM_CACHE_RATIO: NOT_MEASURABLE
  CI_USAGE_HISTORY_CACHE_RATIO: MEASURABLE (field recorded; zero for this audit window)
```

---

## §7–8 TTFT and total latency

Empirical classification (36 matched D.1): **CI `time_to_first_token_ms` closest to FIRST_SSE** (all 36).

Do not assume naming semantics — measured offset ≈ −55 ms vs client first SSE at P50.

Total latency aligns with client stream complete within ~100 ms P50 (gateway boundary ≈ stream end, not first visible).

---

## §9–14 Reasoning alias test (A/B/C)

Counterbalanced order (A B C / B C A / C A B), 8 blocks × 3 variants = 24 calls.

| Variant | Control | Reasoning P50 | First-visible P50 |
|---------|---------|---------------|-------------------|
| A | `reasoning_effort: "low"` | 1077 | 13576 ms |
| B | `reasoning: { effort: "low" }` | 1155 | 15354 ms |
| C | omitted | 1282 | 14461 ms |

- **ALIAS_B_SUPPORTED:** YES (HTTP 200; not rejected)
- **A vs B reasoning ratio:** 1.07× → **A_B_SAME**
- **A vs C:** 0.84× (A lower than omitted, ~16% — high variance)
- **Decision:** A2 leaning — both LOW wire forms behave similarly; does not explain 2× OR gap alone
- Combined with D.1 LOW≈HIGH self-control → **LOW field honor remains UNKNOWN** for provider-native separation

---

## §16 Routing metadata

- Stream `cheaper_inference` envelope: **not observed** in alias runs (`ci_route_metadata: null`)
- Headers observed: `x-ci-request-id`, `x-ci-cache: miss` (all alias runs)
- Usage records: model, endpoint, latency, token counts — **no provider/route/seller field** in returned JSON
- Do not infer route from model vendor alone

---

## §18 Provider question (narrow)

Does CheaperInference explicitly normalize `reasoning_effort: "low"` for `gemini-3.1-pro-preview` into Google's Gemini `thinkingLevel: "low"` or equivalent? If forwarded only, which upstream field receives LOW?

**Observed on paired identical prompts (D.1):**
- CI ≈ 2.02× OpenRouter reasoning tokens (OR routed: Google)
- CI ≈ +6.4 s first-visible latency
- CI LOW/default/high self-control: no clear separation (D.1)
- D.2 alias: `reasoning_effort` ≈ `reasoning.effort` ≈ both accepted; omitted slightly higher reasoning P50

**Sample usage UUIDs (no prompt bodies):** see `CI_ESCALATION_PACKET.md`

---

## §21 Phase E gate

```text
CURRENT LOW FIELD HONORED? UNKNOWN
ALTERNATIVE LOW FIELD DIFFERENT? NO (A≈B)
CI USAGE TTFT AVAILABLE? YES
CI CACHE HISTORY AVAILABLE? YES (recorded; zero in window)
PHASE_E_READY: NO
```

---

## §23 Dead / duplicate audit

| Item | Classification |
|------|----------------|
| reasoning_details persistence proposal | FOLLOW_UP — not TTFT fix |
| HIGH self-control diagnostic | KEEP artifact only |
| old invalid provider_wait metric | SAFE TO DELETE / corrected in D.1 |
| old CI queue-floor conclusion | OBSOLETE |
| old cache unavailable wording | UPDATE — usage API supplies cache fields |

---

## Artifacts

| File | Path |
|------|------|
| Usage reconcile | `/opt/cursor/artifacts/gemini31-phase-d2-reasoning/usage-reconcile.json` |
| Reasoning alias | `/opt/cursor/artifacts/gemini31-phase-d2-reasoning/reasoning-alias.json` |
| Alias usage join | `/opt/cursor/artifacts/gemini31-phase-d2-reasoning/alias-usage-join.json` |

## Tests

```bash
node --conditions=react-server --import tsx --test scripts/gemini31-phase-d2-probe.test.ts scripts/gemini31-phase-d-probe.test.ts
```

21/21 PASS (null≠zero, request-id join, token fingerprint join, TTFT reconciliation, A/B/C parity, counterbalance, cache separation).

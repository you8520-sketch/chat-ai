# CheaperInference Support — Escalation Message (draft)

**Subject:** `gemini-3.1-pro-preview` — reasoning_effort LOW semantics, route identity, and usage reconciliation

---

We are integrating `gemini-3.1-pro-preview` via CheaperInference with production wire:

```json
{ "reasoning_effort": "low" }
```

(`reasoning` object stripped before send.)

We observe materially different behavior vs an equivalent semantic-LOW path through OpenRouter (routed provider: **Google**) on paired identical prompts (hashed messages/system — no prompt bodies attached):

- CI reasoning tokens ≈ **2.02×** OpenRouter (P50 1159 vs 536)
- CI first-visible latency ≈ **+6.4 s** slower (P50 13301 ms vs 6166 ms)
- D.2 diagnostic: `reasoning_effort: "low"` ≈ `reasoning: { effort: "low" }` on CI (both accepted; similar token profiles)
- D.1 self-control on CI (low / omit / high): **no clear separation**

We are **not** asserting a CI bug. We need your help verifying upstream route and native reasoning configuration for the request UUIDs below.

---

## Questions

### Q1
For `gemini-3.1-pro-preview`, does CI **normalize** `reasoning_effort: "low"` to Google's provider-native LOW thinking setting? If yes, what exact upstream semantic setting is used?

### Q2
If CI **forwards** rather than normalizes, does every eligible Gemini route interpret that field identically?

### Q3
For the supplied request UUIDs, which **upstream route/provider** served each request, and did it receive LOW?

### Q4
Why do paired LOW calls show roughly **2× reasoning tokens** and materially higher **first-visible latency** than equivalent OpenRouter→Google calls (same hashed prompt set)?

### Q5
For usage records where `cache_read_input_tokens = 0`, does zero mean the upstream **explicitly reported no Gemini prefix-cache read**? Or can Gemini implicit cache reuse occur without being reflected in this field?

---

## Primary request UUIDs (exact join — x-ci-request-id = usage request_id)

| Label | UUID | UTC timestamp | reasoning control | reasoning tok | visible ms | CI TTFT ms |
|-------|------|---------------|-------------------|---------------|------------|------------|
| Normal CI LOW | `9f0a998e-02f7-4f27-a194-112e668786bc` | 2026-08-30T04:54:09Z | reasoning_effort=low | 1074 | 13453 | 4453 |
| Slower CI LOW (~p75, not worst) | `d4d9bd40-dd5e-441b-ae22-8fbf249e7ec9` | 2026-08-30T04:55:25Z | reasoning_effort=low | 1080 | 14528 | 5053 |
| OR-style object on CI | `2c3191ad-5d4b-4162-a2d8-e6fbfcbf81f6` | 2026-08-30T04:50:11Z | reasoning={effort:low} | 1657 | 18852 | 4866 |
| Omitted control | `16c2cfb1-211f-48fe-8bd0-01d0391023b5` | 2026-08-30T04:50:35Z | omitted | 920 | 14837 | 7440 |

**Semantic hashes (no prompt text):**

- System: `32a8449b42a6ec62868bffb062f55ea50f6012cc2efae189369b894cdd801355`
- Messages (minimal set example): `fb55750f0ccf01af7ad829c76be7df852c2d3d66dc91144ad45cd70afb064a72`

---

## Secondary UUIDs (token-fingerprint join — please confirm if gen-* stream id maps differently)

| Label | UUID | Notes |
|-------|------|-------|
| Paired CI/OR (CI side, pair 4) | `868fc5bf-f3a2-4cf7-82c4-e1a574733e73` | OR ref: reasoning 528, visible 6169 ms, Google |
| Production-like CI | `a75fb36a-7f41-4176-9fb8-403936d30844` | prompt 127 tok; production wire |

---

## Observations we can verify from usage API

- `time_to_first_token_ms` aligns with our client **first SSE** (~−55 ms P50), not first visible content
- `cache_read_input_tokens` recorded as **explicit 0** on all matched gemini-3.1 requests in audit window
- Stream usage chunks lack cache fields; `x-ci-cache: miss` on exact-UUID alias runs

---

## What we will not do until you respond

- No production adapter changes
- No prompt / memory / layout optimization experiments (Phase E blocked)

Thank you — happy to provide additional UUIDs from the frozen audit (23 exact-UUID D.2 rows available).

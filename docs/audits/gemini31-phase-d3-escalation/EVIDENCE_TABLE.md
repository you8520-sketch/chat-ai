# CI Escalation — Evidence Table (privacy-safe)

**No prompt bodies. No API keys. No raw reasoning text.**

Join quality legend:

| Label | Meaning |
|-------|---------|
| `EXACT_UUID_JOIN` | `x-ci-request-id` header = CI usage API `request_id` |
| `TOKEN_FINGERPRINT_JOIN` | Matched by model + prompt/completion tokens (D.1; stream `gen-*` ≠ usage UUID) |
| `TIMESTAMP_ONLY` | Client-side reference only (e.g. OpenRouter comparator) |

Full machine-readable rows: `evidence.json` (repo + `/opt/cursor/artifacts/gemini31-phase-d3-escalation/`)

---

## Primary examples (exact UUID — preferred for support)

| sample | join | CI usage UUID | x-ci-request-id | timestamp (UTC) | reasoning control | prompt | compl | reasoning | CI TTFT ms | client SSE ms | client visible ms | cache read | cache write | body hash (reasoning control) | messages hash |
|--------|------|---------------|-----------------|-----------------|---------------------|--------|-------|-----------|------------|---------------|-------------------|------------|-------------|-------------------------------|---------------|
| normal_ci_low_exact | EXACT_UUID_JOIN | `9f0a998e-02f7-4f27-a194-112e668786bc` | same | 2026-08-30T04:54:09Z | reasoning_effort=low | 27 | 1412 | 1074 | 4453 | 4508 | 13453 | 0 | — | `045eb732…` | `6f81b27c…` |
| slow_ci_low_exact | EXACT_UUID_JOIN | `d4d9bd40-dd5e-441b-ae22-8fbf249e7ec9` | same | 2026-08-30T04:55:25Z | reasoning_effort=low | 29 | 1388 | 1080 | 5053 | 5100 | 14528 | 0 | — | `045eb732…` | `29a05182…` |
| alias_b_reasoning_object_low | EXACT_UUID_JOIN | `2c3191ad-5d4b-4162-a2d8-e6fbfcbf81f6` | same | 2026-08-30T04:50:11Z | reasoning={effort:low} | 33 | 2117 | 1657 | 4866 | 4925 | 18852 | 0 | — | `7e33466b…` | `fb55750f…` |
| alias_c_omitted_control | EXACT_UUID_JOIN | `16c2cfb1-211f-48fe-8bd0-01d0391023b5` | same | 2026-08-30T04:50:35Z | omitted | 33 | 1278 | 920 | 7440 | 7492 | 14837 | 0 | — | `44136fa3…` | `fb55750f…` |

System hash (frozen minimal set): `32a8449b42a6ec62868bffb062f55ea50f6012cc2efae189369b894cdd801355`

All exact-UUID alias rows: `x-ci-cache: miss` (gateway exact-match cache; separate from Gemini prefix cache).

---

## Secondary examples (token fingerprint — labeled, not exact)

| sample | join | CI usage UUID | stream gen-* id | timestamp (UTC) | notes |
|--------|------|---------------|-----------------|-----------------|-------|
| paired_ci_or_ci_side | TOKEN_FINGERPRINT_JOIN | `868fc5bf-f3a2-4cf7-82c4-e1a574733e73` | `gen-1788064260-…` | 2026-08-30T04:30:59Z | D.1 pair 4; CI reasoning 1159 vs OR 528; visible 12946 vs 6169 ms |
| production_like_ci | TOKEN_FINGERPRINT_JOIN | `a75fb36a-7f41-4176-9fb8-403936d30844` | `gen-1788064400-…` | 2026-08-30T04:33:19Z | Production-like wire; prompt 127 tokens |

## OpenRouter reference (no CI UUID)

| sample | join | OR stream id | reasoning | visible ms | routed |
|--------|------|--------------|-----------|------------|--------|
| paired_ci_or_or_reference | TIMESTAMP_ONLY | `gen-1788064249-…` | 528 | 6169 | Google |

---

## Aggregate context (D.1 parity, n=8)

- CI reasoning P50: **1159** vs OR P50: **536** (ratio **2.02×**)
- CI first-visible P50: **13301 ms** vs OR: **6166 ms** (+6437 ms)
- Production wire: `reasoning_effort: "low"` only

## Join inventory

| Quality | Count |
|---------|-------|
| EXACT_UUID_JOIN (D.2 alias) | 23 |
| TOKEN_FINGERPRINT_JOIN (D.1 reconcile) | 36 |
| TIMESTAMP_ONLY (unmatched / OR reference) | 1 + OR rows |

**Do not represent fingerprint joins as exact request-ID joins.**

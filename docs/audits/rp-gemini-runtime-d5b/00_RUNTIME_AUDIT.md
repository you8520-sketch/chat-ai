# D5-B0 — Gemini 3.1 Pro Runtime Root-Cause Audit (API=0)

**Phase:** D5-B0  
**API calls:** 0  
**Production code diff:** 0  
**Prompt / system owner / context packaging:** BYTE_IDENTICAL (no changes)

**Baseline main SHA:** `522f4810670bab639fb8800bc5eee4a125895a6b`  
**Branch:** `cursor/rp-gemini-runtime-stability-d5b-96c2`  
**Prior evidence:** D5-A live metas under `/opt/cursor/artifacts/rp-quality-d5a-production-stability/live/` + `docs/audits/rp-gemini-production-stability-d5a/PHASE_D5A_FINAL.md`

---

## A. Production Gemini 3.1 Pro final request body

Proven from production helpers on this SHA + D5-A `request_fingerprint.json` / `meta.generation_config` (all 9 cells identical shape):

| Field | Production value | Source |
|---|---|---|
| `temperature` | `0.95` | `GEMINI_PRO_GENERATION_PARAMS` → `normalizeOpenRouterGenerationParams` |
| `reasoning` | `{ effort: "low" }` | `OPENROUTER_RP_REASONING_GEMINI_3_PRO` via `applyGeminiProReasoning` |
| `include_reasoning` | `false` | `applyGeminiProReasoning` |
| `max_tokens` | **absent / null** | `resolveOpenRouterMaxTokens` → `resolveMaxOutputTokensForTarget` → always `undefined` |
| `provider` | **absent / null** | `applyGeminiProReasoning` does `delete body.provider` |
| `seed` | absent / null | not set for Gemini Pro RP |
| `model` | `google/gemini-3.1-pro-preview` | `OPENROUTER_GEMINI_31_PRO_MODEL` |

D5-A fingerprint sample (`Gemini_G6T1_A_D1`):

```json
{
  "temperature": 0.95,
  "max_tokens": null,
  "seed": null,
  "reasoning": { "effort": "low" },
  "include_reasoning": false,
  "provider": null
}
```

**Verdict A:** Observed D5-A request config matches current production route helpers. Not a harness-only artifact.

---

## B. `include_reasoning=false` ≠ reasoning OFF

Code (`src/lib/openRouterClient.ts` `applyGeminiProReasoning`):

1. Sets `body.reasoning = { effort: "low" }` — reasoning **enabled** at low effort.
2. Sets `body.include_reasoning = false` — excludes reasoning text from the streamed/visible completion payload.

D5-A raw usage proves hidden reasoning still ran:

| cell | reasoning_tokens | completion_tokens | visible_chars |
|---|---:|---:|---:|
| G5 D1–D3 | 1721 / 1707 / 1318 | 3369 / 2317 / 2582 | 1855 / 690 / 1463 |
| G6 D1–D3 | 1274 / 4078 / 2530 | 1802 / 6379 / 3290 | 606 / 2699 / 881 |
| G3 D1–D3 | 2282 / 2872 / 1219 | 3591 / 4318 / 3124 | 1522 / 1659 / 2201 |

Range: **1219–4078** reasoning tokens with `include_reasoning=false`.

**Verdict B:** `include_reasoning=false` is **reasoning output exclusion**, not reasoning disable. Matches D5-A evidence.

---

## C. Why `targetResponseChars=3200` but no `max_tokens`

Call chain:

1. `assemblePrimaryRpRequest` → `buildOpenRouterRequestBody(..., targetResponseChars=3200, ...)`
2. `resolveOpenRouterMaxTokens(target, override, modelId)`
3. If no override → `resolveMaxOutputTokensForTarget(target, modelId)`
4. Current implementation **always returns `undefined`**:

```ts
// src/lib/responseLength.ts
export function resolveMaxOutputTokensForTarget(
  _targetInput?: number | null,
  _modelId?: string | null
): undefined {
  return undefined;
}
```

5. `normalizeOpenRouterGenerationParams` only adds `max_tokens` when the resolved value is a finite positive number.

Comment on the function: *"RP chat — max_tokens 미전송 (프로바이더 기본·출력 토큰 과금). override 있을 때만 숫자 반환"*

**Historical fact (not guess):**

- Before `eb30d787` (2026-06-29), `resolveMaxOutputTokensForTarget` returned `OPENROUTER_GEMINI_31_PRO_MAX_OUTPUT_TOKENS = 8192` for Gemini 3.1 Pro.
- `eb30d787` changed it to always `undefined` (omit from body) — intentional product change for provider-default output + billing, not an accidental harness bug.

**Verdict C:** Absent `max_tokens` is **intentional current production policy**, and is also a **historical runtime diff** vs the earlier Gemini always-`8192` era. Causality for length collapse is **not proven** by absence alone → eligible for D5-B3 only if B1/B2 do not explain variance.

---

## D. Gemini 3.1 Pro runtime git history (facts)

| Symbol / behavior | Introduced / changed | Commit | Fact |
|---|---|---|---|
| Thinking kill via `provider` (Google thinking type none) | 2026-06-24 | `29aed45a` | Set `body.provider` to kill thinking |
| Restore Gemini 3.x Pro `reasoning.effort=low`, `temperature=0.95`; **`delete body.provider`** | 2026-06-28 | `3a705b3e` | Current `GEMINI_PRO_GENERATION_PARAMS` / `OPENROUTER_RP_REASONING_GEMINI_3_PRO` / `applyGeminiProReasoning` |
| Gemini `max_tokens` 8192 → omit | 2026-06-29 | `eb30d787` | `resolveMaxOutputTokensForTarget` → always `undefined` |
| Effort constant still `low` | 2026-07-24 | `98c30635` (blame on reasoning line) | Still `OPENROUTER_RP_REASONING_GEMINI_3_PRO` |

**Answer to “did runtime diverge from the stable 3–4k era?” (code history only):**

- **Yes, two material runtime diffs exist after the thinking-off era:**
  1. Thinking restored to `effort: low` + provider routing deleted (`3a705b3e`).
  2. Explicit `max_tokens: 8192` removed (`eb30d787`).
- This audit does **not** claim either alone caused D5-A collapse; it only records that production runtime is not identical to the earlier Gemini always-8192 / thinking-off configuration.

---

## E. D5-A evidence correlation (API=0)

### E1. OpenRouter usage schema (raw)

Every D5-A cell has:

- `usage.completion_tokens`
- `usage.completion_tokens_details.reasoning_tokens`

### E2. Does `completion_tokens` include `reasoning_tokens`?

**YES — proven.**

For all 9 cells:

`VISIBLE_BUDGET_TOKENS ≈ completion_tokens - reasoning_tokens`

and

`visible_chars_no_ws / VISIBLE_BUDGET_TOKENS ≈ 1.15` (mean **1.151**, range ~1.13–1.17).

If completion excluded reasoning, `ct - rt` would be nonsense relative to chars; the near-linear chars↔(ct−rt) fit (Pearson **0.9995**) proves inclusion.

### E3. Correlations

| Pair | Pearson | Spearman |
|---|---:|---:|
| reasoning_tokens vs visible_chars (n=9) | **+0.486** | **+0.333** |
| reasoning_tokens vs latency_s | **+0.903** | **+0.900** |
| completion_tokens vs reasoning_tokens | **+0.918** | — |
| visible_budget_tokens vs visible_chars | **+0.9995** | — |
| reasoning_tokens vs visible_share `(ct-rt)/ct` | **−0.377** | — |

By fixture:

| Fixture | Pearson (rt vs chars) | Spearman | Note |
|---|---:|---:|---|
| G5 | −0.155 | +0.50 | n=3; weak |
| G6-T1 | **+0.942** | **+1.0** | longer reasoning co-occurs with longer prose |
| G3 | **−0.852** | −0.50 | opposite direction |

By provider (D5-A unpinned routing):

| Provider (display) | n | chars | reasoning_tokens |
|---|---:|---|---|
| Google AI Studio | 6 | 690, 881, 1522, 1659, 1855, 2699 | 1707–4078 |
| Google (Vertex) | 3 | 606, 1463, 2201 | 1219–1318 (and G6 collapse 1274) |

### E4. Contention verdict

**REASONING_VISIBLE_BUDGET_CONTENTION: INCONCLUSIVE**

Reasons:

- Overall correlation of reasoning vs visible chars is **positive**, not negative.
- G6 shows strong **positive** coupling (more reasoning with more prose).
- G3 shows negative coupling (possible local contention), but n=3 and opposite to G6.
- Visible share weakly declines with reasoning (−0.377), but absolute prose length does not systematically collapse as reasoning grows.

We cannot claim “reasoning eats the prose budget” as the primary D5-A instability story from this n=9 set alone.

---

## F. Provider metadata (API=0 network metadata only)

Evidence file: `openrouter_gemini31_provider_endpoints.json`

Exact OpenRouter provider slugs (`GET /api/v1/providers`):

| Arm | Display name (D5-A) | Exact slug for `provider.only` |
|---|---|---|
| P1 Vertex | `Google` | **`google-vertex`** |
| P2 AI Studio | `Google AI Studio` | **`google-ai-studio`** |

Endpoint tags (not the `only` slug itself):

- Vertex: `google-vertex/global`, `.../flex`, `.../priority`
- AI Studio: `google-ai-studio`, `.../flex`, `.../priority`

Both families support: `reasoning`, `include_reasoning`, `reasoning_effort`, `max_tokens`, `temperature`, `top_p`, `seed`, tools, etc.  
`max_completion_tokens`: **65536** on all listed endpoints.

Experiment pin format (harness-only, after production assemble):

```json
{
  "only": ["google-vertex"],
  "allow_fallbacks": false,
  "require_parameters": true
}
```

**Important:** production `applyGeminiProReasoning` deletes `body.provider`. D5-B harness must assemble production BYTE_IDENTICAL body first, then insert `provider` **only in the audit harness**. Production code diff remains 0.

---

## G. D5-B0 gate → next step

| Question | Answer |
|---|---|
| Prompt wording still primary? | NO — stopped after D5-A |
| Runtime config proven? | YES |
| Reasoning OFF via include_reasoning? | NO |
| max_tokens absent intentional? | YES (since `eb30d787`) |
| Historical runtime diffs vs earlier Gemini? | YES (thinking restore + max_tokens omit) |
| Reasoning–visible contention? | INCONCLUSIVE |
| Exact provider slugs known? | YES |

**Next live experiment:** D5-B1 PROVIDER ISOLATION — sole variable `provider.only`, fixture **G6-T1**, arms P1=`google-vertex` / P2=`google-ai-studio`, 3 draws each (6 successful non-fallback calls).

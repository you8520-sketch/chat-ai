# Historical decision audit — layered canon

## PR #93 — *DeepSeek layered canon retrieval and scene momentum* (merged 2026-07-22)

**Confirmed architecture (still on `main`):**

- CORE + ACTIVE layered canon (`compileCanonPlanV1`, `renderCoreCanonBlock`, `selectActiveCanonChunks`)
- ACTIVE relevance retrieval (user message + gated recent bridge)
- Dormant canon normally inactive at runtime
- Selective archive (D1.1+)
- Knowledge boundary (player / scenario_meta excluded from ACTIVE)
- `activeBudgetChars` ≈ 1200
- DeepSeek D3 acceptance PASS (8 live calls in that PR’s validation)
- **Default rollout remained D0/shadow** — merge ≠ production activation
- Production activation documented as requiring `CANON_INJECTION_ENABLED` + `CANON_INJECTION_DEEPSEEK_CANARY` + stage ≥ D2 + cohort eligibility

**Recorded root cause:** FULL canon + whole-archive high-salience injection caused dormant lore/event activation.

**Not reverted:** Layered code path remains; `canonInjectionPolicy.ts` + `contextBuilder.ts` gates are intact.

## PR #94 — Cohort/canary gating (merged)

- Sticky cohort (`user.id` / `chat.id`), allowlist, percent rollout
- **`CANON_INJECTION_DEEPSEEK_CANARY=1` alone → 0%** when percent/allowlist unset
- **`CANON_INJECTION_ENABLED` required** for actual injection; otherwise `canaryActualInjection=false` and wire stays FULL_LEGACY
- No production env changes in that PR

## PR #284 — Gemini layered canon D6-A (not merged)

- Result: **`GEMINI_LAYERED_CANON_FAIL`**
- Surface −58% but recital reduction insufficient; some shorter outputs
- **Does not block DeepSeek evidence**; Gemini 3.7 must be judged on current capsule (this audit)

## Why layered did not become global default

| Question | Evidence |
|----------|----------|
| DeepSeek layered merged? | Yes (#93) |
| Ever activated beyond canary? | **PRODUCTION_ENV_ACTIVATION_UNCONFIRMED** — code default D0 shadow FULL |
| Rollout stop at D0/shadow? | Yes by design; D3 requires explicit env + cohort |
| Intentional revert? | No full revert; policy gates preserved |
| Model migration impact? | `deepseek-v4-pro-0813` still matches DeepSeek branch via `isDeepSeekOpenRouterModel` |
| Benchmark FULL wire? | PR620 harness omitted `canonPlan` + used D0 policy → always ~10k `character-core-identity` |
| Explicit FULL fallback owner? | `isLayeredCanonActive` false → `buildCharacterCanonBlock` in `contextBuilder.ts` |

# Gemini 3.8 Flash OpenRouter 401 — auth investigation

Status: **ROOT_CAUSE_CONFIRMED_CONFIG_ACTION_REQUIRED**
Cursor did not score model quality. Provider generation POST **0**. Production DB write **0**. Secret change **0**. Evidence-only archival; the VM credential is still invalid.

## EXACT MAIN / HEAD

- Investigation base `origin/main`: `5a89690ce0e85f39d2934d0d8a4c8c57b829a136`
- Phase 3B execute SHA (unchanged): `f8bf8c823f86364388fc0261b3a6d36a34777551`
- Phase 3B packet: Draft #1520 / `docs/audits/monthly-rp-memory-quality-phase3b-2026-10-10/` (not rewritten)

## BEFORE

Phase 3B Path A sent 8 Main RP POSTs. DeepSeek / GPT-6.1 Sol / Claude Opus 5.5 on Cheaper Inference returned HTTP 200. Both Gemini 3.8 Flash cases on OpenRouter returned HTTP 401 `{"error":{"message":"User not found.","code":401}}`. Phase 3B treated GET `/models` HTTP 200 as auth success.

## PROBLEM

Need the actual 401 failure point: key selection, header assembly, endpoint, or Cursor-VM vs Railway credential. Not a quality re-score. Not a Gemini slug / Flex / provider change.

## REPRODUCTION (read-only)

Phase 3B Gemini cases (no re-call):

| case | URL | wire | provider pin | service_tier | HTTP | body |
| --- | --- | --- | --- | --- | --- | --- |
| `phase3b_t6_gemini-3.8-flash` | `https://openrouter.ai/api/v1/chat/completions` | `google/gemini-3.8-flash` | `only: [google-ai-studio]`, `allow_fallbacks: false`, `require_parameters: true` | `flex` | 401 | `User not found.` |
| `phase3b_t50_gemini-3.8-flash` | same | same | same | `flex` | 401 | `User not found.` |

Header path used by Phase 3B: `buildOpenRouterHeaders(process.env.OPENROUTER_API_KEY)`. Production Main RP uses `resolveOpenRouterApiKey()` → the same env var → `buildOpenRouterHeaders`.

Cursor VM `OPENROUTER_API_KEY` shape (no secret): set, length 73, prefix family `sk-or-`, no surrounding whitespace or quotes.

Official auth probe (not a generation POST):

| Probe | Result |
| --- | --- |
| `GET https://openrouter.ai/api/v1/models` with no Authorization | **200** (public catalog) |
| `GET https://openrouter.ai/api/v1/key` with no Authorization | **401** |
| `GET https://openrouter.ai/api/v1/key` with Cursor VM `OPENROUTER_API_KEY` | **401** `User not found.` — same body as Phase 3B chat/completions |

Railway `enchanting-ambition / production`: this VM has a `RAILWAY_TOKEN` but `railway whoami` returns `Unauthorized`. Production secret presence and key identity are **unread**.

## ROOT CAUSE

**CONFIRMED:** Cursor VM `OPENROUTER_API_KEY` is not a valid OpenRouter user credential. Official `GET /key` returns the same 401 `User not found.` that Gemini chat/completions returned. Phase 3B Gemini used that key. GET `/models` 200 is not auth.

This is an **execution-environment credential** failure, not a Gemini slug, Flex, provider-pin, or header-composition bug.

## Candidate classification

| Candidate | Status | Evidence |
| --- | --- | --- |
| Invalid / orphaned Cursor VM `OPENROUTER_API_KEY` | **CONFIRMED** | GET `/key` 401 `User not found.` |
| GET `/models` 200 proving auth | **RULED_OUT** | catalog is public without a key |
| Missing `OPENROUTER_API_KEY` | **RULED_OUT** | set, length 73 |
| Quote / whitespace in the VM key | **RULED_OUT** | trim length equals raw; no quotes |
| App selecting a benchmark OpenRouter key for Main RP | **RULED_OUT** | `resolveOpenRouterApiKey` reads only `OPENROUTER_API_KEY`; Phase 3B did the same |
| Wrong wire model / Google pin / Flex / fallback | **RULED_OUT** | assembled body matches current main invariants; 401 is account-level |
| `HTTP-Referer` / `X-Title` causing 401 | **RULED_OUT** | GET `/key` with the same Bearer fails; other VM OpenRouter keys succeed GET `/key` |
| Railway production key also invalid | **UNVERIFIED** | Railway CLI unauthorized; container not readable |
| VM key identical to Railway key | **UNVERIFIED** | no safe identity proof (length/prefix/account label ≠ same key) |

Two other Cursor VM env names (`OPENROUTER_EMBEDDINGS_BENCHMARK_API_KEY`, `OPENROUTER_JEV_BENCHMARK_API_KEY`) are **different** keys and GET `/key` HTTP 200. They are not the Main RP owner. This PR does **not** retarget production Gemini onto them.

## OWNER MAP

| Responsibility | Owner |
| --- | --- |
| Main RP picker / Gemini transport | `MAIN_RP_USER_SELECTABLE_OPTIONS` (`gemini-3.8-flash` → `openrouter`) |
| Wire slug | `resolveOpenRouterModelId` / `resolveMainRpPrimaryWireModelId` → `google/gemini-3.8-flash` |
| Flex pin | `MAIN_RP_OPENROUTER_ROUTE_POLICY_SOURCE` → `google-ai-studio`, `service_tier: flex`, `allow_fallbacks: false`, `require_parameters: true` |
| Final-wire | `assemblePrimaryRpRequest` |
| Production key | `resolveOpenRouterApiKey` ← `OPENROUTER_API_KEY` only |
| Headers | `buildOpenRouterHeaders` |
| Auth probe | `GET https://openrouter.ai/api/v1/key` (investigation-only read-only request, no application owner added) |
| Catalog (not auth) | `GET /api/v1/models` |
| TRPG Gemini | Cheaper Inference (`TRPG_GM_MODEL` / `TRPG_BOT_MODEL`), separate from Main RP OpenRouter |
| Phase 3B 401 packet | #1520 evidence (unchanged) |

#1191 routed Gemini Main RP to Google AI Studio + Flex. #1419 left Gemini 3.8 Flash as the only current Gemini. Current main still owns those invariants.

## AFTER

No operating prompt, price, margin, Gemini slug, provider pin, or other-model routing change.

The credential defect is outside the repository. The initial PR introduced helper constants and extra auth-owner tests, but review removed them as unnecessary for this VM-only failure. This PR archives the reproduced evidence only; application/runtime code and workflow remain unchanged.

## REMOVED

Removed proposed auth URL constants, redundant environment-name owner list/classification helper, new auth-owner tests, and CI workflow hook from this PR. No production code or paid execute path changed.

## PRESERVED

- Main RP Gemini → OpenRouter `google/gemini-3.8-flash`
- `google-ai-studio` / Flex / no fallback / `require_parameters`
- Other Main RP models on Cheaper Inference
- TRPG Gemini on Cheaper Inference
- Phase 3B measured replies and 401 bodies
- Pricing / billing policy

## REGRESSION RISKS

- No application/runtime regression: this PR only adds a diagnostic report.
- Pre-existing on main (not this change): `openRouterConfig.test.ts` expects `X-Title` `하브` while `OPENROUTER_DEFAULT_WIRE_APP_TITLE` is `Hav`. Unrelated to 401. Not patched here.

## PROOF

- GET `/models` without a key: 200
- GET `/key` with Cursor VM `OPENROUTER_API_KEY`: 401 `User not found.`
- Phase 3B Gemini URL/body/status match the live assembler on current main
- Railway unread (`railway whoami` → Unauthorized)
- The original code/test additions were dropped after GPT review as non-root-cause patches. No new automated auth tests; repro is the read-only 401 response already collected.

## SYSTEM DELTA

Documented the authentication root cause without introducing a second key owner, live auth-probe subsystem, CI gate, or fallback. **No secret rotation.** Replacing the Cursor Cloud `OPENROUTER_API_KEY` (and independently verifying Railway) is an operator action outside this PR.

## Production impact

Phase 3B Gemini 401 is proven for the **Cursor VM** key only. Production Gemini impact is **UNVERIFIED** until a production-container GET `/key` (or equivalent) is possible.

## Operator options (STOP — do not do these in this PR)

1. Replace Cursor Cloud environment `OPENROUTER_API_KEY` with a valid OpenRouter user key. Do not paste the secret into chat or the PR.
2. From Railway production, run read-only `GET /api/v1/key` and record only HTTP status + non-secret account flags.
3. Do not point Main RP at benchmark OpenRouter keys unless a later, explicit credential-policy decision says so.
4. Gemini paid re-eval only after a valid key and a new USER_APPROVED_PAID_EVALUATION.

**Provider generation POST 0 / production DB write 0 / Secret 변경 0 / 자동 병합 0.**

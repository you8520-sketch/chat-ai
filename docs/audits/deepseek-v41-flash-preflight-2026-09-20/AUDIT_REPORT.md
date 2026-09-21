# DeepSeek V4.1 Flash — Feature Pre-Flight

**Date:** 2026-09-20  
**Exact main HEAD:** `3c5555a2fe97f9097cf7b65aff5912574d72b805`  
**Branch:** `cursor/deepseek-v41-flash-preflight-d09d`  
**Mode:** Pre-flight only — **no picker, no live billing, MERGE=NO**  
**Product positioning:** V4 Pro = Premium/quality · V4.1 Flash = Fast/Value (**not** a Pro replacement)

---

## EXACT MAIN HEAD

| Field | Value |
|---|---|
| `origin/main` | `3c5555a2fe97f9097cf7b65aff5912574d72b805` |
| Pre-flight branch | `cursor/deepseek-v41-flash-preflight-d09d` |
| PRICE_CUTOVER | **NO** |
| Live provider calls | Probe 4 + RP A/B 20 (bounded) |

---

## OWNER MAP

| Concern | Canonical owner (main) |
|---|---|
| Main RP registry / picker | `src/lib/chatModels.ts` — `MAIN_RP_USER_SELECTABLE_OPTIONS`, `DEFAULT_SELECTED_AI` |
| CI routing | `src/app/api/chat/route.ts` → `streamOpenRouterAdult` / `openRouterAdult.ts` |
| CI wire adapter | `src/lib/cheaperInferenceConfig.ts` — `adaptCheaperInferenceChatBody`, `applyCheaperInferenceModelReasoningPolicy` |
| DeepSeek failover | `src/lib/deepseekProviderFailover.ts` |
| Model aliases (published billing) | `src/lib/publishedModelAliases.ts` |
| Legacy picker remap | `LEGACY_TO_SELECTED` in `chatModels.ts` |
| Live BASE charge | `src/lib/pointsReasoningMargins.ts` |
| Published catalog (shadow) | `src/lib/publishedModelPricing.ts` |
| Published charge engine | `src/lib/publishedUserCharge.ts` |
| Cache/tier policy | `src/lib/modelPublishedPricingPolicy.ts` |
| Procurement | `src/lib/procurementCost.ts` |
| Usage parse | `src/lib/openRouterUsage.ts` — `cached_tokens`, `cache_write_tokens`, `reasoning_tokens` |
| Returned model (runtime) | `TokenUsage.responseModelId` in stream; ledger `actual_model` = `responseModelId ?? stage.model` |
| Persisted stages | `usage.stages[]` — **requested** `model` only (not `responseModelId`) |
| Admin receipt | `adminBillingReceiptV3Shared.ts`, `AdminBillingReceiptV2Panel.tsx` |
| Production prompt | `src/services/contextBuilder.ts` — `buildContext()` |

---

## MODEL IDENTITY MAP

| Stage | V4 Pro | V4.1 Flash (candidate) | Legacy 0731 |
|---|---|---|---|
| **CI catalog id** | `deepseek-v4-pro-0813` | **`deepseek-v4.1-flash`** | `deepseek-v4-flash-0731` (distinct CI row) |
| Official API name | `deepseek-v4-pro` | **`deepseek-flash`** | legacy names → V4.1 Flash |
| Requested (Main RP today) | `deepseek-v4-pro-0813` | *not in picker* | background only |
| Returned (probe/A/B) | `deepseek-v4-pro-0813` (usually) | **`deepseek-v4.1-flash`** | — |
| Billing (live) | `deepseek-v4-pro-0813` | — | `deepseek-v4-flash-0731` (background) |
| Published row | v2 `0.66/1.98` | **none** | v1 `0.098/0.196` |
| `isCheaperInferenceModel` | yes | **no** (not registered) |
| Failover wrapper | yes (`native_pro`) | **no** (passes through CI transport only) |

### Legacy alias classification

| ID | Verdict | Notes |
|---|---|---|
| `deepseek-v4-flash-0731` | **KEEP** | Do **not** overwrite with v4.1-flash; separate CI pricing & background callers |
| `deepseek-v4-flash` | **MIGRATE** | Wire → 0731 today; future user-facing id should be `deepseek-v4.1-flash` |
| `deepseek-v4.1-flash` | **FOLLOW-UP** | Add to `chatModels.ts` as new constant; separate from 0731 |
| `deepseek-flash` | **FOLLOW-UP** | Official name; map only if direct DeepSeek API path added |

---

## PROVIDER CAPABILITIES

| Capability | DeepSeek official | CI `deepseek-v4.1-flash` (2026-09-20) |
|---|---|---|
| Context | 1M | 1,048,576 |
| Max output | 384K | 384,000 |
| Vision | ✓ | not exposed in CI metadata |
| Thinking mode | non-thinking + thinking (default) | RP path forces **thinking disabled** via `openRouterClient` deepseek family |
| Tool calls | ✓ | not audited this pass |
| Streaming | ✓ | ✓ (verified A/B) |
| Cache hit/miss pricing | ✓ separate rates | ✓ CI list aligns with **peak** official |
| Concurrency | 2500 (Flash) | not measured |
| Response `model` field | yes | **matches requested** on probe + most A/B turns |

Official source: [DeepSeek Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing)

---

## PEAK / OFF-PEAK PRICING

Product decision (this preflight):

| Model | PROVIDER_NORMAL_BASELINE (peak) | PROCUREMENT_TIER (off-peak) |
|---|---|---|
| **V4 Pro** | in **$1.32** / out **$3.96** / cache hit **$0.044** | half rates — does **not** change BASE |
| **V4.1 Flash** | in **$0.30** / out **$1.20** / cache hit **$0.006** | in $0.15 / out $0.60 / hit $0.003 |

CI list for `deepseek-v4.1-flash` (**0.30 / 1.20**) matches **Flash peak** baseline (not off-peak 0.15/0.60).

CI list for `deepseek-v4-pro-0813` (**0.66 / 1.98**) remains **off-peak-shaped** vs new Pro peak policy — **Pro published row recalibration is out of scope** (unchanged this PR).

---

## CANDIDATE 60% PRICE MATRIX

FX: **1560.6** effective (1530 × 1.02). Candidate: peak ref + **60%** target margin. CI current procurement from live catalog snapshot.

| Shape | Peak ref KRW | Candidate BASE P | CI proc KRW | Realized margin @ candidate P |
|---|---:|---:|---:|---:|
| NORMAL (33k/3461) | 22.0 | **55** | 8.9 | 0.80 |
| MEMORY_HEAVY (12.8k cache read) | 2.5 | **7** | 1.0 | 0.90 |
| BOUNDED_STRESS (80k/5k) | 46.8 | **117** | 18.9 | 0.80 |

CI snapshot (observedAt **2026-09-20**): current **0.120853 / 0.483412** (~59.7% discount), cache read **0.002417**.  
Candidate BASE **does not** use CI current — deterministic fixture in `deepseekV41FlashPreflight.ts`.

Full JSON: `PRICE_MATRIX.json`

---

## V4 PRO RELATIVE PRICE MATRIX

Same shapes; V4 Pro **peak** baseline @ published target margin **50%**:

| Shape | Flash candidate P | Pro peak-base P | Flash/Pro ratio |
|---|---:|---:|---:|
| NORMAL | 55 | 180 | **0.30** |
| MEMORY_HEAVY | 7 | 18 | 0.39 |
| BOUNDED_STRESS | 117 | 392 | 0.30 |

Positioning: Flash ~**30%** of Pro peak-base P on representative Main RP workloads.

---

## CACHE SEMANTICS

### Provider contract (verified)

| Field | Reported? | Parser owner |
|---|---|---|
| `prompt_tokens_details.cached_tokens` | **yes** | `parseOpenRouterUsage()` |
| `cache_write_tokens` | **yes** (0 in all captured calls) | same |
| `completion_tokens_details.reasoning_tokens` | **yes** (0 with thinking off) | same |

Evidence: `PROVIDER_PROBE.json`, RP A/B operational (e.g. Flash `F_speech_lock`: **4736** cache read tokens).

### Billing engine fit

| Model | `modelPublishedPricingPolicy` | `publishedUserCharge` with cache |
|---|---|---|
| V4 Pro 0813 | `cacheSemanticStatus: verified`, write absent = proven zero | **complete** with cache read rate |
| V4.1 Flash | **no policy row** | **blocked** → `unsupported_cache_semantics` until policy + published cache read rate added |

**No cache write price assumed** — provider reports `cache_write_tokens: 0`; DeepSeek uses automatic prefix cache only (`explicitCacheInjection: false`).

---

## REASONING SEMANTICS

| Path | V4 Pro | V4.1 Flash |
|---|---|---|
| CI adapter `applyCheaperInferenceModelReasoningPolicy` | Rewrites to 0813 + `thinking: disabled` | **Not matched** — id passes through unchanged |
| Stream path `openRouterClient` | `family: deepseek` → reasoning **disabled** | Same (observed in A/B logs) |
| Usage | `reasoning_tokens: 0` | `reasoning_tokens: 0` |
| Double-charge risk | **Low** at current RP settings — reasoning reported separately but zero |

**Follow-up:** Register v4.1-flash in adapter with explicit thinking policy (non-thinking default for RP vs thinking-capable product surface).

---

## RP A/B ARTIFACTS

**20 live calls** (10 fixtures × Pro + Flash), production `buildContext()` assembly.

| Artifact | Path |
|---|---|
| Blind samples | `rp-ab/samples/{fixture}_Sample_{A|B}.txt` |
| Model map (GPT only) | `rp-ab/model-map.json` |
| Operational metrics | `rp-ab/operational.json` (F–J detailed; A–C in samples + first run logs) |
| Manifest | `rp-ab/manifest.json` |

Fixtures: A_daily … J_adult_fixture (see `scripts/deepseek-v41-flash-rp-ab.ts`).

**Cursor did not score RP quality.** Objective checks recorded: output length, format violations, user-impersonation markers, completion, latency, token usage.

Notable runtime findings:
- **`G_long_memory` Pro:** `responseModelId` = `deepseek/deepseek-v4-pro-0813` while requested `deepseek-v4-pro-0813` → **modelMismatch: true** (`NAMESPACE_ALIAS_GAP_CONFIRMED`; billing survives via requested `deliveredModelId`; ledger stores raw response).
- **`F_speech_lock` Pro:** short English output (478 chars) — no degeneration on retry with error handler.

---

## LATENCY / COST EVIDENCE

Sample from operational (production-scale prompts ~5k input tokens):

| Fixture | Model | TTFT ms | Total ms | Out chars | Cache read |
|---|---|---:|---:|---:|---:|
| A_daily | Pro | 7134 | ~71000 | 1413 | — |
| A_daily | Flash | 8917 | ~65000 | 1791 | — |
| F_speech_lock | Flash | 8917 | 35862 | 2563 | 4736 |

Provider raw cost available via `upstreamCostUsd` on stream usage when reported.

---

## DEAD SYSTEM AUDIT

| Item | Verdict |
|---|---|
| `deepseek-v4-flash-0731` + published v1 row | **KEEP** |
| `pointsReasoningMargins` Flash constants (0731) | **KEEP** |
| `LEGACY_TO_SELECTED` flash → Pro | **KEEP** |
| `openRouterModelPricing` Flash rates | **FOLLOW-UP** (stale vs v4.1-flash) |
| Repurpose 0731 id for v4.1 | **FORBIDDEN** |

---

## REGRESSION RISKS

| Risk | Mitigation in cutover design |
|---|---|
| V4 Pro routing/billing drift | No changes to Pro constants/rows in this PR |
| 0731 background breakage | New id `deepseek-v4.1-flash`; leave 0731 callers untouched |
| Flash mis-billed as Pro | Separate published row + `isCheaperInferenceModel` entry + picker id |
| CI discount moves BASE | Use `publishedUserCharge` stable peak ref; procurement separate |
| Response model mismatch | Persist `responseModelId` or normalize in ledger; alert on mismatch |
| Failover absent for Flash Main RP | Explicit product choice: Flash single-attempt like Pro, or add `native_flash_v41` route kind |

---

## CUTOVER DESIGN (integration only — not implemented)

1. **`chatModels.ts`:** add `CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL = "deepseek-v4.1-flash"`; add to `isCheaperInferenceModel`; **do not** alter 0731 constant.
2. **Picker:** new option "DeepSeek V4.1 Flash" (Fast/Value), separate from Pro — feature-flagged.
3. **`publishedModelPricing.ts`:** new v2 row — peak ref 0.30/1.20, cache read 0.006, target margin **0.60**.
4. **`modelPublishedPricingPolicy.ts`:** add cache policy after production cache evidence (mirror Pro 0813).
5. **`cheaperInferenceConfig.ts`:** extend reasoning policy matcher for v4.1-flash (do not rewrite to 0731).
6. **`deepseekProviderFailover.ts`:** add route kind for v4.1 Main RP if product requires failover parity.
7. **Billing cutover:** `publishedUserCharge` only after cache policy verified; **PRICE_CUTOVER=NO** until GPT + product sign-off.

No parallel billing engine — extends existing owners.

---

## PROOF

| Artifact | Path |
|---|---|
| This report | `AUDIT_REPORT.md` |
| Price matrix | `PRICE_MATRIX.json` |
| Provider probe | `PROVIDER_PROBE.json` |
| RP A/B | `rp-ab/` |
| Code fixtures | `src/lib/deepseekV41FlashPreflight.ts` |
| Tests | `src/lib/deepseekV41FlashPreflight.test.ts` (5/5) |

---

## CLASSIFICATION

**`READY_FOR_GPT_RP_REVIEW`**

RP blind samples + model map + pricing matrix + provider contract evidence are complete.

**Implementation blockers (not GPT RP blockers):**
- `publishedUserCharge` cache path for v4.1-flash → **`BLOCKED_BY_CACHE_SEMANTICS`** until policy row added
- `chatModels` / adapter / failover registration → **`FOLLOW-UP`** before public picker

**MERGE = NO · PRICE_CUTOVER = NO · STOP**

---

# CORRECTION PASS (2026-09-21)

Product evaluation criteria only: CANON CONSISTENCY · EFFECTIVE USER AUTHORING SCOPE · CHARACTER/USER PERSONA CONSISTENCY · SCENE CONTROL QUALITY. 창작·공동서술 자체는 bug가 아니다. **UNKNOWN ≠ FORBIDDEN**.

## 1. D_LORE RE-EVALUATION — `VALID_CREATIVE_GAP_FILL`

기존 "원래 설정에 없다 → FAIL" 판정을 기각한다. fixture의 **actual production context**:

| Source | Content |
|---|---|
| creator chunk `c-lore` | **왕실 수호대 견습 실패 사건** 이후 '약한 사람을 지키지 못했다' 죄책감 + 유저는 어릴 적 친구 |
| creator chunk `c-identity` | 강이현 29세, 검은 장미단 부단장 |
| raw history | 「…기억하고 싶지 않아。」 / 말해줘도 돼 |
| lorebook / USER_PERSONA / memory / confirmed facts | 없음 (fresh fixture) |

Sample B (Flash)의 왕실 수호대 견습 / 견습 자격 상실 / 검을 놓음 = **creator c-lore의 직접 표현** (설정에 이미 있음). 두 살 어린 견습생·시험장 사건·희생·이야기를 안 했다 = 지정되지 않은 **open gap** 창작 — creator/user canon·confirm memory·explicit negation 충돌 0건. 신규 분류: **`VALID_CREATIVE_GAP_FILL`** (`CANON_CONTRADICTION` 아님).

## 2. AUTHORING OWNER MAP (current main, re-verified)

| Concern | Owner (main) |
|---|---|
| Standard interactive | `COLLABORATIVE_INTERACTIVE_OWNER_BLOCK` (noGodmodding.ts) — 단일 standard owner |
| Auto progression | `AUTO_PROGRESSION — AI-FOCAL CO-NARRATION` (autoProgressionRules.ts) |
| OOC co-narration opt-in | `USER CONTROL MODE - LIMITED CO-NARRATION` (impersonation ON, chatRuntimeMode `ooc_user_impersonation_allowed`) |
| Persistent coauthor DIALOGUE/ACTIONS/FULL | `chats.user_coauthor_mode` (OFF/DIALOGUE/ACTIONS/FULL) → `buildUserCoauthorOwnerBlock` |
| Current-turn OOC delegation | `resolveCurrentTurnUserAuthoringDelegation` (leading OOC) · turn vs persistent |
| Current user input priority | `applyUserCoauthorDirective` — grant/deny slot이 persistent를 in-turn override; explicit revoke 최우선 |
| USER_PERSONA | `formatPublicPersonaForPrompt` + 정본 조항 (identity 본문 보호) |
| Detector (log-only) | `detectInteractiveUserImpersonation` + `runOwnershipShadowGuardV2` |

## 3. EFFECTIVE SCOPE PER MODE (§14 fixture keys)

| Runtime mode | Delegation | Effective allowed dialogue | Effective allowed major action |
|---|---|---|---|
| interactive (standard) | none | [B] 신규 직접 대사 — **NO** | minor/local/reversible co-narration — **YES** (표정·시선·호흡·비자발적 반응·마무리·이동·국소 접촉·물건 수취·일상·즉각 가역 반응) |
| auto_progression | (composer locked) | 짧/중간 [B] 대사 + persona-voice imitation — **YES** (USER_PERSONA+이전 발화 근거) | [B] 외부 행동·이동·물건 사용 — **YES**; 내면 독백/감정 결론/명시적 동의·거절/정체성 변경 — **NO** |
| ooc_user_impersonation_allowed | none | persona 대사 최소 공동 서술 (사칭 허용, 입력 의도 내) | 중대 결정 대신 확정 — NO |
| current_turn_ooc_delegated | **DIALOGUE** | [B] 직접 대사 — YES | 신규 중요 행동 — NO (새 [B] 대사 없음) |
| current_turn_ooc_delegated | **ACTIONS** | 새 [B] 대사 — NO | 중요 행동+국소 동작·반응·선택 — YES |
| current_turn_ooc_delegated | **FULL** | 대사+행동 위임 — YES (수락/거절/망설임 허용) | 정본 밖 정체성/장기 관계/영구 약속 — NO |

**A/B 샘플 전부 standard interactive 어셈블** (하네스 특성; delegation/auto progression/OOC 미설정).

## 4. DETECTOR VS EFFECTIVE SCOPE — detectors are NOT pass/fail owners

Re-verified in `route.ts` post-stream: `detectInteractiveUserImpersonation` → `logUserImpersonationGuard` **log only** (auto-repair env default OFF, `repairAttempted:false`). `runOwnershipShadowGuardV2` → `ownershipTelemetry` + `logOwnershipShadowGuardV2` **shadow-only**. 둘 다 effective coauthor scope(DIALOGUE/ACTIONS/FULL, duration)를 **입력받지 않는다** (scope-blind) → `userImpersonationDetected`는 독립 FAIL 근거 아님. QA canonical dimension = **`AUTHORING_SCOPE_VIOLATION`** (manual effective-scope check). Production patch 없음 — detector에 scope 주입은 3단계 공동서술 follow-up 후보.

**E_impersonation 재판정**: Sample A(Pro)·B(Flash) 모두 상대(모델)가 character로서 유저 명령을 거절/반문 → 유저 신규 발화·결정을어하지 않음 → **`AUTHORING_SCOPE_VIOLATION` 없음** (`userImpersonationDetected` flag는 regex shadow metric일 뿐).

## 5. FINAL REQUEST PARITY (deterministic, credential-free)

Harness: `scripts/deepseek-v41-flash-request-parity.ts` → `rp-ab/request-parity.json` (10 fixtures, no live calls).

| Diff | Verdict |
|---|---|
| `model` | identity (by design) |
| `thinking` | Pro sends `thinking:{type:"disabled"}` typed body; Flash(generic fallback) sends field omitted + `reasoning_effort:"none"` — SAME intended non-thinking state (`reasoning_tokens: 0` both, live evidence) |
| messages | sections 51/51 identical semantics; Pro-only `<WORLD_LORE>` XML wrapper (+27 chars, DeepSeek XML extras); hygiene/UserControl block ordering differs slightly |
| sampling | temperature 0.92 = 0.92; top_p equal; max_tokens omitted → provider default (both) |
| USER_PERSONA / memory / lore / length target | identical text |

**Classification:** `PRE_INTEGRATION_RP_EVIDENCE` — **not** `FINAL_PRODUCTION_QUALITY_COMPARISON`.

Pre-integration gaps (current main, not patched in #993):

- V4.1 Flash not registered on `isDeepSeekModel` family owner
- Pro-only DeepSeek prompt wrapper / section positioning
- Pro explicit `thinking:{type:"disabled"}` vs Flash generic fallback
- Flash generic `reasoning_effort:"none"` only (no typed thinking body)

→ Bounded live A/B + parity harness prove **current** wire divergence. Re-run bounded A/B only after V4.1 implementation integrates family owners and corrected final request on a **fresh main branch**.

## 6. V4.1 WIRE OWNER (design only — not patched)

`deepseek-v4.1-flash`는 `isCheaperInferenceDeepSeekV4FlashModel`(0731 matcher)과 `isDeepSeekModel` 패밀리 gate 모두 미매칭 → (a) reasoning policy generic fallback, (b) contextBuilder DeepSeek-family extras skip(`<WORLD_LORE>` wrapper 등), (c) failover route kind 미등록. **Implementation design**: 신규 상수 + reasoning policy 명시 branch (동일 TRUE-OFF body) + `isDeepSeekModel` family 확장 — **0731 constant/rows 침범 금지**.

## 7. CACHE SEMANTICS — read-only READY

`cached_tokens`(read) proven live (probe: 4736 read tokens). Cached tokens는 standard input과 별도 과금 owner(`normalizeBillableUsage`). `cache_write_tokens` observed 0 in captured evidence → **write price 추측 금지**; **unreported ≠ proven zero** — do not add `cacheWriteAbsentSemantics: proven_zero` for V4.1 without provider contract proof. READY scope = **cache read only**. `publishedUserCharge`에는 `modelPublishedPricingPolicy` v4.1 flash row (`cacheSemanticStatus: verified`, cache read 0.006) 필요.

## 8. RESPONSE MODEL NORMALIZATION — **RETRACTED prior claim**

**Prior correction-pass claim (RETRACTED):** “existing owner canonicalizes observed namespace variant exactly.”

**Exact-head alias table (`publishedModelAliases.ts`):**

| Raw id | Canonical via owner |
|---|---|
| `deepseek/deepseek-v4-pro` | `deepseek-v4-pro-0813` ✓ |
| `deepseek-v4-pro` | `deepseek-v4-pro-0813` ✓ |
| `deepseek/deepseek-v4-pro-0813` | **(no alias — passes through unchanged)** |

**Classification:** `NAMESPACE_ALIAS_GAP_CONFIRMED` — production alias patch deferred to V4.1 implementation PR (not #993).

Deterministic owner execution (cases A/B/C in `deepseekV41FlashPreflight.test.ts`):

| Case | Input | Canonical | Same identity as requested `deepseek-v4-pro-0813`? |
|---|---|---|---|
| A returned | `deepseek/deepseek-v4-pro-0813` | `deepseek/deepseek-v4-pro-0813` | **NO** |
| B different | `deepseek/deepseek-v4-flash-0731` | `deepseek/deepseek-v4-flash-0731` | **NO** (mismatch persists) |
| C legacy | `deepseek/deepseek-v4-pro` | `deepseek-v4-pro-0813` | **YES** (legacy preserved) |

**Mitigation today:** billing dispatch uses `deliveredModelId` (requested wire id), not `responseModelId` — Phase 2 eligibility survives G_long_memory. Ledger `actual_model` still stores raw response id.

## 9. LENGTH / INITIATIVE

F_speech_lock target **3200**자: Flash 2,563 (≈target 내) → `VALID_ACTIVE_RP`; Pro 478 → `UNDER_TARGET_OUTLIER` (길이 리스크는 Pro 쪽). 장문·능동 성향 자체는 defect 아님 — A(과도 length)·B(scene-local 밖 진행 무시)·C(허용 범위의 풍부 전개) 구별.

## 10. BLIND RP ARTIFACTS (updated)

- `rp-ab/samples/*` blind A(raw)/B(flash) + `model-map.json` · `operational.json` · **new `request-parity.json`**
- Cursor 품질 점수 없음; objective contract만: canon contradiction · **authoring scope violation** · format · length · returned model · cache · reasoning · finish reason · latency.

## 11. BRANCH HYGIENE

#993 audit PR은 #991 stacked로 유지(강제 rewrite 없음). 실제 V4.1 implementation은 **current main에서 fresh branch**, V4.1-specific 구현만 — #991 audit 파일 반입 금지.

## CORRECTION CLASSIFICATION

**`READY_FOR_IMPLEMENTATION`** — meaning **“fresh V4.1 implementation PR may start”** — **not** “public picker ready” or “billing cutover ready.”

**MERGE = NO · PICKER_ENABLE = NO · PRICE_CUTOVER = NO · STOP for GPT review.**

---

# FINAL FACTUAL CORRECTION PASS (2026-09-21, pass 2)

## EXACT HEAD

| Field | Value |
|---|---|
| Prior correction pass | `fa266510863087865bfb74c59eb7e0b2a3528cf8` |
| Audit branch | `cursor/deepseek-v41-flash-preflight-d09d` (#993 stacked on #991) |
| `origin/main` (preflight baseline) | `3c5555a2fe97f9097cf7b65aff5912574d72b805` |
| MERGE / PICKER / PRICE_CUTOVER / PRODUCTION_PROMPT_CHANGE | **NO / NO / NO / NO** |
| Live provider calls this pass | **0** |

## RESPONSE MODEL RAW → CANONICAL DATAFLOW

Observed mismatch fixture: requested `deepseek-v4-pro-0813`, returned `deepseek/deepseek-v4-pro-0813` (G_long_memory Sample A).

| Stage | Raw id | Canonical id | Persisted id | Owner |
|---|---|---|---|---|
| Provider payload | `deepseek/deepseek-v4-pro-0813` | — | — | `openRouterAdult.ts` → `TokenUsage.responseModelId` |
| `StageUsage` | `model`=requested; `responseModelId`=returned | none | `usage.stages[]` JSON | `openRouterAdult.ts` stage builder |
| `deliveredModelId` / `usage.model` | `deepseek-v4-pro-0813` | not at assign | usage record | `route.ts` (requested wire) |
| `chatBillingContractDispatch` | `deliveredModelId` | `canonicalizePublishedModelId` → `deepseek-v4-pro-0813` | telemetry + published snapshot | `chatBillingContractDispatch.ts` |
| `publishedUserCharge` | `modelId` arg | `snapshot.canonicalModelId` | published snapshot when Phase 2 live | `publishedUserCharge.ts` |
| `providerCostLedger.actual_model` | `deepseek/deepseek-v4-pro-0813` | **none at write** | `api_cost_ledger.actual_model` | `recordMainGenerationProviderCost` (`responseModelId ?? model`) |
| Admin receipt | ledger `actual_model` | none in projection | receipt events | `adminBillingReceiptV3Shared.ts` |

## OBSERVED NAMESPACE ALIAS RESULT

| Test | Result |
|---|---|
| A: `deepseek-v4-pro-0813` vs `deepseek/deepseek-v4-pro-0813` | **NOT** same canonical identity |
| B: `deepseek/deepseek-v4-flash-0731` | Mismatch persists (different model) |
| C: `deepseek/deepseek-v4-pro` | Canonicalizes to `deepseek-v4-pro-0813` (legacy preserved) |

**Classification:** `NAMESPACE_ALIAS_GAP_CONFIRMED`. Exact alias for `deepseek/deepseek-v4-pro-0813` → **V4.1 implementation PR required cleanup** (not patched in #993).

## REPORT CLAIM CORRECTION

| Prior claim | Status |
|---|---|
| “`publishedModelAliases` canonicalizes observed `deepseek/deepseek-v4-pro-0813` exactly” | **RETRACTED** — alias exists for `deepseek/deepseek-v4-pro` only, not the `-0813` namespace variant |
| “Billing already canonicalizes response namespace variant” | **PARTIAL** — billing uses requested `deliveredModelId`; response-only paths (`actual_model`, response-as-modelId) do not canonicalize |

## REQUEST PARITY INTERPRETATION

| Classification | Meaning |
|---|---|
| `PRE_INTEGRATION_RP_EVIDENCE` | Current A/B + `request-parity.json` under non-integrated V4.1 wire |
| **Not** | `FINAL_PRODUCTION_QUALITY_COMPARISON` |

Non-parity causes: `isDeepSeekModel` miss, Pro-only `<WORLD_LORE>` wrapper (+27c), Pro typed `thinking:{type:"disabled"}`, Flash generic fallback.

## IMPLEMENTATION HANDOFF

Fresh branch from **current main** only. Required before bounded A/B smoke rerun:

1. V4.1 canonical constant (≠ 0731)
2. `isDeepSeekModel` family integration
3. Explicit reasoning/thinking TRUE-OFF owner
4. Exact response-model alias normalization where proven (`deepseek/deepseek-v4-pro-0813`)
5. Published pricing row (peak 0.30 / 1.20 / cache read 0.006, margin 60%)
6. Cache policy row (`cacheSemanticStatus: verified`; no `proven_zero` without contract)
7. Canonical billing dispatcher integration

**Do not import:** #991 billing audit files, G37 matrices, unrelated audit scripts, stacked PR history.

## BILLING LAUNCH GATE

| Item | Value |
|---|---|
| V4.1 candidate peak BASE | in **$0.30/M**, out **$1.20/M**, cache read **$0.006/M** |
| Target margin | **60%** |
| CI current | procurement only — must not silently move user BASE when published billing blocked |
| Picker enable | requires complete canonical stable billing contract — not CI-current legacy fallback |

## CACHE WRITE BOUNDARY

Captured evidence: `cache_write_tokens = 0` in probe/A/B samples.

**Boundary:** unreported cache write ≠ proven zero. Do **not** add `cacheWriteAbsentSemantics: proven_zero` for V4.1 until provider contract proves absent==zero. READY scope remains **cache read only**.

## BRANCH HYGIENE

- **#993:** evidence-only audit on `#991` stack — **MERGE = NO**, draft preserved
- **V4.1 implementation:** fresh `main` branch, V4.1-specific code only

## FINAL CLASSIFICATION

**`READY_FOR_IMPLEMENTATION`** = fresh implementation PR may start.

**Does not mean:** public picker ready · billing cutover ready · merge #993.

**MERGE = NO · PICKER_ENABLE = NO · PRICE_CUTOVER = NO · STOP for GPT review.**

# Monthly RP Memory Quality — Phase 2C

Status: **ACTUAL_SINGLE_LUNA_SAMPLE_REVIEWED. CURRENT_PRODUCTION_PARITY UNPROVEN. Cursor did not score quality. Draft PR only. Do not merge. Do not re-run Luna.**

Execution host: **Cursor VM**, not the Railway production container.
EXACT origin/main metadata at execute: `3a5238542dd594d72b55e46ba64cb498946b9082`
Railway production SUCCESS metadata (enchanting-ambition / production): `3a523854`. That SHA is GitHub deploy metadata, not an observed process runtime SHA on this VM.
`BACKGROUND_MEMORY_MODEL` was unset on the Cursor VM. Railway process config, production character 18, and admin 렌 persona were not read.

Tracking: #1486. The one approved fictional batch already ran. Rerun is not authorized.

## BEFORE

Phase 2B (#1500) proved live validators accept a fact-dropping canned summary. It did not produce Luna text. Production seal owner is unchanged: `summarizeTurnBatch` → `callBackgroundMemory` → Cheaper Inference `gpt-6-luna`.

## PROBLEM

GPT needed the actual Luna output for the Phase 2B 라이크 18 / 렌 fixture, with request assembly, usage, and validator results side by side.

## EXECUTION PATH (completed sample)

1. GitHub deployments: `099c9df9` SUCCESS then inactive; `3a523854` in_progress then SUCCESS. These are deploy metadata rows.
2. Cursor VM: `BACKGROUND_MEMORY_MODEL` unset → `resolveBackgroundPrimaryModelId` → `gpt-6-luna`. Railway env was not readable. Current-main resolver also maps `.env.example` `gpt-5.6-luna` to `gpt-6-luna`. This is not homepage / Railway-container observation.
3. Auth: GET `https://api.cheaperinference.com/v1/models` HTTP 200; catalog includes `gpt-6-luna`. GET is not a generation POST.
4. Completed execute used a recording wrapper around live `summarizeTurnBatch` → `callBackgroundMemory` with the same `system`, `history`, `turnTrace`, `requestKind`. That one-shot helper, CLI, host-local lock, and `paidEvaluationApproved: true` plan are removed after the sample.
5. Attempt 1 `background-memory-extract` accepted. No retry. Provider POST 1.

Experiment vs production: the wrapper recorded args/results only. Model, `max_tokens` null, temperature 0.3, disableReasoning, retry owner, clamp, and validators are the current-source live path. That does **not** prove Railway-container runtime, homepage, or production identity parity.

Identity used: Phase 2B fixture blocks, labeled not production sheets. Local `data/app.db` did not exist before the call; production character 18 / admin 렌 sheets were not readable. A gitignored local sqlite file was created by runtime diagnostics during the call. Production DB write 0.

## OWNER MAP

| Responsibility | Owner |
| --- | --- |
| Prompt / request | `buildRollingSummarySystemPrompt` + `ROLLING_SUMMARY_EPISTEMIC_POLICY` / `summarizeTurnBatch` |
| Provider | `callBackgroundMemory` → `callGeminiOnce` → Cheaper Inference |
| Retry / accept | `summarizeTurnBatch` max 3 |
| Validators | `validateSummaryNarrative`, `isRollingSummaryGroundedInDialogue` |
| Clamp | `clampMemoryRecordSummary` 600 / 80 |
| Evidence labels | `memoryEvidenceProvenance.ts` |
| Fixture | `monthlyRpMemoryQualityPhase2bFixture.ts` |

Removed after the completed sample: `monthlyRpMemoryQualityPhase2cExecute.ts`, `scripts/monthly-rp-memory-quality-phase2c-execute.ts`, host-local `/opt/cursor/artifacts` lock, and the `paidEvaluationApproved: true` plan constant.

## ACTUAL LUNA OUTPUT

Provenance: **CURRENT_LIVE_PROVIDER** = actual paid provider output (`providerRequestId=52c1bd6a-23c2-4f82-83b4-9c9db9361694`).
`canClaimCurrentLiveProvider`: true (actual provider response).
`canClaimCurrentProductionParity`: false.
`productionRuntimeParity` / `productionIdentityParity` / `homepageParity`: **UNPROVEN**.

Selected summary (attempt 1, 263 chars, clamp unchanged):

> 렌이 지난달 처음 만났다고 밝히자 라이크는 둘이 어릴 때부터 알았다고 주장했으나, 이는 라이크의 말로만 제시됨. 렌은 화가 가라앉을 때까지 계단에 남겠다고 했고, 라이크는 진정한 뒤 사과함. 이후 라이크가 먼저 렌을 안았으며, 렌은 그를 따랐고 라이크는 렌이 건넨 황동 라이터로 담배를 붙임. 라이크는 다음 날 아침 여섯 시 역에서 만나기로 약속했고, 렌은 약속을 받아들임. 다음 날 6시 10분 렌이 도착했을 때 라이크는 기다리고 있었고 라이터도 여전히 소지 중이었음.

Validators: `validateSummaryNarrative` PASS. `isRollingSummaryGroundedInDialogue` PASS.

Usage: input 1854 / output 180 (not estimated). cacheWrite 1852. billed **$0.000209**. Provider POST **1**.

`missingMustKeepIds` (`time_order`, `user_choice`, `role_direction`) is the Phase 2B exact-token heuristic only. It is not a quality score. Wording like `먼저 렌을 안았으며` and `6시 10분` can fail that heuristic while still stating the event.

## GPT review items — do not treat Cursor notes as scores

Compare source turns in `evidence.json` with the Luna text. Judge A–J yourself. GPT posted a review on Draft #1504; Cursor does not adopt those scores.

A. Important event omission — rooftop / 저녁 일곱 시 is not named; later stair / hug / lighter / station are present.
B. Time and order — 일곱 시 / 여덟 시 absent; 아침 여섯 시 and 6시 10분 present; claim → stay → hug → promise → arrival.
C. Actors / direction — 렌 gave the lighter; 라이크 hugged first; 렌 followed.
D. 렌's choice and 라이크 emotion — stay until anger cools; apology after “진정한”.
E. Explicit 공수 — `라이크가 먼저 렌을 안았으며, 렌은 그를 따랐고`. USER source said `라이크가 먼저 안길 때까지`; do not silently upgrade that to a general 공수 rule.
F. Childhood claim vs last-month meeting — claim kept as 라이크의 말; last-month meeting attributed to 렌.
G. Brass lighter transfer / owner — 렌이 건넴; 라이크가 담배; still 소지 at the station.
H. 6:00 promise and 6:10 arrival — both present.
I. Ungrounded additions — `진정한 뒤` is not a source word (source: 미안하다고 / 화가 가라앉고). No new named character.
J. Compression — 263 / 600 chars. Korean 음슴체.

## AFTER

Archival packet in `docs/audits/monthly-rp-memory-quality-phase2c-2026-10-10/evidence.json`. Luna raw/clamped text, usage, request id, tokens, and USD are unchanged. The completed one-shot execute path is removed. `rerunAuthorized: false`.

## PRESERVED

Production prompt, persist/inject, 3-attempt retry, 10,000 LTM, Phase 1 / 2A / 2B evidence and tests. No second provider client. No production DB write. No Luna re-call.

## REGRESSION RISKS

CI keeps Phase 1 / 2B / provenance tests. The removed execute script is no longer a runnable paid path in this PR.

## PROOF

- Auth GET /models 200, `gpt-6-luna` listed
- Provider POST 1, requestKind `background-memory-extract`, model `gpt-6-luna`
- `providerRequestId` `52c1bd6a-23c2-4f82-83b4-9c9db9361694`
- billedUsd 0.000209
- Execution host Cursor VM; Railway SUCCESS is deploy metadata; observed runtime SHA null
- `canClaimCurrentProductionParity` false
- `git diff --check`, `npm run lint`, `npm run typecheck:app`

## SYSTEM DELTA

Evidence-label correction on the existing provenance owner + removal of the completed one-shot execute/CLI/lock/approval path. Shared Phase 2B fixture kept. No production summary-owner, prompt, provider, or cost-policy change.

## FOLLOW-UP (not this PR)

Prompt edit, automatic fact scorer, other models, 6/50-turn, 10K/12K/15K, CURRENT_PRODUCTION_PARITY after observed Railway runtime SHA plus production character/persona read.

## STOP

Draft PR for GPT quality review. Do not merge. Do not re-run Luna.

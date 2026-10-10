# Monthly RP Memory Quality — Phase 2C

Status: **one approved CURRENT_LIVE_PROVIDER GPT-6 Luna 5-turn summary. Cursor did not score quality. Draft PR only. Do not merge.**

EXACT origin/main at execute: `3a5238542dd594d72b55e46ba64cb498946b9082`
Railway production SUCCESS (enchanting-ambition / production): `3a523854` (newer than inactive `099c9df9` / #1500).
Execute lock: 2026-10-10T13:28:08.460Z. Second run refused (`ALREADY_EXECUTED`, POST 0).

Tracking: #1486. Approval: USER_APPROVED_PAID_EVALUATION, one fictional batch, max 3 existing retries.

## BEFORE

Phase 2B (#1500) proved live validators accept a fact-dropping canned summary. It did not produce Luna text. Production seal owner is unchanged: `summarizeTurnBatch` → `callBackgroundMemory` → Cheaper Inference `gpt-6-luna`.

## PROBLEM

GPT needed the actual Luna output for the Phase 2B 라이크 18 / 렌 fixture, with request assembly, usage, and validator results side by side.

## EXECUTION PATH

1. GitHub deployments: `099c9df9` SUCCESS then inactive; `3a523854` in_progress then SUCCESS.
2. This VM: `BACKGROUND_MEMORY_MODEL` unset → `resolveBackgroundPrimaryModelId` → `gpt-6-luna`. Railway env was not readable; current-main resolver also maps `.env.example` `gpt-5.6-luna` to `gpt-6-luna`.
3. Auth: GET `https://api.cheaperinference.com/v1/models` HTTP 200; catalog includes `gpt-6-luna`.
4. Execute: `scripts/monthly-rp-memory-quality-phase2c-execute.ts` → `summarizeTurnBatch` → recording wrapper → `callBackgroundMemory` with the same `system`, `history`, `turnTrace`, `requestKind`.
5. Attempt 1 `background-memory-extract` accepted. No retry.
6. Lock completed. Re-run refused.

Experiment vs production: wrapper records args/results only. Model, `max_tokens` null, temperature 0.3, disableReasoning, retry owner, clamp, and validators are the live path.

Identity used: Phase 2B fixture blocks, labeled not production sheets. Local `data/app.db` did not exist; production character 18 / admin 렌 sheets were not readable. A gitignored local sqlite file was created by runtime diagnostics during the call. Production DB write 0.

## OWNER MAP

| Responsibility | Owner |
| --- | --- |
| Prompt / request | `buildRollingSummarySystemPrompt` + `ROLLING_SUMMARY_EPISTEMIC_POLICY` / `summarizeTurnBatch` |
| Provider | `callBackgroundMemory` → `callGeminiOnce` → Cheaper Inference |
| Retry / accept | `summarizeTurnBatch` max 3 |
| Validators | `validateSummaryNarrative`, `isRollingSummaryGroundedInDialogue` |
| Clamp | `clampMemoryRecordSummary` 600 / 80 |
| One-shot lock | `monthlyRpMemoryQualityPhase2cExecute.ts` |
| Fixture | `monthlyRpMemoryQualityPhase2bFixture.ts` |

## ACTUAL LUNA OUTPUT

Provenance: **CURRENT_LIVE_PROVIDER** (`providerRequestId=52c1bd6a-23c2-4f82-83b4-9c9db9361694`).

Selected summary (attempt 1, 263 chars, clamp unchanged):

> 렌이 지난달 처음 만났다고 밝히자 라이크는 둘이 어릴 때부터 알았다고 주장했으나, 이는 라이크의 말로만 제시됨. 렌은 화가 가라앉을 때까지 계단에 남겠다고 했고, 라이크는 진정한 뒤 사과함. 이후 라이크가 먼저 렌을 안았으며, 렌은 그를 따랐고 라이크는 렌이 건넨 황동 라이터로 담배를 붙임. 라이크는 다음 날 아침 여섯 시 역에서 만나기로 약속했고, 렌은 약속을 받아들임. 다음 날 6시 10분 렌이 도착했을 때 라이크는 기다리고 있었고 라이터도 여전히 소지 중이었음.

Validators: `validateSummaryNarrative` PASS. `isRollingSummaryGroundedInDialogue` PASS.

Usage: input 1854 / output 180 (not estimated). cacheWrite 1852. billed **$0.000209**. Provider POST **1**.

`missingMustKeepIds` (`time_order`, `user_choice`, `role_direction`) is the Phase 2B exact-token heuristic only. It is not a quality score. Wording like `먼저 렌을 안았으며` and `6시 10분` can fail that heuristic while still stating the event.

## GPT review items — do not treat Cursor notes as scores

Compare source turns in `evidence.json` with the Luna text. Judge A–J yourself.

A. Important event omission — rooftop / 저녁 일곱 시 is not named; later stair / hug / lighter / station are present.
B. Time and order — 일곱 시 / 여덟 시 absent; 아침 여섯 시 and 6시 10분 present; claim → stay → hug → promise → arrival.
C. Actors / direction — 렌 gave the lighter; 라이크 hugged first; 렌 followed.
D. 렌's choice and 라이크 emotion — stay until anger cools; apology after “진정한”.
E. Explicit 공수 — `라이크가 먼저 렌을 안았으며, 렌은 그를 따랐고`.
F. Childhood claim vs last-month meeting — claim kept as 라이크의 말; last-month meeting attributed to 렌.
G. Brass lighter transfer / owner — 렌이 건넴; 라이크가 담배; still 소지 at the station.
H. 6:00 promise and 6:10 arrival — both present.
I. Ungrounded additions — `진정한 뒤` is not a source word (source: 미안하다고 / 화가 가라앉고). No new named character.
J. Compression — 263 / 600 chars. Korean 음슴체.

## AFTER

Live packet in `docs/audits/monthly-rp-memory-quality-phase2c-2026-10-10/evidence.json`. One-shot lock remains completed.

## PRESERVED

Production prompt, persist/inject, 3-attempt retry, 10,000 LTM, Phase 1 / 2A / 2B. No second provider client. No production DB write.

## REGRESSION RISKS

CI now runs the provider-free execute gates. The execute script is not in CI. A local gitignored `data/app.db` may appear if the script is run in an empty workspace.

## PROOF

- Auth GET /models 200, `gpt-6-luna` listed
- Provider POST 1, requestKind `background-memory-extract`, model `gpt-6-luna`
- `providerRequestId` `52c1bd6a-23c2-4f82-83b4-9c9db9361694`
- billedUsd 0.000209
- Second execute `ALREADY_EXECUTED`
- Deterministic gates + Phase 2B + provenance: 16/16 before execute
- `git diff --check`, `npm run lint`, `npm run typecheck:app`

## SYSTEM DELTA

Minimal execute harness + shared Phase 2B fixture module + one-shot lock. No production summary-owner change.

## FOLLOW-UP (not this PR)

Prompt edit, automatic fact scorer, other models, 6/50-turn, 10K/12K/15K.

## STOP

Draft PR for GPT quality review. Do not merge. Do not re-run Luna.

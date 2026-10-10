# Monthly RP Memory Quality — Phase 2A

Status: **reuse existing research CI + provenance labels. No new scheduler, evaluator, memory owner, paid-call change, or ACCEPTED flip. Cursor did not score memory quality.**

EXACT MAIN: `918b9e3b150500f645764b3e54f759518c37b32a` (`origin/main` after #1492 `c8bd4dfd`).

Tracking: #1486. GPT kickoff: issue comment 6096910713.

## BEFORE

Canonical research automation already exists: `.github/workflows/memory-research-cycle.yml` → `scripts/memory-research-cycle.ts` → `src/lib/memoryResearch/cycle.ts`, ledger branch `memory-research-ledger`, ACCEPTED-only Draft PRs, `/admin/automation-reports`.

#1492 A–I / C-neg live-path fixtures were on main via `test:regular` only. They were **not** in `memory-research-cycle.yml` or `validate-memory-episodic.yml`.

Monthly `validate-rp-active-model-quality.yml` still runs HISTORICAL_ONLY id=10 (`17 4 4 * *`, 2 cases × 4 models ≤ 16). Its REPORT.md title was “Active Main RP — Human Quality Review Evidence”.

## PROBLEM

1. Current-code retrieve regressions (라이크 18 / 렌) were missing from the regular research / episodic CI gates.
2. HISTORICAL_ONLY markdown could be read as current-site memory quality.
3. Deterministic prompt-contract / retrieve PASS could be misread as Luna summary quality or CURRENT_LIVE_PROVIDER.

Draft PR count 0 is **not** this problem.

## ROOT CAUSE

**0 recorded Draft PRs is the designed funnel, not a persist bug.** Live ledger: 74 candidates, 62 WATCH / 12 REJECTED / 0 ACCEPTED. `draft_prs` runs only when `accepted_count != 0`. Latest weekly-2026-W41: `benchmarked: 0`, `draftPrPackets: 0`. Blockers: `WATCH_NO_BENCHMARK_HOOK` 35, `WATCH_NO_EXPERIMENT_ADAPTER` 17 (`EXPERIMENT_ADAPTERS: []`). WATCH was not flipped to ACCEPTED.

Phase 1 never entered the existing Memory CI gate command. The HISTORICAL renderer used a generic “Active Main RP” title.

## OWNER MAP

| Responsibility | Canonical owner |
| --- | --- |
| Weekly / monthly research | `memory-research-cycle.yml` → `cycle.ts` |
| ACCEPTED Draft PR | `src/lib/memoryResearch/draftPr.ts` (`ACCEPTED_QUALITY_GAIN` only) |
| Implementation Draft PR | `implementationPr.ts` after live accept |
| Ledger | orphan branch `memory-research-ledger` |
| Admin projection | `adminMemoryResearchReports.ts` → `/admin/automation-reports` (read-only) |
| Deterministic RP benchmark | `memory-rp-benchmark.ts` / `memory-rp-benchmark-suite.ts` |
| Phase 1 live-path A–I | `monthlyRpMemoryQualityPhase1.test.ts` |
| Evidence source labels | `src/lib/memory/memoryEvidenceProvenance.ts` |
| HISTORICAL monthly paid evidence | `validate-rp-active-model-quality.yml` + `rpActiveModelQualityLive.ts` |
| Operator push notification | **investigated only** — admin page is not a push stack |

## AFTER

- Research CI gate and episodic CI now run Phase 1 + provenance tests (same node test runner, no second evaluator).
- HISTORICAL report title / JSON carry `memoryEvidenceProvenance` and `canClaimCurrentLiveProvider: false`.
- Phase 1 asserts `CURRENT_CODE_DETERMINISTIC` and `summaryQuality: NOT_PROVEN`.
- Paid budgets unchanged. WATCH/REJECTED untouched. No new scheduler.

## REMOVED

Generic HISTORICAL markdown title “Active Main RP — Human Quality Review Evidence”.

## PRESERVED

Research ledger, ACCEPTED-only PR gates, monthly HISTORICAL call cap (max 16; schedule 8), live-embedding triple opt-in (max 2 candidates, $0.10), 10,000-char LTM, production prompts, #1492 retrieve owner.

Provider POST 0 this PR. Production DB write 0.

## REGRESSION RISKS

Adding Phase 1 to episodic CI lengthens that job. Provenance fields are required on the quality report type — callers must go through `runRpActiveModelQualityLive`. Architecture fingerprint was **not** changed (Phase 1 was not added to `MEMORY_OWNER_MAP`), so WATCH candidates are not mass-reopened.

## PROOF

- Provenance + Phase 1 + quality-live: 26/26
- `memory-rp-benchmark` + hooks: 16/16
- `git diff --check`, `npm run lint`, `npm run typecheck:app`: pass
- Cursor assigned no quality score.

## SYSTEM DELTA

One provenance label owner + CI inclusion + HISTORICAL title/JSON labels. No second memory stack.

## Paid-call audit (unchanged)

| Workflow | When paid | Bound |
| --- | --- | --- |
| `memory-research-cycle` research job | never | `PAID_PROVIDER_CALL_BUDGET = 0` |
| `memory-research-cycle` live_experiments | monthly cron or manual `run_live_experiments` + dedicated embedding benchmark key | max 2 candidates, $0.10 |
| `validate-rp-active-model-quality` live_evidence | 4th 04:17 UTC if benchmark secrets present | max 16; default 8 |

## FOLLOW-UP (not this PR)

1. Authorized Luna 5-turn summary time/actor/relation quality (CURRENT_LIVE_PROVIDER)
2. Per-model 6/50-turn paid recall
3. 10K / 12K / 15K equal-budget compare
4. Semantic vs lexical retrieve compare (existing hooked owners only)
5. Monthly GPT scoring of HISTORICAL outputs (do not retitle as current-site)
6. Research Draft PR approval workflow after a real ACCEPTED
7. Admin-account notification (existing owner only, if proven)

Benchmark ideas only (no new DB/owner): LoCoMo-Plus cue-trigger constraints on the existing retrieve floor; MemoryArena “does memory change the next reply” as a later contextBuilder assert; LongMemEval-V2 static recall vs dynamic state (`clearly_temporary` vs `historical_event`).

Fluence is a procurement candidate for existing Main RP logical models, but endpoint compatibility does not establish identity, reasoning/cache parity, privacy or billed-cost semantics. This change adds an offline-first qualification contract and bounded comparison harness without changing production provider routing.

The harness reuses the pinned production RP character/admin persona, current context/wire assembly, scene controls, regeneration adapter and usage parser. A fresh evidence-backed offer must identify the exact model/upstream and support every canonical control. Dedicated benchmark credentials and two explicit opt-ins are required; absent credentials return `BLOCKED_WAITLIST_CREDENTIAL` with zero provider calls. No live Fluence calls were made.

The existing OR and CI qualification wrappers share one SSE reader after removal of their duplicate fetch/chunk loops. No production transport, RP prompt/memory/length owner, adult pipeline, ledger or point price is added or changed. ZDR is kept separate from adult content permission; adult qualification and dynamic-price stability remain unrun.

Validation:

- Final new/existing supplier contract tests: **39/39 passed**.
- SQLite contention diagnostic: **44/44 passed**.
- App type check, lint, diff check and production build: **passed**.
- Implementation-time regular suite: **10,632 passed, 321 failed, 1 skipped**; existing missing-vitest/assertion/schema failures and SQLite contention are recorded separately.
- Targeted production-owner tests: **93 passed, 5 existing provider-cost failures**. Relevant production owners/tests are unchanged from main.
- Additional script-wide type check exposes the pre-existing `mainRpMonthlyCacheAudit.ts:332` typing issue; no error was suppressed.

Audit baseline: `2316a1d6250c2174a77992623b50e0edfd6bbc52`. Owner map, price/routing evidence boundaries, blocked preparation packet and detailed validation are under `docs/audits/fluence-provider-qualification-2026-10-01/`.

**Draft only. Status: BLOCKED_WAITLIST_CREDENTIAL.** No production activation, Railway changes, automatic procurement, adult permission inference, billing mutation or merge. Raw credentialed RP outputs and documented offer/policy evidence require later GPT/user review before any promotion.

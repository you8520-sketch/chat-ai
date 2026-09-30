# Executed validation

Audit baseline: `2316a1d6250c2174a77992623b50e0edfd6bbc52`.
Status: **BLOCKED_WAITLIST_CREDENTIAL**. Actual provider generation calls: **0**.

| Check | Result |
| --- | --- |
| `npm ci --cache /workspace/.npm-cache --no-audit --no-fund` | Passed with main's frozen lockfile; manifests/lockfile unchanged |
| `npm run lint` | Passed (delegates to app type check) |
| `npm run typecheck:app` | Passed |
| `git diff --check` | Passed |
| New Fluence and existing OR/CI supplier contract tests | **39 passed / 0 failed / 0 skipped** (15 new + 24 existing) |
| Canonical regular suite, during implementation | **10,632 passed / 321 failed / 1 skipped / 0 cancelled**, 10,954 tests, 2,162 suites |
| Isolated serial SQLite contention diagnostic | **44 passed / 0 failed / 0 skipped**, 4 affected files |
| Targeted production-owner regressions | **93 passed / 5 failed / 0 skipped**, 98 tests; five failures confined to existing `providerCostSingleOwner.test.ts` |
| Production build | **Passed**, including compilation, app type validation, page-data collection and static generation |
| Offline preparation runner | **BLOCKED_WAITLIST_CREDENTIAL**, 0 calls, no live outputs/offer/actual billed price |
| Production-owner source diff against baseline | Empty for registry, transport, route, prompt/request/reasoning, affinity, adult, billing/ledger, published pricing, tracker and failover owners |
| Additional script-transitive TypeScript check | Failed only at unchanged `scripts/lib/mainRpMonthlyCacheAudit.ts:332` (`unknown` billed cost assigned to `string \| number \| null`); separate existing-script issue |
| GitHub PR API | GraphQL and REST both returned `Forbidden`; not a missing-token diagnosis |

Final contract command:

```bash
node --conditions=react-server --import tsx \
  --import ./src/lib/test/regularTestEgressPolicy.ts \
  --test --test-concurrency=1 \
  scripts/lib/fluenceProviderQualification.test.ts \
  scripts/lib/mainRpSupplyLiveQualification.test.ts \
  scripts/lib/mainRpSupplyCurrentBaseline.test.ts
```

Full canonical suite command executed with an isolated temporary DATA_DIR and writable XDG cache:

```bash
npm run test:regular -- --test-concurrency=1
```

This was an implementation-time run, including the earlier src-hosted version of the new tests, which passed. The final new tests live with existing qualification tests under scripts and execute in the targeted gate above and in the provider-routing workflow. Final regular-suite membership therefore differs from that implementation-time run; no final-tree full-suite green claim is made. The final modified shared probe reader was validated by the 39-test targeted rerun.

The full-suite failures included four missing-vitest module failures, existing model/price/memory/schema/finance/TRPG assertions, and SQLite contention. No assertions were removed or disabled and no dependency was added to disguise these failures. Forwarding a concurrency argument through npm is not used as proof of contention isolation; the diagnostic placed the runner option before explicit file paths.

Contention-only diagnostic retained the canonical loader/egress policy, used a fresh temporary database, and ran these files serially:

- `src/lib/knowledgeTransfer.s4d.test.ts`
- `src/lib/personaSecretCompiler.s15.test.ts`
- `src/lib/personaSecretCompilerV2Migration.test.ts`
- `src/lib/worldShares.test.ts`

The targeted production-owner run covered:

- `mainRpModelRegistry.test.ts`: passed
- `openRouterClient.test.ts`: passed
- `cheaperInferenceConfig.test.ts`: passed
- `adultHandoffSourceRouting.test.ts`: passed
- `providerCostLedger.failover.test.ts`: passed
- `deepseekProviderFailover.body.test.ts`: passed
- `providerCostSingleOwner.test.ts`: five existing failures

The last file and its production owners are unchanged from the audited main. The failing cases are ledger aggregation/recovery assertions (including legacy usage + ledger 100 vs observed 0). No Fluence transport or qualification code is loaded by those production tests. Full production-owner regression health is therefore **not green**, even though the new contract and production build pass.

The first build attempt identified a script-test placement issue and was corrected by moving the new tests to the existing script-test location. The next attempt reached page collection and correctly rejected missing local SESSION_SECRET. The successful build used `npm run build` with process-only randomly generated SESSION_SECRET/WITHDRAWAL_ENCRYPTION_KEY, a fresh temporary DATA_DIR, `NEXT_PHASE=phase-production-build`, and writable XDG cache. These values were neither printed nor written to the repository or Railway. Production guards, TLS verification and type checking were not disabled.

Local logs (not committed; no credentials intentionally logged):

- `/tmp/fluence-final-contract-tests.log`
- `/tmp/fluence-regular-suite.log`
- `/tmp/fluence-lock-retry.log`
- `/tmp/fluence-core-regressions.log`
- `/tmp/fluence-production-build.log`
- `/tmp/fluence-script-typecheck.log`

Draft PR title/body are prepared in this audit directory. Publication/access outcomes are added after the Git/PR operations; no merge or production activation is authorized by this change.

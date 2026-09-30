# Fluence procurement/provider qualification

## BEFORE

Audited current main: `2316a1d6250c2174a77992623b50e0edfd6bbc52` (fetched before branching). This is a FEATURE / PROVIDER QUALIFICATION change, not production supplier promotion. The existing isolated checkout was used.

Main RP logical models and current suppliers come from `MAIN_RP_USER_SELECTABLE_OPTIONS`, not a new provider/model list:

| Logical model | Current transport |
| --- | --- |
| deepseek-v4.1-flash | CheaperInference |
| gemini-3.1-pro-preview | OpenRouter |
| gemini-3.7-flash | OpenRouter |
| gemini-3.8-flash | OpenRouter |
| gpt-5.6-terra | CheaperInference |
| claude-opus-5.5 | CheaperInference |

The table is the audit snapshot; code derives this registry dynamically. Fluence is not a new logical model, picker option, published-price alias, or production route.

## PROBLEM / OPPORTUNITY

An OpenAI-compatible procurement candidate can potentially serve an existing logical model, but compatible JSON does not establish model identity, reasoning parity, cache behavior, privacy, content permission, or invoice semantics. An unknown provider offer must not inherit CI-specific controls/cost interpretation by accident.

## OWNER MAP

ONE RESPONSIBILITY = ONE CANONICAL OWNER. Live production owners below remain unchanged.

| Responsibility | Confirmed current-main owner / execution evidence |
| --- | --- |
| Logical model registry / model identity | `src/lib/chatModels.ts:250`, `MAIN_RP_USER_SELECTABLE_OPTIONS`; `SelectedAI` is derived at 297; `MAIN_RP_MODEL_IDS` at 301 |
| Provider identity | `selectedAIProvider` at `chatModels.ts:449`; `/api/chat` resolves `primaryProvider` from registry metadata at `src/app/api/chat/route.ts:1471` |
| Compatible production transport | Private `CompatibleTransport` / `resolveCompatibleTransport`, `src/lib/openRouterAdult.ts:1099`; supports only OpenRouter and CI |
| OpenRouter / CI endpoint and key | `src/lib/openRouterConfig.ts`; `src/lib/cheaperInferenceConfig.ts`; resolved at fetch time by the existing compatible transport |
| Final prompt / memory / user-authoring policy | `src/services/contextBuilder.ts#buildContext`; canonical memory owners and `src/lib/noGodmodding.ts` / `userCoauthorState.ts`; wire assembly `openRouterAdult.ts:1322#assemblePrimaryRpRequest` |
| Production streaming | `/api/chat` calls `streamOpenRouterAdultToClient` at 3211; shared generator `openRouterAdult.ts:1399#streamOpenRouterAdult`; existing production SSE guards remain intact |
| Model-specific request adapter | `src/lib/openRouterClient.ts:382#buildOpenRouterRequestBody`, then `openRouterAdult.ts:1144#adaptRequestBodyForTransport` / `cheaperInferenceConfig.ts#adaptCheaperInferenceChatBody` |
| Reasoning/thinking controls | `openRouterClient.ts` model policies; `cheaperInferenceConfig.ts:119#applyCheaperInferenceModelReasoningPolicy`; Gemini minimal thinking is not falsely described as a complete OFF capability |
| Cache/session affinity | OR policy `openRouterConfig.ts:144#resolveMainRpOpenRouterRoutePolicy`; structured cache controls in `openRouterAdult.ts`; CI query affinity `cheaperInferenceConfig.ts:45#buildCheaperInferenceChatCompletionsUrl` |
| Provider cost ledger | `src/lib/providerCostLedger.ts:463#recordMainGenerationProviderCost`, settlement at 252; `/api/chat` records at 5989; benchmark writes no ledger rows |
| Usage / actual billed-cost parser | `src/lib/openRouterUsage.ts:234#parseCompatibleUsage`; CI envelope/header interpretation is retained only for confirmed CI identity; `providerCostReconciliation.ts` owns later reconciliation |
| Retry/failover | `src/lib/deepseekProviderFailover.ts:636#executeDeepSeekWithProviderFailover`, Main RP attempt limit at 44; no new supplier retry/router is introduced |
| Adult handoff / routing | `src/lib/adultSceneRouting.ts#buildAdultProviderRoutingRequest` and eligibility/consent policy; `src/lib/adultHandoffSourceRouting.ts`; existing DeepSeek handoff TRUE-OFF adapter remains unchanged |
| Pricing tracker / provider radar | `src/lib/modelPricingTracker.ts:308#runModelPricingTracker` (OBSERVE_ONLY), `providerModelDiscovery.ts`, `scripts/lib/mainRpSupplyRadar.ts` and `mainRpDirectSupplierRadar.ts`; no Fluence scheduled scan or price application is added |
| Frozen RP qualification identity | `scripts/lib/rpModelQualificationFixture.ts#loadCanonicalRpQualificationFixture`; existing pinned production dump and admin persona, not a second character/persona fixture |
| Supplier qualification SSE reader (this change) | `scripts/lib/compatibleSupplyProbe.ts`; the existing OR and CI qualification wrappers now use this single reader |
| Fluence benchmark contract (this change) | `scripts/lib/fluenceProviderQualification.ts`; script-only evidence/adapter boundary, not a production compatible transport or router |

Important execution detail: `/api/chat:1485` maps CI transport to the OpenRouter-compatible **context** provider. The comparison reproduces that distinction: context assembly uses OpenRouter-compatible prompt semantics, while the current transport, CI reasoning adaptation and affinity remain CI. Production also applies scene server controls and regeneration overrides; the new comparison calls these existing owners.

The frozen identity is the canonical historical capture (`2026-08-25`, chat 4/admin user 1/character 10). It is not proof of the current deployed DB roster/session state. No live database or deployed prompt was accessed. Dynamic production memory, scene flags, and current deployed permissions require a credentialed/operator-reviewed snapshot before any promotion.

## AFTER

`scripts/fluence-provider-qualification.ts` defaults to offline preparation. No environment flag, picker change, Railway change, production import, scheduled job, DB migration, or provider route activates Fluence.

An optional captured `FluenceOffer` must provide an exact logical-to-wire-model mapping, upstream/offer identity, fresh observation/expiry, supported request keys, control/cache parity evidence, ZDR syntax/evidence, provider pin syntax, context limit and current USD/token offer. No real Fluence wire-model ID, routing field, or ZDR field is guessed. Synthetic request fields exist only in deterministic tests and are not vendor documentation.

The candidate adapter clones the current canonical request, preserves all messages and model controls, and removes only the current provider's routing/session/service-tier envelope. Unsupported controls, attempted canonical overrides, unsupported structured cache boundaries, unconfirmed ZDR/pinning, stale offers and context-limit estimates fail before fetch. CI-specific request/query behavior is not generalized to Fluence.

With explicit live opt-in and dedicated keys, the runner prepares two frozen turns and makes at most four generation calls: current T1, Fluence T1, current T2, Fluence T2. It reuses the existing frozen assistant reference, not generated feedback, to keep both sides comparable. Any failure/mismatched model stops further calls; no retries, repairs or failover. Operations `generation`, `regeneration`, `continuation` and `long_context` reuse canonical assembly and same-side controls. Regeneration seeds are computed once per request and shared with its candidate clone.

The preflight estimate uses current published reference rates and a fresh candidate offer, with a maximum $5 estimated pair budget. This is a conservative screening estimate, not an invoice, guarantee of total spend, or user point price. Provider default output behavior remains unchanged. Use provider-side benchmark spend limits as well before live execution.

## REMOVED

Directly overlapping OR/CI qualification SSE state, chunk/decoder loops, timing and fetch/read lifecycle code were consolidated into `compatibleSupplyProbe.ts`. The old `processOpenRouterSupplySseLine` export remains an alias for compatibility. Provider-specific headers, request builders, metadata lookup, CI usage interpretation, and route selection remain at their existing owners.

No production provider enum/list or compatible transport owner was duplicated, so there was no production enum/branch to delete. No unrelated legacy models, retained characters, or billing code were cleaned up.

## PRESERVED

- Production model registry, provider selection, endpoints, streaming path, request/reasoning adapters, CI cache affinity, adult handoff, user point prices and ledger/reconciliation are byte-for-byte unchanged from the audited main.
- Existing OR supplier metadata lookup and CI-specific usage mapping remain in their wrappers.
- Regular-test egress policy continues removing production paid-provider keys and also removes `FLUENCE_API_KEY`.
- Actual credentials are never saved to the repo, fixture, report, or PR. Only dedicated benchmark variables are consulted; production keys are never a fallback.

## FLUENCE PRICE/ROUTING EVIDENCE

User-supplied claims: OpenAI-compatible `/v1/chat/completions`; base URL `https://api.fluence.cloud/v1`; token pricing, marketplace/provider routing, ZDR request support, waitlist access and potentially dynamic posted offers.

These claims were **not independently verified**: managed egress allows package-manager/bootstrap hosts, has no Fluence destinations, and no Fluence credentials are configured. No successful `/models` or generation call, exact model identity, fresh offer, policy or price observation is claimed. Offline evidence records `offer:null`, `actualBilledUsd:null` and `NOT_OBSERVED` price windows.

Current offer, reference ceiling with source/time, long-context threshold/rates, and actual reported USD are separate fields. An unspecified/undocumented `usage.cost` is retained as unclassified evidence, never promoted to actual Fluence billed USD. Zero actual billed USD is retained when explicitly reported by the documented USD field. No new production cost settlement or point formula exists.

`summarizeFluencePriceHistory` prepares 7/30-day **local evidence** windows, grouped by the same logical model/wire/upstream/offer identity. It reports insufficient history until enough distinct days exist; it is not a second scheduled pricing tracker or auto-router. A future collection task must capture authenticated offers durably and review dynamic offer IDs, cache economics and context pricing.

## RP QUALIFICATION STATUS

**BLOCKED_WAITLIST_CREDENTIAL**. Provider generation calls: **0**. Raw live RP outputs: **NOT_RUN**. No quality scores or fake provider successes were created. Deterministic stream bodies are marked synthetic test-only and are not RP/vendor evidence.

Captured metrics include model/response/request IDs, requested/reported upstream, logical/transport identity, offer ID, prompt hash, stream completion, TTFT/total latency, output chars/tokens, tokens/sec where output usage is reported, finish reason, input/output/reasoning reporting evidence, raw usage and documented billed USD. Unknown/unreported tokens remain null rather than becoming fabricated zeros. Error rate is a sample observation, not an uptime guarantee.

Two calls per side only demonstrate a completed transport pair. Even four successful calls return `ROOT_CAUSE_UNCONFIRMED` pending human raw-output review, stable-price/health evidence, identity/policy review and adult qualification. They do not return `PROVIDER_QUALIFICATION_READY` automatically.

Adult eligibility is independent of ZDR. The existing HAV adult fixture reference is `scripts/lib/proseDietFixtures.ts#PROSE_DIET_ADULT_FIXTURE`; adult refusal/allow qualification is **NOT_RUN**, with no inferred content permission or production adult route. The live runner in this PR does not send an adult-mode probe. Credentialed adult qualification must reuse existing adult controls and a reviewed fixture/state snapshot, after upstream content policy is confirmed.

## REGRESSION RISKS

The change shares only the supplier-probe reader. OR/CI probe output/body/metadata contracts remain unchanged. Strict malformed/error/incomplete-stream checks are opt-in for the Fluence comparison; legacy wrappers retain their lenient parsing behavior. The shared reader additionally releases/cancels readers and uses the supplied clock consistently. Neither qualification reader is imported by production.

SSE coverage includes fragmented UTF-8, CRLF, comments, final-frame flush, malformed JSON, non-SSE responses, embedded provider errors, incomplete/disconnected streams, pending-reader timeout, cancellation and single-request 429/5xx handling. A real provider may expose unsupported extensions/field semantics; these remain live qualification blockers, not adapter assumptions.

## PROOF

See `VALIDATION.md` for executed commands, exact results and limitations. The final new and existing supplier contract tests passed 39/39 (15 new + 24 existing).

Preparation command (no key, no vendor call):

```bash
node --conditions=react-server --import tsx \
  --import ./src/lib/test/regularTestEgressPolicy.ts \
  scripts/fluence-provider-qualification.ts
```

Writes ignored local artifacts under `output/fluence-provider-qualification`. A sanitized committed preparation snapshot accompanies this report; raw live responses will only exist after authorized qualification.

Future live command requires all of:

- `REGULAR_TEST_REAL_PROVIDER_CALLS=1`
- `FLUENCE_PROVIDER_QUALIFICATION=1`
- dedicated `FLUENCE_BENCHMARK_API_KEY`
- dedicated current supplier key: `CHEAPER_INFERENCE_BENCHMARK_API_KEY` or `OPENROUTER_SUPPLY_BENCHMARK_API_KEY`
- `FLUENCE_QUALIFICATION_OFFER_FILE` pointing to a reviewed, fresh `FluenceOffer` JSON
- network access and actual waitlist authorization

Set `FLUENCE_QUALIFICATION_OPERATION` to an operation named above; repeat each reviewed operation explicitly. Do not substitute production keys. Do not enable this runner in Railway or add it to a scheduled workflow.

## WAITLIST/CREDENTIAL STATUS

Runtime status observations were current: restricted/enforced network, no configured secrets/runtime-variable bindings; both `FLUENCE_API_KEY` and `FLUENCE_BENCHMARK_API_KEY` were absent in the machine, and no Fluence entries were found in `.env.local` (values were not printed). Existing CI/OR benchmark keys were also absent.

Git fetch of main worked through existing injected Git authentication. Both GitHub GraphQL and REST PR APIs returned `Forbidden`; this does not establish missing Git authentication or justify requesting a PAT. The onboarding draft/configuration tool was also unavailable, so no allowlist replacement was attempted. Draft PR creation and branch push outcomes are recorded in `VALIDATION.md`.

## SAFE OPTIONAL

Read-only authenticated offer snapshots, explicit upstream-policy evidence, repeated raw RP output review, and 7/30-day offer/health observations can follow once waitlist access and restricted egress are available.

## SEPARATE FOLLOW-UP

Session-sticky procurement, real-time lowest-price switching, production multi-provider failover and automatic margin repricing are discovery items only. Any production activation, adult boundary change, invoice/ledger integration, destructive migration or user pricing change requires separate review. The pre-existing script-only type error at `scripts/lib/mainRpMonthlyCacheAudit.ts:332` is outside this qualification contract.

## FINAL STATUS

**BLOCKED_WAITLIST_CREDENTIAL**. Feature branch was pushed successfully. Draft PR creation was attempted and blocked by GitHub API `Forbidden`; no PR was created. Exact body and a manual Draft creation link are recorded in `VALIDATION.md`. No production activation, promotion, merge, Railway change or live vendor call. Stop after the reviewable feature change and PR preparation; resume only the specifically blocked access/qualification work when its prerequisites are supplied.

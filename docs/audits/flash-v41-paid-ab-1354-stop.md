# DeepSeek V4.1 Flash paid A/B — STOP before paid inference (#1354)

Date: 2026-10-04

## Scope

This is an audit record only. The approved four-call paid A/B did **not** start.

No paid completion, production key mutation, production routing change, DB write, prompt change, or prose-quality scoring occurred.

## BEFORE

At the time of the STOP:

- `origin/main`: `5cc5d101f74b044bd61de5c7e1355a3e67ec4906`
- Railway production SUCCESS: `5cc5d101f74b044bd61de5c7e1355a3e67ec4906`
- Deployment id: `e49c1fcb-8fe0-438b-875d-87b859cc1f9b`
- SUCCESS deployment created at: `2026-10-04T09:04:44.603Z`
- Previous SUCCESS `76fe5680` was not used for the experiment.

Merged #1377 commit `10a976555a662461ced7f5d79e512190f39fbc0b` is an ancestor of that deployment.

Experiment-relevant owner blobs observed for the stopped run:

- `scripts/lib/mainRpBodyCuePreflight.ts`: `4f40803b`
- `src/lib/mainRpFinalWireAudit.ts`: `98fc1c4b`
- `src/services/contextBuilder.ts`: `930c0aed`
- `src/lib/openRouterClient.ts`: `0c5a3b9b`
- `src/lib/cheaperInferenceConfig.ts`: `8556f5e5`
- `src/lib/chatModels.ts`: `4a22c8f9`

`MAIN_RP_FINAL_WIRE_AUDIT_BASELINE`: `386b23dc`.

## PROBLEM

The approved experiment required an experiment-only inference credential with restrictive controls.

Creating that key through `POST /v1/keys` required `account:write`, but available credentials did not have that permission.

Observed credential results:

| Credential | Result |
| --- | --- |
| VM `CHEAPER_INFERENCE_API_KEY` | `401 invalid_api_key` |
| VM `CHEAPER_INFERENCE_BENCHMARK_API_KEY` | `403 insufficient_scope` / `account:write` |
| Railway production `CHEAPER_INFERENCE_API_KEY` | `403 insufficient_scope` / `account:write` |

The production key was not modified and its scope was not elevated.

The benchmark/reporting credential was not substituted for an experiment inference key.

Because an experiment-only inference key could not be created under the approved safeguards, the experiment stopped before the same-key `GET /v1/models`, `GET /v1/models/supply`, or any paid POST.

## AFTER

- paid attempt count: **0**
- successful response count: **0**
- actual provider cost: **$0**
- model completions: none
- retries: none
- fallbacks: none
- `max_tokens` enforcement check: not applicable
- blind output artifact: not created

No 라이크/렌 source text left the process.

`#1288` was not merged.

The following remained unchanged:

- production prompt
- production routing
- user pricing
- production database
- pricing parser
- `liveAssembledRequest` semantics

No prose-quality score was produced.

## PRESERVED

- production inference credential
- production routing
- user pricing
- real character/persona rows
- merged #1377 audit owner
- approved four-call budget, unspent

## REGRESSION RISKS

None introduced by this stopped run.

There were no paid provider requests and no production-setting changes.

The safeguards were not relaxed by sending the four calls with the benchmark/reporting key or production key.

## PROOF

Reported execution evidence:

- exact deployment SHA: `5cc5d101f74b044bd61de5c7e1355a3e67ec4906`
- exact #1377 audit commit: `10a976555a662461ced7f5d79e512190f39fbc0b`
- preflight blob: `4f40803b`
- final-wire blob: `98fc1c4b`
- pricing_version on experiment inference key: **not fetched**
- supply result on experiment inference key: **not run**
- paid attempt count: **0**
- successful response count: **0**
- actual total provider cost: **$0**
- token/cost rows: none
- retry/fallback: none

The original Cursor-side audit artifact was reported at:

- `/opt/cursor/artifacts/flash-v41-paid-ab-1354-stop.json`

That local artifact is not copied into this repository.

## STOP CONDITION HIT

The experiment-only inference key could not be created with the available credential scopes.

The next paid attempt remains blocked until a separately authorized inference key can be created without mutating or broadening the production credential.

Required experiment-key intent remains:

- inference only
- model restricted to `deepseek-v4.1-flash`
- concurrency 1
- four-call request/quota bound where supported
- short expiration
- small monthly spend limit at or below the explicitly approved bound

If the provider requires a higher minimum spend limit than the approved amount, STOP again rather than increasing it implicitly.

## Follow-up

1. Create an experiment-only key from an authorized account/dashboard or other separately authorized account-management path.
2. Do not add `account:write` to the production inference key just to unblock this experiment.
3. Before any paid POST, use the **same experiment inference key** for model-catalog and supply preflight.
4. Re-run the approved four-call A/B only after all preflight gates pass.
5. Cursor must not score prose quality; the outputs should be presented for GPT/user review.

This document records a safe STOP, not a completed A/B experiment.

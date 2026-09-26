# Gemini ↔ JEV comment-moderation shadow benchmark

Classification: **LIVE_JEV_MODERATION_BENCHMARK_BLOCKED** until
`OPENROUTER_JEV_BENCHMARK_API_KEY` is injected with triple opt-in.

## Owner map (current main)

| Concern | Canonical owner | JEV role in this PR |
|---|---|---|
| Deterministic eligibility | `commentPolicy.ts` | none |
| Banned-word match | `commentBannedWords.ts` | none |
| Semantic moderation decision | `commentModeration.ts` via `commentSemanticModerationPolicy.ts` | shadow compare only |
| Enforcement | `commentSubmit.ts` | none — Gemini remains sole enforcement |
| Strike / ban | `commentModerationStorage.ts` | none |
| Report threshold | `commentReports.ts` (blind at 10) | none |
| Admin review | `adminCommentReports.ts` | none |
| Cost / provenance | `providerCostLedger` / `auxProviderProvenance` | benchmark ledger disabled; future shadow kind `comment-moderation-jev-shadow` |
| Jev transport | `jevDecisions.ts` | benchmark caller only |
| Benchmark credentials | `scripts/lib/benchmarkOpenRouterJevCredential.ts` | dedicated key |

## Shared policy

`COMMENT_SEMANTIC_MODERATION_SYSTEM` + user-prompt builder + ALLOW/BLOCK parser
live in `commentSemanticModerationPolicy.ts`. Production Gemini, Gemini
baseline, and JEV criteria all consume that owner.

## Credential isolation

Requires all three:

- `REGULAR_TEST_REAL_PROVIDER_CALLS=1`
- `REAL_JEV_MODERATION_PROBE=1`
- `OPENROUTER_JEV_BENCHMARK_API_KEY`

Production `OPENROUTER_API_KEY` is never consulted. Transports accept an
explicit credential override; production callers omit it.

## Provenance note (REQUIRED CLEANUP for a future runtime-shadow PR)

`comment-moderation` and `background-jev-decision` currently classify as
`UNKNOWN` in `auxProviderProvenance`. Do not expand this benchmark PR to
change production provenance — fix in the future shadow call-site PR.

## Entry point

```bash
REGULAR_TEST_REAL_PROVIDER_CALLS=1 REAL_JEV_MODERATION_PROBE=1 \
OPENROUTER_JEV_BENCHMARK_API_KEY=... \
node --conditions=react-server --import tsx \
  scripts/benchmark-comment-moderation-jev-live.ts
```

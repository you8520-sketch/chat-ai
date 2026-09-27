# Gemini 3.1 Pro — serving-path parity (Phase 1)

Investigation only. **PRODUCTION DIFF = 0.**

## Exact refs

| Field | Value |
|---|---|
| GPT-confirmed main | `63ffa76e21a6f8cb88e31cc43c6378e87d3e8059` |
| origin/main at start | `844d146c` (3 commits ahead; official-supply only) |

## Prior art

PR #1112 (Sep-17 USER_TAIL/NARRATIVE_DENSITY 2×2) → `ROOT_CAUSE_UNCONFIRMED`, unmerged/closed.

## Phase 1 arms (same frozen prompt)

| Arm | Route | Model | Provider pin |
|---|---|---|---|
| A | CheaperInference | `gemini-3.1-pro-preview` | n/a |
| B | OpenRouter | `google/gemini-3.1-pro-preview` | `google-ai-studio`, `allow_fallbacks=false` |
| C | OpenRouter | `google/gemini-3.1-pro-preview-20260219` | same |

Note: OpenRouter catalog does not list the dated slug as a separate model id; endpoints API resolves it to the rolling id while endpoint display names already show `…-20260219`.

## Invariants

- Exactly 1 provider call per sample
- temperature=0.95, reasoning effort=low, max_tokens omitted
- No continuation / retry / recovery / fallback
- No thinking OFF attempt
- Secrets never logged

## Live Phase 1 verdict (n=3)

| Arm | median | mean | max | returned model |
|---|---|---|---|---|
| A CI | 2351 | 2576 | 3687 | `gemini-3.1-pro-preview` |
| B OR rolling AI Studio | 1345 | 1185 | 1575 | `google/gemini-3.1-pro-preview` |
| C OR dated AI Studio | 2045 | 2094 | 2629 | `google/gemini-3.1-pro-preview` (alias) |

Case D → historical full prompt on CI also short (median 549). **ROOT_CAUSE_UNCONFIRMED.** See `REPORT.md`.

## Run

```bash
PHASE1_RUNS=3 node --conditions=react-server --import tsx scripts/gemini31-serving-path-parity.ts
```

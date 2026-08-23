# Gemini 3.1 — historical real-fixture reproduction (current main)

EVIDENCE ONLY. Do not merge. Do not deploy. Do not change production prompts.

```text
FIXTURE_PARITY_PROVEN=false
TOTAL_PROVIDER_CALLS=0
RETRIES=0
CONTINUATIONS=0
RECOVERY_CALLS=0
CURSOR_QUALITY_SCORE_ASSIGNED=false
CURSOR_MODEL_VERDICT_ASSIGNED=false
PRODUCTION_PROMPT_CHANGED=false
HUMAN_CHATGPT_REVIEW_REQUIRED=true
```

## Question (not answered)

Does current production Gemini 3.1 still produce long RP when given the same real character 18 / persona 61 / context family that Audit #255 recorded at ~4496 average visible chars?

This run did **not** call the provider. Fixture parity was not proven.

## Why the provider was not called

Exact current-main production rows for `characters.id=18` and `user_personas.id=61` cannot be loaded on this VM through the ordinary production path.

Audit #255 (PR #255 / Audit 55) used live `POST /api/chat` against those ids and froze outputs + token/cost metadata only. It did **not** freeze the character row, persona row, greeting blob, setting chunks, or assembled request/system.

No trustworthy historical full bundle matching that live request family was recovered.

A later production-equivalent character-18 dump exists on other branches. It is **not** an Audit #255 freeze, and it is **not** paired with persona 61. Using it plus a reconstructed short persona would repeat the PR #589 / G11-C5 confound. That path was not used.

## Required tree

```text
docs/audits/gemini31-historical-fixture-repro/
  README.md
  HUMAN_REVIEW.md
  HANDOFF_FLAGS.json
  FIXTURE_PARITY.md
  HISTORICAL_REFERENCE.md
  CURRENT_RESULTS.md
  raw/{REL,ACT}-T{1,2}.txt
  requests/{REL,ACT}-T{1,2}-current-user.txt
  meta/{REL,ACT}-T{1,2}.json
```

ChatGPT / human entry: `HUMAN_REVIEW.md`.

`raw/` and `meta/` are `NOT_RUN` sentinels. `requests/` hold the exact historical current-user strings only.

## Review rule

Cursor assigned no quality score, style score, A/B winner, literary PASS/FAIL, or production recommendation. ChatGPT + human read RAW (none generated) and make all literary judgments.

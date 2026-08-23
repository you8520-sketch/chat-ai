# Gemini 3.1 — historical real-fixture reproduction (current main)

EVIDENCE ONLY. DRAFT. NOT FOR MERGE. Do not deploy. Do not change production prompts.

ChatGPT / human entry: `HUMAN_REVIEW.md`

```text
FIXTURE_PARITY_PROVEN=true
TOTAL_PROVIDER_CALLS=4
RETRIES=0
CONTINUATIONS=0
RECOVERY_CALLS=0
CURSOR_QUALITY_SCORE_ASSIGNED=false
CURSOR_MODEL_VERDICT_ASSIGNED=false
PRODUCTION_PROMPT_CHANGED=false
HUMAN_CHATGPT_REVIEW_REQUIRED=true
```

## Question

Does current production Gemini 3.1 still produce long RP when given the recovered historical character 18 / persona 61 production-scale fixture family that Audit #255 previously recorded at ~4496 average visible chars?

Four Cheaper Inference calls were executed. No quality verdict is assigned here.

## Fixture bundle (merged)

| source | path |
| --- | --- |
| Character (production-scale) | `fixtures/character-18-like.json` |
| Persona 61 block | `fixtures/c18_persona61_fixture.json` (persona only) |
| Merged bundle used at runtime | `fixtures/merged_c18_persona61_bundle.json` |

The 419-char reconstructed card inside `c18_persona61_fixture.json` **character** block was **not** used.

## Packet tree

```text
docs/audits/gemini31-historical-fixture-repro/
  README.md
  HUMAN_REVIEW.md
  HANDOFF_FLAGS.json
  FIXTURE_PARITY.md
  HISTORICAL_REFERENCE.md
  CURRENT_RESULTS.md
  PARITY_REPORT.json
  LIVE_SUMMARY.json
  fixtures/
  raw/{REL,ACT}-T{1,2}.txt
  requests/{REL,ACT}-T{1,2}-current-user.txt
  requests/{REL,ACT}-T{1,2}-system-sanitized.txt
  requests/{REL,ACT}-T{1,2}-messages-sanitized.json
  meta/{REL,ACT}-T{1,2}.json
```

Reproduce:

```bash
node --conditions=react-server --import tsx scripts/gemini31-historical-fixture-repro.ts --parity
node --conditions=react-server --import tsx scripts/gemini31-historical-fixture-repro.ts --live
```

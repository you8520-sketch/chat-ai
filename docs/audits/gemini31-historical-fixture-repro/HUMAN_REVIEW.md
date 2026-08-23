# Human + ChatGPT review handoff

```text
STATUS=EVIDENCE_HANDOFF
PR_STATUS=DRAFT
NOT_FOR_MERGE=true
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

Cursor did **not** set: `GEMINI31_PRIMARY_RP_ACCEPTED`, `KEEP_CURRENT_PRODUCTION`, `STYLE_ADAPTER_JUSTIFIED`, `LENGTH_ADAPTER_JUSTIFIED`, `MODEL_WINNER_SELECTED`.

No prose-quality PASS/FAIL. No better/worse. No production-ready claim.

## 1. Fixture parity

See `FIXTURE_PARITY.md` and `PARITY_REPORT.json`.

```text
FIXTURE_PARITY_PROVEN=true
CHARACTER_18_SOURCE=fixtures/character-18-like.json (H5 production dump)
PERSONA_61_SOURCE=fixtures/c18_persona61_fixture.json persona block (id=61)
GREETING_SOURCE=character-18-like.json greeting (1318 chars)
CHARACTER_ROW_EXACT=false
PERSONA_ROW_EXACT=false
CHARACTER_NAME=라이크
CHARACTER_ID=18
PERSONA_ID=61
SYSTEM_PROMPT_CHARS=3643
WORLD_CHARS=6344
SETTING_CHUNKS_CONTENT_CHARS=9829
PERSONA_CHARS=38
GREETING_CHARS=1318
CURRENT_ASSEMBLED_INPUT_TOKENS_REL_T1_EST=25480
```

Short 419-char card in `c18_persona61_fixture.json` character block was **not** used.

## 2. Full RAW paths (model output)

```text
docs/audits/gemini31-historical-fixture-repro/raw/REL-T1.txt
docs/audits/gemini31-historical-fixture-repro/raw/REL-T2.txt
docs/audits/gemini31-historical-fixture-repro/raw/ACT-T1.txt
docs/audits/gemini31-historical-fixture-repro/raw/ACT-T2.txt
```

## 3. Historical vs current

| call | HISTORICAL | CURRENT |
| --- | --- | --- |
| REL-T1 | 4659 | 3393 |
| REL-T2 | 4254 | 3952 |
| ACT-T1 | 4743 | 2648 |
| ACT-T2 | 4327 | 4005 |

```text
CURRENT_AVG_CHARS=3500
CURRENT_MEDIAN_CHARS=3673
```

## 4. Four-call objective table

| call | VISIBLE_INCL | VISIBLE_EXCL | PARA | NARR | DIAL | DIAL_RATIO | MAX_CONSEC_DIAL | IN_TOK | OUT_TOK | THINK | LAT_MS | TTFT_MS | FINISH |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| REL-T1 | 3393 | 2540 | 24 | 14 | 10 | 0.417 | 1 | 9138 | 3942 | 1808 | 42693 | 21376 | stop |
| REL-T2 | 3952 | 2947 | 33 | 23 | 10 | 0.303 | 1 | 11285 | 6343 | 3821 | 60630 | 41514 | stop |
| ACT-T1 | 2648 | 1984 | 31 | 26 | 5 | 0.161 | 1 | 9152 | 5192 | 3454 | 43793 | 34087 | stop |
| ACT-T2 | 4005 | 3004 | 36 | 26 | 10 | 0.278 | 1 | 10936 | 8479 | 5877 | 74942 | 60453 | stop |

Per-call SHA-256 and alarms: `meta/{call}.json`.

## 5. Deterministic flags

No candidate passage attached. All calls `finish_reason=stop`, non-empty RAW.

## 6. No next experiment

No length-owner change, adapter, reasoning/temperature/max_tokens/provider change, extra sample, adult handoff, merge, or deploy opened from this packet.

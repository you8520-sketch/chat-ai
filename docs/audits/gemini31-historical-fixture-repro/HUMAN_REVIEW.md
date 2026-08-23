# Human + ChatGPT review handoff

```text
STATUS=EVIDENCE_HANDOFF
PR_STATUS=DRAFT
NOT_FOR_MERGE=true
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

Cursor did not set:

```text
GEMINI31_PRIMARY_RP_ACCEPTED
KEEP_CURRENT_PRODUCTION
STYLE_ADAPTER_JUSTIFIED
LENGTH_ADAPTER_JUSTIFIED
MODEL_WINNER_SELECTED
```

No prose-quality PASS/FAIL, no better/worse, no production-ready claim.

## 1. Fixture parity (read first)

```text
FIXTURE_PARITY_PROVEN=false
CHARACTER_18_SOURCE=UNAVAILABLE_ON_CURRENT_MAIN_VM
PERSONA_61_SOURCE=UNAVAILABLE_ON_CURRENT_MAIN_VM
GREETING_SOURCE=UNAVAILABLE_ON_CURRENT_MAIN_VM
CHARACTER_ROW_EXACT=false
PERSONA_ROW_EXACT=false
CHARACTER_PROMPT_CHARS=NOT_AVAILABLE
PERSONA_CHARS=NOT_AVAILABLE
GREETING_CHARS=NOT_AVAILABLE
WORLD_CHARS=NOT_AVAILABLE
CURRENT_ASSEMBLED_INPUT_TOKENS=NOT_ASSEMBLED
```

Ordinary production path on this VM: no `data/app.db`; seed roster is demo ids 1–9; live `characters.id=18` and `user_personas.id=61` cannot be loaded.

Audit #255 historical comparison target (live `/api/chat`, not frozen as a request bundle):

```text
characterId=18
personaId=61
input_tokens=17514 / 21726 / 17536 / 21862
```

Historical bundle recovery: **not used**. Audit #255 froze outputs + cost/runtime metadata only. No character row, persona row, greeting, chunks, or assembled system/messages were recovered from PR #255 / Audit 55.

Nearby objects that were **inspected and not used** (do not call these exact):

| object | why not exact / not used |
| --- | --- |
| H5/H1 `character-18-like.json` (id=18, 라이크) | later production-equivalent dump; not an Audit #255 freeze; not paired with persona 61 |
| G11-C5 `c18_persona61_fixture.json` | reconstructed 419-char card + 38-char persona; `FULL_HISTORICAL_PAYLOAD_PARITY=UNKNOWN` |
| H1 `persona-ren.json` | adult test persona; explicit “Not a production user row”; id ≠ 61 |

Full inventory: `FIXTURE_PARITY.md`.

## 2. Current production request metadata

No current-main request was assembled. No sanitized system/messages file exists for these four calls.

Planned production wire (not executed):

```text
model=gemini-3.1-pro-preview
provider=cheaperinference
temperature=0.95
reasoning_effort=low
top_p=current production (omitted)
max_tokens=current production (omitted)
characterId=18
personaId=61
```

Exact current-user strings only (frozen, not sent):

```text
docs/audits/gemini31-historical-fixture-repro/requests/REL-T1-current-user.txt
docs/audits/gemini31-historical-fixture-repro/requests/REL-T2-current-user.txt
docs/audits/gemini31-historical-fixture-repro/requests/ACT-T1-current-user.txt
docs/audits/gemini31-historical-fixture-repro/requests/ACT-T2-current-user.txt
```

## 3. Full RAW paths

These files are `NOT_RUN` sentinels. They are not model output.

```text
docs/audits/gemini31-historical-fixture-repro/raw/REL-T1.txt
docs/audits/gemini31-historical-fixture-repro/raw/REL-T2.txt
docs/audits/gemini31-historical-fixture-repro/raw/ACT-T1.txt
docs/audits/gemini31-historical-fixture-repro/raw/ACT-T2.txt
```

## 4. Historical vs current visible chars

| call | HISTORICAL | CURRENT |
| --- | --- | --- |
| REL-T1 | 4659 | NOT_RUN |
| REL-T2 | 4254 | NOT_RUN |
| ACT-T1 | 4743 | NOT_RUN |
| ACT-T2 | 4327 | NOT_RUN |

```text
CURRENT_AVG_CHARS=NOT_RUN
CURRENT_MEDIAN_CHARS=NOT_RUN
```

## 5. Four-call objective table

All current output metrics are `NOT_RUN` (no provider text).

| call | VISIBLE_CHARS_INCL_SPACES | VISIBLE_CHARS_EXCL_SPACES | PARAGRAPH_COUNT | NARRATION_PARAGRAPH_COUNT | DIALOGUE_PARAGRAPH_COUNT | DIALOGUE_PARAGRAPH_RATIO | MAX_CONSECUTIVE_DIALOGUE_PARAGRAPHS | INPUT_TOKENS | OUTPUT_TOKENS | THINKING_TOKENS | LATENCY_MS | TTFT_MS | FINISH_REASON |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| REL-T1 | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN |
| REL-T2 | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN |
| ACT-T1 | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN |
| ACT-T2 | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN |

## 6. Deterministic flags

No model text exists to quote. No candidate passage is attached.

```text
MALFORMED_OUTPUT=NOT_APPLICABLE
META_LEAK=NOT_APPLICABLE
EMPTY_OUTPUT=NOT_APPLICABLE
PROVIDER_ERROR=NOT_APPLICABLE
TRUNCATION=NOT_APPLICABLE
NEW_USER_DIALOGUE_CANDIDATE=NOT_APPLICABLE
NEW_USER_ACTION_CANDIDATE=NOT_APPLICABLE
NEW_USER_INTENT_CANDIDATE=NOT_APPLICABLE
CANON_CONTRADICTION_CANDIDATE=NOT_APPLICABLE
SEMANTIC_REPETITION_CANDIDATE=NOT_APPLICABLE
```

`EMPTY_OUTPUT` is not asserted. `NOT_RUN` is not an empty model completion.

## 7. What this handoff is not

No next experiment is opened from this packet. No length-owner change, style adapter, length adapter, reasoning/temperature/max_tokens/provider change, extra Gemini sample, adult handoff, merge, or deploy.

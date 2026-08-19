# ChatGPT review — R1 approved for source use

`CHATGPT_REVIEW_DATE=2026-08-19`  
`CLEAN_REPLACEMENT_SOURCE_R1=true`  
`R1_TECHNICAL_VALIDITY=PASS`  
`GEMINI_SOURCE_READY=true`  
`R1_EXACT_REPLAY_OF_FAILED_REQUEST=false`  
`ADDITIONAL_R1_REGENERATION=0`

---

## 1. Failed 200-char call (unchanged)

Preserved. **Excluded** from Gemini style, length, refusal, and adult-capability statistics.

```text
FAILED_CALL_ID=cr_mszh62oh_e2gs51ql
CLASSIFICATION=UPSTREAM_STREAM_PREMATURE_EOF
VISIBLE_CHARS=200
OUTPUT_TOKENS=180
FINISH_REASON=(none)
CANONICAL=false
ARTIFACTS=H1_GEMINI_ABRUPT_CUT_AUDIT.md, MODEL_STREAM_RAW.txt, DB_STORED_ASSISTANT_RAW.txt, ...
```

---

## 2. R1 frozen as canonical replacement source

```text
CLEAN_REPLACEMENT_SOURCE_R1=true
R1_CALL_ID=h1_r1_mszhxtj1_itmqsv
R1_ASSISTANT_MESSAGE_ID=7
R1_USER_MESSAGE_ID=6
R1_RAW=GEMINI_SOURCE_R1_RAW.txt
R1_VISIBLE_CHARS=4367
R1_VISIBLE_CHARS_NO_WS=3269
R1_OUTPUT_TOKENS=3931
R1_INPUT_TOKENS=20973
R1_FINISH_REASON=stop
R1_TECHNICAL_VALIDITY=PASS
GEMINI_SOURCE_READY=true
```

No further R1 regeneration. Regenerate-path prompt/input-token difference is **provenance only**, not grounds for another model call.

---

## 3. Unresolved provenance note (recorded, not attributed)

```text
failed_call_id=cr_mszh62oh_e2gs51ql
failed_input_tokens=19653
failed_prompt_hash=1e440802

R1_call_id=h1_r1_mszhxtj1_itmqsv
R1_input_tokens=20973
R1_prompt_hash=d7ab0893

delta_input_tokens=+1320
EXACT_CAUSE=not_established
DO_NOT_ATTRIBUTE_FULL_DELTA_TO_REGENERATE_WRAPPER=true
R1_EXACT_REPLAY_OF_FAILED_REQUEST=false
```

Observed differences include regenerate API wrapper, rejected-draft avoidance block, and possible runtime assembly variance. **Do not** infer the full +1320 is solely `[REGENERATE]` without evidence.

---

## 4. Production / model policy (unchanged)

```text
PROMPT_EDITS=0
MAX_TOKEN_EDITS=0
FIXTURE_EDITS=0
ROUTING_EDITS=0
RETRY=0
CONTINUATION=0
RECOVERY=0
DEEPSEEK_CALLS=0
```

---

## 5. HUMAN USER #1 gate (open)

HUMAN USER #1 may begin. Requirements:

- Normal production chat submission (`POST /api/chat`, **not** regenerate)
- Local chat: `http://127.0.0.1:3000/chat/17?chat=3`
- Gemini 3.7 Flash: **exactly 1** call for this turn
- DeepSeek: **0**
- Do not auto-classify adult input as handoff-eligible
- Do not call DeepSeek after capture

After one Gemini response: freeze RAW + telemetry; STOP; return to ChatGPT for classification among:

- `NORMAL_ADULT_COMPLETION`
- `HARD_REFUSAL`
- `SOFT_REFUSAL_OR_EVASION`
- `TRANSPORT_FAILURE`
- `OTHER_MODEL_FAILURE`

```text
HUMAN_USER_1_RECEIVED=false
HUMAN_USER_1_GEMINI_CAPTURED=false
AWAITING_HUMAN_TYPING=true
```

Cursor must **not** synthesize HUMAN USER #1 text.

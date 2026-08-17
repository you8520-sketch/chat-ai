# DeepSeek 0813 adult-handoff final — manual review notes

QUALITY_SCORING_BY_CURSOR: false
QUALITY_REVIEW_STATUS: PENDING_CHATGPT_MANUAL_REVIEW

This packet stopped before live DeepSeek calls.

## Why live calls did not run

`DEEPSEEK_POSITIVE_PROMPT_NOT_PROVABLE = true`

Repository + prior adult-handoff audits contain:

- DeepSeek production common handoff instruction (`DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION`) — this is VANILLA
- Muse-only positive blocks (`[MUSE SOURCE STYLE CONTINUITY — OPUS 5]` / `GEMINI 3.1`)
- Qwen-only source adapters (`OPUS_QWEN_FRAGMENT_SENTENCE`, `GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK`)

There is no recoverable DeepSeek-specific positive/source-fidelity adapter. A guessed prompt was not written and was not sent.

## What is here

- `SOURCE_OPUS.txt` / `SOURCE_GEMINI31.txt` — frozen source assistant RAW (SHA matched to prior Muse/Qwen audit)
- `existing-muse-positive/` — Muse Spark 1.2 Positive n=3 RAW, byte-identical copies
- `EXISTING_MUSE_POSITIVE_REFERENCES.json` — filename / SHA256 / source / condition
- `POSITIVE_PROMPT_PROVENANCE.json` — search evidence
- `PREFLIGHT.json`

## What is not here

- DeepSeek Vanilla/Positive RAW (0 new calls)
- Blind quality/runtime packets
- Reveal map
- Quality scores

## Manual review axes (ChatGPT only — do not score here)

A. PURE PROSE QUALITY /5
B. SOURCE STYLE FIDELITY /5
C. CHARACTER IDENTITY /5
D. SCENE CONTINUITY /5
E. PARAGRAPH / RHYTHM /5
F. ADULT PROGRESSION /5
G. LATE-SCENE CHARACTER VOICE /5

Defects for ChatGPT: CONSENT_CHECKPOINT_STALL, USER_SEMANTIC_DIALOGUE_INVENTION, CHARACTER_VOICE_LOSS, GENERIC_ADULT_VOICE, FOREIGN_SCRIPT_CONTAMINATION, REFUSAL, FADE_EVADE, REPETITION, MALFORMED_OUTPUT

Operational axes for ChatGPT after any future live run: TTFT, total latency, completion efficiency, actual cost, finish reliability, terminal usage reliability, incomplete-stream rate.

Do not treat this file as a production recommendation.

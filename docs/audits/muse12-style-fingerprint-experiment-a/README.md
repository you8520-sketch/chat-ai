# Experiment A — Dynamic Source Style Fingerprint

Audit branch only. This is **not** a stronger fixed style prompt and **not** a multi-character generalization claim.

`GENERALIZATION_PROVEN = false`

The only live change in this experiment is a deterministic structural fingerprint computed from the last visible canonical assistant RAW.

## What did not change

- `[MUSE SOURCE CONTINUITY — STYLE MIRROR]` wording
- Default Opus / Gemini 3.1 → Qwen routing
- Muse Generic is still not production-activated
- Temperature 0.7, length owner, model `muse-spark-1.2`
- Pricing
- Like-specific V1 phrases stay out of production/challenger prompts
- No Agency line in this experiment
- No Fingerprint V2
- No semantic classifier

## Owner

`LAST_VISIBLE_CANONICAL_ASSISTANT`

The RAW that actually enters the next prompt history. Not the selected model name. Not UI paragraph-display transforms.

Excluded: noncanonical OOC, status widget, internal JSON/markers, hidden reasoning, tool/system syntax.

## Confidence

- HIGH: visible chars >= 2000 AND usable prose paragraphs >= 8 → use fingerprint
- MEDIUM: visible chars >= 1000 → use fingerprint
- LOW: otherwise → omit; Generic Mirror only

## Placement

`[current user]` → `[MUSE SOURCE STYLE FINGERPRINT]` → `[STYLE MIRROR]` → terminal user-tail

Fingerprint once. System 0. Muse target only. Qwen/DeepSeek 0.

## Possible next step (document only — do not run here)

If ChatGPT finds a material improvement, Gemini 3.1 only may later test winner + this exact generic agency sentence, n=3, as a separate task:

> 유저 캐릭터의 새로운 의미 있는 대사·의도·결정·동의·거절을 대신 만들지 않는다. 현재 user 입력에 명시된 행동과 의사는 확정된 것으로 받아들이고 그 자연스러운 결과는 진행하되, 입력에 없던 유저의 선택을 새로 확정하지 않는다.

Do not add that sentence in Experiment A.

## Review

Cursor does not score literary quality. ChatGPT reads the named review packet and compares frozen Generic baseline vs Generic + Fingerprint.

`SINGLE_FIXTURE` only. Do not set `GENERALIZATION_PROVEN=true`.

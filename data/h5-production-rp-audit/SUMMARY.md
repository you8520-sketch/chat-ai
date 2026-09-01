# H5 production RP RAW audit

EVIDENCE ONLY
DO NOT MERGE
NO PROSE QUALITY SCORE
NO PROMPT TUNING
HUMAN RAW REVIEW REQUIRED

QUALITY_SCORE_ASSIGNED=false
HUMAN_RAW_REVIEW_REQUIRED=true
SOURCE_PRODUCTION_FILES_CHANGED=0
TOTAL_LOGICAL_RP_SAMPLES=3
TOTAL_PROVIDER_CALLS=1 (confirmed completed cheaperinference call: C only)
A_PROVIDER_CALLS=UNCERTAIN (generation row created; no completion/billing)
B_PROVIDER_CALLS=0 (HTTP 502 before chat persist)
C_PROVIDER_CALLS=1 (completed)

## Gate

BASE_MAIN_SHA / current origin/main / current DEPLOYED_SHA:
`3a87d14d2ac9c5771ebffaf9564b0700c75b091b`

ORIGIN_MAIN_SHA == DEPLOYED_SHA after mid-run #550 cutover.
DEPLOY_STATUS=SUCCESS (`9e310f31-6a3d-4860-9bc8-c85249caf1ec`)

Adopted PRs still present: #548 #549 #546.
Adult fallback model: `deepseek-v4-pro-0813`.

See `DEPLOY_CUTOVER.md` for the instance replacement during A/B/C.

## Characters

See `character-selection.json`.

| Slot | ID | Name | Category basis (stored fields only) |
|---|---:|---|---|
| A | 17 | 플러드 | `genre=로맨스`; genres 로맨스+BL; system_prompt 서술 지침 requires 차분하고 절제된 분위기 and 감정 변화를 행동/시선/짧은 반응으로 |
| B | 10 | 에녹 | user-acceptable; tagline 아포칼립스의 저격수; genres 판타지/SF/아포칼립스; description+world 회색 생태권 / 회색 안개 / 마더 |
| C | 18 | 라이크 | user-acceptable; nsfw=1 confirmed min_age=19; STANDARD consensual adult only |

## Sampler / chats

User: production id=59 `h5-audit-1787365648172@canary.invalid`
Persona: id=96 도윤 (fictional adult 29)
Default model: `deepseek-v4-pro-0813`

| Slot | chat_id | HTTP | visible assistant | billing deductions |
|---|---:|---|---:|---:|
| A | 739 | 200 | 0 | 0 |
| B | none | 502 | 0 | 0 |
| C | 740 | 200 | 1 | 1 |

## RAW SHA256

A empty: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
B empty: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
C: `0a5369c250cd0ef2570627ecc7c03fcea388640a16123e3a9754587a6acaa8f6`

## Flags (objective / UNCERTAIN)

See `ANNOTATIONS.md`. No taste labels.

REFUSAL_COUNT=0
META_LEAK_COUNT=0
SYSTEM_PROMPT_LEAK_COUNT=0

No retries. No fourth sample. No source modification.

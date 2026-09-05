# Gemini 3.1 Pro Preview — current production inventory

Do not call a provider during this inventory. This file is the freeze.

## A. CURRENT PRODUCTION INVENTORY

| Field | Value |
| --- | --- |
| EXACT_MODEL_ID | `gemini-3.1-pro-preview` |
| PROVIDER | cheaperinference |
| TEMPERATURE | 0.95 |
| TOP_P | null |
| MAX_TOKENS | null |
| REASONING_EFFORT | low |
| THINKING_CONFIG | null |
| COMMON_LENGTH_OWNER_COUNT | 1 |
| COMMON_LENGTH_OWNER_POSITION | current_user_message_absolute_tail |
| GEMINI31_AGENCY_SUPPLEMENT_PRESENT | true |
| GEMINI31_AGENCY_SUPPLEMENT_CHARS | 305 |
| GEMINI31_STYLE_SPECIFIC_PROMPT_CHARS | 0 |
| GEMINI31_LENGTH_SPECIFIC_PROMPT_CHARS | 0 |
| NORMAL_CURRENT_USER_WRAPPER | true |
| COMMON_AGENCY_OWNER_COUNT | 2 |

### COMMON_LENGTH_OWNER_TEXT

이번 응답은 한국어 3,200자 이상을 기본 목표로 하나의 충분히 전개된 장면으로 작성한다. 장면에 필요한 내용이 있으면 더 길게 이어간다. 현재 상호작용을 요약하거나 성급히 닫지 말고, 관찰·행동·대사·감각·심리가 서로 다음 변화를 일으키도록 충분히 전개한다.

### Distinguish

- **A. common production prompt** — shared RP, USER CONTROL owner, CURRENT USER wrapper, user-tail length, OUTPUT LAYOUT, Speech Lock, production chunk compiler, third-person POV owner
- **B. Gemini 3.1 agency-only supplement** — present (kept; not a prose/style/length adapter)
- **C. Gemini 3.1 prose/style-specific text** — none
- **D. Gemini 3.1 length-specific text** — none

### Agency supplement (B)

```
[USER AGENCY — GEMINI 3.1 BODY/INTENT BOUNDARY]
사용자의 신체 상태와 이미 정해진 행동은 페르소나·대화에서 확인된 사실을 기준으로 이어간다. 확인되지 않은 신체 전제나 사용자의 답이 필요한 행동은 캐릭터의 관찰·제안·질문·준비 단계까지 자연스럽게 진행하고, 사용자가 다음 반응으로 확정할 자리를 남긴다.
물건의 착용자·수령자·행동 대상처럼 사용자의 의도가 여러 방향으로 해석될 수 있을 때는 한 방향을 사실로 확정하기보다, 캐릭터의 반응이나 짧은 확인을 통해 사용자가 의도를 자연스럽게 드러낼 수 있게 한다.
```

Gate: `isGemini31ProModel(modelId) && godmoddingMode==='standard' && contentKind!=='simulation'`

## Fixture freeze

Exact previously frozen user inputs are reused. Exact production character SQL rows are **not** on this VM seed DB.

- **A** quiet: 3.7 Flash baseline user inputs + frozen 조태형 card/greeting, compiled through production `loadCharacterChunksForPromptReadOnly`
- **B** action: production-smoke 에녹 user inputs + d2-enoch production-compiled canon; greeting newly frozen

PRODUCTION_PROMPT_CHANGED=false

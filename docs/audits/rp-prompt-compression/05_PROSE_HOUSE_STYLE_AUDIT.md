# 05 Prose / House Style Audit

## literaryEnhanced

```text
literaryEnhanced true vs false prose text identical = true
LITERARY_ENHANCED_CURRENTLY_NO_EFFECT = true
```

There is **no Opus-only literary prose adapter** that changes house-style body text.
Opus standard interactive receives:

```text
common House Style (PROSE_STYLE_SECTION / IMMERSIVE_PROSE_BLOCK / layout)
+ common collaborative agency
+ CURRENT USER INPUT wrapper
+ OPUS ARM E TERMINAL
```

## House style goal (audit framing)

Common prose should be a **floor / guardrail**, not a full prose generator specification.
Model-specific strengths (especially Opus literary voice) should remain allowed.

## Semantic unit classification (common prose)

| Unit | Classification | Notes |
|---|---|---|
| NARRATION REGISTER: 해체만 / 번역투 금지 / ...... 금지 | A (quality floor) | KEEP |
| SCENE FLOW | A | KEEP |
| RHYTHM: 같은 시작형 반복 금지 | A/B | MERGE candidate with 번역체 단문 연타 금지 |
| RHYTHM: 짧은 문장 연타 금지 | B/C | MERGE with translationese short-burst rule |
| SENSATION 1–2 channel | A | KEEP |
| IMMERSIVE: 체험 밀착 / 목록화 금지 | A | KEEP |
| IMMERSIVE: 이유 없는 첫 만남 특별취급 금지 | A | KEEP — but REASONED_CANON_CONTINUATION when creator canon supplies 기시감/인연 |
| IMMERSIVE: 추상 판정 해설 금지 | A | KEEP |
| WEBNOVEL BREATH pause/리셋 | A/C | KEEP as floor; avoid micromanaging pause frequency |
| 19+ INTIMACY | A (when NSFW) | KEEP |

## KEEP / MERGE / DROP / MODEL-SPECIFIC (proposal only)

| Phrase / rule | Action |
|---|---|
| 같은 감정을 다른 비유로 반복 증명하지 않는다 | KEEP |
| 짧은 문장 연타 금지 + 번역체 단문 연속 금지 | MERGE candidate |
| ...... 금지 | KEEP |
| 이유 없는 첫 만남 특별취급 금지 (정본·인연 예외) | KEEP — do not strengthen against canon-justified reactions |
| Dense sentence-count paragraph micromanagement (if present outside tests) | DROP / keep test-only |
| Opus Arm E prose micromanagement | none found — Arm E is agency/length, not prose style |
| DeepSeek style-only reminder | MODEL-SPECIFIC (if production-active) |

No deletions applied in this audit.

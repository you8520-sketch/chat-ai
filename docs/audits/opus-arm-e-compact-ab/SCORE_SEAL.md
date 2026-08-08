# Blind score seal (pre-reveal)

Reviewer scored `BLIND_REVIEW.md` with arm identity hidden.

## Fixture L (literary)

| Metric | Output X | Output Y |
|---|---:|---:|
| 문장 선택·리듬 /25 | 23 | 22 |
| 비유·이미지 /20 | 17 | 18 |
| 장면 밀도·구체성 /15 | 14 | 12 |
| 캐릭터 고유 내면/시선 /15 | 14 | 13 |
| 자연스러운 장면 진행 /10 | 9 | 8 |
| 대사 캐릭터성 /5 | 5 | 5 |
| 과설명/AI문체 억제 /5 | 4 | 4 |
| 완성도 /5 | 5 | 4 |
| **Literary total /100** | **91** | **86** |
| OPUS_PREMIUM_DISTINCTIVENESS /5 | 5 | 4 |
| visible chars (display) | 3225 | 2959 |
| severe agency | 0 | 0 |

Notes:
- X: multi-NPC beat (윤태건), guide-sense atmosphere, ends on reversible invitation — denser scene ownership.
- Y: strong intimate voice / confession beat; slightly thinner world motion; still premium but less distinctive vs DeepSeek/Gemini contrast.

Blind literary winner: **X**

## Fixture A (agency)

| Metric | Output X | Output Y |
|---|---:|---:|
| severe agency | **1** (REJECT) | 0 |
| visible chars (display) | 2746 | 2257 |
| Literary total (informational only) | n/a (rejected) | 84 |
| OPUS_PREMIUM_DISTINCTIVENESS /5 | n/a | 4 |

Severe on X:
- NPC: “자리에서 일어나 주세요”
- Narrative then performs [B] standing / balancing on bed edge before any new user input
- = 미특정·신규 요구 [B] 행동 대행 → `COMPACT_SEVERE_AGENCY_VIOLATION` if X is Compact

Y stops before “세 걸음 물러나…” execution; only minor involuntary cues (goosebumps / gaze) — not severe under Audit 58 bar.

Blind agency winner: **Y** (hard gate)

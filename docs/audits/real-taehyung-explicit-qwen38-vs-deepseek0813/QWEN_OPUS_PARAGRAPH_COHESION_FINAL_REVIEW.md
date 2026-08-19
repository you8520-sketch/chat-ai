# Opus → Qwen paragraph cohesion — Candidate B replacement (audit-only)

기존 Opus → Qwen fragment-minimal n=3은 Baseline A로 재사용. 재호출 0.
이번 패킷의 유일한 prompt 변화는 last-user fragment sentence **replacement** 한 개.

- Candidate B RAW: `QWEN_OPUS_PARAGRAPH_COHESION_{1,2,3}.txt`
- metrics: `QWEN_OPUS_PARAGRAPH_COHESION_RUNTIME.json`, `QWEN_OPUS_PARAGRAPH_COHESION_SUMMARY.json`
- blind: `QWEN_OPUS_PARAGRAPH_COHESION_BLIND.md`
- runner: `scripts/real-taehyung-explicit-qwen-opus-paragraph-cohesion.ts`

기존 RAW SHA 불변:

- `QWEN_OPUS_FRAGMENT_MINIMAL.txt` `aef51179871abdcd2c367beb49e2f441327482716b5bcdc99b4eb906480be1e3`
- `QWEN_OPUS_FRAGMENT_MINIMAL_2.txt` `46a667554bbf7d431aa795bcf1272105030571049ece65ec5b64ea31d99e625a`
- `QWEN_OPUS_FRAGMENT_MINIMAL_3.txt` `5a730010ce7194ab7f095f6fa6d3eb8a83f37314f50a1fff433d9ac5bd195cb4`
- Gemini fragment / production-parity RAW도 전부 불변. Gemini 블록은 이 실험에 넣지 않음.

```text
TOTAL_NEW_QWEN_CALLS: 3
OTHER_MODEL_CALLS: 0
MUSE / DEEPSEEK / GLM / GEMINI / SOURCE: 0
retry / continuation / recovery / fallback: 0
model: qwen-3-8-max
temperature: 0.7
reasoning_effort: none
injection: last-user replacement, not accumulation
GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK: NOT USED
PRODUCTION_CHANGED: false
MAIN_MERGED: false
RAILWAY_DEPLOYED: false
```

OLD (Baseline A, production sentence, not changed):

> 문단과 대사 분절은 직전 assistant의 패턴을 따른다. 같은 화자의 이어지는 발화나 하나의 연속된 행동 흐름을 한두 문장마다 새 문단으로 불필요하게 쪼개지 않는다.

NEW (Candidate B, audit-only):

> 직전 assistant의 호흡을 기준으로 문단은 한두 문장 수가 아니라 의미 단위로 나눈다. 같은 화자의 짧은 연속 발화·확인·감탄은 가능한 한 하나의 대사 블록으로 묶고, 하나의 행동·감각·생각 흐름에 속한 서술은 한 문단 안에서 충분히 연결하며, 실제 의미 초점이나 행동 단계가 바뀔 때만 새 문단으로 전환한다.

Last-user SHA (Candidate B 3콜 동일):
`f46e4434c2e28e5501e1595b4b3f3d02ec84d0ca44fded9930e24c6a53131e45`

Baseline A last-user SHA (참고, 재호출 없음):
`783947537587ffdea5b5843b16ff543694c67bb7779c4763eacdf3c6fa40b923`

제외 확인: Muse M1, GLM progression, DeepSeek XML, Gemini31 Qwen style block, old fragment sentence, 강제 adult/length 규칙 추가 없음.

`ADJACENT_SAME_SPEAKER_DIALOGUE_BLOCKS` 정의: 연속 대사 문단, 또는 짧은 지문 한 줄(≤2문장, ≤80자)만 끼고 이어지는 같은 화자 대사 쌍. 이 스타일의 실제 파편화는 quote / beat / quote 이기 때문.

## Auto metrics

Published Baseline A paras/1000는 기존 n=3 리뷰 수치를 그대로 쓴다 (12.733 / 18.032 / 17.048, avg 15.938).
아래 extra 구조 지표는 기존 A RAW를 재측정한 값이다.

| cell | chars | paras | /1000 | 1-sent share | dlg | dlg/1000 | adj same-spk | avg para | median | finish |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| A1 기존 | 5026 | 64 | 12.733 | 0.484 | 28 | 5.571 | 6 | 76.6 | 31 | stop |
| A2 기존 | 3882 | 70 | 18.032 | 0.486 | 28 | 7.213 | 8 | 53.5 | 21 | stop |
| A3 기존 | 5162 | 88 | 17.048 | 0.591 | 40 | 7.749 | 15 | 56.7 | 19 | stop |
| B1 | 6193 | 76 | 12.272 | 0.329 | 33 | 5.329 | 5 | 79.5 | 55 | null |
| B2 | 6068 | 61 | 10.053 | 0.475 | 27 | 4.450 | 4 | 97.5 | 27 | stop |
| B3 | 5968 | 59 | 9.886 | 0.390 | 26 | 4.357 | 1 | 99.2 | 34 | stop |

B1 `finish=null` / usage null은 stream trailer 누락. 본문은 완전한 문장으로 끝난다. malformed로 세지 않음.

## Direct scores (RAW 전체 읽음)

평가 기준은 SOURCE HANDOFF FIDELITY. 자동 regex로 winner를 정하지 않는다.
짧은 신음/호흡/떨림/생리 반응/established 장면의 절정은 agency 위반으로 세지 않는다.
`LATE_SCENE_CHARACTER_VOICE /5`는 삽입 이후 캐릭터 대사만 본다. `/25` 총점에 합치지 않는다.

### Baseline A (재사용, 기존 점수)

| | A1 | A2 | A3 |
|---|---:|---:|---:|
| SOURCE_STYLE_FIDELITY | 5 | 4 | 4 |
| CHARACTER_IDENTITY | 5 | 4 | 4 |
| SCENE_CONTINUITY | 4 | 4 | 4 |
| PARAGRAPH_STRUCTURE | 2 | 2 | 2 |
| ADULT_PROGRESSION | 5 | 5 | 5 |
| **SCORE** | **21** | **19** | **19** |
| LATE_SCENE_CHARACTER_VOICE | 5 | 3 | 4 |
| GENERIC_ADULT_VOICE | LOW | MEDIUM | MEDIUM |
| CONSENT_CHECKPOINT_STALL | NO | NO | NO |
| USER_SEMANTIC_DIALOGUE_INVENTION | NO | NO | NO |
| FOREIGN_SCRIPT_CONTAMINATION | NO | YES (`安抚`) | YES (`คำ`) |

### Candidate B

| | B1 | B2 | B3 |
|---|---:|---:|---:|
| SOURCE_STYLE_FIDELITY | 4 | 4 | 4 |
| CHARACTER_IDENTITY | 4 | 4 | 4 |
| SCENE_CONTINUITY | 4 | 4 | 4 |
| PARAGRAPH_STRUCTURE | 3 | 4 | 4 |
| ADULT_PROGRESSION | 5 | 5 | 5 |
| **SCORE** | **20** | **21** | **21** |
| LATE_SCENE_CHARACTER_VOICE | 4 | 4 | 4 |
| GENERIC_ADULT_VOICE | MEDIUM | MEDIUM | MEDIUM |
| CONSENT_CHECKPOINT_STALL | NO | NO | NO |
| USER_SEMANTIC_DIALOGUE_INVENTION | NO | NO | NO |
| FOREIGN_SCRIPT_CONTAMINATION | NO | NO | NO |
| CHARACTER_VOICE_LOSS | NO | NO | NO |
| REFUSAL | NO | NO | NO |
| FADE_EVADE | NO | NO | NO |
| MALFORMED_OUTPUT | NO | NO | NO |
| REPETITION | LOW | LOW | LOW |

**B1:** 서술 문단은 A1보다 길고(median 55), 1문장 문단 비율이 0.484→0.329로 줄었다. 대사는 삭제되지 않았다(33블록). 삽입 이후 “나 안 피하잖아 / 그거. 그 소리 / 계속 듣고 싶어”는 남는다. A1의 “빨간색 아니면, 나 안 멈춘다” 천장에는 못 미친다. check-in이 많다. 12.272/1000으로 A1과 비슷하고 A avg보다는 낮다.

**B2:** 10.053/1000. 서술 흐름이 분명히 길어진다. “안 피해 / 너도 피하지 마 / 빨간색 / 야, 나 지금 되게 참기 힘든데 / 그럼 나, 좀 더 간다 / 나 봐, 끝까지 보게.” 대사는 여전히 짧은 한 줄이 많지만 블록 수가 줄고 지문이 묶인다. A2의 late-voice 3 / `安抚`보다 낫다.

**B3:** 9.886/1000. “피하라고 해도 못 피하게 해 놓고 / 네가 피하지 말라고 해서, 진짜 안 피하는 거거든 / 나 지금 너만 들려 / 책임져야 된다 / 피하지 마. 나도 안 피할 테니까.” 소리 능력 모티프가 후반까지 남는다. A3의 `คำ` 혼입 없음. 벽문단은 아님.

대사를 지우고 서술만 늘린 BAD 패턴은 3/3에서 보이지 않는다. 같은 말맛을 더 적은 블록/더 긴 서술 단위로 묶는 GOOD 패턴에 가깝다.

## Gate check

P0: STALL 0/3, USER_SEMANTIC_DIALOGUE_INVENTION 0/3, REFUSAL 0/3, MALFORMED 0/3. PASS.

P1 voice: late avg 4.00 ≥ 3.5, 3/3 ≥ 4. PASS. A1 peak 5는 재현되지 않았지만 평균은 동률.

P2 paragraph: avg 10.737 ≤ 12.5, 2/3 ≤ 12.0 (10.053, 9.886). 15.938 대비 명확한 개선. PASS.

P3: 1-sent share 0.520→0.398, dlg/1000 6.844→4.712, adj same-spk 9.667→3.333. PASS.

STRONG PASS 기준: avg ≤ 11.5 AND late ≈ 4.0 AND stall 0/3 AND identity/source 비하 없음. 충족.

## Blind A/B

패킷: `QWEN_OPUS_PARAGRAPH_COHESION_BLIND.md`

Reveal key:

- PAIR 1 LEFT = B1, RIGHT = A1
- PAIR 2 LEFT = A2, RIGHT = B2
- PAIR 3 LEFT = B3, RIGHT = A3

채점자가 생성과 채점을 같이 했으므로 독립 블라인드는 아니다. 질문별 판단:

1. 덜 끊김: PAIR1 근소 LEFT(B), PAIR2 RIGHT(B), PAIR3 LEFT(B)
2. 의미 흐름: 같은 방향. B2/B3가 분명하고 B1은 소폭
3. 라이크 말투: PAIR1 RIGHT(A1) peak, PAIR2 RIGHT(B2) ≥ A2, PAIR3 동급~LEFT(B3)
4. 대사 과분리: B 쪽. 대사가 사라진 것은 아님
5. 읽기: B, 특히 2/3
6. production sentence: Candidate B

`BLIND_PREFERENCE`: Candidate B (2/3 pairs clear, 1/3 mixed on peak voice)

## Decision

`OPUS_QWEN_FRAGMENTATION_CONFIRMED`는 Baseline A에 대해 그대로 true.
Candidate B는 그 한 문장 replacement만으로 문단 응집과 late voice 보존을 같이 만족한다.

`OPUS_QWEN_PARAGRAPH_REPLACEMENT_RECOMMENDED`: **true**

이번 패킷에서는 production `OPUS_QWEN_FRAGMENT_SENTENCE`를 바꾸지 않는다.
제3 paragraph prompt는 만들지 않는다.

`OPUS_FINAL_HANDOFF`: QWEN (뒤집지 않음)
`GEMINI_FINAL_HANDOFF`: QWEN (이 실험과 무관, frozen)
`GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK`: FROZEN
Muse: CLOSED

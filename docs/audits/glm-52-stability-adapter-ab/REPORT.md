# GLM-5.2 two-sentence stability adapter A/B

```text
GLM52_STABILITY_ADAPTER = FAIL
```

A = COMMON_PROSE_OUTPUT (production owners, unchanged).
B = A + the two specified GLM-5.2 stability sentences after `rule-output-layout-recency`.
USER_TAIL / temperature 0.7 / `reasoning_effort=none` / omitted `max_tokens` unchanged.
retry = continuation = recovery = 0.

Run HEAD: `51858ffaefa848f4fd688545bd7f4ed17186b1c3`

Assembled diff (all seeds): character/history/persona/memory/current user/agency/common prose/length owner/sampling/reasoning = identical. Only the two stability sentences differ.

## Why FAIL

S4 improved (no 7k self-clone, no fridge-as-fact). That is not enough.

S3-B lost quoted dialogue (`dialogueRatio = 0`). That is a dialogue-format regression versus S3-A. Adoption rule 5 fails.

Do not stack more sentences. GLM-5.2 stays HOLD. No Gemini 3.7 comparison. No production change.

## S4 A/B raw

- A: `docs/audits/glm-52-stability-adapter-ab/raw/S4-A.txt` (3,694자)
- B: `docs/audits/glm-52-stability-adapter-ab/raw/S4-B.txt` (3,381자)

S4-B: no mid-text scene restart, no fridge/medical-affiliation fact lock, not 500–1000자 collapse, scene still moves (offer → tease → drink → return → name). Residual bottle focus remains but is not a second copy of the same scene.

S4-A: still invents habit/rehearsed-care reading and esper-wave color. Longer, more inference.

## S1–S4 metrics

| cell | chars+sp | outTok | para | dlg ratio | latency ms | usage.cost USD | finish |
|---|---:|---:|---:|---:|---:|---:|---|
| S1-A | 4418 | 3629 | 38 | 0.263 | 58183 | 0.008976 | stop |
| S1-B | 3244 | 2731 | 25 | 0.320 | 44834 | 0.006974 | stop |
| S2-A | 4980 | 4050 | 38 | 0.316 | 67782 | 0.009946 | stop |
| S2-B | 3050 | 2562 | 25 | 0.240 | 41817 | 0.006602 | stop |
| S3-A | 2704 | 2193 | 16 | 0.250 | 37698 | 0.005734 | stop |
| S3-B | 3104 | 2540 | 15 | 0.000 | 45304 | 0.006564 | stop |
| S4-A | 3694 | 3073 | 31 | 0.161 | 50157 | 0.010987 | stop |
| S4-B | 3381 | 2892 | 27 | 0.259 | 43767 | 0.008682 | stop |

avg chars A = 3949
avg chars B = 3194.75 (−19.1%, still ~3.2k; not a 1,000자 collapse)

## Repetition cells

- S4-B: no self-restart / duplicated-scene clone (cleared vs prior 7,327자 B)
- S1-A / S2-A: 이명·초커·관찰 버릇 재서술 (padding, not a full scene clone)
- S1-B / S2-B: lighter; no scene restart

## Unsupported-fact cells

- S4-A: 습관적으로 남을 챙기는 부류 / 연습된 ‘괜찮으니까’ / 에스퍼·가이드 파동 색
- S4-B: fridge/소속 사실화 없음. 가이드·지원국은 가능성으로만. 물병 온도는 미확정
- S1-A: 출입증 존재 단정
- S1-B: 출입증 단정 없음. 얼굴 층위 과잉독해는 남음
- S2-A: 동쪽 복도/의료동 시선 확정에 가깝게 진행
- S2-B: 출입증 없음은 관찰. 목적지 미확정 유지
- S3-B: 오늘 아침 지원국 발령 명단 확인 — 설정에 없는 사실

## Quality regressions (B vs A)

- S3-B: 대사 따옴표/독립 문단 소실 (`dialogueRatio=0`) — dialogue regression
- S1-B / S2-B: 한국어·캐릭터성·speech-act는 유지. S2-B는 “어디를”로 동행을 선점하지 않아 speech-act는 A보다 정확
- S1 both: 유저가 하지 않은 ‘갸웃’을 렌에게 부여 (agency, A/B 공통)
- 평균 길이는 줄었으나 1,000자급 급축소는 아님. 길이 숫자만으로 채택하지 않음

## Cost

| arm | usage.cost sum USD |
|---|---:|
| A | 0.035643 |
| B | 0.028822 |

No INVALID_TRANSPORT.

## HEAD SHA

- experiment run: `51858ffaefa848f4fd688545bd7f4ed17186b1c3`
- artifact commit: recorded after this report is committed

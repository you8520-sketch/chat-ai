# Gemini 3.7 Flash — A vs B 6-seed length expansion

```text
model = gemini-3.7-flash
reasoning_effort = low
max_tokens = omitted (production)
A = vanilla, no Gemini 3.7 length sentence
B = SAME sentence once in system/model-specific
C = not run
sentence = 현재 장면을 충분히 전개하여 한국어 공백 포함 약 3,200~4,000자 분량으로 완성한다. 짧게 마무리하거나 요약하지 않는다.
retry = 0
continuation = 0
recovery = 0
starting snapshot = same greeting + 조태형/렌 fixture
```

## A/B 6-sample table

| seed | user | A chars | B chars | A finish | B finish | A speech-act | B speech-act | A agency | B agency | A invalid | B invalid |
|---:|---|---:|---:|---|---|---|---|---|---|---|---|
| 1 | 나는 렌이라고… 본 기억이 안 나는데… 나 알아? | INVALID_TRANSPORT | INVALID_TRANSPORT | n/a | n/a | false | false | false | false | true | true |
| 2 | 같이 갈래? *두리번* | 2880 | INVALID_TRANSPORT | stop | n/a | false | false | false | false | false | true |
| 3 | *가방 끈을 꼭 쥐고* 음… 조금만. 나 길 잘 모르거든. | 2671 | INVALID_TRANSPORT | stop | n/a | false | false | false | false | false | true |
| 4 | *나란히 걷다 멈춰 서서* 여기… 자주 오는 곳이야? | INVALID_TRANSPORT | INVALID_TRANSPORT | n/a | n/a | false | false | false | false | true | true |
| 5 | *물병을 꺼내 내민다* …목마르면 마셔. 나 괜찮으니까. | 2805 | INVALID_TRANSPORT | stop | n/a | false | false | false | false | false | true |
| 6 | *벽에 기대 숨을 고른다* 잠깐만… 여기 좀 쉬자. | INVALID_TRANSPORT | 3196 | n/a | stop | false | false | false | false | true | false |

## Aggregate (valid samples only)

| | A | B |
|---|---:|---:|
| valid samples | 3 | 1 |
| avg chars | 2785.333 | 3196 |
| median chars | 2805 | 3196 |
| min | 2671 | 3196 |
| max | 2880 | 3196 |
| range | 209 | 0 |
| CV | 0.031 | 0 |
| >=2700 | 2 | 1 |
| >=3000 | 0 | 1 |
| avg output tokens | 2367 | 2332 |
| avg API KRW | 12.256 | 12.17 |
| avg latency | 14649.667 | 15980 |
| speech-act errors | 0 | 0 |
| agency errors | 0 | 0 |
| repetition flags | 1 | 0 |
| off-scene flags | 0 | 0 |
| malformed flags | 0 | 0 |
| transport failures | 3 | 5 |

## Quality flags by cell

| cell | repetition | same-q | speech-act | agency | off-scene | meta | truncate | transport |
|---|---|---|---|---|---|---|---|---|
| A1 | false | false | false | false | false | false | false | true |
| B1 | false | false | false | false | false | false | false | true |
| A2 | false | true | false | false | false | false | false | false |
| B2 | false | false | false | false | false | false | false | true |
| A3 | false | false | false | false | false | false | false | false |
| B3 | false | false | false | false | false | false | false | true |
| A4 | false | false | false | false | false | false | false | true |
| B4 | false | false | false | false | false | false | false | true |
| A5 | false | false | false | false | false | false | false | false |
| B5 | false | false | false | false | false | false | false | true |
| A6 | false | false | false | false | false | false | false | true |
| B6 | false | false | false | false | false | false | false | false |

## Manual quality notes (valid + seed-2 fragment)

- A2 (valid, 2880): `"같이 갈래?"`를 렌의 제안으로 인용. 제안자/수락자 뒤집힘 없음.
- B2 (INVALID_TRANSPORT, 1451 fragment): 같은 인용(`초면에 대뜸 같이 가자고?`). 이전 B T2의 "제안을 넙죽 받아들였다"는 이 조각에서 재발하지 않음. 미완성이라 반복 경향으로 확정하지 않음.
- A3 (valid, 2671): 유저 "조금만 / 길 잘 모르거든"을 그대로 인용. agency/speech-act 문제 없음.
- A5 (valid, 2805): 물병을 렌이 건넨 제안으로 읽음. 렌이 마셨다고 쓰지 않음.
- B6 (valid, 3196): "잠깐 쉬자"를 렌의 요청으로 받고 태형이 수락. agency 문제 없음.
- A2 `same-q` 자동 플래그는 물음표 개수 heuristic. 동일 의미 질문 누적이라고 보지 않음.

## Verdict

```text
valid n = A 3 / B 1
B 6-sample avg cannot be claimed
A valid avg = 2785.333 (<3000)
B valid avg = 3196 (n=1 only)
transport failures = A 3 / B 5
VERDICT = KEEP_VANILLA
B = REJECT
reason = insufficient valid samples; transport-dominated run; do not adopt from n=1
NO_NEW_SENTENCE = true
C_NOT_RERUN = true
```

## RAW paths

- A1: docs/audits/gemini-37-flash-length-ab-6seed/a1-raw.txt
- B1: docs/audits/gemini-37-flash-length-ab-6seed/b1-raw.txt
- A2: docs/audits/gemini-37-flash-length-ab-6seed/a2-raw.txt
- B2: docs/audits/gemini-37-flash-length-ab-6seed/b2-raw.txt
- A3: docs/audits/gemini-37-flash-length-ab-6seed/a3-raw.txt
- B3: docs/audits/gemini-37-flash-length-ab-6seed/b3-raw.txt
- A4: docs/audits/gemini-37-flash-length-ab-6seed/a4-raw.txt
- B4: docs/audits/gemini-37-flash-length-ab-6seed/b4-raw.txt
- A5: docs/audits/gemini-37-flash-length-ab-6seed/a5-raw.txt
- B5: docs/audits/gemini-37-flash-length-ab-6seed/b5-raw.txt
- A6: docs/audits/gemini-37-flash-length-ab-6seed/a6-raw.txt
- B6: docs/audits/gemini-37-flash-length-ab-6seed/b6-raw.txt

# #1541 TRPG 인간 PC 행동·대사 권한 — 조사 및 유료 재현 증거

추적 이슈: https://github.com/you8520-sketch/chat-ai/issues/1541

이 문서는 사실과 원문 위치만 기록한다. 품질 점수·판정은 하지 않는다(GPT 원문 평가 대기).
**코드는 수정하지 않았다. PR은 없다.** 이 브랜치는 docs-only 증거 브랜치다.

## 1. 기준

- 기준 main: `3b553c6c` (`d8b39f65` 이후). R3·R4 원본 증거: `docs/evidence/trpg-1541-real-play/` @ `35669f8d`.
- 대상 모델: `gemini-3.8-flash` (CheaperInference, GM 스트리밍 + structured JSON). 키는 수동 live-probe용 `CHEAPER_INFERENCE_BENCHMARK_API_KEY`.
- 재현 입력: R4 원본 최종 입력(`call-13-gm-r4-provider-request.json`)을 그대로 읽어 `messages[1]`(user)을 바이트 단위로 재사용했다. 네 호출 모두 `userSha256 = 53015341f28c107a0dcb7d62e762a710427c6ee25355fec9bc4dc1e1eed2c59c`(원본과 동일).
- 현재 main의 `TRPG_GM_SYSTEM` sha256 = `b329d0a1…03b6a0` = 원본 R3·R4 호출의 system sha256. 현재 main 코드로 재조립한 provider body가 저장된 원본 body와 byte 동일함을 호출 전에 확인했다(`max_tokens`만 증거 하네스의 16,384로 고정).
- 유료 호출은 GM 4회(R4만), 재시도·모델 대체 없음, 호출당 POST 1회로 fetch를 막았다. 실측 합계 **약 95 KRW**(1,450 KRW/USD, catalog 단가 × 사용량). 한도(4회, 1,000원 미만) 이내. 호출별 값은 `calls/*/…-call.json`, 원장은 `replay/spend-ledger.json`.

## 2. 최종 GM 입력에서 확인한 사실 (R4, `live/wire/call-13-gm-r4-*`)

사람이 제출한 현의 R4 행동: "결박한 심부름꾼을 끌고 채광창으로 나가면서, 강도현이 마지막 배를 언제 어디서 타려는지 심부름꾼에게 낮은 목소리로 캐묻는다."

1. 인간 행동 권한 문장은 최종 system의 ROUND CRAFT 2에 이미 있다: "Submitted canonical actions fix intent only. [AUTHORITATIVE HUMAN PC ACTION …] is the sole authority for that human PC's voluntary action, movement, route choice, dialogue, allegiance, decision, and inner state." 이 문장은 소유자를 말하지만 GM이 무엇을 쓸 수 있고 쓰면 안 되는지(제출된 말의 실현 범위, 제출되지 않은 위협·감정·결정)는 말하지 않는다.
2. 같은 system의 ROUND CRAFT 끝에 떨어져 있는 `Allowed speaker lines: NPC, world voice where appropriate, GM closing aside.`에는 인간 PC가 없다. 반면 user의 `[CHECK no_check reason=talk — spoken words occur; listener/world response is still GM-owned]`와 system의 `For talk/ask (CHECK no_check reason=talk), spoken words are in-scene`는 PC의 말이 장면에서 발화된다고 말한다. 제출문은 "캐묻는다"라는 의도 서술이라 실제 대사 문장은 GM이 써야 하는 구조다. 이 세 문장 사이에 PC 발화를 어디까지 쓸지 정하는 문장은 없다.
3. `[PLAYER PERSONAS — portray these human PCs as written …]`의 페르소나는 이름/호칭만 있다(말투 예시 없음).
4. 별도 recovery/regen 재작성 경로는 없다. `runGmForRound`는 `TRPG_GM_SYSTEM` + `buildTrpgGmUserBlock` 한 번의 GM 호출이 전부다(`engineAdvance.ts`). `regenerate` 접두는 이번 입력에 없다.
5. R4 user에는 `[RECENT ROUNDS — RAW]`로 R1–R3의 GM 원문이 그대로 들어간다. 그 안의 R2 GM 원문에는 현이 **제출하지 않은** 긴 대사가 있다. R2에서 현이 제출한 행동은 "소란 틈에 빠져나가 … 거리를 두고 몰래 뒤따라간다"였다.
6. 길이 예산은 `Input density: SPARSE / Minimum 3200 / Target 4200–5200 Korean characters`다.

## 3. 원본 실제 증거에서 제출되지 않은 인간 PC 발화·행동 (사실 대조)

| 라운드 | 사람 제출 | GM 원문에 있는 것 |
| --- | --- | --- |
| R2 | 현: 심부름꾼을 몰래 뒤따라간다 | `현: "심부름꾼 놈은 놓쳤지만 … 지금 바로 뒤쫓는다면 …"` (긴 직접 대사, 제출 없음) |
| R3 | 렌: 골목 입구에서 망을 보며 다가오는 자가 있으면 조용히 신호 | 렌이 "칼을 쥐고 경비병들의 접근을 지연시키며", "창고 문을 향해 경고를 던졌고"(제출에 없는 행동·발화) |
| R3 | 현: 열쇠로 문을 열고 서류함을 확인 | 현이 "미간을 찌푸렸고", 도윤의 팔을 짚어 진정시킴, 창고 문틈으로 바깥을 살핌 |
| R4 | 현: 심부름꾼에게 낮은 목소리로 배의 시간·장소를 캐묻는다 | 제출된 질문 + `네놈 목숨줄을 쥔 건 저기서 문을 부수고 있는 경비병들이 아니라 바로 우리다.`(제출에 없는 생명 위협), 멱살을 잡고 바위벽에 밀어붙임 |

## 4. 유료 재현 (R4 동일 user 입력, 모델 출력 원문 전문은 `calls/`)

system 변형 두 개를 시험했다(코드 변경 없음, 증거 하네스에서 system 문자열만 교체). 차이는 `replay/system-v1.diff`, `replay/system-v2.diff`.

- **v1**: ROUND CRAFT 2에 "제출된 질문/진술은 그 PC의 `이름: "대사"`로 말하며 제출 내용만 담는다 …, 제출하지 않은 추가 대사·위협·약속·고백·감정·결정은 쓰지 않는다 …"를 넣고, 떨어져 있던 `Allowed speaker lines` 줄을 삭제.
- **v2**: v1에서 `이름: "대사"` 문구를 빼고, `Allowed speaker lines`를 삭제하지 않고 `…, and a human PC's submitted words only.`로 확장.

| 호출 | system | finish | 입력/출력 tokens | 비용 | narration 글자 수 | 렌·현 직접 대사 줄(`이름: "…"`) |
| --- | --- | --- | --- | --- | --- | --- |
| 원본 증거 call-13 | 현재 main | stop | 15,567 / 3,494 | 23.4 KRW | 4,115 | 현 1줄 (질문 + 생명 위협) |
| c2 재현(통제) | 현재 main | stop | 15,567 / 4,497 | 26.9 KRW | 6,012 | 현 1줄 (질문 + `네 목숨줄은 지금 그 입에 달렸다`) |
| c1 | v1 | stop | 15,649 / 5,177 | 29.4 KRW | 7,083 | 현 2줄(질문, `문 뒤에 사람이 있소. 망설이고 있군.`), 렌 2줄(`오 노인은 동생의 죄를 …`, 오 노인에게 건네는 긴 설득 연설). 현의 질문에 위협 없음 |
| c3 | v2 | stop | 15,650 / 2,435 | 19.7 KRW | **2,463** | 현 1줄(질문만, 위협 없음). 서술이 `오 노인: "` 직후 닫히지 않은 따옴표(JSON 이스케이프 누락)로 잘림. `GM:` 마무리 없음 |
| c4 | v2 | stop | 15,650 / 4,829 (cache read 13,675) | 19.4 KRW | 5,960 | 현 1줄(질문 + `네놈의 몸뚱이가 저 파도 밑으로 먼저 처박힐 줄 알아라`), 서술에 현이 단검을 귀밑머리에 들이댐 |

세어 보면(원문 기계 대조, 서사 판단 아님):

- 현재 main 입력에서 현의 R4 질문 대사에 제출되지 않은 위협이 붙은 횟수: 2/2(원본, 재현).
- v1: 위협 0/1, 그러나 제출되지 않은 렌 대사·결정(오 노인에게 말을 거는 것)이 새로 생김(현재 main 두 샘플에는 렌 직접 대사 0).
- v2: 위협 1/2(잘린 샘플은 확인 불가 구간이 있음), 렌 직접 대사 0/2.
- 길이는 모든 샘플이 최소 3,200자 이상이었으나 c3만 예외(JSON 이스케이프 실패로 잘림).

## 5. 결론 (사실과 한계)

- 확정된 사실: (a) 이미 주입된 권한 문장은 소유자만 선언하고 허용·금지 범위가 없다, (b) 같은 최종 입력 안에 PC 발화를 허용하는 신호(`spoken words occur`, `spoken words are in-scene`)와 허용하지 않는 신호(`Allowed speaker lines`, 권한 문장)가 공존한다, (c) 입력에 이전 라운드의 비제출 PC 발화 선례(R2)가 들어 있다, (d) 현재 main 입력의 같은 R4에서 위협 추가는 2/2로 재현된다.
- 확정하지 못한 것: 위 (a)–(c) 중 무엇이 모델 행동의 원인인지. system 문구 두 변형은 샘플당 결과가 갈렸고(v1은 위협은 사라지고 렌 발화가 생김, v2는 위협이 1/2로 남음) 호출 상한(4회) 안에서 효과를 입증하지 못했다. 변형 v1은 오히려 제출되지 않은 PC 발화를 늘렸다.
- 따라서 ticket §8에 따라 **코드 변경 없이 조사 보고 후 STOP**했다. 근거 없는 문구 추가나 PC 발화 후처리 정규식은 만들지 않았다.
- 별도 관측: c3에서 Gemini가 서술 JSON 문자열 안의 `"대사"` 따옴표를 이스케이프하지 않아 서술이 잘렸다. 4회 중 1회이며 이번 변경과 무관할 수 있다(현재 main 두 호출은 정상 이스케이프). 별도 후속 조사 대상이다.
- 이번에 하지 않은 것: R3 재현(호출 한도), 실제 사람 플레이, 50턴 이상 장기 품질.

## 6. 재현

`replay/replay.ts`는 저장소 루트에서 `node --conditions=react-server --import tsx`로 `.mts`로 복사해 실행한 일회성 하네스다(`DATA_DIR`가 `/tmp/g1541h/`가 아니면 거부, 호출 누적 4회·900 KRW 차단, 호출당 POST 1회). `replay/pc-lines.js`는 narration에서 `렌:`/`현:` 줄만 뽑는 단순 스크립트다. 서사 점수는 계산하지 않는다.

# 탐험 미니맵 V1 플레이 기록

스크립트 GM/동료. 유료 공급자 호출 0. 시드와 라운드 상태는 `explorationPlay.test.ts`가 통과한 실행의 원문이다.

- seed: `c48bcfbc9c58afed`
- gmCalls: 9 (오프닝 포함)
- botCalls: 16
- paidProviderCalls: 0
- 승인 위협: `경보 방어장치` (시나리오 encounter `enc_alarm`, 경보실, 도착한 다음 라운드에 1회)
- 재생성 서술: `같은 열쇠는 그대로 두고 문장만 바꾼다. GM: 무엇을 하겠는가.`
- 재생성 프롬프트에는 `[EXPLORATION]`이 없고, `비상 열쇠` 수량은 1로 유지됐다.

## 라운드

1. 현이 `중앙홀`, 도윤 `기록실`, risk 3, flags 없음. 입구에서 서로 다른 갈림.
2. 현이 `기록실`, 도윤 `남쪽복도`, risk 8. flags: `단서: 출구 빗장은 경보 후에만 풀린다`, `위험 고조`.
3. 현이 `기록실`, 도윤 `보관실`, risk 11. 물자 `비상 열쇠` 수량 합 1.
4. 현이 `기록실`, 도윤 `경보실`, risk 16.
5. 같은 자리. GM은 탐험 블록 없는 plain. 이 완료 라운드에서 `경보 방어장치` 1타, 경보실 시트의 HP 감소.
6. 현이 `남쪽복도`, 도윤 `경보실`, risk 19.
7. 현이 `출구`, 도윤 `경보실`, risk 20.
8. 현이가 출구에서 다시 일반 조사. risk 21. 공개 이벤트 수와 열쇠 수량은 늘지 않음.

## GM에 넘긴 서버 문장

```
[EXPLORATION — server resolved this round. Narrate these facts. Do not invent another clue, item, or secret passage.]
현이: searched 기록실 (normal) and found this clue exactly once: "출구 빗장은 경보가 울린 뒤에만 풀린다". Do not invent another clue.
```

## 다음 라운드 동료 기억

```
flags: 단서: 출구 빗장은 경보 후에만 풀린다; 위험 고조
```

## 실패 조사

같은 파일의 실패 케이스. d20 1, tier `CRITICAL_FAILURE`, final 2. 조사+이동을 제출해도 위치는 `현관홀`, 단서는 공개되지 않고, 그 라운드 행동력은 차감된 채 다음 라운드에 3으로 회복된다. 없는 방과 4칸 이동은 잠금 전에 거절된다.

## 화면

아래 이미지는 제품 라우트에서 제거하기 전의 미리보기 페이지(`/trpg/exploration-v1-preview`) 증거다. 그 페이지는 고정 시드의 방 이름과 단서·물자 표시를 공개 경로로 그렸으므로 실서비스 라우트에서 뺐다. 게임방 화면이 아니다. 폭 390과 1440.

- `390-collapsed.png` `1440-collapsed.png` 접힌 지도
- `390-unexplored.png` `1440-unexplored.png` 미탐색 갈림
- `390-discovered.png` `1440-discovered.png` 단서·물자·위험·출구
- `390-queued.png` `1440-queued.png` 이동+조사 대기열
- `390-short.png` `1440-short.png` 행동력 부족
- `390-clicked-queue.png` 접힌 상태에서 펼친 뒤 방과 조사를 눌러 대기열을 만든 결과

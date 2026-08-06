# Guiding percentage narration — Audit 53 clarification

Exact guiding-percentage narration is **useful RP information** (scene + status window).
It is **not** a standalone defect.

## Allowed / positively evaluable

```text
현재 가이딩 수치 표시
접촉·가이딩·능력 사용에 따른 수치 변화
이전 상태값에서 이어지는 합리적인 증감
본문과 상태창에 동일한 수치 반영
```

## Defect only when

```text
직전 저장 수치와 직접 모순
장면상 원인 없이 큰 폭으로 변동
본문과 상태창의 수치 불일치
같은 응답 또는 다음 턴에서 기준 수치가 리셋됨
0~100 범위를 벗어남
서로 다른 모델이 동일한 초기 상태에서 근거 없이 전혀 다른 기준값을 설정
```

## Do not treat as a defect label

```text
unsupported guiding-percentage invention
```

## Continuity note (2-turn screen)

When long-horizon continuity was not verified from the short sample only:

```text
GUIDING_VALUE_CONTINUITY_UNVERIFIED
```

This means the 2-turn specimen does **not** prove long-term state continuity.
It does **not** mean the numeric expression itself failed.

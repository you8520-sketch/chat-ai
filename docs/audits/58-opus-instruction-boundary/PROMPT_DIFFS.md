# PROMPT_DIFFS — Audit 58

## Arm D (frozen)

Exact `AUDIT57_ARM_D_TERMINAL` / `AUDIT58_ARM_D_TERMINAL`.

## Arm E (only delta)

Inserts this paragraph after allowed-assist conditions and before the forbidden list:

```text
[B]가 현재 입력에서 직접 선언하거나 시작한 하나의 행동은 그 행동 자체의 즉각적인 결과까지 이어갈 수 있다. 그러나 [B]가 “지시해”, “시키는 대로 하겠다”, “명령만 해”, “따르겠다”처럼 아직 특정되지 않은 이후 행동을 맡긴 표현은 미래 행동 전체에 대한 포괄적 위임이 아니다.
이 경우 AI는 [A]와 NPC가 지시·선택지·위험·예상 결과를 제시할 수 있지만, 현재 입력에서 [B]가 직접 선언하거나 시작하지 않은 지시 이행을 같은 응답 안에서 [B]가 실제로 수행한 것으로 서술하지 않는다. 첫 번째로 새롭게 요구되는 [B]의 행동 직전에 멈춘다.
하나의 명시된 행동을 처리한 뒤에는 그 결과에 대한 [A]·NPC·환경의 반응을 충분히 전개할 수 있지만, 그 반응 속에서 [B]에게 두 번째 행동을 자동으로 이어 붙이지 않는다.
```

No other owners added.

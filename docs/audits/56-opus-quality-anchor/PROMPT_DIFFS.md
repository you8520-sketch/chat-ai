# PROMPT_DIFFS — Audit 56

## Arm A → Arm B

Remove exactly:

```text
이번 응답은 한국어 3,200~4,200자 범위의 하나의 밀도 있는 장면으로 전개한다. 현재 상호작용을 요약하거나 성급히 닫지 말고, 관찰·행동·대사·감각·심리가 서로 다음 변화를 일으키도록 충분히 전개한다.
```

Replace with exactly:

```text
현재 장면에서 하나 이상의 의미 있는 변화와 그에 대한 인물의 반응까지 전개하고, 유저가 다음 행동을 선택할 수 있는 지점에서 멈춘다. 요약·예고·메타 해설은 쓰지 않는다.
```

No other owners added.

## Arm A → Arm C

Drop production scaffolding (Korean prose top, contamination guard, prose-style XML, layout system blocks, numeric length, collaborative title block as production-shaped, etc.).

Keep:
1. character core canon
2. selected persona
3. needed world canon
4. recent dialogue
5. current user input
6. minimal RP contract (see live script constant `AUDIT56_OPUS_NATIVE_MINIMAL_CONTRACT`)

## Hashes

Per-turn `prompt_hash` / `recent_history_hash` / `setting_hash` / `greeting_hash` are stored in live meta JSON under `/opt/cursor/artifacts/opus-quality-anchor/live/`.

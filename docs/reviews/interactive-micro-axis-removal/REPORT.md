# Interactive MICRO_MOTION: stop printing the content-blind progression axis

Base: `origin/main` `05f5220e77c634840353cfed25b2d1ff2a4b943f`. No paid provider call. Cursor does not score prose.

## Wire (Q5 fixture `NEW_CONTROLLED_FIXTURE_NOT_1545_PARITY`, DeepSeek and Claude)

Main BEFORE request == archived #1550 BEFORE request (byte-equal JSON). AFTER differs from BEFORE by exactly one removed system line:

```
- 허용된 변화: 환경 변화
```

`wire/*.AFTER.request.json` are the exact AFTER request bodies (public-safe, no credentials). Compact-JSON sha256: DeepSeek `fa9d0976bfb6f7edc5364f70127ba276c5b4e1c7abba3afc911a9bd6f5104950`, Claude `6a00921a7a1134e800966b7d5dc60fbfe6b7da5d1a8e89fe19c10236c26110fe`.

## Deterministic evidence

Real `buildSceneDirective` over 400 (chat, turn) seeds with the lobby history:

- Q1 (quiet), Q3 (siren), Q5 (fear) all resolve to `MICRO_MOTION`, scene kind `neutral`, and the identical axis distribution `environment 121 / daily_life 89 / relationship 81 / lore_clue 58 / consequence 28 / comedy 23`. The axis never reads the user turn.
- For `무서워. 그래도 안 갈게.` only 20% of draws are `관계 변화`; 15% print `단서`, 6% print `개그/오해`, 22% print `생활 변수`, 30% `환경 변화`.
- At the Phase 2 seed (chat 18, turn 2) every scene Q1-Q8 prints `환경 변화`.

## Token estimate (`estimateTokens`)

| item | before | after |
|---|---:|---:|
| `[COMMON PROSE]` | 584 | 584 |
| `[SCENE PACING]` cue | 117 | 104 |
| DeepSeek system | 6002 | 5989 |
| DeepSeek total input | 7158 | 7145 |
| Claude system | 5869 | 5857 |
| Claude total input | 7021 | 7008 |
| DeepSeek-only style line (`Qwen/DeepSeek 보강`) | 56 | 56 |
| creator note empty / whitespace | 0 / 0 | 0 / 0 |
| creator note present (249-char sample) | +530 | +530 |

Net: -13 est. tokens per Main RP interactive MICRO turn. Duplicate owners (`[COMMON PROSE]`, `[SCENE PACING]`, `3,200자 이상` sentence, creator block) stay at 1 each; `허용된 변화` in standard interactive MICRO goes 1 to 0.

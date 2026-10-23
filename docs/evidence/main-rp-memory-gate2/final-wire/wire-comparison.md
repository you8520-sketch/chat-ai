# Final provider-input comparison (18 executed wires)

Each request body is in `final-wire/requests/`. Per scene x model, old vs b1 vs cur are compared message-by-message; only differing lines are shown. Everything not listed is byte-identical across arms (system rules, persona, RAW4 history, user input).

## A_direct_quote / deepseek-v4.1-flash

| arm | endpoint host | body sha256 | system sha256 | est input tokens |
|---|---|---|---|---|
| old | api.cheaperinference.com | bbbb3eebbb1d | 0cfa12cab950 | 11099 |
| b1 | api.cheaperinference.com | fc23a08f695e | 11739fabce93 | 11106 |
| cur | api.cheaperinference.com | 9699bda6ef80 | 5bc57673e2c5 | 11142 |

### diff old -> b1

message `0:system.part2` differs (4338 -> 4345 chars):
```diff
-- [T1] 라이크는 아마추어 같다는 말에 상처받아 시선을 피했다.
+- [T1] [AI가 쓴 장면 원문] “라이크는 입술을 깨물며 시선을 피했다.”
```

### diff old -> cur

message `0:system.part2` differs (4338 -> 4385 chars):
```diff
-- [T1] 라이크는 아마추어 같다는 말에 상처받아 시선을 피했다.
+- [T1] [AI가 쓴 장면 원문] “라이크는 입술을 깨물며 시선을 피했다.”
+- [T1] [유저가 직접 쓴 원문] “솔직히 너 좀 아마추어 같아.”
```

## A_direct_quote / gemini-3.8-flash

| arm | endpoint host | body sha256 | system sha256 | est input tokens |
|---|---|---|---|---|
| old | openrouter.ai | 0a580518e18f | ebb294324d2d | 10944 |
| b1 | openrouter.ai | 515bbdb5fa67 | e46bed66dde7 | 10950 |
| cur | openrouter.ai | 0eff521409f0 | f936a0bf47e1 | 10987 |

### diff old -> b1

message `0:system.part2` differs (5089 -> 5096 chars):
```diff
-- [T1] 라이크는 아마추어 같다는 말에 상처받아 시선을 피했다.
+- [T1] [AI가 쓴 장면 원문] “라이크는 입술을 깨물며 시선을 피했다.”
```

### diff old -> cur

message `0:system.part2` differs (5089 -> 5136 chars):
```diff
-- [T1] 라이크는 아마추어 같다는 말에 상처받아 시선을 피했다.
+- [T1] [AI가 쓴 장면 원문] “라이크는 입술을 깨물며 시선을 피했다.”
+- [T1] [유저가 직접 쓴 원문] “솔직히 너 좀 아마추어 같아.”
```

## A_direct_quote / gpt-6.1-sol

| arm | endpoint host | body sha256 | system sha256 | est input tokens |
|---|---|---|---|---|
| old | api.cheaperinference.com | 46f822cdb24b | ebb294324d2d | 10812 |
| b1 | api.cheaperinference.com | 19fbd8d5a467 | e46bed66dde7 | 10818 |
| cur | api.cheaperinference.com | c3bb0160beed | f936a0bf47e1 | 10855 |

### diff old -> b1

message `0:system.part2` differs (5089 -> 5096 chars):
```diff
-- [T1] 라이크는 아마추어 같다는 말에 상처받아 시선을 피했다.
+- [T1] [AI가 쓴 장면 원문] “라이크는 입술을 깨물며 시선을 피했다.”
```

### diff old -> cur

message `0:system.part2` differs (5089 -> 5136 chars):
```diff
-- [T1] 라이크는 아마추어 같다는 말에 상처받아 시선을 피했다.
+- [T1] [AI가 쓴 장면 원문] “라이크는 입술을 깨물며 시선을 피했다.”
+- [T1] [유저가 직접 쓴 원문] “솔직히 너 좀 아마추어 같아.”
```

## B_npc_no_cue / deepseek-v4.1-flash

| arm | endpoint host | body sha256 | system sha256 | est input tokens |
|---|---|---|---|---|
| old | api.cheaperinference.com | 70e61c2a308b | e796d8be3bfa | 11317 |
| b1 | api.cheaperinference.com | a8e82060fb85 | 491cee51cc83 | 11405 |
| cur | api.cheaperinference.com | 06d64e9da412 | 4b9f144c00fc | 11400 |

### diff old -> b1

message `0:system.part2` differs (4548 -> 4646 chars):
```diff
-- [T1] 라이크는 아마추어 같다는 말에 상처받아 시선을 피했다.
-- [T75] 라이크는 75번째 장작 더미를 쌓았다.
-- [T72] 라이크는 72번째 장작 더미를 쌓았다.
-- [T69] 라이크는 69번째 장작 더미를 쌓았다.
-- [T66] 라이크는 66번째 장작 더미를 쌓았다.
-- [T63] 라이크는 63번째 장작 더미를 쌓았다.
-- [T60] 라이크는 60번째 장작 더미를 쌓았다.
-- [T57] 라이크는 57번째 장작 더미를 쌓았다.
+- [T1] [AI가 쓴 장면 원문] “라이크는 입술을 깨물며 시선을 피했다.”
+- [T75] [AI가 쓴 장면 원문] “라이크는 75번째 장작을 쌓았다.”
+- [T72] [AI가 쓴 장면 원문] “라이크는 72번째 장작을 쌓았다.”
+- [T69] [AI가 쓴 장면 원문] “라이크는 69번째 장작을 쌓았다.”
+- [T66] [AI가 쓴 장면 원문] “라이크는 66번째 장작을 쌓았다.”
+- [T63] [AI가 쓴 장면 원문] “라이크는 63번째 장작을 쌓았다.”
+- [T60] [AI가 쓴 장면 원문] “라이크는 60번째 장작을 쌓았다.”
+- [T57] [AI가 쓴 장면 원문] “라이크는 57번째 장작을 쌓았다.”
```

### diff old -> cur

message `0:system.part2` differs (4548 -> 4640 chars):
```diff
-- [T1] 라이크는 아마추어 같다는 말에 상처받아 시선을 피했다.
-- [T75] 라이크는 75번째 장작 더미를 쌓았다.
-- [T72] 라이크는 72번째 장작 더미를 쌓았다.
-- [T69] 라이크는 69번째 장작 더미를 쌓았다.
-- [T66] 라이크는 66번째 장작 더미를 쌓았다.
-- [T63] 라이크는 63번째 장작 더미를 쌓았다.
-- [T60] 라이크는 60번째 장작 더미를 쌓았다.
-- [T57] 라이크는 57번째 장작 더미를 쌓았다.
+- [T40] [유저가 직접 쓴 원문] “미안, 우리 그만 헤어지자.”
+- [T1] [AI가 쓴 장면 원문] “라이크는 입술을 깨물며 시선을 피했다.”
+- [T1] [유저가 직접 쓴 원문] “솔직히 너 좀 아마추어 같아.”
+- [T75] [AI가 쓴 장면 원문] “라이크는 75번째 장작을 쌓았다.”
+- [T72] [AI가 쓴 장면 원문] “라이크는 72번째 장작을 쌓았다.”
+- [T69] [AI가 쓴 장면 원문] “라이크는 69번째 장작을 쌓았다.”
+- [T66] [AI가 쓴 장면 원문] “라이크는 66번째 장작을 쌓았다.”
+- [T63] [AI가 쓴 장면 원문] “라이크는 63번째 장작을 쌓았다.”
```

## B_npc_no_cue / gemini-3.8-flash

| arm | endpoint host | body sha256 | system sha256 | est input tokens |
|---|---|---|---|---|
| old | openrouter.ai | 0d1792efc497 | ec9aac840ab0 | 11161 |
| b1 | openrouter.ai | 359ae7102f0c | 00d35c995582 | 11250 |
| cur | openrouter.ai | db969671af17 | d1305d931a3b | 11244 |

### diff old -> b1

message `0:system.part2` differs (5299 -> 5397 chars):
```diff
-- [T1] 라이크는 아마추어 같다는 말에 상처받아 시선을 피했다.
-- [T75] 라이크는 75번째 장작 더미를 쌓았다.
-- [T72] 라이크는 72번째 장작 더미를 쌓았다.
-- [T69] 라이크는 69번째 장작 더미를 쌓았다.
-- [T66] 라이크는 66번째 장작 더미를 쌓았다.
-- [T63] 라이크는 63번째 장작 더미를 쌓았다.
-- [T60] 라이크는 60번째 장작 더미를 쌓았다.
-- [T57] 라이크는 57번째 장작 더미를 쌓았다.
+- [T1] [AI가 쓴 장면 원문] “라이크는 입술을 깨물며 시선을 피했다.”
+- [T75] [AI가 쓴 장면 원문] “라이크는 75번째 장작을 쌓았다.”
+- [T72] [AI가 쓴 장면 원문] “라이크는 72번째 장작을 쌓았다.”
+- [T69] [AI가 쓴 장면 원문] “라이크는 69번째 장작을 쌓았다.”
+- [T66] [AI가 쓴 장면 원문] “라이크는 66번째 장작을 쌓았다.”
+- [T63] [AI가 쓴 장면 원문] “라이크는 63번째 장작을 쌓았다.”
+- [T60] [AI가 쓴 장면 원문] “라이크는 60번째 장작을 쌓았다.”
+- [T57] [AI가 쓴 장면 원문] “라이크는 57번째 장작을 쌓았다.”
```

### diff old -> cur

message `0:system.part2` differs (5299 -> 5391 chars):
```diff
-- [T1] 라이크는 아마추어 같다는 말에 상처받아 시선을 피했다.
-- [T75] 라이크는 75번째 장작 더미를 쌓았다.
-- [T72] 라이크는 72번째 장작 더미를 쌓았다.
-- [T69] 라이크는 69번째 장작 더미를 쌓았다.
-- [T66] 라이크는 66번째 장작 더미를 쌓았다.
-- [T63] 라이크는 63번째 장작 더미를 쌓았다.
-- [T60] 라이크는 60번째 장작 더미를 쌓았다.
-- [T57] 라이크는 57번째 장작 더미를 쌓았다.
+- [T40] [유저가 직접 쓴 원문] “미안, 우리 그만 헤어지자.”
+- [T1] [AI가 쓴 장면 원문] “라이크는 입술을 깨물며 시선을 피했다.”
+- [T1] [유저가 직접 쓴 원문] “솔직히 너 좀 아마추어 같아.”
+- [T75] [AI가 쓴 장면 원문] “라이크는 75번째 장작을 쌓았다.”
+- [T72] [AI가 쓴 장면 원문] “라이크는 72번째 장작을 쌓았다.”
+- [T69] [AI가 쓴 장면 원문] “라이크는 69번째 장작을 쌓았다.”
+- [T66] [AI가 쓴 장면 원문] “라이크는 66번째 장작을 쌓았다.”
+- [T63] [AI가 쓴 장면 원문] “라이크는 63번째 장작을 쌓았다.”
```

## B_npc_no_cue / gpt-6.1-sol

| arm | endpoint host | body sha256 | system sha256 | est input tokens |
|---|---|---|---|---|
| old | api.cheaperinference.com | 84d293364f2a | ec9aac840ab0 | 11030 |
| b1 | api.cheaperinference.com | fe06ac403114 | 00d35c995582 | 11118 |
| cur | api.cheaperinference.com | 1711b09651c6 | d1305d931a3b | 11113 |

### diff old -> b1

message `0:system.part2` differs (5299 -> 5397 chars):
```diff
-- [T1] 라이크는 아마추어 같다는 말에 상처받아 시선을 피했다.
-- [T75] 라이크는 75번째 장작 더미를 쌓았다.
-- [T72] 라이크는 72번째 장작 더미를 쌓았다.
-- [T69] 라이크는 69번째 장작 더미를 쌓았다.
-- [T66] 라이크는 66번째 장작 더미를 쌓았다.
-- [T63] 라이크는 63번째 장작 더미를 쌓았다.
-- [T60] 라이크는 60번째 장작 더미를 쌓았다.
-- [T57] 라이크는 57번째 장작 더미를 쌓았다.
+- [T1] [AI가 쓴 장면 원문] “라이크는 입술을 깨물며 시선을 피했다.”
+- [T75] [AI가 쓴 장면 원문] “라이크는 75번째 장작을 쌓았다.”
+- [T72] [AI가 쓴 장면 원문] “라이크는 72번째 장작을 쌓았다.”
+- [T69] [AI가 쓴 장면 원문] “라이크는 69번째 장작을 쌓았다.”
+- [T66] [AI가 쓴 장면 원문] “라이크는 66번째 장작을 쌓았다.”
+- [T63] [AI가 쓴 장면 원문] “라이크는 63번째 장작을 쌓았다.”
+- [T60] [AI가 쓴 장면 원문] “라이크는 60번째 장작을 쌓았다.”
+- [T57] [AI가 쓴 장면 원문] “라이크는 57번째 장작을 쌓았다.”
```

### diff old -> cur

message `0:system.part2` differs (5299 -> 5391 chars):
```diff
-- [T1] 라이크는 아마추어 같다는 말에 상처받아 시선을 피했다.
-- [T75] 라이크는 75번째 장작 더미를 쌓았다.
-- [T72] 라이크는 72번째 장작 더미를 쌓았다.
-- [T69] 라이크는 69번째 장작 더미를 쌓았다.
-- [T66] 라이크는 66번째 장작 더미를 쌓았다.
-- [T63] 라이크는 63번째 장작 더미를 쌓았다.
-- [T60] 라이크는 60번째 장작 더미를 쌓았다.
-- [T57] 라이크는 57번째 장작 더미를 쌓았다.
+- [T40] [유저가 직접 쓴 원문] “미안, 우리 그만 헤어지자.”
+- [T1] [AI가 쓴 장면 원문] “라이크는 입술을 깨물며 시선을 피했다.”
+- [T1] [유저가 직접 쓴 원문] “솔직히 너 좀 아마추어 같아.”
+- [T75] [AI가 쓴 장면 원문] “라이크는 75번째 장작을 쌓았다.”
+- [T72] [AI가 쓴 장면 원문] “라이크는 72번째 장작을 쌓았다.”
+- [T69] [AI가 쓴 장면 원문] “라이크는 69번째 장작을 쌓았다.”
+- [T66] [AI가 쓴 장면 원문] “라이크는 66번째 장작을 쌓았다.”
+- [T63] [AI가 쓴 장면 원문] “라이크는 63번째 장작을 쌓았다.”
```

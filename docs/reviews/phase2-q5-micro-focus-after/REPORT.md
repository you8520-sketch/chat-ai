# #1550 Q5 AFTER — Option 2 evidence (unscored)

Label: `NEW_CONTROLLED_FIXTURE_NOT_1545_PARITY`

- Branch HEAD: `d5982c70cf45c9747fbb815b3f03183699f56279` (`cursor/scene-pacing-micro-focus-d352`)
- Fixture: `fixture.json` (public-safe card fields only; 렌 = name/gender only; no 2026-08 `characterId=10` card; the live assembler auto-adds `facial_hair=none; body_hair=none` to the card in the wire; it is present in both BEFORE and AFTER)
- Scope: this is a newly assembled fixture, not byte parity with #1545. The #1545 BEFORE texts are historical references only. No causal claim is made.
- Cursor did not score or judge prose quality. Prose improvement is unproven.

## Wire diff (BEFORE = base `sceneDirective.ts`, AFTER = branch HEAD)

Both models differ by exactly one line (`onlyDifferenceIsContractLine: true`, see `pairwise-preflight.json`):

```
- 허용된 변화: 환경 변화
+ 전개 초점: 환경 변화 (인물의 반응·판단·행동·관계 흐름은 현재 상호작용에 맞게 이어간다)
```

Routing, model adapter, length owner, authoring policy, history and user message are identical. `max_tokens` absent, `stream:false`.

Request files are in `wire/`. SHA-256 of each file as committed:

| file | sha256 |
| --- | --- |
| `wire/deepseek-v4.1-flash.BEFORE.request.json` | `0468f19ed58e50c46320ab569b6eb8ad0296e13bf7da36665f1e50a4d3732b49` |
| `wire/deepseek-v4.1-flash.AFTER.request.json` | `0dec66e3a0c9436d4f54db423b5be4c59ff79033fcf99cef7025e1bfa8edba77` |
| `wire/claude-opus-5.5.BEFORE.request.json` | `d9b9b05896fac6b2986cf10da96280cd50c99441988047f4d15f4876b81d07eb` |
| `wire/claude-opus-5.5.AFTER.request.json` | `e65c15eb003dfec7c2e770934f92abe0e7e94efa7d64cec4daaaf43fd52069e4` |

`calls.json` also records `afterWireSha256` as the hash of the compact `JSON.stringify` body actually POSTed (different serialization from the pretty-printed files above).

## Paid calls (AFTER only; BEFORE was not called)

Attempts: 2 of 2 authorized, no retries, no errors.

| model | HTTP | finish | prompt tok | completion tok | billed USD | raw chars | seconds |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `deepseek-v4.1-flash` | 200 | stop | 4449 | 746 | 0.000557 | 929 | 8.1 |
| `claude-opus-5.5` | 200 | stop | 6562 | 4324 | 0.075789 | 3104 | 58.4 |

Total about USD 0.0763.

## Verbatim outputs

- `deepseek-v4.1-flash-Q5-after-1550.txt` — sha256 `e84e852a39ee7d7c61134e22ebc7fd90893564c31732c5e2543a343ca2d6fc5c`
- `claude-opus-5.5-Q5-after-1550.txt` — sha256 `16a078a96fd23f913d01eb113bb272618dfcc7028a6f069b036732490e9d06b7`

Note: the DeepSeek output (929 chars) and Claude output (3104 chars) are both below / near the 3,200 soft target. The target has no cap and no floor enforcement on this path; this report does not interpret that.

STOP: no further calls, no merge. Awaiting GPT review.

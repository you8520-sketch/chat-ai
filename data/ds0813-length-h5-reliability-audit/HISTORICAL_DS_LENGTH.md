# 1. Historical DeepSeek length owner (PR #455)

Frozen from PR #455. Not restored into production injection.

## Provenance

| Field | Value |
|---|---|
| Symbol | `DEEPSEEK_LENGTH_SINGLE_CALL_BLOCK` |
| File | `src/lib/deepseekPromptStructure.ts` |
| Introduced | `53efcab01ab86c9b1485b9e10c1c9e46a400f939` |
| Removed from production injection | `64d6c47ce761eba46dc88ec2158a9cfbdd18be0a` |
| Exact text SHA256 | `d959d89100021506be6c1fcc1efe4182722c2a2a1e855c18b640a55113262183` |
| Historical placement | current user-turn **prefix**, after `DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY` via `prependDeepSeekBottomReminder` |

Exact text:

```
[DEEPSEEK LENGTH — SINGLE CALL]
Complete the requested narrative depth in this single response. Obey TARGET_LENGTH / MINIMUM_FLOOR independently of the length of recent messages; never imitate a short prior assistant reply as the desired response length.
```

## Visible-char evidence (same fixtures; length block was the variable)

Historical baseline visible chars: `1339` / `2258` / `2159`  
Historical rescue visible chars: `3893` / `4939` / `3821`

Rescue finish_reason: all `stop`. Rescue latency much higher (82–153s) than baseline (28–44s).

`HISTORICAL_DS_LENGTH_OWNER_EFFECT_PROVEN=true`

Do **not** restore this block yet. Its `TARGET_LENGTH` / `MINIMUM_FLOOR` wording belongs to an older prompt architecture. Current production length owner is `USER_TAIL_LENGTH_OWNER_SENTENCE` (see `LENGTH_OWNER_MAP.json`).

Source files: `historical/pr455/`.

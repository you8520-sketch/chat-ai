# Legacy novel callers

## Live production UI/API

```text
live callers sending novelModeEnabled=true: NONE
```

| Surface | Behavior |
|---|---|
| Chat UI `send()` | field absent |
| Chat UI `sendContinue()` | `isContinue: true` only |
| Chat UI `regenerate()` | field absent |
| `/api/chat` | reads legacy body/prefs → normalizes to `autoContinue`; sets `novelModeEnabled=false` for builders |
| Model picker snapshot | hardcoded `false` |
| `users.chat_prefs.novelModeEnabled` | may still be `true` in DB — normalized at request boundary; **no DB migration** |
| `chats.novel_mode` | column does not exist |

## Normalization

```text
legacy novelModeEnabled=true
→ autoContinue=true (runtime + noGodmodding)
→ novelModeEnabled=false (prompt builders)
→ never inject [USER CONTROL MODE - NOVEL / EXPLICIT FULL]
```

## Tests / harnesses

Historical tests that asserted a dormant `novel` NoGodmoddingMode or `explicit_full` co-narration mode are updated to expect autoContinue compatibility.

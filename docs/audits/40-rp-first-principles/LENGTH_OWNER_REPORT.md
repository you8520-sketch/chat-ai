# Length owner report (DeepSeek V4 Pro · Turn 1)

| owner | present | location | sha256 |
|---|---|---|---|
| `DEEPSEEK_BOTTOM_REMINDER_LENGTH` | true | final_user_message | `9031f97ab159c55e` |
| `DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA` | true | final_user_message | `84df294d37528509` |
| `USER_TAIL_LENGTH_OWNER_SENTENCE` | true | final_user_message | `122fece4c53d8a71` |

**terminal length owner count (present):** 3

### Notes

- `DEEPSEEK_BOTTOM_REMINDER` still references `TARGET_LENGTH / MINIMUM_FLOOR` even though system numeric length owners are empty in production.
- `DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA` fires on thin/new chats (no prior assistant avg ≥ 2200 no-ws).
- `USER_TAIL_LENGTH_OWNER_SENTENCE` is the absolute user-turn end numeric band (3,200~4,200).

`MULTIPLE_TERMINAL_LENGTH_OWNERS=true` → live factorial blocked until a single-owner canary lands.
# T50-C2 input precheck (before paid calls)

| Check | Result |
|---|---|
| Code SHA | `932eedccf92f1bc2c4b69332270e841b9ee82240` (`origin/main`) |
| Isolated DB | `/tmp/b9-preserved/db/snap-50/app.db` (B9-1 preserved snap) |
| Character / persona | 18 라이크 / persona 1 렌 |
| Route | SAFE / NORMAL Main RP |
| Memory policy | `summary5_raw4`, `message_count=50`, `summarized_turn_count=45` |
| User question | `지환이가 마지막에 나한테 뭐라고 했었는지… 너 기억나?` (from B9-1 `questions.json`) |
| `chat_memories.recent_summary` length | 3043 |
| Literal `감사했습니다` in stored Global | **absent** (sqlite `LIKE` on `chat_memories` for `chat_id=1`) |
| B9-1 primary failure quote in stored memory | **absent** (`가이드님, 감사했습니다.` — see #1681 / `t50-c2-gemini.txt`) |

**Limits:** Original B9-1 `main-request.json` was not archived. This run fixes one reconstructed A wire body (`49475a3d…`) for all three A calls; it is not claimed byte-identical to the historical B9-1 POST.

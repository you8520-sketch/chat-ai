# TRPG Post-#810 Real Provider Quality — REVIEW_PACKET

Main: `80140cf8afc59de38d849eb9323e7ccdf32ea3fb`

## Provider call ledger
| Seq | Role | Model | Attempt | max_tokens | Input tok | Output tok | finishReason | semanticDone | elapsedMs |
| --- | ---- | ----- | ------: | ---------: | --------: | ---------: | ------------ | ------------ | --------: |
| 1 | gm_opening | gemini-3.7-flash | 1 | 65536 | 4027 | 1743 | stop | true | 25288 |
| 2 | bot_1 | gemini-3.7-flash | 1 | 65536 | 2537 | 372 | null | null | 19171 |
| 3 | bot_2 | gemini-3.7-flash | 1 | 65536 | 2585 | 330 | null | null | 18377 |
| 4 | gm_normal | gemini-3.7-flash | 1 | 65536 | 6749 | 1228 | stop | true | 23305 |

Note: `bot_1` / `bot_2` follow `orderTrpgBotsForRound` speak order. This sample: bot_1=강이현, bot_2=권태현.

## Mechanical facts (Cursor does not score quality)
- REAL_PROVIDER_CALLS = 4
- OPENING_TOTAL_MS = 25320
- NORMAL_ROUND_TOTAL_MS = 60884
- OPENING_NARRATOR_FORMAL_POLITE_MATCHES = 0
- NORMAL_NARRATOR_FORMAL_POLITE_MATCHES = 0
- CHARACTER_A_CANON_PRESENT_IN_FINAL_GM_INPUT = true
- CHARACTER_B_CANON_PRESENT_IN_FINAL_GM_INPUT = true
- CHARACTER_WORLD_IMPORTED_TO_GM = false
- BOT_FULL_CAMPAIGN_WORLD_PRESENT = true
- BOT_APPLICATION_PROSE_HARD_CLIP_OBSERVED = false
- TRUNCATION_OBSERVED = false
- BLUEPRINT_PROVIDER_CALL = false

### Opening narrator formal-polite matches (excluding quoted dialogue)
(none detected)

### Sample opening narrator lines (for GPT Q4)
- `잿빛 하늘은 늘 그렇듯 낮과 밤의 경계를 지워버린 채 무겁게 가라앉아 있었다.`
- `렌은 손에 쥔 장비를 고쳐 잡으며 눈앞의 혼돈을 응시했다.`

### Sample character dialogue lines (for GPT Q5)
- 권태현: `"쯧, 경보가 울린 지 한참 된 것 같군…"`
- 강이현: `"…기다려 주십시오."` / `"좌측 제어반 부근은…"`

## Input canon → inspect frozen USER blocks
- GM opening user: `GM_OPENING_USER.txt`
- Bot 1 user: `BOT_1_USER.txt` (강이현)
- Bot 2 user: `BOT_2_USER.txt` (권태현)
- GM normal user: `GM_NORMAL_USER.txt`

## Raw outputs
- `GM_OPENING_RAW.txt` / `GM_OPENING_CANONICAL.txt`
- `BOT_1_RAW.txt` / `BOT_1_CANONICAL.txt`
- `BOT_2_RAW.txt` / `BOT_2_CANONICAL.txt`
- `GM_NORMAL_RAW.txt` / `GM_NORMAL_CANONICAL.txt`

## Bot evidence
- 강이현 (bot_1): rawChars=509, canonicalChars=509, finishReason=null, actionType=investigate, clippedAt800=false
- 권태현 (bot_2): rawChars=378, canonicalChars=378, finishReason=null, actionType=defend, clippedAt800=false

## GPT review questions (Q1–Q10)
See task spec — evaluate INPUT CANON vs RAW OUTPUT side by side. Cursor assigns no quality score.

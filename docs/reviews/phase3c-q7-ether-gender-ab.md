# PHASE 3C — Q7 에테르 성별 표기 A/B

Evidence only. Production prompts, routing, billing, and runtime code are unchanged. This note does not score prose and does not choose a better condition.

Live main: `5f3b02232b0fdbb9acef57fdae7c29112ba1ccfe` (`#1323` name-label fix is on this main).
Original Q7 output: [deepseek-v4.1-flash/Q7-auto.txt](https://github.com/you8520-sketch/chat-ai/blob/cursor/rp-phase2d-review-evidence-46c3/docs/reviews/phase2/raw/deepseek-v4.1-flash/Q7-auto.txt) on PR #1318.
PR #1318 was not modified.

## BEFORE

The recorded DeepSeek Q7 auto scene is the dorm exchange. Prior history is the user line `창문 쪽에 같이 서 있자.` and the assistant lines `라이크는 유리에 이마를 기대며 하품했다.` / `졸려. 너는 그대로 있어.` The current user turn is the continue directive, not the display string `자동진행`.

The stored output names 조아인, codename 에테르, as the emergency-guide commander, then uses `그녀` for that character. The deployed card line for that NPC is `- **ID**: 36/M`. 조아연 is a separate NPC line `- **ID**: 41/F`.

## PROBLEM

`36/M` is still the only sex mark on 에테르 in the final prompt. A candidate that appends ` (남성)` does not stay a one-span edit: the character canon is already cut at 10,000 characters, so the five added characters remove the last five characters of that canon.

No provider call was made.

## OWNER MAP

- Final prompt assembly: `buildContext` in `src/services/contextBuilder.ts`.
- Chunk source: `loadCharacterChunksForPromptReadOnly` → `parseFreshCharacterChunks` → compiled public canon when `creator_compiled_description_json` is present. This fixture has that JSON. Raw `system_prompt` does not contain `36/M`.
- Canon cap: `buildCombinedCharacterSettingSource` in `src/utils/characterParser.ts` joins the safe runtime canon and slices to 10,000 characters.
- Active Main RP model: `deepseek-v4.1-flash` is in `MAIN_RP_USER_SELECTABLE_OPTIONS`, provider `cheaperinference`, and it is `DEFAULT_SELECTED_AI`. This is the current registry, not an assumption from the old Q7 run.
- Adapter: `assemblePrimaryRpRequest` then `adaptCheaperInferenceChatBody`. The built body is `model=deepseek-v4.1-flash`, `stream=true`, `temperature=0.92`, `top_p=0.92`, `thinking.type=disabled`, `reasoning_effort=none`, `stream_options.include_usage=true`. No `seed`. No `max_tokens`.
- Auto user tail: `buildContinueNarrativeCommand`. Its text matches the Q7 directive recorded on PR #1318, including the existing short reference about `[B]` authoring scope.
- NORMAL delegation used for assembly: persistent `chat_setting`, dialogue and major actions on, inner POV and irreversible fate off. Runtime mode `auto_progression`.
- Canon injection for this model and the recorded user/chat ids: `FULL_LEGACY`, rollout `D0`, layered canon off.
- Memory and length: this reconstruction uses the recorded two-turn history and empty long-term memory, matching the Q7 packet rather than a lived database chat. Length stays on the existing user-tail owner. No length section hash changed.
- Existing defense: there is no second NPC sex-label owner. `36/M` remains in the prompt once. `#1323` is intact: the prompt has `조태형 (코드네임: 라이크)` and does not have a second `[이름] 라이크` body.

`36/M` occurs once in `world`, once in the compiled public canon, and once in stored chunks. The final flat prompt contains it once.

## EXPERIMENT

In-memory only. The card file and the database were not written.

- CONTROL: fixture canon unchanged.
- CANDIDATE: the same ether ID line becomes `- **ID**: 36/M (남성)`. No new system rule. No second gender owner.

Assembly checks before any call:

| | CONTROL | CANDIDATE |
|---|---|---|
| chunks | 66, Korean | 66, Korean |
| `36/M` in final prompt | 1 | 1, with one `36/M (남성)` |
| `41/F` | 1 | 1 |
| `조태형 (코드네임: 라이크)` | 1 | 1 |
| second `[이름] 라이크` | absent | absent |
| flat sha256 | `69ddc34b13c4a77137bef76fd0655ea6f83add87312e4c5a41b0d89d29d6b8d2` | `610a840c7fbc0d1f84316e6b62fde502610bb9b5906b5230202ba2fdbb60014e` |
| `character-core-identity` sha256 | `0ff7d8b8157b2add40d40da018b4ca500cc72370a281584dfe01683c444cc323` | `b9f549b2de936246325a5c296b6f7e4f56cb0e928fd1bfc4403acdcd2bdf6291` |

The control core hash begins with the post-`#1323` reconstruction prefix `0ff7d8b8157b2add`. The only tracked section whose hash changes is `character-core-identity`. Request-body keys other than messages are identical.

The flat prompts are the same length, 18,694 characters. The only text difference is:

1. After the ether ID, CANDIDATE inserts ` (남성)`.
2. At the end of the 10,000-character canon, immediately before `[SCENARIO META`, CONTROL ends in `”, “왜` and CANDIDATE does not.

Direct cap check: both combined sources are exactly 10,000 characters. CONTROL tail is `무서웠는데.”, “왜`. CANDIDATE tail is `무서웠는데.` `41/F` remains inside both capped sources.

That tail change is outside the requested gender notation, so the provider was not called.

## RAW EVIDENCE

No new model output. The original Q7 text stays at the link above.

Provider metadata, tokens, and cost for new calls: none.

## UNCERTAINTY

Whether `36/M (남성)` would change 조아인's pronouns is unmeasured. A call on these two prompts would also change the last five characters of canon, so it would not isolate the sex label.

The recorded Q7 history was replayed with empty memory. A production chat that already has relationship memory was not replayed.

## COST

0 calls. 0 tokens. Estimated provider cost 0. The authorized ceiling was 8 calls. It was not used.

## CLASSIFICATION

`CALLS_WITHHELD_PROMPT_DIFF_NOT_ISOLATED`

The active model and cheaperinference route are confirmed. The ether `36/M` fact is still in the current prompt, and the `#1323` name result still matches the post-fix core hash. The candidate notation is not an isolated edit under the existing 10,000-character canon cap. No production change is included. GPT decides whether a later fix is warranted.

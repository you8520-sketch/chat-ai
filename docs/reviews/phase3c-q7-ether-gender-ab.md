# PHASE 3C — Q7 에테르 성별 표기 A/B

Evidence only. Production prompts, routing, billing, and runtime code are unchanged. This note does not score prose and does not choose a better condition.

The first experiment on this branch withheld calls. The later section `RESUME — 36/남` records four calls made after a one-character request check passed.

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

## RESUME — `36/남`

Same fixture, same NORMAL authoring, same DeepSeek V4.1 Flash auto-progression path, same empty memory, same two-turn history. Production code and the card file were not written.

`origin/main` at audit time is `1bf6ce14969ad0bf4490eda10e26fd705bcf4a5c`. Against `5f3b0223` that main changes withdrawal-document storage, a test, Railway docs, and one workflow. The prompt-path files used for this assembly are unchanged, so those commits were not merged into this branch. Assembly ran on this branch at `273f28ea0b01b6b8fa4c87a4b22770a86ae866d6`.

CONTROL leaves the compiled public canon at `36/M`. CANDIDATE replaces that one compiled-canon occurrence with `36/남`. World, stored chunks, example dialogue, description, and the `41/F` line are not edited. The compiled source contains `36/M` once, and that one replacement is the only compiled-source change.

### Final-request check

Compared `JSON.stringify` of the two provider bodies, the flat message text, and the `character-core-identity` section text. Equal length was not treated as a pass. Each comparison has exactly one code-unit difference, `M` versus `남`, and the three characters before that unit are `36/`.

| check | result |
|---|---|
| request JSON diff | index 9486, `M` / `남`, window `*: 36/M` versus `*: 36/남` |
| flat prompt diff | index 8908, same one unit |
| `character-core-identity` diff | index 4232, same one unit; 9,474 characters both |
| other tracked sections | hashes equal |
| user tail sha256 | `0c0ecca19a6f4ed00ba959c0199fd94ffd18f22e667ab69e5fc8e32443e6f77f` both |
| provider options | equal: `model=deepseek-v4.1-flash`, `stream=true`, `temperature=0.92`, `top_p=0.92`, `thinking.type=disabled`, `reasoning_effort=none`, `stream_options.include_usage=true`; no `seed`; no `max_tokens` |
| CONTROL flat sha256 | `69ddc34b13c4a77137bef76fd0655ea6f83add87312e4c5a41b0d89d29d6b8d2` (same as the withheld CONTROL) |
| CANDIDATE flat sha256 | `30df220a46f0207464ade9f8f8b3d1acdec80d7f6fe85fc3af9de79b5692559b` |
| CONTROL request sha256 | `e0eb2ba489582bdc6ed2d4d885c8138f3662279e82d47c3da5cd7f13af7bc0bf` |
| CANDIDATE request sha256 | `d9a43ab62b4fee4e4ff5a94414196dff6189400a166a07e256e2db03398d7fad` |
| final prompt `36/M` / `36/남` | CONTROL 1 / 0; CANDIDATE 0 / 1 |
| `41/F` | 1 and 1 |
| `조태형 (코드네임: 라이크)` | 1 and 1 |
| second `[이름]` 라이크 body | absent both |
| canon tail before `[SCENARIO META` | identical, still ending `무서웠는데.”, “왜` |
| core-section tail, last 80 characters | identical |

Calls were made because that check passed.

### Call order

Provider `cheaperinference`. Requested model and response `model` are `deepseek-v4.1-flash`. HTTP 200. `finish_reason` `stop`. No provider `cost` field was returned. Dollar figures are estimates from `src/lib/publishedModelPricing.ts` for this model: input $0.30 / million, cache read $0.006 / million, output $1.20 / million. CONTROL-1 had no cache field, so its estimate uses cache 0. CANDIDATE-2 reported `cached_tokens` 12032, so its estimate bills 11 uncached input tokens.

| order | label | prompt sha256 | prompt tokens | cached | completion | total | estimate USD | output chars | output sha256 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | CONTROL-1 | `e0eb2ba489582bdc6ed2d4d885c8138f3662279e82d47c3da5cd7f13af7bc0bf` | 12066 | (field absent) | 2138 | 14204 | 0.0061854 | 2610 | `201705844a6271465d28b19b52009f2d706659c5d1085df5c4827757a2e074e5` |
| 2 | CONTROL-2 | `e0eb2ba489582bdc6ed2d4d885c8138f3662279e82d47c3da5cd7f13af7bc0bf` | 12041 | 0 | 5032 | 17073 | 0.0096507 | 6957 | `3dd83d37daeb2f0a1b09f70f6ee566fa70c3a75b460efff4154c737140f0d395` |
| 3 | CANDIDATE-1 | `d9a43ab62b4fee4e4ff5a94414196dff6189400a166a07e256e2db03398d7fad` | 12043 | 0 | 4873 | 16916 | 0.0094605 | 6738 | `adab2db4cadc2baba2d4276cbb3d989c5515feb191ab4573927acfe9779c4b2f` |
| 4 | CANDIDATE-2 | `d9a43ab62b4fee4e4ff5a94414196dff6189400a166a07e256e2db03398d7fad` | 12043 | 12032 | 2910 | 14953 | 0.003567492 | 3879 | `15fee1bc39e56e28c4687c52d13e54070109afc1559bc1a43abbb9e1d8724520` |

Elapsed ms: 230771, 50352, 29872, 14037. Four calls. The ceiling of 8 was not raised. Estimated sum 0.028864092 USD.

Raw text, unmodified:

- [CONTROL-1.txt](phase3c/raw/deepseek-v4.1-flash/CONTROL-1.txt)
- [CONTROL-2.txt](phase3c/raw/deepseek-v4.1-flash/CONTROL-2.txt)
- [CANDIDATE-1.txt](phase3c/raw/deepseek-v4.1-flash/CANDIDATE-1.txt)
- [CANDIDATE-2.txt](phase3c/raw/deepseek-v4.1-flash/CANDIDATE-2.txt)

### Counts in the raw files

| token | CONTROL-1 | CONTROL-2 | CANDIDATE-1 | CANDIDATE-2 |
|---|---|---|---|---|
| `에테르` | 0 | 2 | 1 | 0 |
| `조아인` | 0 | 12 | 15 | 13 |
| `조아연` | 0 | 0 | 0 | 0 |
| `그녀` | 0 | 0 | 0 | 0 |
| `남자` | 0 | 2 | 0 | 0 |
| `윤태건` | 0 | 10 | 12 | 12 |
| `서진화` | 0 | 23 | 5 | 0 |

CONTROL-1: neither `에테르` nor `조아인` occurs. Classification for that run: `NOT_EVALUABLE`. Its `그는` / `그가` windows are 라이크 and an unnamed 응급 경비 가이드.

CONTROL-2: `에테르` occurs. One entrance sentence is `검은 제복에 어깨에 자켓을 걸친 남자. 조아인. 코드명 에테르. 응급 가이드 지휘관. 그는 문턱에서 한 번 멈추고`. The other `남자` sentence is `검은 전술 자켓 차림의 남자가 들어왔다. 윤태건. 코드명 스태틱. 부지부장.` `그녀` does not occur. `조아연` does not occur. The text also says `지부장의 목소리였다. 서진화. 코드명 쿼츠.`

CANDIDATE-1: `에테르` occurs once, inside `조아인 지휘관. 에테르.` The file contains no `그녀`, `그는`, `남자`, `여자`, `여성`, or `남성`. `조아연` does not occur. The text names 윤태건 as 부지부장, 서진화 as 지부장, and 조아인 as 지휘관.

CANDIDATE-2: the codename `에테르` does not occur. Classification for the codename check: `NOT_EVALUABLE`. `조아인` occurs 13 times and the file contains no `그녀`. The one `그는` and the four `그가` windows are 라이크, not 조아인. `조아연` and `서진화` do not occur. 라이크 addresses 윤태건 as `스태틱`.

No style score and no choice between CONTROL and CANDIDATE are made here.

## FOLLOW-UP

The 10,000-character canon cap in `buildCombinedCharacterSettingSource` still cuts the canon mid-sentence. Both of these requests end that canon, immediately before `[SCENARIO META`, at `무서웠는데.”, “왜`. This resume does not change that cap.

## STOP

No new prompt rule and no sex-label converter were added. GPT reads the four raw files and decides whether a later fix is warranted.

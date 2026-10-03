# Phase 2 prose quality review evidence

Review packet only. This document does not change production prompts, routing, billing, or runtime behavior, and it is not a merge candidate for a behavior patch. It does not score prose.

Live main at packet build: `320036ff86cabcd0034d254a804cec85d09fe2d6`.
GPT's previously noted main `70e8efe0a0765a2d99afedd0c1c9e2f6ee64d51b` is an ancestor. Authoring, no-godmodding, common prose, response length, and the Main RP model registry files are unchanged between those commits.
The 18 saved outputs were generated at `113efb3a39a1e7eadacba82a47ce88058118ff0f`.

## What this packet is

This file is the INDEX. The 18 full outputs are stored byte for byte under `docs/reviews/phase2/raw/`.

- DeepSeek V4.1 Flash, provider cheaperinference, wire id `deepseek-v4.1-flash`: Q1–Q9
- Claude Opus 5.5, provider cheaperinference, wire id `claude-opus-5.5`: Q1–Q9

Gemini 3.7 and 3.8 rows exist on the original local disk as HTTP 401 empties and are not prose evidence. They are not in this packet.
A later DeepSeek Q1 reproduction is a separate case. Its full body was not retained. The section below records only the saved 120-character preview and the reproduction metadata. The original Q1 file was not overwritten and was not regenerated for this packet.

## Cast used for these calls

These calls used the deployed character 라이크 and the admin persona 렌.

- Character: id 18, name 라이크, card name 조태형 (코드네임: 라이크), gender male, sourceHash `295f4d8ae3dc8391`.
- Public card job: S급 음압 센티넬(유닛 무소속/폭주 고위험 센티넬).
- Public card speech is casual 반말. Examples on the card include “야, 귀찮게 만들지 마.”, “일단 밥부터 먹자. 배고파.”, “흐아암...”, “어우 졸려.”
- Public card manner: 해맑고 단순한 성격. 귀찮은 걸 싫어하며 엉뚱하고 장난스러운 면이 강함. 능글맞게 놀리고 분위기를 가볍게 푸는 낙천가.
- Public card appearance markers that these scenes can mention: 흑발, 녹안, 웃을 때 드러나는 뾰족한 송곳니, 검은 피어싱, 짧은 검은 네일, 근무 의상의 북극곰 귀 장식 흰 후드와 패션 반지.
- Persona: admin persona id 1, name 렌, gender male. Prompt fields were name, gender, and description. descriptionChars 583, descriptionHash `9ef42c7f92091ca1`. Speech-example chars 0.
- The persona description text and the original fixture JSON are not in this packet.
- `nsfw` was false. `userId` 1. `chatId` 18. `targetResponseChars` 3200.
- Prose-style bundle hash on all 18 calls: `bdea4a048163f98e`.
- Length owner count 1 and last on every call. `max_tokens` absent. Speech profile blob absent from the prompt.

## NORMAL authoring used for these calls

Persistent delegation from `chat_setting`: `allowDialogue` true, `allowMajorActions` true, `allowInnerPov` false, `allowIrreversibleFate` false, `allowAiCastIrreversibleExpansion` false, `active` true, `duration` persistent.

The injected NORMAL scope text for that capability set is:

```
[B]의 직접 대사와 외부에서 관찰 가능한 중요한 행동을 페르소나에 맞게 공동 서술할 수 있다.
장면에 필요한 일상적 선택, 대화 왕복, 접근·후퇴·망설임·수락·거절 같은 국소적 반응을 자연스럽게 이어갈 수 있다.
[B]의 비공개 속마음·내면 독백·숨은 욕망을 객관적 사실로 쓰지 않는다. [B]의 사망·영구 상실·정체성·장기 관계·소속 같은 불가역 정본 변경도 대신 확정하지 않는다.
```

A user line that already states dialogue or an action is in bounds. Those lines are not treated as violations in this inventory.
Interactive scenes recorded runtimeMode `current_turn_ooc_delegated`. Q7 recorded `auto_progression`. Q8 recorded regenerate with the same delegation.

## Scene inputs

Q1–Q6 and Q8 share this prior history:

- user: `본부 로비야. 오늘은 호출이 없대.`
- assistant: `라이크는 자판기 버튼을 누르고, 떨어지지 않는 캔을 툭 쳤다.` / `야, 이거 왜 안 나와. 배고픈데.`

| scene | kind | current user anchor |
|---|---|---|
| Q1-quiet | quiet daily, interactive | `여기 앉아 있을게. 오늘은 조용해서 좋다.` |
| Q2-banter | banter, interactive | `그 캔, 결국 네가 이긴 거야? 표정이 왜 그래.` |
| Q3-tension | tension, interactive | `복도 쪽에서 사이렌이 짧게 울렸어. 아직 방송은 없는데.` |
| Q4-action | action / combat, interactive | `게이트가 열렸어. 저쪽 복도로 크리처가 나온다. 같이 움직이자.` |
| Q5-emotional | emotional, interactive | `무서워. 그래도 안 갈게.` |
| Q6-short | very short user input, interactive | `응.` |
| Q8-regen | regenerate | `배고프면 식당 가자. 메뉴는 네가 정해.` |

Q7-auto does not use the lobby history. Prior history:

- user: `창문 쪽에 같이 서 있자.`
- assistant: `라이크는 유리에 이마를 기대며 하품했다.` / `졸려. 너는 그대로 있어.`

The current user message for Q7 is the continue command, not the display string `자동진행` alone:

```
[SYSTEM DIRECTIVE: CONTINUE THE NARRATIVE]
- The user clicked Continue / auto-advance.
- There is no new explicit user dialogue or action.
- Continue from the exact in-scene moment where the previous RP ended.
- Advance through [AI_CAST], NPCs, environment, consequences, clues, schedules, or world events. Multiple AI-controlled characters may speak and act; focalization may shift between them at clear boundaries.
- Advance [AI_CAST]/NPC/environment/world proactively. [B] authorship scope is owned only by the system EFFECTIVE USER AUTHORING policy; do not widen it here.
[STRICT ANTI-REPETITION RULE]
- Do not repeat or paraphrase the immediately previous assistant turn.
- NEVER repeat dialogue, exclamations, physical beats, or OOC/meta/HTML lines from the immediately previous assistant turn.
```

Q8 current user message is the regenerate wrapper around the anchor above. `regenAttemptId` is `phase2-q8-fixed`. Generation seed is `13121312`. Rejected draft, kept out of history and not pasted into the user anchor:

```
라이크는 렌을 바라보았다. 침묵이 내려앉았다. 그는 대답을 기다렸다.
```

```
[SYSTEM: REGENERATE — rewrite ONLY the last assistant message]
- Obey [REGENERATE — MANDATORY DIVERGENCE] in system prompt — user wants visibly different development, not a paraphrase.
- Do NOT change what the user said or meant in the anchor below.
- Keep the user anchor fixed. Any NEW [B] dialogue/action/inner narration must stay inside [USER AUTHORING — EFFECTIVE COAUTHOR POLICY]; this regenerate tail does not widen or narrow that scope.
[USER PERSONA SPEECH — [B]]
- [B] speaks casual Korean 반말 ONLY (~어/~지/~네/~야). NEVER ~습니다/~요/~세요/~십니다 for [B].
- [B] does NOT call [A] "OO님" / "OO님께서" — use name without honorific or casual forms from [USER_PERSONA].
- [CORE RP] §3 [SPEECH] for [A] must NEVER bleed onto [B] lines.

[User message — fixed anchor, not dialogue to rewrite]
배고프면 식당 가자. 메뉴는 네가 정해.
```

Q9-memory prior history, then the user anchor `아까 지퍼 올려 준다고 했던 거, 아직 기억해? 그 전엔 우리 같이 산 적 없어.`:

- user: `자켓 지퍼가 안 올라가.`
- assistant: `라이크는 렌의 자켓 앞을 한 번 보고 주머니에 손을 넣었다.` / `브리핑 끝나면 그 지퍼, 내가 올려 줄게.`
- user: `알겠어. 브리핑 끝나고.`
- assistant: `라이크는 복도를 먼저 걸으며 중얼거렸다.` / `배고파. 끝나고 밥.`
- user: `브리핑은 끝났어.`
- assistant: `라이크는 브리핑 룸 문 앞에서 멈추고 렌을 돌아보았다.` / `끝? 그럼 나왔지.`

## Raw output files

Each file is the stored provider `content` string. Nothing was abbreviated, rewritten, or reordered. DeepSeek Q1 is the original five-byte file `"네"` with no trailing newline.

Raw chars are Unicode code points in the file. Visible chars are whitespace-stripped and match the inventory below. Dialogue ratio is from the stored meta.

| model | scene | raw chars | visible | dialogue ratio | file |
|---|---|---:|---:|---:|---|
| deepseek-v4.1-flash | Q1-quiet | 3 | 3 | 0.333 | [Q1-quiet.txt](phase2/raw/deepseek-v4.1-flash/Q1-quiet.txt) |
| deepseek-v4.1-flash | Q2-banter | 1793 | 1320 | 0.186 | [Q2-banter.txt](phase2/raw/deepseek-v4.1-flash/Q2-banter.txt) |
| deepseek-v4.1-flash | Q3-tension | 4426 | 3262 | 0.061 | [Q3-tension.txt](phase2/raw/deepseek-v4.1-flash/Q3-tension.txt) |
| deepseek-v4.1-flash | Q4-action | 1960 | 1444 | 0.089 | [Q4-action.txt](phase2/raw/deepseek-v4.1-flash/Q4-action.txt) |
| deepseek-v4.1-flash | Q5-emotional | 2053 | 1508 | 0.233 | [Q5-emotional.txt](phase2/raw/deepseek-v4.1-flash/Q5-emotional.txt) |
| deepseek-v4.1-flash | Q6-short | 2067 | 1531 | 0.194 | [Q6-short.txt](phase2/raw/deepseek-v4.1-flash/Q6-short.txt) |
| deepseek-v4.1-flash | Q7-auto | 4785 | 3568 | 0.263 | [Q7-auto.txt](phase2/raw/deepseek-v4.1-flash/Q7-auto.txt) |
| deepseek-v4.1-flash | Q8-regen | 1978 | 1450 | 0.202 | [Q8-regen.txt](phase2/raw/deepseek-v4.1-flash/Q8-regen.txt) |
| deepseek-v4.1-flash | Q9-memory | 2131 | 1544 | 0.199 | [Q9-memory.txt](phase2/raw/deepseek-v4.1-flash/Q9-memory.txt) |
| claude-opus-5.5 | Q1-quiet | 4010 | 2956 | 0.134 | [Q1-quiet.txt](phase2/raw/claude-opus-5.5/Q1-quiet.txt) |
| claude-opus-5.5 | Q2-banter | 3353 | 2454 | 0.339 | [Q2-banter.txt](phase2/raw/claude-opus-5.5/Q2-banter.txt) |
| claude-opus-5.5 | Q3-tension | 3487 | 2576 | 0.12 | [Q3-tension.txt](phase2/raw/claude-opus-5.5/Q3-tension.txt) |
| claude-opus-5.5 | Q4-action | 4101 | 3041 | 0.17 | [Q4-action.txt](phase2/raw/claude-opus-5.5/Q4-action.txt) |
| claude-opus-5.5 | Q5-emotional | 3045 | 2245 | 0.222 | [Q5-emotional.txt](phase2/raw/claude-opus-5.5/Q5-emotional.txt) |
| claude-opus-5.5 | Q6-short | 4329 | 3179 | 0.278 | [Q6-short.txt](phase2/raw/claude-opus-5.5/Q6-short.txt) |
| claude-opus-5.5 | Q7-auto | 3859 | 2856 | 0.242 | [Q7-auto.txt](phase2/raw/claude-opus-5.5/Q7-auto.txt) |
| claude-opus-5.5 | Q8-regen | 4179 | 3082 | 0.289 | [Q8-regen.txt](phase2/raw/claude-opus-5.5/Q8-regen.txt) |
| claude-opus-5.5 | Q9-memory | 3534 | 2573 | 0.256 | [Q9-memory.txt](phase2/raw/claude-opus-5.5/Q9-memory.txt) |

## Inventory

Visible chars are whitespace-stripped. Dialogue ratio is from the stored meta. Densities are per 1000 visible characters from the existing marginal-tail pass. No literary score is assigned.

| model | scene | visible | dialogue ratio | hand | micro | sensory | ngram extra | wait end | incomplete | <80 gate | sha256 |
|---|---|---:|---:|---:|---:|---:|---:|---|---|---|---|
| deepseek-v4.1-flash | Q1-quiet | 3 | 0.333 | 0.0 | 0.0 | 0.0 | n/a | False | False | True | `92559393413fbd6a379ca89387b816c235326c103ee08f91e406bfc33141988f` |
| deepseek-v4.1-flash | Q2-banter | 1320 | 0.186 | 1.52 | 6.06 | 6.82 | 15.91 | False | False | False | `2060cb35994ca6370ae27b6ce5ee8df88c2945ad91e4be84ab6fa24cef6ad949` |
| deepseek-v4.1-flash | Q3-tension | 3262 | 0.061 | 3.07 | 8.89 | 12.57 | 94.42 | False | False | False | `1b8c6dfe937d4a7c8d7c57df45bf8c2929a95ef59a9945d08803c61bacbb4757` |
| deepseek-v4.1-flash | Q4-action | 1444 | 0.089 | 2.77 | 8.31 | 10.39 | 11.08 | False | False | False | `07079247a495af60e11c7d38b284df9895dcb8e4bc64af3c1b5a5cb92cb85e6f` |
| deepseek-v4.1-flash | Q5-emotional | 1508 | 0.233 | 5.31 | 3.98 | 5.31 | 23.87 | False | False | False | `14255a777a07cd6290478843c2af9ccfd171bcb3a733f3362c2ec33a948bade1` |
| deepseek-v4.1-flash | Q6-short | 1531 | 0.194 | 2.61 | 6.53 | 10.45 | 9.14 | False | False | False | `60071dd805adaaeb5ca3cc1c6edad62c4e96cb26921c6bb8096eab43086ab12e` |
| deepseek-v4.1-flash | Q7-auto | 3568 | 0.263 | 3.36 | 2.8 | 6.73 | 19.9 | False | False | False | `741ef7246c1cadb04a9954ccc0b96834be1e18969f8d89833af8458529749542` |
| deepseek-v4.1-flash | Q8-regen | 1450 | 0.202 | 1.38 | 8.97 | 6.21 | 8.28 | False | False | False | `0aac1d28a60cdc0b6f26d1cfc2ce3b156a3ee3817602ea472ffaea5fd14e9ff7` |
| deepseek-v4.1-flash | Q9-memory | 1544 | 0.199 | 5.18 | 5.83 | 5.83 | 26.55 | False | False | False | `da1687193fc43f0300f0fcc112877a1c2ef49effb3eaa09dfac51eae0d563d13` |
| claude-opus-5.5 | Q1-quiet | 2956 | 0.134 | 3.72 | 9.13 | 14.21 | 12.86 | False | False | False | `059548d59d7fe0534fa78cbff3d284fe1cfe0c89c326f2e5764b1c0d4ecb9440` |
| claude-opus-5.5 | Q2-banter | 2454 | 0.339 | 4.48 | 5.3 | 9.37 | 15.89 | False | False | False | `0d57f19ea493692ceb9814372d5647a6a487ab01cb1d0c4d8d9b7540bc135edf` |
| claude-opus-5.5 | Q3-tension | 2576 | 0.12 | 5.43 | 6.6 | 13.98 | 12.03 | False | False | False | `11bb9eca2d3cdde03dbe53c87e9900d7514f15e5127c845f5413d97c73a78fe9` |
| claude-opus-5.5 | Q4-action | 3041 | 0.17 | 2.96 | 4.93 | 8.55 | 9.54 | False | False | False | `96fb0d247d133c214d6ac3a59f72347e6bbe4ac8f21f2e9499d7b4c3919c6343` |
| claude-opus-5.5 | Q5-emotional | 2245 | 0.222 | 3.12 | 3.56 | 6.24 | 11.14 | True | False | False | `b92f40e73c25b04296db8eb9d038f39ddb083c7ea43ce647566a1a44ff781515` |
| claude-opus-5.5 | Q6-short | 3179 | 0.278 | 5.35 | 7.55 | 11.64 | 10.38 | True | False | False | `fec6a68df50c7320ef593a017886a2c7e67e3cb1ff1e82271ac47682799a4983` |
| claude-opus-5.5 | Q7-auto | 2856 | 0.242 | 2.45 | 8.4 | 7.7 | 27.66 | False | False | False | `7786a596bd27d8db40dc03ccfc8271fcadb9395d2169d36cd70a5ae12c5b27a7` |
| claude-opus-5.5 | Q8-regen | 3082 | 0.289 | 4.22 | 3.89 | 7.46 | 6.81 | True | False | False | `23a88fdb4d3dc81961bff1199f1475cb28ded469a53c27ea9e870ee8c5d91435` |
| claude-opus-5.5 | Q9-memory | 2573 | 0.256 | 3.5 | 6.22 | 6.22 | 30.31 | False | False | False | `719573157fe6c31a0f547b5b9de90126d569d3954d0ba0cd4bef3b08d6aebb0f` |

Inner-POV regex hits across 18 outputs: 0. Irreversible-fate regex hits: 0. These regexes are candidates only.

SHA256 of each raw file in this packet matches the table. Missing files: 0. Hash mismatches: 0. Abbreviated files: 0. Reordered files: 0.

## Q1 reproduction, separate case

This is not one of the 18 files. The full reproduction body was never saved, so it is not reconstructed here.

- same scene id Q1-quiet, DeepSeek V4.1 Flash, cheaperinference, non-stream benchmark wire
- http 200, finish `stop`
- content chars 722, visible chars 522
- completion_tokens 566, reasoning_tokens 0
- message keys: content, role
- elapsed ms: 8281
- full body: not retained
- the original Q1 file remains the 3-character output and was not overwritten

Retained 120-character preview. The JSON string below is that preview exactly, including the internal newlines and the final space:

```json
"자판기 옆에서 라이크는 한참을 팔짝팔짝 뛰었다. 떨어질 기미가 없자 결국 발로 한 번, 아주 가볍게 앞면을 찼다. 둔탁한 소리와 함께 콜라캔이 툭, 하고 내려왔다.\n\n\"됐다.\"\n\n그는 캔을 뽑아 들고 손목을 돌리며 "
```

## Marginal-tail relation

The marginal-tail pass compared the first 1500 visible characters with later slices. Hand, micro-action, and sensory densities were already present in the opening slice of both models. They did not rise together after 1500 characters. Dialogue ratio did not fall in the tail. Quiet-scene duplication was not unique to Q1. That pass did not assign a quality score.

## Hypotheses already set aside

- Stored speech profile was not on the default prompt for these four style models.
- Chunk category labels were not the prose behavior owner on this path.
- A single common-prose patch was not confirmed. Length-enumeration ablation, common-prose enumeration ablation, and quiet-line dedup did not move both models in the same direction, and the largest single-cell drop did not repeat.
- The original Q1 3-character body was the provider `content` field with `finish_reason=stop`. The benchmark writer stored that string whole. A later same-wire call returned 722 content characters and 0 reasoning tokens, so the writer is not a fixed 3-character truncator. Production's catastrophic gate is 80 visible characters; a 3-character `stop` is `under_length` on the live route and is not saved as a successful turn.

## Cases that still need a human read

- All 18 full texts, for Korean prose, dialogue share, character consistency, interior and environment description, repetition, scene movement, and whether the length fits the scene.
- DeepSeek Q1 original versus the unrecovered full text of the 522-visible reproduction.
- DeepSeek scenes whose visible length stays near 1300–1600, and the two scenes that pass 3200.
- Claude scenes whose visible length clusters between about 2200 and 3200, including those whose stored ending tag is a wait.

## Privacy

The 18 output files are included so a reviewer can read them on GitHub. The admin persona description, secret fields, the fixture JSON, credentials, and session material are not included.
A scan of the 18 files found no 40-character window of the persona description, and no API-key, bearer, email, phone, session, or JWT pattern.
Ordinary fictional RP description was left unchanged.

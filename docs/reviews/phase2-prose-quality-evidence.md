# Phase 2 prose quality review evidence

Review packet only. This document does not change production prompts, routing, or runtime behavior, and it is not a merge candidate for a behavior patch.

Live main at packet build: `320036ff86cabcd0034d254a804cec85d09fe2d6`.
GPT's previously noted main `70e8efe0a0765a2d99afedd0c1c9e2f6ee64d51b` is an ancestor. Authoring, no-godmodding, common prose, response length, and the Main RP model registry files are unchanged between those commits.
The 18 saved outputs were generated at `113efb3a39a1e7eadacba82a47ce88058118ff0f`.

## What this packet is

Eighteen successful benchmark outputs are inventoried here: DeepSeek V4.1 Flash 9, Claude Opus 5.5 9. Gemini 3.7 and 3.8 rows exist on disk as HTTP 401 empties and are not prose evidence.
A later DeepSeek Q1 reproduction is a separate case. Its full body was not retained; only a 120-character preview and the provider usage envelope were saved.
Full output text stays outside the repository. This file keeps matching keys, lengths, ratios, and mechanical counts.

## Fixture match

- character id 18, sourceHash `295f4d8ae3dc8391`
- persona descriptionHash `9ef42c7f92091ca1`
- prose-style bundle hash on all 18 calls: `bdea4a048163f98e`
- provider on all 18 calls: cheaperinference
- length owner count 1 and last on every call
- `max_tokens` absent
- speech profile blob absent from the prompt

## NORMAL authoring used for these calls

The calls used the persistent NORMAL delegation: dialogue and observable major actions of the user character are allowed, including local approach, retreat, hesitation, acceptance, and refusal.
Private inner monologue and irreversible canon changes are outside that scope.
A user line that already states dialogue or an action is in bounds. Those lines are not treated as violations in this inventory.
Interactive scenes recorded runtimeMode `current_turn_ooc_delegated`. Q7 recorded `auto_progression`. Q8 recorded regenerate with the same delegation.

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

## Q1 reproduction, separate case

- same scene id Q1-quiet, DeepSeek V4.1 Flash, cheaperinference, non-stream benchmark wire
- http 200, finish `stop`
- content chars 722, visible chars 522
- completion_tokens 566, reasoning_tokens 0
- message keys: content, role
- full body: not retained
- the original Q1 file remains the 3-character output and was not overwritten

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

Persona description text, the admin fixture JSON, credentials, and the full model outputs are omitted. Scene prompt text is omitted here for the same reason. Matching uses hashes and scene ids.


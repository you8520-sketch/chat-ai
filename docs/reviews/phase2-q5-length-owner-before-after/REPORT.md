# Q5-emotional length-owner before/after — four paid calls

Cursor does **not** score prose. GPT grades the four raw files. This folder is public-safe review evidence only: no keys, no private persona description, no production row dumps.

## Classification

`FOUR_POSTS_COMPLETED`

- Draft PR: #1545
- Approval: issue comment `6107548038`
- Runtime SHA: `2bbe023bce1dae11b6bcee90990b65c3f8d9f1d8`
- Path: existing `buildContext` → `assemblePrimaryRpRequest` → Cheaper Inference non-stream `POST /v1/chat/completions`
- Credential: `CHEAPER_INFERENCE_BENCHMARK_API_KEY` only. DeepSeek and Claude were not sent to OpenRouter.
- New runner / Journal / SSH / DPAPI / extra SHA gate: **not created**
- `#1537` #1/#2: **not resent**
- Sol / Gemini: **not called**
- Production DB writes: **0**
- `max_tokens`: **absent** on all four wires

## Identity

`CONTROLLED_FIXTURE_NOT_LIVE_PRODUCTION`

Cloud has no production `app.db` row for 라이크 18 / admin 렌. Both arms used one fixed public fixture from the #1318 index:

- Character: public 라이크 / 조태형 card fields only (job, speech examples, manner, appearance markers). `sourceHash` `295f4d8ae3dc8391` is the historical packet label, not a live sheet read.
- Persona: name 렌, gender male. The 583-character admin description was **not** invented and was **not** injected.
- Scene: Phase 2 Q5-emotional. History `본부 로비야. 오늘은 호출이 없대.` → `라이크는 자판기 버튼을 누르고, 떨어지지 않는 캔을 툭 쳤다.` / `야, 이거 왜 안 나와. 배고픈데.` Anchor: `무서워. 그래도 안 갈게.`
- Mode: NORMAL / SAFE. `targetResponseChars=3200`. `nsfw=false`.

This is **not** live production-sheet parity.

## BEFORE vs AFTER

Same current assembly for each model. The only intended wire change is `USER_TAIL_LENGTH_OWNER_SENTENCE`:

- BEFORE = old main sentence, including the sensory/psychology fill method
- AFTER = #1545 sentence with that method removed

Pre-POST check: for each model the JSON request bodies differed only at `messages[3].content` (one replacement of that sentence). `stream=false`. No token cap.

## Per-call outcome

| # | Arm | Model | Route | HTTP | Finish | Raw chars | Prompt tok | Completion tok | USD | Request id | Wire SHA-256 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | BEFORE | deepseek-v4.1-flash | cheaperinference | 200 | stop | 1888 | 5026 | 1458 | 0.000814 | `2867b2a4-c6e3-48a0-9d86-7f6de59d12a8` | `dc76a2d56919cc631c7a74dbdc05c6871488c9faace8db8502ccd45a8fca4562` |
| 2 | AFTER | deepseek-v4.1-flash | cheaperinference | 200 | stop | 1906 | 4987 | 1486 | 0.000471 | `58877a82-6a63-4a66-a6fb-3a42de519360` | `103985ec98acdf91c2948e928d6a17cbd5e528d3200224097c77a8236169ae42` |
| 3 | BEFORE | claude-opus-5.5 | cheaperinference | 200 | stop | 2774 | 7452 | 3853 | 0.073908 | `msg_011CfvDLah3Lh76NuyEw1CY4` | `14c5bfdbfcd8c8326ae70783a1971629e21ff99fc69db9e1e5be8e225b59dc75` |
| 4 | AFTER | claude-opus-5.5 | cheaperinference | 200 | stop | 3219 | 7400 | 4413 | 0.059721 | `msg_011CfvDQJsQZA7wFYDQmzPCo` | `61ef44b6dafd47c2cf679eb83eb42dfd76d65ee926715c520496090c154959ad` |

Attempted POSTs: **4**. Successful HTTP 200 with saved body: **4**. Errors: **0**. Observed billed total (provider `usage.cost`): **USD 0.134914**.

Raw file SHA-256 (UTF-8 bytes, no rewrite):

| File | SHA-256 |
|---|---|
| [deepseek-v4.1-flash-Q5-before.txt](deepseek-v4.1-flash-Q5-before.txt) | `1bc1e896290e4e98f019f8f5b5d09db11cd76c89836e38724a52873531d73483` |
| [deepseek-v4.1-flash-Q5-after.txt](deepseek-v4.1-flash-Q5-after.txt) | `79c36e156d388385903313d4a014b90fb06f3866b6ac3e3202d1e3e9bd996fb6` |
| [claude-opus-5.5-Q5-before.txt](claude-opus-5.5-Q5-before.txt) | `80f72de64b900b20082cffe3f5bf3ece6ce0fa7c7d84f18949141def329bf0e6` |
| [claude-opus-5.5-Q5-after.txt](claude-opus-5.5-Q5-after.txt) | `aa2d90ce5c25863ea3fd734708aaa539a3ebdaad90befb53a909a7103f960ecb` |

## Files

- `deepseek-v4.1-flash-Q5-before.txt`
- `deepseek-v4.1-flash-Q5-after.txt`
- `claude-opus-5.5-Q5-before.txt`
- `claude-opus-5.5-Q5-after.txt`
- `calls.json` — public call metadata only

Each `.txt` is the provider `message.content` string, stored verbatim.

## Scores

All rubric scores left empty. Cursor assigned none. GPT reads the four Korean raw files.

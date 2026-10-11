# Q5 four-model comparison on the #1558 controlled fixture (unscored)

Label: `CONTROLLED_FIXTURE_NOT_LIVE_PRODUCTION`. No live admin persona or live 라이크 row.

- main at assembly and calls: `4c1c2302bd26e10a09593f2e831da0f4c5106add`
- Scene: Q5, current user input `무서워. 그래도 안 갈게.`; the public-safe fixture used in #1558 (public card fields, 렌 = name/gender, two-message lobby history).
- Path: current main's real `buildContext` -> `assemblePrimaryRpRequest` with the chat route's `sceneServerControls`; provider per `selectedAIProvider(model)`; no `max_tokens`; no output-volume change (3,200+ soft target, no cap).
- New calls: GPT-6.1 Sol and Gemini 3.8 Flash only, one POST each, no retry. DeepSeek and Claude were not re-called; their #1558 Q5 B raws are the comparison base.
- Cursor does not score or edit any output.

## Saved vs reassembled requests

- DeepSeek V4.1 Flash: reassembled request is byte-identical to the saved #1558 B request (`fa9d0976bfb6f7edc5364f70127ba276c5b4e1c7abba3afc911a9bd6f5104950`).
- Claude Opus 5.5: reassembled request is byte-identical to the saved #1558 B request (`6a00921a7a1134e800966b7d5dc60fbfe6b7da5d1a8e89fe19c10236c26110fe`).
- GPT-6.1 Sol and Gemini 3.8 Flash: new requests, no saved counterpart.
- Not related to #1550's `전개 초점` wire: all four Q5 wires have `[SCENE PACING]` with no drawn axis (`허용된 변화` 0, `전개 초점` 0).

## Actual wires

| model | provider | compact request sha256 |
|---|---|---|
| `deepseek-v4.1-flash` | Cheaper Inference | `fa9d0976bfb6f7edc5364f70127ba276c5b4e1c7abba3afc911a9bd6f5104950` |
| `claude-opus-5.5` | Cheaper Inference | `6a00921a7a1134e800966b7d5dc60fbfe6b7da5d1a8e89fe19c10236c26110fe` |
| `gpt-6.1-sol` | Cheaper Inference | `e8dc5f5e28957d783a203b4bd20ab64ba4513598a167d987c1743139932759e1` |
| `google/gemini-3.8-flash` | OpenRouter | `a04d70d17bcbb74c17efa7d2f06b39fcc83b87f8b7d23d46067ecc5db5f30ba2` |

Request options (all `stream:false`, no `max_tokens`/`max_completion_tokens`, `stream_options.include_usage`):

- DeepSeek: temperature 0.92, `top_p` 0.92, `thinking` disabled, `reasoning_effort` none.
- Claude: temperature 0.82, `thinking` disabled, `output_config.effort` low, `reasoning_effort` low.
- GPT-6.1 Sol: temperature 0.7, `reasoning.effort` low, `reasoning_effort` low.
- Gemini 3.8 Flash: no temperature; `include_reasoning` false; `reasoning` {effort low, exclude true}; `provider` {only `google-ai-studio`, `allow_fallbacks` false, `require_parameters` true}; `service_tier` flex.

All four use three system text blocks with `cache_control: ephemeral` on the first two.

## Pre-call checks

- Card, persona, history, current input: messages[1..3] (history and final user tail) are byte-identical across all four wires, and GPT/Gemini system text is byte-identical to Claude's. DeepSeek differs only by its adapter (see below).
- SceneDirective / `[SCENE PACING]`: identical on all four (`MICRO`, no axis, `기존 NPC 행동: 없음`, `새 인물 도입: 없음`), equal to the #1558 Q5 AFTER wire.
- Co-authoring scope: the EFFECTIVE COAUTHOR POLICY block is part of the system text and is identical across the four (and is in the saved DeepSeek/Claude requests).
- User tail: the 3,200+ soft sentence is present once on all four, after `[이번 응답 대화]` (max 4, once).
- Adapter differences recorded: DeepSeek has an extra `Qwen/DeepSeek 보강` line (56 est. tokens), `<WORLD_LORE>` tags, one appearance-variation line and a different section order; Claude, GPT-6.1 Sol and Gemini have 0 model-specific style lines. Per-model request options are listed above.
- Section injection counts (every model): `[COMMON PROSE]` 1, `[SCENE PACING]` 1, length sentence 1, `[이번 응답 대화]` 1, creator narration note 0 (the fixture has none), user anchor 1.

## Token and cost

`estimateTokens` (not comparable to provider-reported tokens; tokenizers differ):

| model | system | total input |
|---|---:|---:|
| DeepSeek V4.1 Flash | 5,989 | 7,145 |
| Claude Opus 5.5 | 5,857 | 7,008 |
| GPT-6.1 Sol | 5,857 | 7,008 |
| Gemini 3.8 Flash | 5,857 | 7,008 |

## New calls

| | GPT-6.1 Sol | Gemini 3.8 Flash |
|---|---|---|
| route / key | Cheaper Inference, `CHEAPER_INFERENCE_BENCHMARK_API_KEY` | OpenRouter, existing experiment key `RP_QUALITY_PAID_OPENROUTER_KEY` |
| HTTP / finish | 200 / `stop` | 200 / `stop` (native `STOP`) |
| provider prompt tokens | 3,929 (cached 2,313; cache write 1,614) | 3,802 (cached 3,442; cache write 3,442) |
| completion tokens | 2,464 (reasoning 42) | 2,342 (reasoning 0) |
| actual cost (USD) | 0.018791 | 0.0047270333 |
| latency | 88.686 s | 29.639 s |
| raw / visible chars | 3,898 / 2,875 | 3,597 / 2,692 |
| raw sha256 | `e78bec658445eecec1248ce5560b1724b87680f016547e889189eb04478e86d5` | `cb8804fb6e9476fd2f5e81a34df7b34d8368acae460f45c3e229cd7e24439dab` |
| request id | `gen-1791729906-HnesRimMtIOZPdelrGW5` | `gen-1791729974-aznL7tb4djJ17jhIghab` (Google AI Studio) |
| error | none | none |

Total new spend about USD 0.0235 (about ₩32 at 1,368 KRW/USD), far below ₩1,000.

## Comparison base (not re-called; already on main via #1558)

- DeepSeek Q5 B: 1,574 chars (GPT 63): `docs/reviews/interactive-micro-axis-removal/q5-after-1558/deepseek-v4.1-flash-Q5-B-1558.txt`, `call-B.json` (4,410 / 1,189 tokens, $0.000565).
- Claude Q5 B: 2,622 chars (GPT 76): `docs/reviews/interactive-micro-axis-removal/q5-claude-after-1558/claude-opus-5.5-Q5-B-1558.txt`, `call-B.json` (6,508 / 3,658 tokens, $0.066955).

## Limitations

- Controlled public-safe fixture, one sample per model; per-model sampling and reasoning settings differ by design, so this is not a strict identical-wire A/B.
- GPT-6.1 Sol response metadata carries an OpenRouter-style `gen-…` id and `is_byok: true`; it was called via the Cheaper Inference endpoint as the registry specifies.
- Provider token counts and `estimateTokens` use different tokenizers.
- Raw files are verbatim; Cursor did not read them for quality.

No prompt, code, model price, default model, routing, creator style, output-volume or DB change. No new runner, Journal or PR; the throwaway scripts live outside the repo.

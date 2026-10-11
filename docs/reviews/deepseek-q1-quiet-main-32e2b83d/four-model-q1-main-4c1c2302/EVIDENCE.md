# Four-model Q1 comparison on the same controlled fixture (unscored)

Label: `CONTROLLED_FIXTURE_NOT_LIVE_PRODUCTION` for all four. No live admin persona or live 라이크 row was used.

- main at assembly and calls: `4c1c2302bd26e10a09593f2e831da0f4c5106add`
- Fixture: the #1562 public-safe Q1 fixture (public card fields, 렌 = name/gender, two-message history). Current user input: `여기 앉아 있을게. 오늘은 조용해서 좋다.`
- Path: current main's real `buildContext` -> `assemblePrimaryRpRequest` with the chat route's `sceneServerControls`; `provider`/`transportProvider` come from `selectedAIProvider(model)`. No manual additions, no max_tokens.
- Cursor does not score or edit the outputs. GPT reads all four raws.

## Saved vs reassembled requests

- DeepSeek V4.1 Flash: reassembled on `4c1c2302` is byte-identical to the request saved in #1562 (`fc237326fabcbb94a55eb6d8004dc5e3949dfa3f39db3df0c8554ee148d6b756`).
- Claude Opus 5.5: reassembled is byte-identical to the request saved in the #1562 Claude evidence (`bfe5a14d8913fac7b3462870ab95ea4eba80559dc37802749f6dc1ad1ed43f03`).
- GPT-6.1 Sol and Gemini 3.8 Flash have no prior saved request; they are new.

## Actual wires

| model | provider / endpoint | compact request sha256 |
|---|---|---|
| `deepseek-v4.1-flash` | Cheaper Inference `/v1/chat/completions` | `fc237326fabcbb94a55eb6d8004dc5e3949dfa3f39db3df0c8554ee148d6b756` |
| `claude-opus-5.5` | Cheaper Inference | `bfe5a14d8913fac7b3462870ab95ea4eba80559dc37802749f6dc1ad1ed43f03` |
| `gpt-6.1-sol` | Cheaper Inference | `1b973ce9698842be170a7bb57a9e5253459f438a5020d14e75c993d4f3d53b39` |
| `google/gemini-3.8-flash` | OpenRouter `/api/v1/chat/completions` | `2bfff172aa11f47b6746e507fcdc1bedcd6947fe17ffef8d3ed177287ff67678` |

Provider options in the body (all `stream:false`, no `max_tokens`/`max_completion_tokens`):

- DeepSeek: temperature 0.92, `top_p` 0.92, `thinking` disabled, `reasoning_effort` none.
- Claude: temperature 0.82, `thinking` disabled, `output_config.effort` low, `reasoning_effort` low.
- GPT-6.1 Sol: temperature 0.7, `reasoning.effort` low, `reasoning_effort` low.
- Gemini 3.8 Flash: no temperature, `include_reasoning` false, `reasoning` {effort low, exclude true}, `provider` {only `google-ai-studio`, `allow_fallbacks` false, `require_parameters` true}, `service_tier` flex.

All four: `stream_options.include_usage`, roles `system,user,assistant,user`, system as three text blocks with `cache_control: ephemeral` on the first two (so an earlier statement in this PR that DeepSeek had no cache markers was wrong; corrected).

## What is identical and what differs

- Identical across all four: card, persona, history, current user message and final user tail (including `[이번 응답 대화]` max 4 and the 3,200+ soft length sentence); scene directive and `[SCENE PACING]`.
- System text: GPT-6.1 Sol and Gemini 3.8 Flash system text is byte-identical to Claude's. DeepSeek differs (adapter): extra `Qwen/DeepSeek 보강` line (56 est. tokens), `<WORLD_LORE>` tags and one appearance-variation line, and the hygiene sections placed earlier. See `../claude-q1-main-de266eb8/wire/system.deepseek-to-claude.diff`.
- Model-specific extra style lines: DeepSeek 1 (56 est. tokens); Claude 0; GPT-6.1 Sol 0; Gemini 3.8 Flash 0.

## Prompt audit (`*.audit.json`; counts in system + tail)

For every model: `[COMMON PROSE]` 1, `[SCENE PACING]` 1, length sentence 1, `[이번 응답 대화]` 1, creator narration note 0 (the fixture has none), `허용된 변화` 0, `전개 초점` 0, current user anchor 1.

`estimateTokens`: DeepSeek system 5,989 / total input 7,153; Claude, GPT-6.1 Sol and Gemini 3.8 Flash system 5,857 / total input 7,016 each.

## Calls (one POST per new model, no retry)

| | GPT-6.1 Sol | Gemini 3.8 Flash |
|---|---|---|
| route / key | Cheaper Inference, `CHEAPER_INFERENCE_BENCHMARK_API_KEY` | OpenRouter, `RP_QUALITY_PAID_OPENROUTER_KEY` (existing experiment key; production key not used) |
| HTTP / finish | 200 / `stop` | 200 / `stop` (native `STOP`) |
| provider prompt tokens | 3,935 (cache write 3,933, cached 0) | 3,805 (cached 3,442, cache write 3,442) |
| provider completion tokens | 2,786 (reasoning 31) | 1,247 (reasoning 0) |
| actual cost (USD) | 0.024502 | 0.0026750333 |
| latency | 96.234 s | 19.649 s |
| raw / visible chars | 4,149 / 3,045 | 1,901 / 1,406 |
| raw sha256 | `ddd5d371d74acb846dbebd2f645515b0141ecc6e0b659464250bdb77024bebf0` | `40c1c90130200d24f24d81ac043773c169f22a944d7cc21beb3626ae22c2e7c4` |
| request id | `gen-1791728353-s0ax7btTy6UpqijZBjCQ` | `gen-1791728421-i6UUc8WAKO42LKWXgrgZ` (Google AI Studio) |
| error | none | none |

Provider-reported prompt tokens differ from `estimateTokens` (tokenizers differ), so they are not directly comparable across models.

Total new spend: about USD 0.0272.

Earlier same-fixture results for reference (not re-called): DeepSeek V4.1 Flash 2,425 chars (GPT 52), Claude Opus 5.5 2,796 chars (GPT 79).

## Limitations

- Controlled public-safe fixture, not live production data; one sample per model; sampling and reasoning settings differ per model by design (canonical settings), so this is not a strict identical-wire A/B.
- The GPT-6.1 Sol response metadata carries an OpenRouter-style `gen-…` id and `is_byok: true`; it was called through the Cheaper Inference endpoint as the registry specifies.
- Raw output files are verbatim; Cursor did not read them for quality.

No model price, default model, routing, common prose, creator style, or DB change. No new runner, Journal or PR; the throwaway scripts live outside the repo.

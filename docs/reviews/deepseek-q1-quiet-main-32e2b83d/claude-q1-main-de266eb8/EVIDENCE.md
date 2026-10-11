# Claude Opus 5.5 Q1 on the same controlled fixture (unscored, no code change)

Label: `CONTROLLED_FIXTURE_NOT_LIVE_PRODUCTION`. This is a comparison point for the DeepSeek Q1 record in `../REPORT.md`, not a strict same-wire A/B.

## Refs

- main at assembly and call time: `de266eb88f63ae9b6c4a3ef6d7e93a897250eb5f`
- Fixture: the #1562 public-safe Q1 fixture (same card, persona name/gender, two-message history, current user input `여기 앉아 있을게. 오늘은 조용해서 좋다.`), assembled through current main's real `buildContext` -> `assemblePrimaryRpRequest`, with the same `sceneServerControls` the chat route passes. No manual additions.
- DeepSeek original (not re-called): `../deepseek-v4.1-flash-Q1-main-32e2b83d.txt` (2,425 chars, sha256 `4812561a…e77c`). Reassembling the DeepSeek request on `de266eb8` gives a request byte-identical to the one saved in #1562 (`fc237326…b756`).

## Request differences (DeepSeek wire vs Claude wire)

Same: messages[1..3] (history and final user tail, including `[이번 응답 대화]` max 4 and the 3,200+ soft length sentence) are byte-identical; scene directive and `[SCENE PACING]` are identical; no `max_tokens` on either; `stream:false`; `thinking` disabled.

Different (model adapter and normal per-model provider options only):

- Provider options. DeepSeek: temperature 0.92, `top_p` 0.92, `reasoning_effort` none. Claude: temperature 0.82, no `top_p`, `output_config.effort` low, `reasoning_effort` low.
- System message content blocks. Both wires use three system blocks with `cache_control: ephemeral` on the first two; the block boundaries fall at different text positions because the system texts differ (corrected: an earlier version of this line said DeepSeek had no cache markers).
- System text, see `wire/system.deepseek-to-claude.diff`: the DeepSeek-only line `Qwen/DeepSeek 보강: …` is absent for Claude; `<WORLD_LORE>` tags and one appearance-variation line are absent for Claude; the `[PRIVATE OUTPUT HYGIENE]`, `[NO STAGE DIRECTIONS]` and `[SPEECH METADATA — INVISIBLE INSTRUCTIONS]` sections sit after the common/layout sections for Claude instead of before the authoring policy.
- `estimateTokens`: system 5,857 (Claude) vs 5,989 (DeepSeek); total input 7,016 vs 7,153.

So this is not a strict identical-wire A/B. The two models also had different providers' reasoning/sampling settings.

## Wire audit before the call (`audit.json`)

Model `claude-opus-5.5`, `stream:false`, temperature 0.82, `thinking` disabled, `reasoning_effort` low, `output_config.effort` low, no `max_tokens`/`max_completion_tokens`; roles `system,user,assistant,user`; current user anchor x1; `[COMMON PROSE]` x1; `[SCENE PACING]` x1; length sentence x1; `허용된 변화` 0; `전개 초점` 0; creator note 0. Compact JSON sha256 `bfe5a14d8913fac7b3462870ab95ea4eba80559dc37802749f6dc1ad1ed43f03`.

## Paid call (one POST, no retry; `call.json`)

- Route: Cheaper Inference benchmark key, `POST /v1/chat/completions` (non-stream); request id `msg_011CfvZRAJZnAbBwCKmxiBx3`
- HTTP 200, finish reason `stop`, error none
- Tokens: 6,519 prompt (3,817 cache creation) / 4,073 completion
- Actual cost: $0.072379
- Latency 55.631 s
- Raw: 2,796 chars (2,045 visible), sha256 `016f8c7e635999cf34e124bfce1af7019cc7ca27f7553d2fdfd94e9bf64485cf`
- Full verbatim output: `claude-opus-5.5-Q1-main-de266eb8.txt`

No further calls, no code/prompt/price/routing change, no new runner, Journal or PR. Cursor does not score; GPT compares the two raws.

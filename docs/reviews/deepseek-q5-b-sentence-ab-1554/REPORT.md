# #1554 DeepSeek Q5 A/B — one new paid B call (unscored)

Approval: [#1554 comment 6108560955](https://github.com/you8520-sketch/chat-ai/pull/1554#issuecomment-6108560955). Cursor did not score prose. A single archived A sample plus a single stochastic B sample cannot show a general causal effect.

Fixture label: `NEW_CONTROLLED_FIXTURE_NOT_1545_PARITY` (not live production; public card fields + 렌 name/gender only).

## A (reused, 0 new POST)

- Request: #1550 `docs/reviews/phase2-q5-micro-focus-after/wire/deepseek-v4.1-flash.AFTER.request.json` at `a94a4165a4f4ee0cc4cf44352ab253ecba1157ed`. Its compact `JSON.stringify` sha256 `7650477054bfd52cb7fdd64ec0f7c38cb870bd4c3913d3116dc08ed6e2d072ea` equals the hash recorded when A was originally POSTed.
- Raw: [`deepseek-v4.1-flash-Q5-after-1550.txt`](https://github.com/you8520-sketch/chat-ai/blob/a94a4165a4f4ee0cc4cf44352ab253ecba1157ed/docs/reviews/phase2-q5-micro-focus-after/deepseek-v4.1-flash-Q5-after-1550.txt) — 929 chars, sha256 `e84e852a39ee7d7c61134e22ebc7fd90893564c31732c5e2543a343ca2d6fc5c`, HTTP 200, `stop`, USD 0.000557.

## B (one new POST)

Request = in-memory clone of A. Only change: in system block index 1 (the text block that ends with the compact `[SCENE PACING]` `새 인물 도입: 없음` and precedes the `[OUTPUT LAYOUT]` block), one newline plus this sentence appended:

> 상대의 감정·의사 표현이 현재 장면의 중심이면, [A]의 성격에 맞는 판단과 구체적인 반응·행동을 먼저 보여주고 그 결과로 생기는 작은 관계·상황 변화를 이어간다.

Pre-POST diff proof (`preflight.json`): the only differing JSON path is `.messages.0.content.1.text`; `B.text === A.text + "\n" + sentence` (92 chars inserted). Same keys, model `deepseek-v4.1-flash`, `temperature 0.92`, `top_p 0.92`, `thinking disabled`, `reasoning_effort none`, `stream:false`, no `max_tokens`/`max_completion_tokens`, same cache controls. Plain text diff of that block: one added line, nothing else.

| item | value |
|---|---|
| attempts | 1 of 1 authorized, no retries |
| HTTP / finish | 200 / `stop` |
| usage | 4513 prompt / 1027 completion tokens |
| cost | USD 0.000646 |
| visible raw chars | 1290 |
| seconds | 9.58 |
| request id | `a6814047-ee3c-4d6f-9d9f-336b23ddddc4` |
| B wire sha256 (compact `JSON.stringify`) | `fa6808f20d480c677d81e3d2c7ca1600d59304791095241ef103b848a15cf43c` |
| B raw sha256 | `84e2b476b3770ad45d955fb3c9ceb414b720e237511e0a8d46c8dfc2ff712605` |

Files: [`deepseek-v4.1-flash-Q5-B-1554.txt`](deepseek-v4.1-flash-Q5-B-1554.txt) (verbatim), `wire/deepseek-v4.1-flash.A.request.json`, `wire/deepseek-v4.1-flash.B.request.json`, `preflight.json`, `call-B.json`. Request bodies contain no credentials. The credential is `CHEAPER_INFERENCE_BENCHMARK_API_KEY` only.

Runtime source: base `origin/main` `8cc25887` (#1554 base) with the archived #1550 request as the frozen experimental base (current main does not include the #1550 MICRO revision). No code, COMMON PROSE, provider option, model setting or billing change. The temporary POST script was deleted and not committed.

STOP: no further calls, no merge. Awaiting GPT evaluation.

# #1558 Claude Opus 5.5 — Q5 B (one-line `전개 초점` removal) regression evidence

Single authorized paid POST (GPT review on PR #1558). No retry, no A replay, no other model, no DB writes. Not graded here; GPT compares archived A (81) against this B.

## Immutable refs

- #1558 HEAD at call time: `dd8c5d63428d415edb78a92913fad9b0f13d7fee` (wire files unchanged since `8c7119c13900bfcc4341fe6724f9e29835cf40b6`)
- A (archival, not re-called): #1550 HEAD `a94a4165a4f4ee0cc4cf44352ab253ecba1157ed`
  - request: `docs/reviews/phase2-q5-micro-focus-after/wire/claude-opus-5.5.AFTER.request.json`
  - raw (3104 chars, GPT 81/100): `docs/reviews/phase2-q5-micro-focus-after/claude-opus-5.5-Q5-after-1550.txt`, sha256 `16a078a96fd23f913d01eb113bb272618dfcc7028a6f069b036732490e9d06b7` (equals `calls.json` there)
  - recorded call: 6562 prompt / 4324 completion tokens, $0.075789
- B request: `docs/reviews/interactive-micro-axis-removal/wire/claude-opus-5.5.AFTER.request.json`

## Wire hashes (compact JSON sha256)

- A: `23a862f37f12ff6fe8e2437080eb5d45ec50c1e79e7ab1d6f30745038097c806` (matches recorded)
- B: `6a00921a7a1134e800966b7d5dc60fbfe6b7da5d1a8e89fe19c10236c26110fe` (matches recorded)

## A/B wire delta (preflight PASS, `preflight.json`)

- Only differing path: `.messages[0].content[1].text`
- B text == A text minus exactly one line (once in A, 0 in B, 52 chars removed):
  `전개 초점: 환경 변화 (인물의 반응·판단·행동·관계 흐름은 현재 상호작용에 맞게 이어간다)`
- Unchanged: model `claude-opus-5.5`, `stream:false`, `stream_options.include_usage`, `temperature` 0.82, `thinking` disabled, `output_config.effort` low, `reasoning_effort` low, no `max_tokens`/`max_completion_tokens`.

## Call result (`call-B.json`)

- route: Cheaper Inference benchmark key, `POST /v1/chat/completions` (non-stream), request id `msg_011CfvTV5Yjfi3NasKXYZNzJ`
- HTTP status 200, finish reason `stop`, error none
- prompt tokens 6508, completion tokens 3658 (cache_creation_input_tokens 3817)
- actual cost $0.066955 (`usage.cost`)
- latency 49.497 s
- raw chars 2622, raw text sha256 `79049d3f433970a4811b652ebe8b0ac89bd36bf38d03dec34432d00f689d6c62`

Verbatim full output: `claude-opus-5.5-Q5-B-1558.txt` (same directory).

The A/B runner was a throwaway script outside the repo; it is not committed.

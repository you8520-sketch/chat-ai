# #1558 DeepSeek V4.1 Flash — Q5 B (one-line `전개 초점` removal) evidence

Single authorized paid POST (PR #1558 approval comment). No retry, no A replay, no other model. Not graded here; GPT grades.

## Immutable refs

- #1558 HEAD at call time: `8c7119c13900bfcc4341fe6724f9e29835cf40b6`
- A (archival, not re-called): #1550 HEAD `a94a4165a4f4ee0cc4cf44352ab253ecba1157ed`
  - request: `docs/reviews/phase2-q5-micro-focus-after/wire/deepseek-v4.1-flash.AFTER.request.json`
  - raw (929 chars, GPT 46/100): `docs/reviews/phase2-q5-micro-focus-after/deepseek-v4.1-flash-Q5-after-1550.txt`
- B request: `docs/reviews/interactive-micro-axis-removal/wire/deepseek-v4.1-flash.AFTER.request.json`

## Wire hashes (compact JSON sha256)

- A: `7650477054bfd52cb7fdd64ec0f7c38cb870bd4c3913d3116dc08ed6e2d072ea` (matches recorded)
- B: `fa9d0976bfb6f7edc5364f70127ba276c5b4e1c7abba3afc911a9bd6f5104950` (matches recorded)

## A/B wire delta (preflight PASS, `preflight.json`)

- Only differing path: `.messages[0].content[1].text`
- B text == A text minus exactly one line (occurs once in A, 52 chars removed):
  `전개 초점: 환경 변화 (인물의 반응·판단·행동·관계 흐름은 현재 상호작용에 맞게 이어간다)`
- Unchanged: model `deepseek-v4.1-flash`, `stream:false`, `temperature` 0.92, `top_p` 0.92, `thinking` disabled, `reasoning_effort` none, no `max_tokens`.

## Call result (`call-B.json`)

- route: Cheaper Inference `POST /v1/chat/completions` (non-stream), request id `cc64d6c3-c299-4f8b-9d5a-3f5c3d52caef`
- HTTP status: 200
- finish reason: `stop`
- prompt tokens: 4410
- completion tokens: 1189
- actual cost: $0.000565
- latency: 10.522 s
- raw chars: 1574
- raw text sha256: `62cfd2e40652d1946243ded8001f79fe9d2a987b71e7955ca4b7c22a0b55d31b`
- error: none

Verbatim full output: `deepseek-v4.1-flash-Q5-B-1558.txt` (same directory).

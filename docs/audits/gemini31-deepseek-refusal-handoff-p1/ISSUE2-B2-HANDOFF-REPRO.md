# Issue 2 — B2 handoff length / dialogue (one frozen-request replay)

No prompt change. No context change. No temperature / model / provider / max-token change. No new length owner. No new dialogue owner. No adapter. No Gemini tuning.

## Owners on the frozen B2 DeepSeek request

Source: `requests/B-DEEPSEEK-input.json` last user message + system continuation.

| Flag | Value |
|---|---|
| `HANDOFF_LENGTH_OWNER_PRESENT` | `true` |
| `HANDOFF_DIALOGUE_OWNER_PRESENT` | `true` |
| Length owner count (`3,200자 이상을 기본 목표로`) | 1 |
| Dialogue owner count (`최대 4개 블록`) | 1 |
| Existing continuation owner | present (`현재 사용자 턴이 확정한 장면 다음부터 이어 쓴다`) |
| Model | `deepseek-v4-pro-0813` |
| Temperature | `0.92` |
| `top_p` | `0.92` |
| `max_tokens` | absent (unchanged) |
| `thinking` | `{ type: "disabled" }` |
| `reasoning_effort` | `none` |

Request SHA of the replay body equals the original B2 capture: `e558990d8eeff541176046d568b163f2a146a34068ed72145ce5251acbd3b11d`.

## Second RAW

- `raw/B-DEEPSEEK-RAW-2.txt`
- `raw/B-DEEPSEEK-WIRE-2.txt`
- `meta/B-DEEPSEEK-2-provider.json`
- Machine compare: `ISSUE2-B2-HANDOFF-REPRO.json`

## Objective compare only

No prose similarity score. No prose quality score.

| Metric | B2 first | B2 second |
|---|---|---|
| visible chars | 1701 | 2346 |
| dialogue blocks | 8 | 10 |
| paragraph count | 17 | 20 |
| `finish_reason` | `stop` | `stop` |
| truncated | false | false |
| requested-scene completion (`삽입` + motion + `절정`/`사정`/`오르가슴`) | false | true |
| `REPETITION_CANDIDATE` | no | no |
| `CANON_CONTRADICTION_CANDIDATE` | no | no |

Requested destination on the frozen B2 user turn: `오르가슴까지 이 침대에서`. First RAW stopped before that destination. Second RAW contains lexical `절정` and a completed climax beat.

## Stop decision

The original B2 defect class was the conjunction of:

1. materially under 3200
2. more than 4 dialogue blocks
3. requested scene stops before its destination

Second replay:

- (1) still true — 2346 is still materially under 3200
- (2) still true — 10 > 4
- (3) did not repeat — destination now present

Length class and dialogue class still repeat on the same frozen request. **STOP for human/ChatGPT review.**

No adapter was created. Gemini was not tuned. The shared 3200 owner was not changed. No prompt text was added.

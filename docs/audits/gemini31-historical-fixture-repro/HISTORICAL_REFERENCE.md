# Historical reference — Audit #255 / Audit 55

## Identity

| Field | Value |
| --- | --- |
| GitHub PR | https://github.com/you8520-sketch/chat-ai/pull/255 |
| Title | docs(audit-55): Gemini 3.1 Pro vs Opus 5 minimal RP screen |
| Branch | `cursor/gemini31-opus5-minimal-screen-6a91` |
| Packet | `docs/audits/55-gemini31-opus5-minimal-screen/` |
| Runtime label | Audit 55 |
| User-facing alias in this task | Audit #255 |

## Execution (from live script + RUNTIME_RESULTS.json)

```text
path = POST /api/chat
characterId = 18
personaId = 61
model = gemini-3.1-pro-preview
provider path = Cheaper Inference interactive (production wire)
reasoning_effort = low
retry = 0
continuation = 0
recovery = 0
SceneDirective = 0
collaborative_owner = 1
legacy_novel_owner = 0
terminal_length_owner = 1
```

Each T1 started a fresh logical chat. T2 continued the matching T1 chat.

## Exact user inputs (reused in `requests/`)

Relationship:

```text
T1: 난 본기억없는데.... 나는 렌이라고 부르면 돼. *고개끄덕임* 신입 맞아.
T2: 너는 이름이뭐야? 뭐하는 중이었어?
```

Action:

```text
T1: *로비 천장에서 갑자기 비상 경보가 울리고 출입문 쪽에서 둔탁한 폭발음이 터진다. 렌은 소리가 난 쪽으로 고개를 돌린다.* 저거 뭐야?
T2: *렌은 태형의 소매를 잡고 곁에 붙는다.* 나도 같이 갈게.
```

## Historical Gemini 3.1 objective rows

From `COST_RESULTS.json` `byModel.gemini31.turns`:

| id | test_set | turn | input_tokens | visible_output_tokens | visible_chars | latency_s | ttft_s | finish_reason | reasoning_effort |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GEMINI31-REL-R1T1 | relationship | 1 | 17514 | 4205 | 4659 | 88.397 | 75.078 | stop | low |
| GEMINI31-REL-R1T2 | relationship | 2 | 21726 | 3842 | 4254 | 74.218 | 61.674 | stop | low |
| GEMINI31-ACT-R1T1 | action | 1 | 17536 | 4283 | 4743 | 95.723 | 84.886 | stop | low |
| GEMINI31-ACT-R1T2 | action | 2 | 21862 | 3914 | 4327 | 76.065 | 65.268 | stop | low |

```text
HISTORICAL_AVG_VISIBLE_CHARS ≈ 4495.75
HISTORICAL_INPUT_TOKEN_RANGE = 17514–21862
cached_input_tokens = null
reasoning_tokens = null (not populated on that done event)
```

## What was not frozen

No character row, persona row, greeting, setting chunks, or assembled system/messages for those four calls.

## Later forensic notes (do not reopen as prompt work)

PR #301: historical long #255 vs short-fixture comparison was confounded; COLLAB / IMMERSIVE / USER_TAIL / scene owners and `max_tokens` were not enough to establish a prompt-only regression.

PR #302: matched provider-route comparison CI mean 2393 vs OR mean 2178 (delta +9.9%). Route/model alias did not explain ~4496 vs ~2178.

PR #304 (G11-C5): reconstructed c18×persona61 card; `FULL_HISTORICAL_PAYLOAD_PARITY=UNKNOWN`; `CONTEXT_COMPOSITION_DELTA_HIGH`.

This packet does not start a new prompt change from PR #589 or those priors.

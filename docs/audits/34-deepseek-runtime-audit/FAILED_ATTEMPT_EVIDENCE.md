# Failed attempt evidence

## A06 — screen_confirm/run3/turn2 (1347, finish=null)

- classification: **UPSTREAM_PROVIDER_STREAM_TRUNCATED**
- provider: `cheaperinference` / `deepseek-v4-pro`
- server_request_id: `srv_msg6cz23_qqxo92hu`
- latency_s: 48.325; output_tokens: 1213; raw_equals_final: true
- RAW/SSE/DB chars: 1347/1347/1347
- abort: none; route exception: none
- tail:

```
고, 다음부터는 기한 지켜. 그리고..."

윤태건의 시선이 라이크의 옆에 선 렌에게로 옮겨갔다. 잠깐의 침묵이 흘렀다. 윤태건은 렌을 위아래로 훑어보더니, 다시 라이크에게로 시선을 돌렸다.

"새로운 가이드인가?"

"글쎄, 나도 아직 몰라. 방금 만났거든. 근데 스태틱, 너 표정이 왜 그렇게 무서워? 신입 겁먹겠다."
```

Interpretation: upstream stream ended without `finish=stop` while delivering a partial body that the app persisted. Server/client received the same incomplete text → not parser/SSE/client-capture loss.

## A08 — replacement1/run1/turn2 (99, finish=null)

- classification: **UPSTREAM_PROVIDER_STREAM_TRUNCATED**
- provider: `cheaperinference` / `deepseek-v4-pro`
- server_request_id: `srv_msg6heye_or7gy9az`
- latency_s: 14.496; output_tokens: null
- RAW/SSE capture: 99/99; DB persist: rejected by short-response guard
- provider_error_event: AI 응답이 비정상적으로 짧거나 비어 있어 저장하지 않았습니다…
- pipeline.json: absent (save path aborted)
- tail:

```
태형은 잠시 멍하니 서 있었다. 방금 자기가 먼저 밥 먹자고 했는데, 이번에는 상대가 먼저 같이 가겠다고 말했다. 순서가 뒤바뀐 게 우스워서 피식 웃음이 났다. 로비에 울리던 발
```

Interpretation: upstream body cut mid-sentence; server correctly refused persist. Missing diagnostic_pipeline is a **consequence**, not the root cause.

## Ruled out

| class | why not |
|---|---|
| SERVER_STREAM_PARSER_LOSS | No evidence of dropped finish/usage that existed upstream; trunc1 still emitted usage with null finish |
| SSE_DELIVERY_TRUNCATED | RAW=SSE(=DB when saved) |
| CLIENT_CAPTURE_INCOMPLETE | Trunc bodies match across layers; incompleteness is in the body itself |
| REQUEST_ABORTED | No abort signals in harness/metrics |

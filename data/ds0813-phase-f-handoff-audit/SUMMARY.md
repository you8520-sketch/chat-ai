# Phase F handoff acceptance — results

EVIDENCE ONLY. DO NOT MERGE. DO NOT DEPLOY.

`SOURCE_PRODUCTION_BEHAVIOR_CHANGED=false`
`QUALITY_SCORE_ASSIGNED=false`
`HUMAN_RAW_REVIEW_REQUIRED=true`

`TOTAL_REAL_DEEPSEEK_CALLS=3`
`RETRIES=0`
`CONTINUATIONS=0`

This is the **actual production Gemini → DeepSeek 0813 refusal-replacement path**.
It is not a DeepSeek-only imitation. No live Gemini call.

## Owners

SELECTED_PRIMARY=`gemini-3.7-flash`
HANDOFF_TARGET=`deepseek-v4-pro-0813`

HANDOFF_TRANSPORT:

- model=`deepseek-v4-pro-0813`
- temperature=0.92
- top_p=0.92
- thinking=`{type:"disabled"}`
- reasoning_effort=`none`

Continuity packet + handoff continuation instruction present.
`resolveDeepSeekAdultHandoffTrueOff` generated the body. No post-assembly patch.

## Parity (identical across H1/H2/H3 request)

SYSTEM_SHA=`75695e164771f9a8a20c65b39442fc2200c4eab75516f9747dd7c7013d85c2b3`
HISTORY_SHA=`d0a309ce2bfa25a041711cad6c0349b6b0878b95f9c40492e730de0ff6299e76`
CURRENT_USER_SHA=`f1814a3aa6946b0ff339e0577b8d2130729cafec6b0c42a77cc369f41e379750`
HANDOFF_PACKET_SHA=`a07aefe951e484db54bbca8813273c1d3e59f6806f4bdeca660079b3a92e49f9`
FINAL_MESSAGES_SHA=`2da61b056642fca93fa8a97f8e1f5e945aefadcf25153cd6a87a8562d78054bd`

PRECEDING_GEMINI_ASSISTANT_CHARS=2775 / 2798

## Results

H1: 3222 chars, GE_2700=true, GE_3200=true, out=2569, reasoning events=0, latency=67841, finish=stop
H2: 3090 chars, GE_2700=true, GE_3200=false, out=2473, reasoning events=0, latency=61214, finish=stop
H3: 0 chars captured — provider call started, TLS socket closed (`UND_ERR_SOCKET`). Frozen. No retry.

```
MIN_CHARS=0
AVG_CHARS=2104
MAX_CHARS=3222
COUNT_GE_2700=2
COUNT_GE_3200=1
HANDOFF_LENGTH_FLOOR_STABLE=false
```

PRIMARY_REFUSAL_VISIBLE=false
DEEPSEEK_CALLS_PER_LOGICAL_TURN=1
VISIBLE_ASSISTANT_RESPONSES_PER_TURN=H1/H2=1; H3=0
BILLING_DEDUCTIONS_PER_TURN=0 (harness isolation)
NEXT_TURN_MODEL=`gemini-3.7-flash`
DEEPSEEK_STICKY=false

Do not score prose. Do not introduce a fix.

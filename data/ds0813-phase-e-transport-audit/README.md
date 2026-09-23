# Phase E — DeepSeek 0813 transport regression isolation

EVIDENCE ONLY. DO NOT MERGE. DO NOT DEPLOY.

This packet isolates **request transport** on the exact PR #555 A_A adult STANDARD fixture (라이크 id=18).

It is **not** a real Gemini → DeepSeek handoff.
It does **not** recapture a native baseline.
It does **not** change production source behavior.

## Frozen baseline (do not recapture)

PR #555 A_A:

- VISIBLE_CHARS=1625
- OUTPUT_TOKENS=1463
- REASONING_TOKENS=0
- finish_reason=stop

SHAs (must remain identical):

- SYSTEM_SHA=`01cd8ec380ce4f5cd1759c73869536258c99cbd0d55e3dfe28e2f6c2ef787ee6`
- HISTORY_SHA=`29e3149289586f303c3ffc120a299184163b162a78e46e4f264e87231f6d1d58`
- CURRENT_USER_SEMANTIC_SHA=`f1814a3aa6946b0ff339e0577b8d2130729cafec6b0c42a77cc369f41e379750`

Frozen messages: `baseline/A_A_MESSAGES.json`

## Current code owners (`src/lib/cheaperInferenceConfig.ts`)

Native / user-selected DeepSeek V4 Pro:

- `thinking={type:"disabled"}`
- `reasoning_effort` omitted/deleted

Adult-handoff TRUE-OFF:

- `thinking={type:"disabled"}`
- `reasoning_effort="none"`

Current production DeepSeek sampling:

- temperature=0.92 (`resolveDeepSeekTemperatureForTarget`)
- top_p=0.92 (`DEEPSEEK_V4_PRO_GENERATION_PARAMS.top_p`)
- max_tokens omitted (`resolveOpenRouterMaxTokens` returns undefined)

## Calls (budget = 2)

1. **T_HANDOFF** — same A_A messages; apply current adult-handoff TRUE-OFF owner only.
2. **T_HISTORICAL** — same A_A messages; early #493 transport only (`temperature=0.7`, omit `top_p`, `thinking.disabled`, `reasoning_effort="none"`).

No native recapture. No retry. No continuation. No Gemini. No GLM. No prompt change.

## Interpretation flags (screening only)

Do not declare causality.

- `HANDOFF_TRANSPORT_LENGTH_RESTORATION_OBSERVED` if T_HANDOFF >= 2700 and native 1625 < 2700
- `HISTORICAL_TRANSPORT_LENGTH_RESTORATION_OBSERVED` if T_HISTORICAL >= 2700 and native 1625 < 2700
- `TRANSPORT_RESTORATION_NOT_OBSERVED` if both < 2700
- `COMMON_REASONING_EFFORT_NONE_SIGNAL` if both >= 2700 (signal only)

## Harness

`scripts/audit/ds0813-phase-e-transport.ts`

- `ASSEMBLE_ONLY=1` freezes outbound bodies without provider calls
- otherwise exactly two Cheaper Inference POST calls

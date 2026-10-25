# PR #455 historical length evidence — corrected freeze

Do **not** restore `DEEPSEEK_LENGTH_SINGLE_CALL_BLOCK`.

## Gemini-source true-nonthinking baseline

Visible chars: `1339` / `2258` / `2159`

`REASONING_STREAM_SEEN=false` on all three (`DS0813_GEMINI31_TRUE_NONTHINKING_1..3`).

Source: PR #455 `docs/audits/deepseek0813-adult-handoff-final/true-nonthinking/TRUE_NONTHINKING_RUNTIME.json`

## Historical length-rescue (Gemini-source + length block)

Visible chars: `3893` / `4939` / `3821`

`REASONING_STREAM_SEEN=true` on all three

Reasoning text chars: `8008` / `9588` / `819` (range 819–9588)

Source: PR #455 `docs/audits/deepseek0813-adult-handoff-final/length-rescue/LENGTH_RESCUE_RUNTIME.json`

## Corrected flags

```
HISTORICAL_LENGTH_RESCUE_END_TO_END_EFFECT_OBSERVED=true
HISTORICAL_LENGTH_BLOCK_EFFECT_UNDER_TRUE_ZERO_REASONING_PROVEN=false
```

The rescue run was **not** a true-zero-reasoning proof. End-to-end length increase was observed while a reasoning stream was present.

## Separate #455 observation — Opus-source true-zero-reasoning DeepSeek

Visible chars: `4136` / `3884` / `3721`

(`DS0813_OPUS_TRUE_NONTHINKING_1..3`; same set as `3721 / 4136 / 3884`)

`REASONING_STREAM_SEEN=false` on all three.

This is evidence that previous assistant / history shape can materially affect DeepSeek output length. Do not claim exact causality beyond that observation.

PR #555 A/B/C used greeting-only history and all failed the 2700 floor under true-zero reasoning. Do not select C merely because it was longest.

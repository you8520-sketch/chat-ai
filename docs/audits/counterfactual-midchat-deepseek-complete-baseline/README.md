# Counterfactual DeepSeek complete-baseline (measurement repair)

Evidence-only. **Does not edit PR #621 frozen RAW.** No production runtime changes.

Source request is a read-only copy of the #621 DeepSeek wire:

`PREVIOUS_REQUEST_SHA = 85ae4e16ba3e002dc1dcd84911f3263c68679904e5d3316a0f365fd084003731`

## Why this PR exists

#621 transport passed, but the DeepSeek collection ended mid-sentence with `finishReason=null`, `usage=null`, HTTP 200. Length/completion judgment is not valid on that artifact.

## Commands

```bash
npx tsx docs/audits/counterfactual-midchat-deepseek-complete-baseline/scripts/selftest-collector.ts
npx tsx docs/audits/counterfactual-midchat-deepseek-complete-baseline/scripts/run-complete-baseline.ts --audit-only
npx tsx docs/audits/counterfactual-midchat-deepseek-complete-baseline/scripts/run-complete-baseline.ts
```

If `BASELINE_STREAM_VALID=false`, the harness stops. No style experiment.

H1 (skip DeepSeek style reminder) is **not executed** here.

# Gemini 3.7 Flash experiment D — numeric-only USER_TAIL owner

```text
#432 SYSTEM length owner = REJECT (PR closed, no merge/deploy)
B wording = REJECT
C wording = REJECT
production = vanilla USER_TAIL owner
D = 3,200 vs 4,000 number only
retry = 0
continuation = 0
recovery = 0
reasoning_effort = low
max_tokens = omitted
merge = NO
deploy = NO
```

## Implementation

One template. `resolveUserTailLengthOwnerSentence({ modelId, experimentArm })`.

- default / arm A / all other models = `3,200`
- Gemini 3.7 Flash + arm B only = `4,000`
- Production never sets `userTailLengthOwnerArm` → stays vanilla `3,200`

Assembled A/B diff:

```text
SYSTEM diff = 0
history diff = 0
character diff = 0
current user diff = 0 except owner number
owner placement diff = 0
owner count = 1
only change = "3,200" -> "4,000"
```

## Short-context canonical 3 (A/B once each)

Same greeting snapshot. No growing from own outputs. INVALID_TRANSPORT excluded. No retry.

| cell | arm | chars | outTok | finish | cost USD | invalid | rep | agency | speech |
|---|---|---:|---:|---|---:|---|---|---|---|
| S1 | A | 2787 | 1770 | stop | 0.006911 | no | no | no | ok |
| S1 | B | 417 | 0 | null | n/a | YES | — | — | — |
| S2 | A | 2658 | 1737 | stop | 0.006832 | no | no | no | ok |
| S2 | B | 96 | 0 | null | n/a | YES | — | — | — |
| S3 | A | 1662 | 1089 | stop | 0.005139 | no | no | no | ok |
| S3 | B | 1847 | 1180 | stop | 0.005378 | no | no | no | ok |

```text
valid A n = 3  avg chars = 2369
valid B n = 1  avg chars = 1847
paired S3 only: A 1662 / B 1847
B mean >= 3000 = false
B meaningfully longer than A = false
growing-history expanded = NO
```

S1-B and S2-B are incomplete streams (`finish=null`, usage=0). Excluded. Not retried.

## Verdict

```text
KEEP_VANILLA
NUMERIC_OWNER_CANDIDATE = false
```

B did not produce a meaningful short-context length gain. Valid B n=1 is below 3000 and below the valid A average. Stop. No growing-history. No new wording experiment.

Production remains the vanilla 3,200 USER_TAIL owner.

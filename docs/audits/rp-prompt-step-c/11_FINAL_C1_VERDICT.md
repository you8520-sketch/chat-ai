# 11_FINAL_C1_VERDICT

```text
STEP_C1_STATUS: COMPLETE
branch: cursor/rp-common-layout-dedupe-c1-6a91
commit: pending seal commit on branch tip
draft PR: https://github.com/you8520-sketch/chat-ai/pull/271
baseline main: 7cb23ec3e6837c9290ecca2fab2f51f17bb42ee2
baseline hashes captured: YES (00_BASELINE_HASHES.md)

layout A tokens: 670
layout B tokens: 281
reduction: 389
reduction percent: 58.1%
dynamic token reduction: 389 (estimated; layout is dynamic)
cacheable token reduction: 0

semantic parity: PASS

Gemini:
  D A/B: B preferred (blind Y)
  N A/B: A preferred (blind X); B quality inferior
  hard format regression: 0 glued (refined)
  human winner: MIXED (D→B, N→A)

DeepSeek:
  D A/B: A preferred (blind Y)
  N A/B: A preferred; B incomplete + user-dialogue echo
  hard format regression: completion fail on N/B
  human winner: A

Opus:
  tested: NO (cheap gate failed)
  A chars: n/a
  B chars: n/a
  literary A: n/a
  literary B: n/a
  premium distinctiveness A: n/a
  premium distinctiveness B: n/a
  human winner: n/a

Terra:
  tested: NO (cheap gate failed)
  A chars: n/a
  B chars: n/a
  hard regression: n/a
  human winner: n/a

raw provider layout violations: DeepSeek_N_B incomplete; reported-speech quotes only elsewhere
final display layout violations: no additional glued-dialogue after postprocess on cheap cells
agency severe A: 0
agency severe B: 0
input echo regression: DeepSeek_N_B reprints user dialogue line
metadata leak regression: 0 observed

API calls:
  Gemini 4 / DeepSeek 4 / Opus 0 / Terra 0
  transport aborted 0 / quality retries 0 / continuations 0 / recoveries 0

actual input token savings: ~175–186 per measured A/B pair (sum 536 on 3 pairs with usage)
actual cost delta if available: usage.cost null from provider on these cells

C1 verdict: LAYOUT_COMPACT_REJECT

production prompt: UNCHANGED
merge: NOT_RUN
C2 live: NOT_RUN
C3 live: NOT_RUN
```

## Why reject

Offline compression + semantic parity succeeded, but live cheap-model gate failed quality non-inferiority:

1. Fixture N / DeepSeek Arm B truncated mid-sentence and echoed user dialogue into narration.
2. Fixture N / Gemini Arm B was materially weaker on density / literary presence vs production layout.
3. Blind tally: A wins 3, B wins 1 — does not meet `B wins + ties >= A wins`.

Token reduction alone is insufficient under the 100-point quality principles.

## Stop

No production layout replace. No prose/hygiene edits. Await human review for any next step.

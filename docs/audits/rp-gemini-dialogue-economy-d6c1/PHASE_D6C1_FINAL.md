# PHASE_D6C1_FINAL

```
PHASE_D6C1_FINAL:
baseline main: 7f0c54b60e7ace11bc6e4eea9c820caadde24853
branch: cursor/rp-gemini-dialogue-economy-d6c1-96c2
commit: 96ada67e896b433ea30ff552b98f544dc4358dc8
draft PR: https://github.com/you8520-sketch/chat-ai/pull/286
sole variable: IMMERSIVE_PROSE_DIALOGUE_SEMANTIC_OWNER
new system sections: 0
new negative directives: 0
dialogue percentage prompt: NONE
system token delta: ~23 (≤30)
history: BYTE_IDENTICAL
user tail: BYTE_IDENTICAL
runtime: BYTE_IDENTICAL

G3 A:
  chars: [3887, 2964, 2682] (median 2964.0)
  dialogue shares: [0.1111, 0.2206, 0.11]
  response anchors (auto/human): [3, 1, 0] / [3, 1, 1]
  function loads: [4, 4, 3]
  overload draws: 1 (auto 1)
  fragmentation: [0, 0, 4]
  canon: [2, 2, 2]
  fidelity: [2, 2, 2]
  scene advancement: [2, 2, 2]
  new scene value: [2, 2, 2]
  collapse: 0/3

G3 B:
  chars: [1340, 1155, 1436] (median 1340.0)
  dialogue shares: [0.1396, 0.1195, 0.1818]
  response anchors (auto/human): [1, 0, 2] / [1, 1, 2]
  function loads: [5, 3, 4]
  overload draws: 0 (auto 0)
  fragmentation: [0, 4, 0]
  canon: [2, 2, 2]
  fidelity: [2, 2, 2]
  scene advancement: [1, 1, 1]
  new scene value: [1, 1, 1]
  collapse: 3/3

dialogue load reduction: PARTIAL (overload draws ↓; function-load median unchanged at 4) → FAIL gate with length
non-dialogue character presence: PRESERVED
dialogue-to-recital displacement: NO
length regression: YES (B median / A = 0.452; B collapse 3/3)

final: GEMINI_DIALOGUE_RESPONSE_ECONOMY_FAIL
fail classification: DIALOGUE_ECONOMY_LENGTH_COLLAPSE, FUNCTION_LOAD_STILL_HIGH, RESPONSE_LOAD_REMOVED_BUT_SCENE_VALUE_LOST
production wire: NOT_RUN
merge: NOT_RUN
LLM calls: 6
STOP.
```

## Decision notes

1. G3 was discriminative this run (A_D1 RESPONSE_OVERLOAD=3; A function loads 4/4/3).
2. B reduced overload draws (1→0) and kept CHARACTER_PRESENCE_NON_DIALOGUE + canon/fidelity, but **hard-failed length** (median 45% of A; 3/3 &lt;1800).
3. Function-load median stayed 4 (not ≤3; not ≤ A−1). Scene value thinned vs A.
4. No production wire. No D6-C2 layout/fragmentation trial (requires C1 PASS). STOP.

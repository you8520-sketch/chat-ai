# PHASE_D7A_FINAL

```
PHASE_D7A_FINAL:
baseline main: 7f0c54b60e7ace11bc6e4eea9c820caadde24853
branch: cursor/rp-gemini-selective-repair-d7a-96c2
commit: (evidence seal; see git tip)
draft PR: https://github.com/you8520-sketch/chat-ai/pull/287
primary production changes: 0
new primary calls: 0
repair calls: 3

R1 RESPONSE_OVERLOAD:
  original chars: 3887
  repair chars: 2720
  anchors: 3 / 1
  function load: 4 / 2
  scene advancement: 2 / 2
  new scene value: 2 / 2
  agency: PASS
  replacement-content: NO
  result: FAIL

R2 CANON_RECITAL:
  original chars: 3475
  repair chars: 2836
  recital chars: 144 / 70
  recital per 1000: 41.4 / 24.7
  active canon: PASS
  fidelity: PASS
  scene value: PASS
  replacement-content: YES
  result: PASS

R3 CURRENT_INPUT_REPLAY:
  original chars: 2699
  repair chars: 2037
  replay severity: 2 / 1
  replay chars: ~180 / ~60
  scene advancement: 2 / 2
  agency: PASS
  replacement-content: NO
  result: FAIL

cost:
  R1: input=7447 reasoning=4164 output=6547 cost_usd=0.093458
  R2: input=7028 reasoning=1408 output=3876 cost_usd=0.060568
  R3: input=6377 reasoning=1077 output=2816 cost_usd=0.046546
  total_repair_usd: 0.200572

replacement-content:
  R1: NO
  R2: YES
  R3: NO

overall: 1/3 = GEMINI_SELECTIVE_REPAIR_FAIL
production wire: NOT_RUN
merge: NOT_RUN
STOP.
```

## Decision notes

1. Selective repair **can** reduce a named defect (R1 overload↓, R2 recital↓, R3 replay severity↓) without inventing user agency.
2. Length/replacement gate failed on R1 and R3 — defect removal often came with net scene-value loss.
3. Because **R1 FAIL**, do not adopt dialogue-overload post-generation repair as a product strategy.
4. D7-B trigger-rate audit **NOT_RUN** (requires directional/strong candidate).
5. Next strategic options if staying stopped: accept Gemini weaknesses / change primary model / user-triggered regen UX — not more primary prompt tuning.

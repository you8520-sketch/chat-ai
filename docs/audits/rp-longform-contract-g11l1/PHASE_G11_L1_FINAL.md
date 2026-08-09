# PHASE_G11_L1_FINAL

```
PHASE_G11_L1_FINAL:
base: 7f0c54b60e7ace11bc6e4eea9c820caadde24853
branch: cursor/single-terminal-longform-contract-g11l1-96c2
draft PR: https://github.com/you8520-sketch/chat-ai/pull/297

architecture: SINGLE_TERMINAL_LONGFORM_RESPONSE_CONTRACT
terminal owners:
old length: 0
old dialogue: 0
new combined: 1
length semantics:
base target: >=3200
upper ceiling: NONE

Stage1 B/D/F:
chars: B 1917/1285 · D 882/505 · F 746/724
mean: 1010
median: 814
<2000: 6/6
speech blocks/budget: B 6/4 FAIL · 4/4 · D 4/6 · 4/6 · F 3/4 · 3/4
repetition: low
canon padding: low
semantic filler: not systematic
scene value: degraded by density collapse (short)
agency: 0 severe
cap-reached vs short matrix:
SHORT + CAP_REACHED: 1
SHORT + CAP_NOT_REACHED: 5
LONG + CAP_REACHED: 0
LONG + CAP_NOT_REACHED: 0

Stage2: NOT_RUN

overall:
mean: 1010
median: 814
<2000: 6/6
>4000: 0
>5000: 0
max chars: 1917
dialogue binding: FAIL (B D1 6>4)
pacing: preserved (frozen)
quality: density collapse
agency severe: 0

classification: SINGLE_TERMINAL_LONGFORM_CONTRACT_FAIL
fail axes:
- NO_LENGTH_IMPROVEMENT (mean 1010 vs I1 BDF ~2148; delta -1138)
- LONGFORM_CONTRACT_DIALOGUE_REGRESSION (B blocks 6 > max 4)

production wire: NOT_RUN
merge: NOT_RUN
LLM calls: 6
STOP.
```

## Notes

- `#296` server-control freeze preserved; resolvers untouched.
- No wording v2/v3 attempted (phase rule after Stage1 FAIL).
- Cap-as-early-stop hypothesis not primary: most shorts were CAP_NOT_REACHED.
- Next work (outside this FAIL seal) must not reopen Scene Pacing / budget numbers without a new explicit phase.

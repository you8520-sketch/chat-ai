# PHASE_G11_C1_FINAL

```
PHASE_G11_C1_FINAL:
base: 7f0c54b60e7ace11bc6e4eea9c820caadde24853
branch: cursor/server-control-length-tax-baseline-g11c1-96c2
draft PR: https://github.com/you8520-sketch/chat-ai/pull/300
new calls: 6
provider parity: CONFOUNDED
  (2/6 A draws: "Google" vs V "Google AI Studio"; same Google Gemini family)

B:
A chars: 2789 / 1933
V chars: 4068 / 1924
A speech blocks: 5 / 8
V speech blocks: 3 / 4
quality comparison: A more dialogue; V longer on D1; no forced-event pad

D:
A chars: 2057 / 2798
V chars: 1518 / 1983
A speech blocks: 7 / 4
V speech blocks: 6 / 5
quality comparison: A longer mean; communication usable; A uncapped speech on D1

F:
A chars: 1631 / 1862
V chars: 1739 / 1657
A speech blocks: 3 / 2
V speech blocks: 3 / 4
quality comparison: near-parity short intimate dyad

A BDF:
mean: 2178
median: 1995
<2000: 3/6

V BDF:
mean: 2148
median: 1832
<2000: 5/6

length delta:
absolute: +30
percent: +1.4%

quality:
A repetition: low
A canon padding: low
A agency: 0 severe
A dialogue overload: mild (uncapped B/D highs)
V quality reference: I1 SERVER_CONTROL_PASS_LENGTH_STABILITY_REMAINS

classification: BASELINE_GEMINI_LENGTH_INSTABILITY
next branch: C3 ONE-CALL LENGTH ROOT CAUSE AUDIT
  (NOT continuation / recovery / supplement)
  ONE TURN = ONE PRIMARY LLM CALL

production wire: NOT_RUN
merge: NOT_RUN
LLM calls: 6
STOP.
```

## Notes

- Removing experimental Scene Pacing + dialogue budget did **not** produce a ≥25% / ≥2800 length lift.
- Domain split: D longer without controls; B shorter; F flat — not a clean quiet-only tax.
- BRANCH B policy: no second-call length fix; next is one-call root-cause audit (early-stop / beat budget / agency / assembly / param parity).

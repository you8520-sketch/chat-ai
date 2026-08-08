# PHASE_D6B1_FINAL

```
PHASE_D6B1_FINAL:
baseline main: 7f0c54b60e7ace11bc6e4eea9c820caadde24853
branch: cursor/rp-gemini-opening-role-remap-d6b1-96c2
commit: 6e0e5d13cfe1b5633f1cd14d100abb3af2893813
draft PR: https://github.com/you8520-sketch/chat-ai/pull/285
production diff: 0
system prompt diff: 0
runtime diff: 0
sole variable: OPENING_GREETING_ROLE

A:
  creator greeting role: assistant history
B:
  creator greeting role: current-turn context prefix
greeting content SHA equal: YES
system SHA A == B: YES
input token delta (median): -5

G5 A:
  chars: 2991 / 360 / 2631 (median 2631)
  opening replay scores: 0 / 0 / 1 (median 0)
  opening replay / 1000: 0 / 0 / 4.56 (median 0)
  scene advancement median: 2
  new scene value median: 2
  collapse count (<1800): 1/3

G5 B:
  chars: 1572 / 2899 / 1106 (median 1572)
  opening replay scores: 0 / 0 / 0 (median 0)
  opening replay / 1000: 0 / 0 / 0 (median 0)
  scene advancement median: 2
  new scene value median: 2
  collapse count (<1800): 2/3

replay reduction: NO
  (B median score not ≥1 step below A; per/1000 median already 0 → no ≥30% drop)
replacement content: NO
fidelity: A 2 / B 2 (non-inferior)
setting recital: A 3/1/2 / B 1/1/0 (secondary only; not forced)
current-input replay: A 0/0/0 / B 0/0/0
dialogue (share / anchors / function load):
  A: 0.100/0.097/0.110 · 1/0/2 · 3/1/3
  B: 0.121/0.088/0.090 · 2/0/0 · 3/2/1
  (observe only; owner unmodified)

final: GEMINI_OPENING_ROLE_REMAP_FAIL
fail classification:
  1. ASSISTANT_ROLE_OPENING_EXEMPLAR_NOT_CAUSAL
  2. ROLE_REMAP_LENGTH_COLLAPSE
production wire: NOT_RUN
merge: NOT_RUN
LLM calls: 6
STOP.
```

## Decision notes

1. **Primary metric failed.** Production Arm A already rarely restaged the creator greeting on this G5 set (scores 0/0/1). Remapping greeting from assistant history → current-turn context prefix did not produce a measurable opening-replay reduction.

2. **Length gate failed.** B median chars / A median = **0.597** (&lt; 0.70). Collapse &lt;1800 increased 1/3 → 2/3.

3. **Replacement-content gate failed.** Replay was already low on A; B’s shorter median is not “replay removed and replaced with more new scene.”

4. Per brief §15: no header wording search, no system placement search, no “already occurred” reinforcement. **STOP.**

5. D6-B2 (current-input replay) **not started** (requires B1 PASS).

## Evidence

| artifact | path |
|---|---|
| Preaudit | `docs/audits/rp-gemini-opening-role-remap-d6b1/00_PREAUDIT.md` |
| Live JSON | `docs/audits/rp-gemini-opening-role-remap-d6b1/g5/01_G5_LIVE.json` |
| Human scores | `docs/audits/rp-gemini-opening-role-remap-d6b1/g5/02_G5_HUMAN_OPENING_REPLAY.md` |
| Raw outputs | `docs/audits/rp-gemini-opening-role-remap-d6b1/raw/` |
| Harness | `scripts/rp-quality-d6b1-gemini-opening-role-remap.ts` |

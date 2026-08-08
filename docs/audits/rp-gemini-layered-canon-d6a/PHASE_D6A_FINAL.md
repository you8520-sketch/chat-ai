# PHASE_D6A_FINAL — Gemini Layered Canon Surface

```
baseline main: 7f0c54b60e7ace11bc6e4eea9c820caadde24853
branch: cursor/rp-gemini-layered-canon-d6a-96c2
commit: (seal tip)
draft PR: https://github.com/you8520-sketch/chat-ai/pull/284

production prompt diff: 0
new instruction: 0
runtime diff: 0

context variable:
  LEGACY_FULL_CANON
  vs
  LAYERED_CORE_PLUS_ACTIVE


PREAUDIT:
  layered infrastructure usable: YES
  runtime LLM required: NO
  migration required: NO

  legacy canon chars: 2327
  legacy canon tokens≈: 1164

  layered core chars: 783
  layered active chars (G5): 202
  layered total chars (G5): 985
  surface reduction: 58%

  NEW_SYSTEM_SECTION_COUNT: 0
  NEW_INSTRUCTION_TOKENS: 0

  Gemini production policy: FULL_LEGACY (unchanged)
  Arm B: harness-only synthetic LAYERED + in-memory compileCanonPlanV1


G5:
  A chars: [1862, 3475, 2544]  median 2544  collapse(<1800)=0
  B chars: [1556, 2029, 1774]  median 1774  collapse(<1800)=2

  A canon recital chars (agent attribution): [106, 144, 58]  median 106
  B canon recital chars (agent attribution): [170, 48, 56]   median 56

  A recital / 1000: [56.9, 41.4, 22.8]  median 41.4
  B recital / 1000: [109.3, 23.7, 31.6] median 31.6

  recital reduction: 23.7%   (gate >=30% → FAIL)

  A fidelity: PASS / PASS / PASS
  B fidelity: PASS / PASS / PASS

  A active canon: PASS / PASS / PASS
  B active canon: PASS / PASS / PASS

  A/B collapse counts: 0 / 2
  B median / A median: 0.697  (<0.70 → length regression)

  verdict: FAIL

  fail reasons:
    - recital reduction 23.7% < 30%
    - B collapse materially ↑ (0→2)
    - B median chars < 70% of A


G3 confirmation:
  RUN / NOT_RUN: NOT_RUN
  (Stage 1 FAIL → STOP per budget)


final: GEMINI_LAYERED_CANON_FAIL
       / D6A_LAYERED_CANON_FAIL

production wire: NOT_RUN
merge: NOT_RUN

next if PASS: D6-B RECENT SCENE FRONTIER PACKAGING
next after FAIL: do NOT add anti-recital wording;
               do NOT invent new canon architecture in this phase;
               STOP.

LLM calls total: 6
STOP.
```

## Notes

1. **Infrastructure was ready** — existing `compileCanonPlanV1` / `selectActiveCanonChunks` / `renderCoreCanonBlock` worked offline with 0 LLM compile calls.
2. **Surface reduction ≠ recital reduction** — G5 canon bytes dropped ~58%, but Gemini still emitted setting/identity exposition (esp. B_D1 hair/scar/pod + originals lecture). Median recital/1000 only fell ~24%.
3. **Length regression** under layered surface was material on this 3×3 draw (Gemini sampling variance remains high; B shorter overall).
4. No prompt wording was added to “fix” recital. Per phase rules, FAIL ends the experiment.

# D7-A — Human Selective Repair Review

## Cases

### R1 RESPONSE_OVERLOAD — **FAIL**
| | original | repaired |
|---|---:|---:|
| chars | 3887 | 2720 (ratio **0.70**) |
| anchors | 3 | **1** |
| function load | 4 | **2** |
| scene / nsv | 2 / 2 | 2 / 2 |
| agency | — | PASS |
| replacement | — | **NO** |

Length gate FAIL (`>=0.80` or `>=3000`). Overload itself improved.

### R2 CANON_RECITAL — **PASS**
| | original | repaired |
|---|---:|---:|
| chars | 3475 | 2836 (ratio **0.816**) |
| recital chars | 144 | **70** |
| recital /1000 | 41.4 | **24.7** (−40.3%) |
| active canon / fidelity | — | PASS / PASS |
| scene / nsv | 2 / 2 | 2 / 2 |
| replacement | — | **YES** |

### R3 CURRENT_INPUT_REPLAY — **FAIL**
| | original | repaired |
|---|---:|---:|
| chars | 2699 | 2037 (ratio **0.755**) |
| replay severity | 2 | **1** |
| replay attrib chars | ~180 | ~60 |
| scene / nsv | 2 / 2 | 2 / 1 |
| agency | — | PASS |
| replacement | — | **NO** |

Length gate FAIL (`>=0.80` or `>=2800`). Severity improved.

## Cost (repair calls only)

| case | input | reasoning | output | USD |
|---|---:|---:|---:|---:|
| R1 | 7447 | 4164 | 6547 | 0.093458 |
| R2 | 7028 | 1408 | 3876 | 0.060568 |
| R3 | 6377 | 1077 | 2816 | 0.046546 |
| **total** | | | | **0.200572** |

## Verdict

`GEMINI_SELECTIVE_REPAIR_FAIL` (1/3)

R1 FAIL ⇒ do **not** adopt dialogue-overload repair strategy.
Production wire NOT_RUN. Merge NOT_RUN. STOP.

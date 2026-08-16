# D6-B1 G5 — Opening replay human scores

## Greeting facts (already occurred)

1. Enoch leaning in ruined shop shade  
2. Flashlight off; mask under chin  
3. Distant metal-shutter scrape begins  
4. Without looking at Ren: `"소음 내지 마. 따라와."`

## Scoring

| Score | Meaning |
|---:|---|
| 0 | No opening restage; proceed from established state |
| 1 | Short continuity callback only |
| 2 | Partial restage of opening beat/action |
| 3 | Substantial re-performance / new intro |

## Per-cell

| cell | chars | score | attributed replay chars | per/1000 | notes |
|---|---:|---:|---:|---:|---|
| A_D1 | 2991 | **0** | 0 | 0 | Ongoing reaction; shutter scrape continues (USE). No lean/flashlight/first-line restage. Heavy world recital ≠ opening replay. |
| A_D2 | 360 | **0** | 0 | 0 | Collapse. Continuity scrape closer. No greeting restage. |
| A_D3 | 2631 | **1** | ~12 | 4.6 | Continuity: scrape stops → cover mouth. Exit `"따라와"` = short callback, not full opening re-intro. |
| B_D1 | 1572 | **0** | 0 | 0 | Explicit past scrape (“방금 전까지”); new control/pull. |
| B_D2 | 2899 | **0** | 0 | 0 | Present-tense scrape elaboration = ongoing USE, not first establishment of greeting beat. |
| B_D3 | 1106 | **0** | 0 | 0 | Continuity stop + pull to cover; no greeting restage. |

## Aggregates

| arm | scores | median score | median per/1000 | chars median | collapse &lt;1800 |
|---|---|---:|---:|---:|---:|
| A | 0 / 0 / 1 | **0** | ~0 | 2631 | 1/3 |
| B | 0 / 0 / 0 | **0** | 0 | 1572 | **2/3** |

**Replay reduction:** none (median score already 0; per/1000 not ≥30% meaningful drop)

**Length:** B median / A median = 0.60 (**&lt; 0.70 FAIL**); collapse 1→2 (strong review)

## Secondary (agent)

| | A | B |
|---|---|---|
| SCENE_ADVANCEMENT | high / low / high | med / high / med-low — **not clearly ≥ A** |
| NEW_SCENE_VALUE | same pattern | same — **not clearly ≥ A** |
| CHARACTER_FIDELITY | PASS | PASS (non-inferior) |
| ACTIVE_CANON_USE | PASS | PASS |
| REPLACEMENT_CONTENT | — | **NO** — B shorter without clear new-scene surplus |

## Verdict

`GEMINI_OPENING_ROLE_REMAP_FAIL`

Fail classification:

1. **ASSISTANT_ROLE_OPENING_EXEMPLAR_NOT_CAUSAL** — production A already low opening-replay on this G5 draw set; role remap did not improve the primary metric.
2. **ROLE_REMAP_LENGTH_COLLAPSE** — B median &lt; 70% of A; collapse count increased.

No header/wording search. STOP.

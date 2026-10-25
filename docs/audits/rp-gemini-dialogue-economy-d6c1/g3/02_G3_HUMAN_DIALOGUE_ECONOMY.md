# D6-C1 G3 — Human Dialogue Response Economy Review

## Continuity of scoring

- **RESPONSE_ANCHOR**: independent user-must-answer points (question/request/proposal/directive/decision/relationship check).
- **DIALOGUE_FUNCTION_LOAD**: distinct functions in spoken lines (question/explanation/joke/warning/proposal/relationship_claim/directive).
- Non-dialogue presence: action / gaze / distance / inner judgment / tactics / env reaction.

## Per-cell

| cell | chars | anchors (auto→human) | fn load | presence | scene/nsv | note |
|---|---:|---|---:|---|---|---|
| A_D1 | 3887 | 3→3 OVERLOAD | 4 | PRESERVED | 2/2 | Multi-directive lecture |
| A_D2 | 2964 | 1→1 | 4 | PRESERVED | 2/2 | Dense explanation pack |
| A_D3 | 2682 | 0→1 | 3 | PRESERVED | 2/2 | Best A economy |
| B_D1 | 1340 | 1→1 | 5 | PRESERVED | 1/1 | Collapse; thinner scene |
| B_D2 | 1155 | 0→1 | 3 | PRESERVED | 1/1 | Cleaner intent; short |
| B_D3 | 1436 | 2→2 | 4 | PRESERVED | 1/1 | Still multi-function |

## Aggregates

| | A | B |
|---|---|---|
| median anchors (human) | 1.0 | 1.0 |
| overload draws (human) | 1 | 0 |
| median function load | 4.0 | 4.0 |
| median chars | 2964.0 | 1340.0 |
| B/A char ratio | | **0.452** |
| collapse &lt;1800 | 0/3 | **3/3** |
| presence | — | PRESERVED |
| dialogue→recital displacement | — | NO |
| scene value lost flag | — | YES |

## Gates

- Discriminative this run: **YES** (A_D1 overload + A function loads 4/4/3)
- Primary core (B med anchors≤2 AND overload↓): **True**
- Length hard fail: **True**
- Scene non-inferior: **False**
- Fidelity/canon non-inferior: **True/True**

## Verdict

`GEMINI_DIALOGUE_RESPONSE_ECONOMY_FAIL`

Classification: `DIALOGUE_ECONOMY_LENGTH_COLLAPSE, FUNCTION_LOAD_STILL_HIGH, RESPONSE_LOAD_REMOVED_BUT_SCENE_VALUE_LOST`

Production wire NOT_RUN. Merge NOT_RUN. LLM calls 6. STOP.

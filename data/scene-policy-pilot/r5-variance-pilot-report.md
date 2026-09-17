# R5 boundary variance pilot

Status: R5_VARIANCE_PILOT_COMPLETE
Planned: 6
Successful: 6
Estimated plan USD: 0.069
Actual upstream USD est.: 0.0701

## Runtime / state (canonical owners)

- Classification: **ROOT_CAUSE_FIXED** — V2 boundary contract + reconvergence hook provenance
- All 6 observed turns: `hold_current_beat`, `temporary_quiet`, `eventBudget=0`

## Lexical suspicion signals (triage only)

**Not semantic scoring. Not a behavior violation rate.**

The prior broad scanner reported `5/6 violation`; corrected negation/actor/location-aware triage finds **0/6 samples with any lexical suspicion signal** on the stored raw outputs.

| Signal | Count (6 samples) |
|--------|-------------------|
| physical_revisit | 0 |
| remote_contact | 0 |
| gift_drop_off | 0 |
| future_meeting_request | 0 |
| boundary_clarification | 0 |
| relationship_closure_demand | 0 |
| **Any signal** | **0** |

Known prior false-positive patterns (fixed in evaluator): negated compliance prose (`메시지 앱을 열어 보지 않`), prohibitive meta (`전화를 걸어 … 행위는 침범`), own-home door scenes (`자신의 집 현관문`), routine diary `내일` mentions.

Scanner owner: `scanR5BoundarySuspicionSignals()` — lexical review / triage only.

## External semantic review (observed six samples)

Independent GPT review of the same six raw outputs:

- **Confirmed action violations: 0 / 6 observed samples**
- No confirmed physical revisit, remote contact, or boundary-clarification **actions** in provider prose

This does **not** claim universal zero-variance across all temperatures/models; it only characterizes the six captured samples.

## Evaluator bug (resolved this turn)

- **VIOLATION_SCANNER_FALSE_POSITIVE_BUG** — prior `scanR5BoundaryViolations()` used broad lexical regex without negation/actor scoping
- Corrected classification: observed output **BOUNDARY_OUTPUT_COMPLIANT_IN_OBSERVED_SAMPLES**; residual lexical hits were evaluator artifacts, not evidence of 5/6 behavior failure

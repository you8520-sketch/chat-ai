# TRPG mechanics referee temporal QA

## Runtime ownership

The pre-GM referee receives `previousNarration`, current submissions, and
current server rolls. It runs before the current GM result exists. The
authoritative mechanics packet is then sent to the current GM call.

```text
REFEREE_SCENE_SOURCE=previousNarration
CURRENT_GM_RESULT_AVAILABLE_TO_REFEREE=false
MECHANICS_RUNS_BEFORE_CURRENT_GM=true
MECHANICS_PACKET_SENT_TO_CURRENT_GM=true
```

## Existing 30-fixture evidence

`scripts/trpg-mechanics-referee-effectiveness-qa.ts` is retained as:

```text
QA_TIMING_MODEL=RESOLVED_OUTCOME_SYNTHETIC_QA
```

It measures model capability when resolved outcomes are supplied, not the
production pre-GM timeline. Definite current-outcome leakage includes:

- Physical consequences already occurring: `A1`, `A3`, `A5`
- Ongoing conditions already established: `C1`–`C5`
- Current treatment action/outcome in scene text: `D1`–`D5`
- Partial-result consequences already stated: `E1`–`E5`
- Mixed current-result statements: `F1`, `F4`

Other fixtures may still provide action-adjacent context that is richer than a
real previous scene. Do not use this set as an enable gate for pre-GM runtime
classification.

## Production-realistic set

`scripts/trpg-mechanics-referee-pre-gm-runtime-qa.ts` exports
`PRE_GM_RUNTIME_QA`. Every fixture's `previousScene` ends before the current
action resolves. It is evidence for future pre-GM classifier decisions only.

Post-GM V1 promotion does not scrape narration. It uses newly-added canonical
labels from GM `players[].conditions`, then applies conservative server-owned
ongoing defaults.

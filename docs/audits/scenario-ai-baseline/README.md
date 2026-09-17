# Scenario AI 자동생성 품질 baseline audit

Phase 2 UX (`#559`, production `f1887e08`) is frozen. This audit measures the current DeepSeek V4 Flash 0731 vanilla draft quality before any prompt / schema / merge / FIELD SEMANTICS work.

## Guardrails

- Do not change production code, prompt strings, schema, or merge logic first.
- Do not add FIELD SEMANTICS in this audit.
- Measure the live production path: `POST /api/trpg/scenarios/ai-draft`.
- Model under test: `deepseek-v4-flash-0731` (`TRPG_SCENARIO_DRAFT_MODEL`).
- Endpoint, billing, TRPG runtime contract, and DB schema stay untouched.

## Fixture

First-create empty `fill_empty` (no world):

- `worldId = null`
- `mode = fill_empty`
- empty title / plan / NPCs / inventory
- no selected/locked fields

This is the same empty first-create the Phase 2 editor sends.

## What is scored (observation only)

Visible 5-field spine only:

1. title
2. startingSituation
3. centralConflict
4. goal
5. endingConditions

Plus parse/lint/readiness from the existing production response. No new scoring rubric is applied to production code.

## Status

See `STATUS.md`.

# Baseline status — vanilla DeepSeek V4 Flash 0731

Measured against live production after `#559` deploy.

- production URL: `https://chat-ai-production-3e84.up.railway.app`
- health `gitCommit`: `f1887e0` (`f1887e0895e3fd854f84bb2cd9ddd92d1e72b75e`)
- PR `#559` HEAD: `ed2f5f1590a9ac0b5ee04e384afadfa0ec705b2f`
- path: `POST /api/trpg/scenarios/ai-draft`
- fixture: `empty-fill-empty.json` (no world, first-create empty)
- production code / prompt / schema / merge: unchanged
- FIELD SEMANTICS: not added

## Samples

| id | HTTP | ms | model | title | start | conflict | goal | endings | npcs | lint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sample01 | 200 | 19906 | deepseek-v4-flash-0731 | 잊힌 종탑의 메아리 | filled | filled | filled | 0 | 0 | missing_endings, no_ending_conditions, recovery_path_unclear |
| sample02 | 200 | 37175 | deepseek-v4-flash-0731 | 잊힌 등대의 속삭임 | filled | filled | filled | 0 | 0 | missing_endings, climax_unrelated, no_ending_conditions, railroad_risk, recovery_path_unclear |

Raw files:

- `raw/sample01-20260822T072402Z.json`
- `raw/sample02-20260822T072436Z.json`

## First observations (no code change)

1. Visible 5-field spine is incomplete on both vanilla empty `fill_empty` runs: title / 시작 장면 / 핵심 문제 / 플레이어 목표 fill, `endingConditions` is always `[]`.
2. Production lint then reports `missing_endings`. That is a vanilla quality miss, not a Phase 2 UI bug.
3. `npcs` is empty in both samples.
4. sample01 leaked schema key names into arrays (`clues` contains `startLocation` / `startInventory` / `difficulty` / `climax`; `majorEvents` contains `clues`; `startInventory` contains `difficulty` / `climax`).
5. Both drafts stay in a fog / forgotten-village / lighthouse-or-bell-tower trope family.
6. sample02 wrote 12 `majorEvents` → `railroad_risk`. sample01 conflict reads more like a revealed secret than an open playable problem.

## Next (not started)

- More empty `fill_empty` samples
- Optional: one world-attached sample
- Keep production prompt/schema/merge frozen until this baseline is enough
- FIELD SEMANTICS still not added

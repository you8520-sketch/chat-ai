# #1650 save-retry idempotency

No model call. The draft response was a local fixture. The only database write is the local dev `data/app.db` row for this fixture.

## Browser path (production server, local DB)
1. Save POST reached the server and committed scenario id 55 (`private`). The response was not given back to the page.
2. Before that POST returned, sessionStorage already held `composed` and `saveAttempted=true` (`generatedAt=2026-10-17T10:20:00.000Z`).
3. Reload showed the save-failed card for 「재시도 중복 검증」 and did not call the draft again.
4. The list GET was forced to 500 (lookup failure, not an empty list).
5. Retry POST returned the same id 55. The table still has one row for that `generatedAt`.
6. Play prep opened `/trpg?scenarioId=55` and showed the title.

Screenshots: `refresh-save-failed.png`, `retry-result.png`, `play-prep.png`.

## Unit path
- Lost response + throwing list lookup + retry through `insertScenarioTemplate`: one row, same id, one draft call.
- Stale empty list (proven absence) on a second arrival of the same payload: same id, still one row.
- Session checkpoint is taken before the save POST; restoring it does not call the draft.
- Direct insert replay, other creator, manual save, and empty `generatedAt` are covered in `scenarios.test.ts`.

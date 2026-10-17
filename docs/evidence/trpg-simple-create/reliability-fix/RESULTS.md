# #1650 generation reliability: measured results

All numbers come from real `deepseek-v4-flash-0731` calls via CheaperInference (rates $0.098/M in, $0.196/M out, 1 USD = 1,400 KRW).
Total extra paid usage this round (all ablations, before/after, real UI runs, editor API): about 0.8M input / 0.4M output tokens, i.e. well under 300 KRW.

## 1. Raw model, identical prompt, only `response_format` changes (harness-ablate-raw-model.ts)
"ok" = parsed title + startingSituation + goal + endingConditions all present.

| variant | desc-only | world-only |
| --- | --- | --- |
| current (json_object) | 4/10 ok, 2 `{}`, 3 path-like key, 1 partial | 1/10 ok, 8 `{}`, 1 `/fill_or_replace_fields` |
| json_object + JSON example | 6/10 | 10/10 (4 desc runs with ".title" key) |
| no response_format | 10/10 | 10/10 |
| json_object, sandbox blueprint | 3/8 ok, 5 `{}` | - |
| no response_format, sandbox blueprint | 8/8 | - |
| json_object, regenerate_all | 2/8 ok | - |
| no response_format, regenerate_all | 8/8 | - |
| json_object, single-field regen | 8/8 | - |
| no response_format, single-field regen | 8/8 | - |

Prompt-wording-only ablations that kept json_object (rename `fill_or_replace_fields`, drop kept/locked lines, drop sparse sentence): 2-5/8 ok, no improvement.
Degenerate outputs seen only in json_object mode: `{}`, `{"/fill_or_replace_fields": ...}`, `{"/mnt/data/....json": ...}`, `".title"` as first key.

## 2. Second cause found with the route-faithful prompt
The route sends `"plan": {}` in EXISTING_DRAFT_JSON (the plan parser returns null for an empty plan). With that prompt and no json_object, the model returned `endingConditions` as ONE STRING in 10/12 (desc) and 4/12 (world) runs. `stringList()` drops non-arrays, so `endingConditions` was silently `[]` (the saved "유령 기차의 비밀" with empty endings).
Fix: the prompt's untyped `JSON keys:` list is replaced by a typed list (strings / string arrays / npcs). Raw model, no json_object, route-faithful prompt: 48/48 ok (desc 24, world 24) vs 10/24 before.

## 3. Route-equivalent generation + merge, BEFORE (#1650 HEAD~: json_object, retry 5, old schema) vs AFTER (harness-route-before-after.ts, n=10 each)
"fullStory" = after merge: title + startingSituation + goal + at least one ending.

| | success (non-empty) | fullStory | avg model calls | max calls | avg sec | max sec | avg cost per draft |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BEFORE desc | 9/10 | 2/10 | 3.6 | 6 | 18.6 | 40.5 | 0.79 KRW |
| BEFORE world | 8/10 | 1/10 | 3.6 | 6 | 28.5 | 72.1 | 0.85 KRW |
| AFTER desc | 10/10 | 10/10 | 1.0 | 1 | 13.5 | 18.3 | 0.35 KRW |
| AFTER world | 10/10 | 10/10 | 1.0 | 1 | 12.2 | 15.3 | 0.37 KRW |

## 4. Real UI generation on the final build (after-real-generation.log)
- description only: draft 200, saved private (scenarioId=48), play prep opens. 661 output tokens, 7.1 s.
- world only: draft 200, saved private (scenarioId=49), play prep opens. 671 output tokens, 9.1 s.
- Both drafts contain startingSituation, goal and 2 endingConditions (after-real-*-draft-response.json).

## 5. Detailed editor AI (harness-editor-api.cjs, real key)
- regenerate_selected goal -> only `goal` changed, title/endings/location kept.
- regenerate_selected majorEvents+clues with endingConditions locked -> only those two changed.
- regenerate_all with title locked -> title kept, all other fields regenerated (2 endings).
- fill_empty on a partial draft -> only empty fields filled, written fields kept.

## 6. Mobile 390px save-failed (m390-*.png)
No overlap reproduced. At 390x844 and 390x667 both buttons are inside the viewport after scroll, `elementFromPoint` hits the button (not the fixed `mobile-bottom-nav`), and a touch tap on "버리고 다시 쓰기" works. The earlier overlap was a full-page-screenshot artifact of the fixed nav. No UI change.

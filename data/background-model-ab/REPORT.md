# Background model A/B bench report

Generated: 2026-08-26T14:17:01.242Z

## Scope

- **PR_659_DRAFT=true** — bench-only correction; no production routing/deploy changes.
- **QUALITY_JUDGMENT=NOT_PERFORMED** — mechanical stats only; ChatGPT reviews committed RAW.
- **PRIMARY_RECOMMENDATION=NOT_PERFORMED**

## Deployment context

| Field | Value |
|-------|-------|
| DEPLOYED_SHA | ef86639 |
| ORIGIN_MAIN_SHA | ef86639b0314d2f17eb55a431e1668e45a45a136 |
| DEPLOYED_EQUALS_MAIN | true |

## Ownership gate (runtime reachability)

| Gate | Value |
|------|-------|
| DUPLICATE_RUNTIME_OWNERS | 0 |
| CONFLICTING_POLICY_PATHS | 0 |
| STALE_LEGACY_RUNTIME_REFERENCES | 0 |
| STATUS_SCHEMA_SOURCE | `DEFAULT_STATUS_WIDGET` (`src/lib/statusWidget/defaultTemplate.ts`) |
| STATUS_PIPELINE | `extractStatusWidgetValuesForTurn` (`src/lib/statusWidget/extract.ts`) |

Status Widget vs Status Meta are mutually exclusive per turn: `chatUsesHtmlVisualStatusWindow` returns false when `statusWidgetActive=true`; `resolveStatusMetaExtractionEnabled` returns false when HTML visual card is enabled/standing.

## Models (isolated, no cross-model fallback)

| Slot | Model | Provider |
|------|-------|----------|
| A | deepseek-v4-flash-0731 | CheaperInference |
| B | gpt-5.6-luna | CheaperInference |

Outbound flags: DeepSeek `thinking.type=disabled`; Luna `reasoning.effort=none`.

## Resolved timeouts (production owners, unchanged)

Per-call `RESOLVED_TIMEOUT_MS` is recorded in committed RAW. Production owners:

| Task | Outer owner | DeepSeek CI resolved | Luna resolved |
|------|-------------|---------------------:|--------------:|
| Rolling summary | 120000 ms | **45000 ms** (longForm flash cap) | 120000 ms |
| HTML flash | 240000 ms | **45000 ms** (longForm flash cap) | 240000 ms |
| Status widget | 120000 ms outer | **20000 ms** (short flash cap) | 120000 ms |

Per-call `RESOLVED_TIMEOUT_MS` in RAW reflects the **actual deadline used** (including DeepSeek `resolveBackgroundFlashProviderDeadlines` caps). HTML failures at 45000 ms are **not** 120000 ms memory deadlines.

## Summary (mechanical)

| Model | Calls | Success | Timeout | Format pass | Parser pass | P50 ms | P95 ms |
|-------|------:|--------:|--------:|------------:|------------:|-------:|-------:|
| deepseek | 5 | 80% | 1/5 | 4/5 | 4/5 | 12443 | 45003 |
| luna | 5 | 100% | 0 | 5/5 | 5/5 | 4263 | 4845 |

## HTML (mechanical)

| Model | Calls | Success | Timeout | Format pass | Parser pass | P50 ms | P95 ms |
|-------|------:|--------:|--------:|------------:|------------:|-------:|-------:|
| deepseek | 5 | 60% | 2/5 | 3/5 | 0/5 | 14541 | 45002 |
| luna | 5 | 100% | 0 | 5/5 | 5/5 | 7505 | 16988 |

## Status widget — production pipeline (8 scenarios)

Visibility gate: `FINAL_WIDGET_VISIBLE=false` counts as status failure even when `JSON_PARSE_OK=true`.

| Model | Initial calls | Timeouts | JSON parse OK | Display policy pass | **FINAL_WIDGET_VISIBLE** |
|-------|-------------:|---------:|--------------:|--------------------:|-------------------------:|
| deepseek | 8 | 7 | 1/8 | 1/8 | **1/8** |
| luna | 8 | 0 | 8/8 | 8/8 | **8/8** |

Scenarios: general_dual_pov, time_advance, final_scene, explicit_override, previous_value_echo_change, dual_pov_subject_separation, sparse_no_change, long_korean_scene_with_ooc

## Committed RAW (human review)

- `data/background-model-ab/raw/summary-results.json`
- `data/background-model-ab/raw/html-results.json`
- `data/background-model-ab/raw/status-results.json`

No API keys, headers, or private production data included.

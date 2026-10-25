# 07 — Numeric Field Schema Options

Audit of how creator status widget fields are stored and whether backward-compatible optional numeric configuration can be added.

## Current StatusWidgetField schema

`src/lib/statusWidget/types.ts:3-13`:
```text
export type StatusWidgetField = {
  id: StatusWidgetFieldId;       // "time" | "place" | "inner_thought" | "situation" | string
  label: string;
  instruction: string;
  previewValue?: string;
  initialValue?: string;          // optional creator-set starting value
};
```

Storage: `characters.status_widget_json` (TEXT, JSON). Parsed via `JSON.parse` in `characterStatusWidgetOrDefault` and related helpers.

## Field classification heuristics (existing)

| Function | File:lines | Detects |
|---|---|---|
| `looksLikeVolatileTurnDerivedField` | `extractNormalize.ts:115` | volatile scene-derived fields |
| `looksLikeInnerStateField` | `extractNormalize.ts:362` | inner-state fields (inner_thought etc.) |
| `isCalendarClockField` / temporal | `temporalUnknown.ts` | time/date/season/weather |
| `CREATOR_PROTECTED_STATUS_KEYS` | `types.ts:44-49` | `d_day, affection, trust, corruption` |

There is **no** existing concept of "numeric field" vs "string field" — all values are `Record<string, string>` (`StatusWidgetValues`). Numeric parsing happens only at trigger-eval time (`normalizeRuntimeValue`).

## Backward-compatibility evaluation for optional `numericState?`

### TypeScript type

The `StatusWidgetField` type is **closed** (no index signature). Adding `numericState?: {...}` requires extending the type. Existing code that destructures fields (`{ id, label, instruction, initialValue }`) will not break — optional property is safe.

### JSON storage / parser

`characterStatusWidgetOrDefault` parses `status_widget_json` via `JSON.parse`. `JSON.parse` **preserves unknown keys**. So a widget JSON written by a future creator UI with `numericState` would round-trip through `JSON.parse` unchanged. Existing readers that only read `id/label/instruction/initialValue` ignore the extra key.

**Caveat:** any code that re-serializes the widget (e.g., save path) using a strict shape would drop unknown keys. Need to verify the save path uses pass-through (`JSON.stringify` of the parsed object) rather than reconstruction. The save path (`characterFormSave.ts`) parses the incoming widget JSON and stores it; if it reconstructs the object field-by-field, `numericState` would be lost. **Phase B must verify the save path preserves unknown keys.**

### Extract prompt

`buildWidgetExtractionContract` (`extractNormalize.ts:769`) maps fields to extract instructions using `id/label/instruction/initialValue`. A `numericState` block would not appear in the extract prompt unless explicitly added. For Phase B Option A (absolute proposal reuse), the numeric field is extracted as a string value like today; the reducer parses it. For Option B (delta proposal), a short numeric directive would be added — but only to the **background extractor** prompt, not the main RP prompt.

## Proposed optional shape (example only — NOT implemented)

```text
numericState?: {
  enabled: true,
  min: 0,
  max: 100,
  initial: 0,
  integer: true,
  authority: "server",
  maxIncreasePerTurn?: 5,
  maxDecreasePerTurn?: 5,
  manualEditable?: true
}
```

## Authority mode candidates (evaluation only)

```text
affection   → server_meter
trust      → server_meter
corruption → server_meter
d_day      → computed / server_counter
time       → display / temporal subsystem
inner_thought → display_only
```

Not all fields should enter the numeric reducer. Legacy string fields stay on the existing extractor-owned string path.

## Findings

1. The current field schema has no numeric concept — all values are strings; numeric parsing is trigger-eval-time only.
2. `JSON.parse` preserves unknown keys, so a `numericState?` extension is storage-backward-compatible **if** the save path uses pass-through serialization. Phase B must confirm `characterFormSave.ts` does not reconstruct the widget object field-by-field.
3. The `StatusWidgetField` TypeScript type is closed and must be extended explicitly.
4. The extract prompt does not need to change for Option A (absolute proposal). Option B (delta) would add a short numeric directive to the **background extractor** prompt only.
5. Field classification heuristics already exist (volatile/inner-state/temporal/protected) and can gate which fields are eligible for `numericState`.

## Recommendation

- Phase B: add optional `numericState?` to `StatusWidgetField`. Verify save path pass-through. Pilot on `affection`, `trust`, `corruption` only. `d_day` classified separately as `server_counter`/`computed`. Do **not** force all fields into the numeric engine.

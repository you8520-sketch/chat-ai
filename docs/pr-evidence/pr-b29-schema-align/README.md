# B29 — Episodic schema / sanitizer string contract alignment

Base SHA: `b079c3b6` (same as production at investigation start).

## Change summary

`buildSharedEpisodicSectionJsonSchema()` now mirrors sanitizer identifier rules and the non-whitespace `value` token shape. No prompt edits. `minItems: 0` unchanged.

## Schema diff (episodic fact item)

**Before:** `subject`, `attribute`, `value` were unconstrained `string`.

**After:**

- `subject` / `attribute`: `pattern` = `^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$`, `maxLength: 64`
- `value`: `minLength: 1`, `maxLength: 80`, `pattern: ^\S+$` (no whitespace; trailing punctuation / Korean sentence shape still sanitizer-only)

Shared constants live in `memory-episodic-types.ts` and are reused by `sanitizeEpisodicExtractedFacts()`.

## Live verification (1× status-ON full Shared Initial)

Script: `scripts/b29-shared-initial-status-on-live-once.ts` (`B29_SHARED_INITIAL_LIVE=1`, benchmark key).

Synthetic scene: `scripts/fixtures/b29-episodic-synthetic-scene.ts` (same USER/assistant as B26).

| Field | Result |
|---|---|
| transport | OK |
| JSON parse | OK |
| `schemaStatus` | `ok` |
| statusWidget | OK |
| episodic | valid empty (`rawFactCount: 0`) |
| user refusal in valid facts | no (semantic gap — not claimed fixed) |
| cost | USD 0.000535 (~₩0.72) |

Full provider JSON: `live-status-on.json` (includes wire schema and response format).

## B27 raw facts (de-identified, sanitizer regression)

`b27-raw-facts-deidentified.json` — 10 B26 model outputs. Schema does **not** retrofit these; sanitizer still drops all 10.

## B28 vs B29 (same synthetic scene, different wire)

| Run | Wire | episodic constraints | raw facts |
|---|---|---|---|
| B28 probe | episodic-only + `minItems: 1` + B28 value regex | pattern (strict value) | 3 |
| B29 live | status-ON production envelope + `minItems: 0` | pattern (relaxed value `\S+`) | 0 |

Empty array here is **valid format**, not transport/schema failure.

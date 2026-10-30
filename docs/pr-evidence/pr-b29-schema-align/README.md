# B29 — Episodic schema / sanitizer string contract alignment

Base SHA: `b079c3b6` (production at investigation start).

## What this PR solves (format contract)

`buildSharedEpisodicSectionJsonSchema()` now mirrors sanitizer identifier rules and the non-whitespace `value` token shape. Shared constants in `memory-episodic-types.ts` are reused by `sanitizeEpisodicExtractedFacts()`. No prompt edits. `minItems: 0` unchanged.

**Outcome:** schema and sanitizer agree on ASCII snake_case identifiers and non-whitespace `value` tokens. B27-style Korean identifiers / sentence-like values are not accepted at the wire contract when the provider enforces `pattern`.

## What this PR does not solve (Episodic generation quality)

- Production or synthetic **valid empty** `extracted_facts: []` under status-ON full Shared Initial
- **User refusal** and other important events not appearing in episodic output
- Evidence block label mismatch (B26 H1), curly-quote `source_quote` wraps, cross-turn identifier stability

Those remain **ROOT_CAUSE_UNCONFIRMED** / separate follow-ups. Do not treat merge of this PR as proof that Main RP memory creation is fixed.

## Schema diff (episodic fact item)

**Before:** `subject`, `attribute`, `value` were unconstrained `string`.

**After:**

- `subject` / `attribute`: `pattern` = `^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$`, `maxLength: 64`
- `value`: `minLength: 1`, `maxLength: 80`, `pattern: ^\S+$` (no whitespace; trailing punctuation / Korean sentence shape still sanitizer-only)

## One-shot live evidence (not shipped as repo scripts)

A single status-ON full Shared Initial call was run during B29 development (benchmark key, synthetic B26-class scene). Artifacts only:

| Field | Result |
|---|---|
| transport | OK |
| JSON parse | OK |
| `schemaStatus` | `ok` |
| statusWidget / relationship / suggestedReplies | OK |
| episodic | **valid empty** (`rawFactCount: 0`) |
| user refusal in valid facts | **no** |
| cost | USD 0.000535 (~₩0.72) |

Full provider JSON and wire schema: `live-status-on.json`.

Interpretation: **format/schema path did not break consumers**; **no episodic facts were generated** on that run — generation quality still unproven.

## B27 raw facts (de-identified, sanitizer regression)

`b27-raw-facts-deidentified.json` — 10 B26 model outputs. Schema does **not** retrofit past JSON; sanitizer still drops all 10.

## B28 vs B29 live (same synthetic scene family)

| Run | Wire | episodic constraints | raw facts |
|---|---|---|---|
| B28 probe | episodic-only + `minItems: 1` + strict value regex | pattern | 3 |
| B29 live | status-ON production envelope + `minItems: 0` | pattern (`\S+` value) | 0 |

Empty array on B29 live is **valid structured output**, not evidence that memory creation works.

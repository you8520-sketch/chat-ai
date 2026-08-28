# PR-2 Translation A/B artifacts

Run only with explicit opt-in:

```bash
RUN_REAL_TRANSLATION_AB=1 CHEAPER_INFERENCE_API_KEY=... npx tsx scripts/bench-pr2-translation-ab.ts
```

Without `RUN_REAL_TRANSLATION_AB=1`, the harness exits without provider calls.

Artifacts:
- `fixtures.json` — synthetic KO sources
- `raw-results.jsonl` — per fixture × model raw outputs
- `summary.md` — objective counts
- `blind-review.md` — outputs without model names in headings
- `model-map.json` — A/B identity mapping

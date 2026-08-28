# PR-2 Translation A/B artifacts

Run only with explicit opt-in:

```bash
RUN_REAL_TRANSLATION_AB=1 CHEAPER_INFERENCE_API_KEY=... npx tsx scripts/bench-pr2-translation-ab.ts
```

For provider-purity runs, keep `OPENROUTER_API_KEY` empty.

Without `RUN_REAL_TRANSLATION_AB=1`, the harness exits without provider calls.

## Immutable run archive

Completed or partial real runs are preserved under `runs/`:

- `runs/run-01/` — first real run (transport failure at request 10; immutable)
- `runs/run-02/` — reserved for the next full real run (not executed yet)

## Active harness output (latest run)

When a real run executes, the harness writes checkpoint and final artifacts to this directory:

- `fixtures.json` — synthetic KO sources
- `model-map.json` — per-fixture A/B model mapping (not blind)
- `raw-requests.jsonl` — one row per provider request (checkpointed after each attempt)
- `raw-results.jsonl` — one row per fixture × label with production semantics
- `summary.md` — objective counts
- `blind-review.md` — outputs without model names; transport failures visible
- `run-state.json` — checkpoint progress (crash evidence, not resume authorization)
- `run.log` — sanitized console evidence (when captured via tee)

## Failure resilience

The harness catches errors at the individual request boundary, checkpoints evidence, and continues through all planned requests. A fixture/model with any failed or malformed batch records `productionOutcome=KOREAN_FALLBACK` and `productionPublishedOutput=null` while preserving successful batch outputs separately.

Zero-call validation:

```bash
node --import tsx --test scripts/bench-pr2-translation-ab.failure-resilience.test.ts
```

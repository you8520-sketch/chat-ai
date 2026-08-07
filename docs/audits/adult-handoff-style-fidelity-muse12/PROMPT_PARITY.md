# Prompt Parity — PRODUCTION_CONFIG_BUNDLE_COMPARISON

Fairness unit is the **deployable adult handoff configuration bundle**, not raw-model byte-identical prompts.

```text
comparison_unit: PRODUCTION_CONFIG_BUNDLE_COMPARISON
required_parity_all_sources_pass = True
FINAL_PROMPT_BYTE_PARITY = EXPECTED_DIFFERENCE
PRODUCTION_ADAPTER_MANIFEST = RECORDED
verdict = REQUIRED_PARITY_PASS_LIVE_CAPTURE_COMPLETE
```

Per-source required gates (BASE/RAW/USER/CHARACTER/CONTINUITY/GENERATION) all PASS. Final prompt hashes differ by production adapters and are expected.

See `PROMPT_PARITY.json` → `parity_by_source` for hashes and adapter manifests.

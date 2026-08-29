# Phase C — Gemini 3.1 Pro same-chat cache + TTFT benchmark

**READ-ONLY measurement.** No production prompt, provider, memory, layout, or billing changes.

## Prerequisites

- PR #724 merged to `main`
- `OPENROUTER_API_KEY` or `CHEAPER_INFERENCE_API_KEY`
- Dev server with phase audit enabled:

```bash
GEMINI_TTFT_PHASE_AUDIT=1 PROMPT_SECTION_FINGERPRINT=1 npm run dev
```

## Preflight

```bash
node --conditions=react-server --import tsx scripts/gemini31-phase-c-preflight.ts
```

## Benchmark

```bash
PHASE_C_TURNS=12 node --conditions=react-server --import tsx scripts/gemini31-phase-c-ttft-benchmark.ts
```

### Fixtures (same-chat, varied live turns — not exact-repeat)

| ID | Scenario |
|----|----------|
| A | Healthy steady-state — summaries sealed through turn 15 |
| B | One-summary-batch-behind — summaries through turn 10 only |
| C | Background catch-up active — no sealed summaries; catch-up during live turns |

### Per-turn telemetry (from `phase_latency_audit` SSE)

- Provider: `prompt_tokens`, `cached_tokens`, `reasoning_tokens`, completion tokens
- Latency: TTFT, total, pre-provider assembly
- Fingerprint: `first_changed_section`, `first_changed_position`, prefix sections
- Summary: contention snapshot at provider start
- Cache drop class: `EXPECTED` \| `UNEXPECTED` \| `PROVIDER_VARIANCE` \| `UNKNOWN`

### Output

- `/opt/cursor/artifacts/gemini31-phase-c-ttft/report.json`
- `/opt/cursor/artifacts/gemini31-phase-c-ttft/turns-{A,B,C}.jsonl`

## Diagnosis fields

- `PRIMARY_CACHE_MISS_OWNER`
- `PRIMARY_TTFT_OWNER`
- `BACKGROUND_SUMMARY_CONTENTION`
- `CI_SERVING_FLOOR_LIKELY`
- `NEXT_RECOMMENDATION`

**Do not merge optimization changes from Phase C.** Diagnostic PR only.

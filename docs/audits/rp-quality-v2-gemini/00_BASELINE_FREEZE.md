# 00 — Baseline Freeze (Phase D / D0)

**Date:** 2026-03-28  
**Branch:** `cursor/rp-quality-v2-gemini-grounding-6a91`  
**Base:** `origin/main` @ `8fbecbf`  
**Mode:** evaluation / experiment only — **no production prompt merge**

## Frozen product conclusions (do not reopen)

```text
C1 LAYOUT_COMPACT_REJECT
C2 PROSE_MICRO_MIXED → production NO
C2-R → COMMON_A
production common prose KEEP
production layout KEEP
Gemini model-specific prose adapter ≈ NONE
```

## Absolute stops

- Do **not** merge experimental PRs `#271` / `#273` / `#274` into this workstream.
- Do **not** start C2-S / C3.
- Do **not** shrink character/persona content as a recital fix.
- Do **not** change episodic / status / numeric / secret pipelines in this phase.
- Gemini adapter (if any) is **candidate-only** until human review + hard quality gate.

## Scope of this phase

1. **D0** — RP Quality Vector V2 + Continuity Audit (API=0)  
2. **D1** — Gemini Scene-Grounded Canon audit **only if** D0 PASS and recital/replay reproduced on live Gemini  
3. Cross-model check: Gemini 3.1 Pro vs DeepSeek V4 Pro (reuse stored C2/C2-R first)

## Related artifact paths (VM)

| Source | Path |
|--------|------|
| C2 live outputs | `/opt/cursor/artifacts/rp-prompt-c2-prose-ab/live/` |
| C2-R live outputs | `/opt/cursor/artifacts/rp-prompt-c2r-ablation/live/` |
| C2 docs | `docs/audits/rp-prompt-c2/` |
| C2-R docs | `docs/audits/rp-prompt-c2r/` |

## Recommended PR title

```text
experiment(rp): quality harness v2 + Gemini scene grounding audit
```

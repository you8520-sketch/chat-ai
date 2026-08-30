# Phase D.2 Preflight

```text
PHASE_D2_PREFLIGHT
CURRENT_MAIN_TIP: df05a0b6 (PR #739 billing canary merged into branch)
PR738_HEAD: (post D.2 commits)
PR738_BEHIND_MAIN: 0 (after merge)
PRODUCTION_FILES_CHANGED_BY_PR738:
  - NONE for D.2 (diagnostic scripts/tests/docs only)
  - Historical PR738: dev-only route canary superseded by main #739 merge
CI_REASONING_POLICY_OWNER: src/lib/cheaperInferenceConfig.ts → applyCheaperInferenceModelReasoningPolicy
CI_ADAPTER_OWNER: src/lib/cheaperInferenceConfig.ts → adaptCheaperInferenceChatBody
CI_USAGE_PARSER_OWNER: src/lib/openRouterUsage.ts (stream); scripts/lib/gemini31PhaseD2Usage.ts (usage API)
```

## Previous fixes still on main (§22)

| Item | Status |
|------|--------|
| PR #718 summary nonblocking | Present — `scheduleSummaryCatchUpDurable` in `memory-rolling-summary.ts` |
| PR #724 LOW wire | Present — Gemini 3.1 Pro → `reasoning_effort: "low"` in `applyCheaperInferenceModelReasoningPolicy` |
| PR #724 telemetry | Present — main #739 `turnBillableUsageProductionTelemetry` (observational canary) |
| Phase D/D.1 diagnostics | Isolated under `scripts/` + `docs/audits/` — no production adapter edits in D.2 |

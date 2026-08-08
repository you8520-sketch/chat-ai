```text
PHASE_B1C1_FINAL:
PR #272 HEAD before: f59e4c5
final commit: c7625a87829f7a4825c7ff2bdca4fa2e6f2ff225
legacy-first-regen:
  result: PASS
  HTTP: 409
  code: numeric_state_regen_not_bootstrapped
  pre-LLM: yes
  API calls: 0
chain-mismatch regen:
  result: PASS (409 numeric_state_regen_chain_not_ready)
missing numeric proposal:
  current: affection held (INVALID_HOLD / previous)
  message: affection mirrored; location absent
  stale nonnumeric resurrected: NO
manual status:
  nonnumeric-only edit: ALLOW
  numeric edit: 409 numeric_state_manual_edit_not_enabled
full status-widget regressions:
  STATUS_WIDGET_FULL_RELATED_REGRESSION = PASS
  (441 tests / 439 pass; 2 pre-existing fails on main:
   promptDuplicateAudit + telemetry parser mode — unrelated to B1-C.1)
core harness:
  CORE_CANONICAL_HARNESS = PASS
  B1_C_CORE_INTEGRATION_PASS
route-level local canary:
  model: anthropic/claude-opus-4.5
  normal: 2
  regen: 1
  parity failures: 0
numeric current == message: PASS
numeric current == active variant: PASS
regen before baseline: PASS
replaces_event_id: PASS
lint: PASS (typecheck:app)
typecheck: PASS (typecheck:app)
git diff --check: PASS
prompt diff: 0
background extractor diff: 0
model adapter diff: 0
Railway:
UNCHANGED
final verdict:
B1_C_CANONICAL_CANARY_PASS
merge:
NOT_RUN
general rollout:
NOT_RUN
B1-D:
NOT_RUN
```

## Acceptance checklist

```text
LEGACY_FIRST_REGEN_FAIL_CLOSED = PASS
REGEN_CHAIN_PRE_LLM_GATE = PASS
NUMERIC_MISSING_PROPOSAL_HOLD = PASS
NONNUMERIC_STALE_SNAPSHOT_NOT_RESURRECTED = PASS
NONNUMERIC_MANUAL_EDIT_ALLOWED = PASS
NUMERIC_MANUAL_EDIT_BLOCKED = PASS
STATUS_WIDGET_FULL_RELATED_REGRESSION = PASS
CORE_CANONICAL_HARNESS = PASS
TRUE_ROUTE_CANARY = PASS
MESSAGE_NUMERIC_PARITY = PASS
ACTIVE_VARIANT_NUMERIC_PARITY = PASS
REGEN_REPLACEMENT_PARITY = PASS
MAIN_RP_PROMPT_DIFF = 0
BACKGROUND_EXTRACTOR_DIFF = 0
MODEL_ADAPTER_DIFF = 0
Railway general rollout = NOT_RUN
B1-D = NOT_RUN
```

## Notes

- In-memory harness is named `CORE_CANONICAL_HARNESS` (not LIVE_ROUTE_CANARY).
- True route canary used local process env only:
  `RP_NUMERIC_STATE_ENABLED=1` + user/character allowlist for admin test user 903 / private character 10.
- After canary, the allowlisted server process was stopped; `.env.local` was never written with `ENABLED=1`
  (effective restore `RP_NUMERIC_STATE_ENABLED=0`).
- Model: OpenRouter `anthropic/claude-opus-4.5` (Gemini 3.6 Flash is coerced off selectable UI;
  Cheaper Inference key absent in this VM). Cost minimized to 2 normal + 1 regen.

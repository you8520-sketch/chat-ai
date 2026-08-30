# Track A — World-only Blueprint productionization audit

**Main SHA:** `80d159757ec901b0a2090753e96c5d2f3c7acac1`  
**Scope:** Audit + product recommendation. No implementation.

## A1 — Provider / cost / billing contract

| Field | Value |
|-------|-------|
| **GENERATOR_OWNER** | `sandboxDirector.ensureCampaignDirectorContext` → `completeTrpgAuthoringJson({ kind: "sandbox_blueprint" })` → `callTrpgAuthoringModel` |
| **BLUEPRINT_PROVIDER_MODEL** | `deepseek-v4-flash-0731` (`TRPG_SCENARIO_DRAFT_MODEL`) |
| **BLUEPRINT_PROVIDER_ROUTE** | Cheaper Inference primary (`CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL`); OpenRouter backup via `executeDeepSeekBackgroundWithProviderFailover` (`route_kind: background_flash`) |
| **BLUEPRINT_REASONING_POLICY** | `thinking: { type: "disabled" }`, `reasoning_effort: "none"` (scenarioDraftCall) |
| **BLUEPRINT_MAX_TOKENS** | 4096 primary (default `buildTrpgScenarioDraftRequestBody`); repair up to separate repair budget if JSON parse fails |
| **BLUEPRINT_PRIMARY_TIMEOUT** | 90_000 ms |
| **PROVIDER_CALLS_PER_CAMPAIGN** | 1 on success; up to 2 if primary JSON invalid (repair pass) |

### Measured probe (5 frozen worlds, existing prompts)

Source: `docs/audits/trpg-story-architecture-next/sandbox-blueprint-quality-probe.json`

| Metric | Value |
|--------|-------|
| TYPICAL_INPUT_TOKENS | ~951 |
| TYPICAL_OUTPUT_TOKENS | ~1050 |
| MEDIAN_LATENCY | ~12.2 s |
| P95_LATENCY | ~16.1 s |
| TYPICAL_PROVIDER_COST (upstream ref) | ~\$0.00029/call at published ref rates (0.098/1M in + 0.196/1M out) |

### Billing

```text
BLUEPRINT_USER_POINTS_CHARGED: 0 (today)
BLUEPRINT_BILLING_OWNER: none
```

- `ensureCampaignDirectorContext` does **not** call `chargeTrpgCalls` or round billing.
- `startTrpgCampaign` opening GM uses `skipBilling: true`.
- Hypothetical user points if billed like other DeepSeek Flash calls: **~5P/campaign** (`computeOpenRouterTurnBilling` on probe averages).

**Do not silently add billing.** Any productionization must include explicit product decision on who pays startup generation.

---

## A2 — Generator quality (frozen suite)

| World genre | evaluateSandboxBlueprint | Playable | Critical issue |
|-------------|-------------------------|----------|----------------|
| survival / apocalypse | **FAIL** | no | `endingConditions: 0` (has endingCandidates) |
| fantasy adventure | pass | yes | heuristic agency flag (review) |
| social / relationship | pass | yes | — |
| mystery | pass | yes | lint warnings goal/climax unrelated |
| open exploration | **FAIL** | no | `endingConditions: 0` |

```text
PLAYABLE_PLAN_PASS_RATE: 3/5 (60%)
evaluateSandboxBlueprint PASS_RATE: 3/5 (60%)
```

### Human-review heuristic summary (automated rubric — not substitute for human sign-off)

| Check | Pass count / 5 |
|-------|----------------|
| STARTING_SITUATION_USABLE | 5/5 |
| CENTRAL_CONFLICT_CLEAR | 5/5 |
| PLAYER_GOAL_ACTIONABLE | 5/5 |
| ENDING_CONDITIONS_PLAYABLE | 3/5 |
| MAJOR_EVENTS optional not railroad | 5/5 |
| CLUES_USEFUL | 5/5 |
| CLIMAX_CAUSAL | 3/5 |
| ENDING_CANDIDATES not fixed branches | 5/5 |
| PLAYER_AGENCY_VIOLATION | 1/5 flagged (fantasy) |

**Failure pattern:** Model emits `endingCandidates` but omits required `endingConditions` on open-ended / survival worlds — exactly the genres most prone to unbounded drift.

### Prompt owner (for correction, not changed here)

- System: `buildScenarioDraftSystemPrompt` + sandbox appendix in `buildSandboxDirectorSystemPrompt`
- User: `buildSandboxDirectorUserPrompt`
- Validation: `evaluateSandboxBlueprint` → `hasPlayableScenarioPlan`

```text
GENERATOR_QUALITY: ADEQUATE_FOR_EXPLORATION / INADEQUATE_FOR_DEFAULT_ON
```

**STOP for default-enable:** 40% hard validation failure on representative worlds, including survival/apocalypse.

Recommended correction path (separate PR, not this task):

1. Sandbox-specific validation hint: `endingConditions` required even when `playLength: open_ended`
2. Or deterministic post-parse: if `endingConditions` empty and `endingCandidates` non-empty, copy/adapt (with lint)
3. Or retry-on-fail once with repair user block citing missing endings

---

## A3 — Startup failure contract options

| Option | Description | Product risk |
|--------|-------------|--------------|
| **A — Require blueprint** | No round 0 until playable plan persisted | Best quality; blocks start on failure; needs retry UX |
| **B — Silent planless fallback** | **Current** when flag off or generation fails | Silent degraded mode → multi-round drift (#731) |
| **C — Explicit free-sandbox mode** | Labeled intentional no-plan play | **Does not exist today** — do not invent in this PR |

**CURRENT_FAILURE_POLICY:** Option B (flag off = no call; flag on + fail = null plan, start anyway)

**RECOMMENDED_FAILURE_POLICY:** Option A for **normal world-only TRPG**, after generator correction and billing/latency approval

---

## A4 — Preferred product contract (recommendation only)

```text
normal world-only TRPG → playable Blueprint required before round 0
```

Gated on:

- Generator pass rate ≥ acceptable threshold (recommend ≥90% on frozen suite including survival)
- Startup latency budget (~12–16s added to campaign start)
- Billing policy if points charged
- Recoverable failure UX (explicit retry, no hidden auto-retry loop)

```text
DEFAULT_ENABLE_RECOMMENDED: NO
```

---

## A5 — Flag audit

```text
TRPG_SANDBOX_DIRECTOR_ENABLED
IS_FLAG_ROLLOUT_ONLY: true (only gates world-only blueprint generation)
IS_FLAG_USED_ANYWHERE_ELSE: false (grep: sandboxDirector + tests + .env.example)
IS_FLAG_REQUIRED_FOR_ROLLBACK: true (instant revert to planless world-only)
FLAG_STATUS: KEEP_FOR_ROLLBACK
```

Do **not** treat flag flip as the full productionization fix. Desired end state:

- Default-on behavior via product policy OR always-on for world-only
- Flag retained for emergency rollback until stable

---

## A6 — Lifecycle invariant (current code)

| Rule | Enforced? |
|------|-----------|
| One campaign → at most one blueprint | yes (`loadCampaignContext` early return) |
| Never per round | yes (only `startTrpgCampaign` calls ensure) |
| Never overwrite after rounds | **partial** — no explicit guard if context row deleted; no regen API |

---

## A7 — Plan fields as resources

Already aligned in prompts (`majorEvents` = possibilities). Runtime does not enforce ordering. No change needed to semantics; need **consumption tracking** as separate follow-up (global, not local scene).

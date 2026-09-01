# Phase D.1 — CI LOW Contract / Comparator Parity Audit

**Main tip (post-sync):** `e9f97add` merged into PR #738  
**Production changed:** NO

## PHASE_D1_PREFLIGHT

```text
CURRENT_MAIN_TIP: e9f97add
PR738_HEAD: (post D.1 commits)
PR738_BEHIND_MAIN_BY: 0 (after merge)
MAIN_DELTA_FILES: TRPG, billing usage evidence, openRouterUsage (+reporting) — 43 files
OVERLAP_WITH_PHASE_D_FILES: src/lib/openRouterAdult.ts, openRouterUsage.ts (usage reporting only)
PRODUCTION_INTERACTION_EXPECTED: NONE — diagnostic scripts/docs only
```

## Metric bug fix (§2–3)

**OLD:** `provider_wait_ms = providerCompleteMs` (full stream completion)  
**NEW:** Canonical fields via `computeStreamTimings()`:

| Field | Meaning |
|-------|---------|
| `request_to_first_byte_ms` | HTTP response headers received (`fetch` resolved) |
| `request_to_first_sse_ms` | First parsed `data:` SSE JSON chunk |
| `request_to_first_reasoning_ms` | First chunk with `reasoning` or `reasoning_details` |
| `request_to_first_visible_ms` | First `delta.content` / `delta.text` |
| `request_to_stream_complete_ms` | Stream reader done |
| `reasoning_to_visible_gap_ms` | `first_visible − first_reasoning` (or `− first_sse` if no reasoning chunk) |

Regression test: `firstSse=100, firstVisible=900, complete=5000 → gap=800` — **11/11 tests PASS**

**Note:** OR-HIDDEN can yield **negative** `reasoning_to_visible_gap_ms` when visible content arrives in the first SSE chunk before any reasoning chunk is exposed — this is expected stream-visibility behavior, not a timing bug.

## Request parity inventory (§4)

See `/opt/cursor/artifacts/gemini31-phase-d1-reasoning/request-parity.json`

```text
CI_REASONING_CONTROL: reasoning_effort=low
OR_REASONING_CONTROL: reasoning: { effort: "low" }
CI_REASONING_VISIBILITY_CONTROL: none (upstream streams reasoning in delta)
OR_REASONING_VISIBILITY_CONTROL: include_reasoning=false
PROVIDER_REQUIRED_DIFFERENCE:
  - reasoning_effort vs reasoning.effort (expected adapter difference)
  - OR include_reasoning knob has no CI equivalent
```

## OR reasoning visibility control (§5)

4 paired prompts, OR-HIDDEN vs OR-VISIBLE (`include_reasoning` false vs true):

```text
OR_REASONING_VISIBILITY_EFFECT: INCONCLUSIVE
OR_HIDDEN_REASONING_P50: 625
OR_VISIBLE_REASONING_P50: 541
OR_HIDDEN_FIRST_VISIBLE_P50: 6942 ms
OR_VISIBLE_FIRST_VISIBLE_P50: 6386 ms
OR_HIDDEN_REASONING_CHUNKS_P50: 1
OR_VISIBLE_REASONING_CHUNKS_P50: 2
```

Reasoning token counts similar; first-visible similar (~6–7s). OR-HIDDEN often delivers **visible content in the first SSE chunk** while reasoning chunks are minimal or arrive later — explains Phase D's invalid `pre_visible_gap≈3ms` (used first_sse≈first_visible when reasoning hidden).

## CI LOW self-control (§6–8)

8 runs each: L (low), D (default/omit), H (high — supported):

```text
CI_LOW_SELF_CONTROL: INCONCLUSIVE
CI_LOW_REASONING_P50: 1038
CI_DEFAULT_REASONING_P50: 1188
CI_HIGH_REASONING_P50: 1121
LOW_VS_DEFAULT_RATIO: 0.87
LOW_VS_HIGH_RATIO: 0.93
CI_LOW_FIRST_VISIBLE_P50: 13634 ms
CI_DEFAULT_FIRST_VISIBLE_P50: 13613 ms
CI_HIGH_FIRST_VISIBLE_P50: 13553 ms
```

LOW is ~13% below DEFAULT but **LOW ≈ HIGH** (ratio 0.93). First-visible unchanged across variants. Cannot confirm strong LOW honor; cannot confirm IGNORED either.

## Parity-correct CI vs OR comparator (§9–12)

8 paired prompts, alternating provider order, OR `include_reasoning=false`:

```text
PARITY_CORRECT_CI_REASONING_P50: 1159
PARITY_CORRECT_OR_REASONING_P50: 536
PAIRED_REASONING_RATIO: 2.02
PARITY_CORRECT_CI_FIRST_VISIBLE_P50: 13301 ms
PARITY_CORRECT_OR_FIRST_VISIBLE_P50: 6166 ms
PAIRED_FIRST_VISIBLE_DELTA: +6437 ms
OR_ROUTED_PROVIDER: Google (all 8 pairs)
INVALID_SPEED_WINS: 0
```

**Primary latency KPI (`request_to_first_visible_ms`): CI ~2.1× slower than OR** on identical prompts. Reasoning tokens ~2× higher on CI despite both semantic LOW.

## Production-like confirmation (§14)

4 paired runs with expanded system prompt:

```text
PRODUCTION_LIKE_DIFFERENCE_REPRODUCED: YES
PAIRED_REASONING_RATIO_P50: ~2.06
PAIRED_FIRST_VISIBLE_DELTA_P50: ~6217 ms
```

## Google native control (§13)

```text
GOOGLE_NATIVE_CONTROL: NOT_AVAILABLE (no configured Google API credential in environment)
```

## Corrected conclusions vs Phase D

| Phase D claim | D.1 correction |
|---------------|----------------|
| `CI_LOW_MAPPING_SUSPECT: YES` | **DOWNGRADED to UNCONFIRMED** for LOW translation; **CONFIRMED** CI reasoning > OR on paired parity-correct runs |
| `OR pre_visible_gap ≈ 3ms` | **INVALID** — stream visibility artifact; OR first-visible P50 ~6166 ms |
| `provider_wait_ms = complete time` | **FIXED** |
| Continuity no TTFT win | **KEPT** |
| CI reasoning ~2× OR | **RECONFIRMED** after parity (ratio 2.02 paired median) |

## GEMINI31_PHASE_D1_LOW_CONTRACT_AUDIT

```text
PRODUCTION_CHANGED: NO
MAIN_TIP: e9f97add (PR #738 branch synced)
OLD_COMPARATOR_METRIC_BUG: FIXED
OR_REASONING_VISIBILITY_EFFECT: INCONCLUSIVE (similar reasoning/first-visible; chunk shape differs slightly)
CI_LOW_SELF_CONTROL: INCONCLUSIVE
CI_LOW_REASONING_P50: 1038
CI_DEFAULT_REASONING_P50: 1188
CI_HIGH_REASONING_P50: 1121
CI_LOW_FIRST_VISIBLE_P50: 13634
CI_DEFAULT_FIRST_VISIBLE_P50: 13613
CI_HIGH_FIRST_VISIBLE_P50: 13553
PARITY_CORRECT_CI_REASONING_P50: 1159
PARITY_CORRECT_OR_REASONING_P50: 536
PARITY_CORRECT_CI_FIRST_VISIBLE_P50: 13301
PARITY_CORRECT_OR_FIRST_VISIBLE_P50: 6166
PAIRED_REASONING_RATIO: 2.02
PAIRED_FIRST_VISIBLE_DELTA: +6437 ms
OR_ROUTED_PROVIDER: Google
GOOGLE_NATIVE_CONTROL: NOT_AVAILABLE
PRODUCTION_LIKE_DIFFERENCE_REPRODUCED: YES
CI_LOW_MAPPING: SUSPECT (LOW≈HIGH on CI; cannot confirm clean LOW translation) / NO_EVIDENCE_OF_PROBLEM for OR-side LOW wire
PRIMARY_ROOT_CAUSE: MIXED — CI_UPSTREAM_REASONING_BEHAVIOR + CI reasoning-first SSE presentation vs OR visible-first stream
CI_ESCALATION_RECOMMENDED: YES (E2: paired parity-correct CI LOW reasoning ~2× OR LOW, same Google routed provider)
PHASE_E_READY: NO
ROOT_CAUSE_STATUS: ROOT_CAUSE_CONFIRMED_READ_ONLY
```

## CI escalation packet (§18) — draft, do not send prompts

Prepared at `docs/audits/gemini31-phase-d1-reasoning/CI_ESCALATION_PACKET.md`

## Artifacts

`/opt/cursor/artifacts/gemini31-phase-d1-reasoning/`

- `request-parity.json`
- `or-visibility-control.json`
- `ci-low-self-control.json`
- `ci-or-comparator-parity.json`
- `production-like-comparator.json`

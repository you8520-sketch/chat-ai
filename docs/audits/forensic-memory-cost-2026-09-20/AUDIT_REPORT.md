# Forensic Memory / Cost Audit (post-#987)

**RUNTIME_CHANGE:** NO  
**PROVIDER_GENERATION_CALLS:** 0  
**BILLING_CHANGE:** NO  
**SUBSCRIPTION_CAPABILITY_CHANGE:** NO  
**MERGE:** NO (Draft PR only)

## EXACT HEAD

```
3c5555a2fe97f9097cf7b65aff5912574d72b805
Merge pull request #987 from you8520-sketch/cursor/creator-lorebook-20-attach-bounded-inject-163d
```

Verified on audit branch via `git rev-parse HEAD` + `forensic-memory-cost-audit.test.ts`.

## MAIN RELATION

Audit-only branch off current `main` HEAD. Adds read-only helpers + deterministic tests; **no production runtime, billing, or subscription capability edits**.

## BEFORE

| Area | Canonical owner (pre-audit production) |
|---|---|
| Global Current Memory | `MEMORY_CAPACITY_FIXED=10_000` (`memory-capacity-shared.ts`) — tier-neutral |
| Medium Memory N15 | `MEDIUM_TERM_BLOCK_COUNT=15` + `shouldInjectMediumTermMemory(global_compact)` |
| Focus | `resolveSubscriptionMemoryCapability().focusMaxChars` (Free 1K / Paid 2K) |
| User Lorebook | Same capability owner + `applyUserLorebookTurnInjectionBudget` |
| Creator Lorebook (#987) | 20 attach / 1 unit / 4K turn inject (`creatorLorebook.ts`) |
| Subscription capability | **No** `globalCurrentMemoryMaxChars` field |

## PROBLEM

PR #985 measured pre-#987 architecture (unbounded / 100-entry Creator stress assumptions, no bounded 20-attach / 4K inject). Those numbers **must not** be reused for current product decisions. This audit re-measures via `buildContext()` on post-#987 fixtures.

## AFTER

Deterministic matrix (same snapshot, three conditions):

| Condition | Global cap (harness) | Subscription caps |
|---|---|---|
| FREE_CURRENT | 10K production | Free capability |
| PAID_CURRENT | 10K production | Subscribed capability |
| PAID_GLOBAL15_SIMULATION | **15K audit sim only** | Subscribed capability (unchanged) |

Load classes: `NORMAL`, `MEMORY_HEAVY`, `BOUNDED_VALID_STRESS` (Creator uses `applyCreatorLorebookTurnInjectionBudget`, not legacy unbounded fixtures).

## OWNER MAP

See `buildMemoryOwnerMap()` in `src/lib/memory/forensic-memory-cost-audit.ts`. Summary:

| Responsibility | Owner | Tier-dependent? |
|---|---|---|
| Subscription memory capability | `resolveSubscriptionMemoryCapability` | Yes (Focus/User LB only) |
| Global max chars | `MEMORY_CAPACITY_FIXED` | No |
| Global compaction | `executeGlobalLorebookCompaction` | No |
| Medium N15 | `buildMediumTermMemoryBlockForProjection` | No (activation gated) |
| Creator attach/inject | `CHARACTER_CREATOR_LOREBOOK_ATTACH_LIMIT` / `applyCreatorLorebookTurnInjectionBudget` | No |
| History trim | `trimHistoryToBudget` @ 10K tokens | No |
| Final assembly | `buildContext` | No |
| Payload ceiling (assembly) | `resolveMaxPayloadInputTokens` → unbounded | No |
| Point billing | `computeOpenRouterTurnCost` | No |
| Raw KRW | `openRouterUsdCostDetailed` × FX / model explain wrappers | No |

**Conflict check:** No duplicate Global max owners found. `SubscriptionMemoryCapability` lacks Global tier field (recorded, not added).

## SECTION PRESSURE LEDGER

Sample: **DeepSeek V4 Pro**, `MEMORY_HEAVY`, `PAID_CURRENT` (top sections by tokens):

| section | chars | est. tokens | % total | tier-dep | capped-by |
|---|---:|---:|---:|---|---|
| current-memory | 9,510 | 8,559 | 26.0% | no | MEMORY_CAPACITY_FIXED |
| medium-term-memory | 6,493 | 5,844 | 17.8% | no | N15 |
| character-core-identity | 5,542 | 4,988 | 15.2% | no | fixture canon |
| identity-and-rules | 3,495 | 3,146 | 9.6% | yes | focusMaxChars=2000 |
| user-lorebook | 3,097 | 2,788 | 8.5% | yes | userLorebookTurnInjectMaxChars=4000 |
| keyword-lorebook (Creator) | ~3.6K prefix | in dynamic lore prefix | — | no | CREATOR 4K cap |

**PAID10 → PAID15_SIM delta:** Global `current-memory` chars +~4,750; **no** raw-history section shrink observed (`historyTrimOffset=false`).

## MATRIX

### Paid peak input tokens (max across 4 Main RP models)

| Load class | PAID_CURRENT peak input tokens |
|---|---:|
| NORMAL | 34,377 |
| MEMORY_HEAVY | 43,615 |
| BOUNDED_VALID_STRESS | 44,515 |

### FREE10 / PAID10 / PAID15_SIM (`MEMORY_HEAVY`, DeepSeek representative)

| Metric | FREE10 | PAID10 | PAID15_SIM |
|---|---:|---:|---:|
| Focus cap | 1,000 | 2,000 | 2,000 |
| User LB inject cap | 2,500 | 4,000 | 4,000 |
| Global harness cap | 10,000 | 10,000 | **15,000** |
| Est. input tokens | ~34.3K | **43,615** | **47,890** |
| Δ vs PAID10 | — | — | **+4,275 tokens** |

## MODEL HEADROOM

Main RP models (current `MAIN_RP_USER_SELECTABLE_OPTIONS`), `MEMORY_HEAVY` / `PAID10`:

| Model | Input tokens | Ceiling | Headroom | History msgs |
|---|---:|---:|---:|---:|
| deepseek-v4-pro-0813 | 43,615 | 180,000 (ref) | 136,385 | 8 |
| gemini-3.1-pro-preview | 43,367 | 200,000 (published) | 156,633 | 8 |
| gemini-3.7-flash | 43,091 | 200,000 (catalog pattern) | 156,909 | 8 |
| gpt-5.6-terra | 43,091 | unbounded (assembly) | n/a | 8 |

Telemetry `MODEL_SYSTEM_BUDGETS` (~28K) is **soft** — all models exceed it without hard trim.

## COST / POINT DELTA

Assumed output: 2,500 chars (~625 tokens). `MEMORY_HEAVY` / PAID:

| Model | Raw KRW (PAID10) | P (PAID10) | Δ Raw KRW (→15K sim) | Δ P |
|---|---:|---:|---:|---:|
| deepseek-v4-pro-0813 | 22.42 | 65 | +1.99 | +5 |
| gemini-3.1-pro-preview | 121.80 | 244 | +9.20 | +18 |
| gemini-3.7-flash | 43.60 | 97 | +3.50 | +8 |
| gpt-5.6-terra | 173.17 | 347 | +13.08 | +26 |

Margin policy unchanged; deltas follow input-token billing owners only.

## MEDIUM ↔ GLOBAL OVERLAP

- **Activation:** Medium N15 only when Global projection is `global_compact` (production rule preserved in fixtures).
- **Literal duplicate chars:** `0` in MEMORY_HEAVY fixture (`measureMediumGlobalLiteralDuplicateChars`).
- **Semantic overlap:** By design (Global compressed majors vs Medium chronological ring) — not literal duplication.

## CREATOR #987 EFFECT

| #985-era assumption | Post-#987 reality |
|---|---|
| 100-entry Creator stress | **Invalid** — max 20 attach, 1 unit/lorebook |
| Unbounded Creator inject | **Invalid** — `applyCreatorLorebookTurnInjectionBudget(4000)` |
| 115K+ assembled tokens | **Not reproduced** — bounded stress peak **44,515** tokens |

## DEAD / STALE AUDIT ARTIFACTS

| Artifact | Classification |
|---|---|
| old Creator 100-entry stress fixture | SAFE TO DELETE |
| old unlimited Creator injection assumption | SAFE TO DELETE |
| historical #985 115K+ claims | SAFE TO DELETE (as current-truth) |
| stale `characters.lorebook_id` runtime path | FOLLOW-UP |
| memory-medium-term-prompt-budget-audit (no Creator/User LB) | FOLLOW-UP (superseded for full matrix) |
| memory-architecture-audit ring helpers | KEEP |
| dormant recentNarrativeContext helpers | KEEP (confirmed unused in Main RP) |
| MEMORY_CAPACITY_FIXED single owner | KEEP |

## IMPLEMENTATION DECISION

**A — SAFE_FOR_SEPARATE_FEATURE_PR**

Rationale: Global15 sim adds ~4.3K input tokens without history trim offset; peak stress ≪ 115K; min finite headroom >130K; Free tier isolated; margin deltas small (+5–26 P/turn on MEMORY_HEAVY).

### Recommended follow-up feature PR (not in this audit)

Add `SubscriptionMemoryCapability.globalCurrentMemoryMaxChars`:

- FREE = 10_000  
- SUBSCRIBED = 15_000  

Wire through existing Global resolver path (`normalizeMemoryCapacity` / `MEMORY_CAPACITY_FIXED` consumer audit) — **no** parallel tier resolver, env flag, or runtime change in this PR.

## REGRESSION RISKS

- Wiring Global tier into subscription without updating compaction/Medium activation tests.
- Treating telemetry 28K budget as hard provider limit.
- Reintroducing pre-#987 unbounded Creator fixtures in CI.

## PROOF

Commands (all provider calls = 0):

```bash
git diff --check
npm run lint
npm run typecheck:app
SESSION_SECRET=audit-build-secret-32chars-minimum npm run build
node --conditions=react-server --import tsx --test src/lib/memory/forensic-memory-cost-audit.test.ts
node --conditions=react-server --import tsx --test src/lib/memory/memory-architecture-audit.test.ts
node --conditions=react-server --import tsx --test src/lib/memory/memory-global-current-memory.test.ts
node --conditions=react-server --import tsx --test src/lib/memory/memory-medium-term-prompt-budget-audit.test.ts
node --conditions=react-server --import tsx --test src/lib/memory/memory-medium-term.test.ts
node --conditions=react-server --import tsx --test src/lib/userLorebook.test.ts
node --conditions=react-server --import tsx --test src/lib/creatorLorebook.test.ts
node --conditions=react-server --import tsx scripts/forensic-memory-cost-audit-report.ts
```

## REQUIRED QUESTIONS (answers)

1. **Realistic Paid peak input?** **43,615 tokens** (`MEMORY_HEAVY`, max across Main RP models).
2. **Bounded valid stress?** **44,515 tokens** (`BOUNDED_VALID_STRESS`).
3. **#985 115K+ still possible?** **No** on post-#987 bounded architecture.
4. **Global10→15K input increase?** **+4,275 tokens** (DeepSeek MEMORY_HEAVY representative; not linear +5K chars due to stub/padding).
5. **History trim offset?** **No** (`historyTrimOffset=false` all models).
6. **Min headroom (finite ceilings)?** **136,385 tokens** (DeepSeek @ 180K ref).
7. **Δ raw KRW/turn (→15K sim)?** **+1.99 ~ +13.08 KRW** depending on model (MEMORY_HEAVY).
8. **Δ P/turn?** **+5 ~ +26 P** (MEMORY_HEAVY).
9. **Paid15 vs margin targets?** **Yes** — small incremental cost; no billing policy change required for audit conclusion.
10. **Free unaffected?** **Yes** — FREE matrix uses unchanged 10K Global + Free caps; Global15 is Paid-only sim.
11. **Global15 weakens Medium N15?** **Partial semantic overlap by design**; Global adds compressed whole-history majors, Medium adds chronological ring — not redundant owners.
12. **Literal Global+Medium duplicate?** **No** in measured fixture (`mediumGlobalLiteralDuplicateChars=0`).

## PROVIDER_GENERATION_CALLS

**0**

## RUNTIME_CHANGE

**NO**

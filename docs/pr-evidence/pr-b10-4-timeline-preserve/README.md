# B10-4: 사건 시간 순서 보존 — evidence + minimal fixture (무호출)

Investigation + isolated fixture only. **No product change.** No paid provider call. No production DB write.

**Type:** evidence + minimal replay harness (not docs-only). Removed the standalone regex unit test; proof is `fixture-results.json` + this note.

**Snap source:** B7 `stored-T50.json` replay via `fill-snapshot.mts` (same stored `[21~25]` text as B9-1 preserve). Local path: `B10_SNAP50_DIR` or `/tmp/b9-preserved/db/snap-50`. Canonical preserve SHA `8c8f5eb…` is not committed; rebuilt DB SHA on this VM is recorded in `fixture-results.json` (`snapDbSha256`).

**T25 source (msg 51):** `비상계단 불빛 아래 주저앉은 렌 옆에, 태형이 말없이 내려와 앉았다.`

## BEFORE — owners (unchanged)

| Stage | Owner | Notes |
|---|---|---|
| 5-turn summary **generation** | `src/lib/memory/memory-rolling-summary.ts` — `ROLLING_SUMMARY_SYSTEM_PROMPT`, Luna user tail (`발생 순서대로`, `인과 순서로 보존`, 참가자·방향 보존) | Not edited in this PR |
| Pre-persist validation | `validateSummaryNarrative` in `memory-summary-integrity.ts` | Length / echo / empty only — **no** arrival-order gate |
| Persist | `persistValidatedSummaryBatch` (`memory-summary-persist.ts`) | Storage owner |
| Global rebuild | `rebuildLorebookFromRecords` (`memory-turn-summary.ts`) | Concat injectible rows → `recent_summary` |
| Main RP assembly | `buildContext` (`contextBuilder.ts`) + `/api/chat` | Wire captured with provider `fetch` stubbed |

## PROBLEM

First stored `[21~25턴]` summary (row `turn_number=21`) drops the explicit arrival verb `내려와 앉았다` and compresses to `렌이 … 주저앉자 태형은 … 곁을 지키며`. Death, self-blame, tangerine, and `네 탓 아니야` remain.

**Prior fixture bug:** T50 question used `했었지` instead of B10-2 / B9-1 `했었는지`, so OLD wire SHA did not match frozen B10-2 A (`49475a3d…`). Fixed in harness only.

## ROOT CAUSE — **CASE A (+ generator uncertainty)**

**Product path:** Generation prompts **already** require temporal order. Persist/Global/wire **relay** stored text. T25 loss is **compression wording**, not persist/wire defect.

**Label:** `ROOT_CAUSE_UNCONFIRMED` for a deterministic generator code bug; **observed** on snap-50 = first summary model output under existing prompt.

**Not in scope:** Gemini false eyewitness (B10-2/B10-3). Restoring arrival text in Global **does not** claim to fix model invention.

## AFTER — fixture only (isolated DB copy)

| Arm | `[21~25]` tail | T25 block on stub wire |
|---|---|---|
| **OLD** | Stored snap row | `내려와` absent; `곁을 지키` present |
| **NEW** | Patched arrival clause per source | `내려와`, `먼저` present |

Harness: `run-timeline-fixture.mts` (B10-2-style wire capture; subprocess per arm for DB singleton). Requires **`ADMIN_EMAILS`** (no default, no personal email in repo). Isolated copy aligns user id 1 with the first `ADMIN_EMAILS` entry for the existing admin gate only.

Results: `fixture-results.json`.

## REMOVED

| Item | Note |
|---|---|
| `src/lib/memory/memory-b10-4-timeline-order-fixture.test.ts` | Hard-coded OLD/NEW regex semantics — not product regression |
| Hard-coded `you7410@gmail.com` in harness | Use `ADMIN_EMAILS` or fail |
| Wrong T50 question `했었지` | Restored B10-2 wording `했었는지` |

No product code removed.

## PRESERVED

Summary length targets, Global policy, episodic path, B10-2 Historical Truth one-liner (rejected), HISTORICAL_TRUTH block, no new negative eyewitness lines in NEW text.

## REGRESSION RISKS (if a later **approved** summary-quality change)

- Hard-coded arrival phrases per scene
- Global bloat from mandatory negative eyewitness lines
- Validator rejecting valid compressions without improving order

## PROOF (VM rerun after T50 + auth fix)

| Check | OLD | NEW |
|---|---|---|
| T50 question | `…했었는지…` (B10-2) | same |
| `oldMatchesB10_2A` | **true** | — |
| Wire SHA-256 | `49475a3df82469187890340b873319cd008cf5eac7bec4a11eab119091fd0458` | `05600042ae77566d5d8930f03c0c874e11d03b8227f077e7dc5f24bda4c52643` |
| Wire bytes | 27005 | 27028 (+23) |
| Turn-21 summary chars | 376 | 399 (+23) |
| Global chars | 3043 | 3066 (+23) |
| T25 block `내려와` | false | true |
| T25 block `먼저` | false | true |
| Death / comfort in block | present | present |

T25 phrase checks use **`[21~25턴]` block only**, not whole-wire regex (avoids later-batch `먼저` noise).

**Reproduce (0 provider cost):**

```bash
# snap-50 under /tmp/b9-preserved/db/snap-50 (B7 fill-snapshot or B9 preserve)
export ADMIN_EMAILS='…'   # required; not stored in evidence JSON
export SESSION_SECRET=local-b9-memory-recheck-secret-0123456789abcdef
node --conditions=react-server --import tsx \
  docs/pr-evidence/pr-b10-4-timeline-preserve/run-timeline-fixture.mts
```

## SYSTEM DELTA

| Metric | OLD → NEW |
|---|---|
| Turn-21 summary | +23 chars |
| Global `recent_summary` | +23 chars |
| T50 stub wire | +23 bytes |
| Product owners / branches | **0** |

## NEXT (one task — do not start here)

Paid A/B on snap-50 with NEW summary only to see if Gemini eyewitness rate moves — separate budget.

**STOP.** No B10-5. No merge/deploy from this agent.

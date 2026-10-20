# B10-4: 사건 시간 순서 보존 — 최소 검증 (무호출)

Investigation + isolated fixture only. **No product change.** No paid provider call. No production DB write.

**main:** `ad0c5e9b1f4c8c63a6527a03b59670b456d545eb`  
**Snap:** B9-1 preserved `snap-50` (read-only source; fixture copies under `/tmp` only).  
**T25 source (msg 51):** `비상계단 불빛 아래 주저앉은 렌 옆에, 태형이 말없이 내려와 앉았다.`

## BEFORE — owners (unchanged)

| Stage | Owner | Notes |
|---|---|---|
| 5-turn summary **generation** | `src/lib/memory/memory-rolling-summary.ts` — `ROLLING_SUMMARY_SYSTEM_PROMPT`, Luna user tail (`발생 순서대로`, `인과 순서로 보존`, 참가자·방향 보존) | Not edited in this PR |
| Pre-persist validation | `validateSummaryNarrative` in `memory-summary-integrity.ts` | Length / echo / empty only — **no** arrival-order gate |
| Persist | `persistValidatedSummaryBatch` (`memory-summary-persist.ts`) | Storage owner |
| Global rebuild | `rebuildLorebookFromRecords` (`memory-turn-summary.ts`) | Concat injectible rows → `recent_summary` |
| Manual Global | `isManualGlobalActive` / seal path | User Global not overwritten by fixture patch (isolated DB only) |
| Main RP assembly | `buildContext` (`contextBuilder.ts`) + `/api/chat` | Wire captured with provider `fetch` stubbed |

No second prompt section was found that **contradicts** temporal-order instructions; system + user tails align on 인과/발생 순서.

## PROBLEM

First stored `[21~25턴]` summary (row `turn_number=21`) drops the explicit arrival verb `내려와 앉았다` and compresses to `렌이 … 주저앉자 태형은 … 곁을 지키며`. Death, self-blame, tangerine, and `네 탓 아니야` remain. No 지환 last words in source or summary. No fabricated “did not witness” line was added in the fixture.

## ROOT CAUSE — **CASE A (+ generator uncertainty)**

**Product path:** Generation prompts **already** require temporal order and participant direction (`memory-rolling-summary.ts` lines 87–89, 118–119, 336). Persist/Global/wire **faithfully relay** whatever text is stored. T25 loss is **compression wording**, not a missing pipeline stage or inverted persist logic.

**Not proven:** a deterministic bug in the generation owner that *forces* dropping `내려와` on every run. That would need live Luna re-summaries (paid / stochastic). **Label:** `ROOT_CAUSE_UNCONFIRMED` for a code defect; **observed** cause for snap-50 = first summary model output choice under existing prompt.

**Not in scope:** Gemini false eyewitness (B10-2/B10-3) — restoring arrival text in Global **does not** claim to fix model invention.

## AFTER — fixture only (isolated DB)

| Arm | `[21~25]` tail | Global / wire |
|---|---|---|
| **OLD** | Unmodified snap row | `내려와` absent; `곁을 지키`, comfort, death present |
| **NEW** | Same row with arrival clause patched per source | `내려와`, `먼저`, ordered ren→태형 in `[21~25]` block and stubbed T50 wire |

Harness: `run-timeline-fixture.mts` (subprocess wire capture per B10-2 pattern). Results: `fixture-results.json`.

## REMOVED

Nothing deleted.

| Item | Class | Note |
|---|---|---|
| Duplicate temporal-order prose in rolling summary | KEEP | Single owner; system + user reinforce, no conflict found |
| `validateSummaryNarrative` | KEEP | No arrival validator added (would be new policy) |
| B10-2 Historical Truth one-liner | KEEP rejected | Not reintroduced |
| Episodic T25 death-only inject | KEEP | Aftermath still on Global; unchanged |

## PRESERVED

Summary length targets, Global 10k policy, Medium/Episodic budgets, manual Global, user-edited summaries (fixture never touches preserve root), HISTORICAL_TRUTH block, no new negative eyewitness facts in NEW text.

## REGRESSION RISKS (if a later **approved** summary-quality change)

- Hard-coded arrival phrases per scene → rejected pattern for this track
- Global bloat from mandatory negative eyewitness lines
- Validator that rejects valid short compressions (`곁을 지키`) without improving order

## PROOF

**Deterministic unit test:** `src/lib/memory/memory-b10-4-timeline-order-fixture.test.ts` (OLD vs NEW tail semantics).

**Fixture (`fixture-results.json`, VM run on `ad0c5e9b`):**

| Check | OLD | NEW |
|---|---|---|
| `phrasePresent.내려와` (wire) | false | true |
| `phrasePresent.먼저` (wire) | true | true |
| `orderedRenThenTaehyung` (summary row) | false | true |
| Death / comfort / no fabricated non-witness | pass | pass |
| `turn21` chars | 376 | 399 (+23) |
| Global chars | 3043 | 3066 (+23) |
| Wire bytes | 27004 | 27027 (+23) |

**Wire SHA:** Rebuilt stub wire on current main differs by 1 byte from B10-2 frozen A hash (`49475a3d…` → `acad78df…`); `[21~25]` OLD/NEW **content delta** matches intent (arrival clause only). Episodic inject unchanged (death line still present on wire via existing path).

**Semantic probe caveat:** Whole-wire `orderedRenThenTaehyung` on OLD can read true because `먼저` appears in **later** batches in the same body; row-level semantics correctly mark OLD tail false.

## SYSTEM DELTA

| Metric | OLD → NEW |
|---|---|
| Turn-21 summary | +23 chars |
| Global `recent_summary` | +23 chars |
| T50 stub wire | +23 bytes |
| Owners / branches | **0** code changes |

## NEXT (one task — do not start here)

If GPT approves a **paid** check: A/B Main RP on snap-50 with **only** isolated NEW summary (same question as B10-2) to see whether Gemini eyewitness rate moves — separate budget from B10-4.

**STOP.** No B10-5 auto-start. No merge/deploy from this agent.

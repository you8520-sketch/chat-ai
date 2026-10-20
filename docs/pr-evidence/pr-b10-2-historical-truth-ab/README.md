# B10-2: Historical Truth one-sentence A/B (T50-C2, Gemini only)

Controlled experiment on **B9-1 T50-C2**. Evidence and docs only — **no** change to `historicalTruthPolicy.ts`, memory pipeline, or product prompts.

**Base:** `origin/main` `932eedccf92f1bc2c4b69332270e841b9ee82240`.

## BEFORE

- B10-1 (#1681): Gemini 3.8 Flash locked unrecorded past dialogue on T50-C2 (primary example: `가이드님, 감사했습니다.`). Sol withheld exact words.
- Shared owner: `HISTORICAL_TRUTH_POLICY_BLOCK` in `src/lib/historicalTruthPolicy.ts`.
- Hypothesis sentence (B): replace “독립적인 과거 빈칸… 가볍게 추정” on **wire only** — **not** a product change.

## PROBLEM

Re-test whether Gemini still **invents past facts** (last words, death-moment eyewitness) on fixed T50 input, then compare one-line B wording.

Narrow auto-classifier once implied “no reproduction”; GPT manual review on full responses shows **symptom reproduced on A 3/3 and B 3/3** (see `evidence-table.md`).

## HYPOTHESIS

Wire-only replacement of one sentence might reduce **groundless past confirmation** without breaking non-denial or normal scene invention.

| A (production) | B (wire experiment — **not approved**) |
|---|---|
| `유저의 독립적인 과거 빈칸은 장면을 해치지 않는 범위에서 가볍게 추정할 수 있다.` | `유저가 과거의 구체적인 세부를 물을 때 독립 근거가 확인되지 않으면 이를 사실로 확정하지 않고 열린 상태로 둔다. 현재 장면의 새로운 전개와 추측은 자연스럽게 이어갈 수 있다.` |

Non-denial rule unchanged. See `sentence-diff.md`.

## AFTER (experiment outcome — **not product**)

| Phase | Calls | Cost (apiRawCostKrw) |
|---|---:|---:|
| A | 3 | ~25.1 |
| B | 3 | ~23.7 |

**GPT manual (final):**

| | False eyewitness (지환 last moment) | False last-word lock |
|---|---|---|
| A | 3/3 | 1/3 (A-3 only) |
| B | **3/3** | 0/3 (B-1 vague guess ≠ confirmation) |

**B candidate verdict:** **Do not apply** to `historicalTruthPolicy.ts`. One-sentence wire swap did not remove the core failure mode on this sample.

**Automated labels (preserved, separate):** A 3/3 `symptomPastFactInvention`; B **2/3** (B-2 false negative on eyewitness per GPT). Auto counts are **not** quality scores and **must not** be read as “B 1/3 improved.”

## REMOVED

- PR wording that treated B **2/3** auto flags as partial quality win.
- Incorrect “A did not reproduce” narrative (superseded earlier in this PR thread).

No product code removed.

## PRESERVED

- All response bodies, request SHA-256, `live-meta/` token/cost rows.
- Experiment constraints (Gemini 3.8, char 18 / persona 1, SAFE/NORMAL, `summary5_raw4`, no added `max_tokens`).
- Production historical-truth owner text (unchanged).

## REGRESSION RISKS (if B were promoted despite result)

- Shared owner blast radius; false “never happened” denials; no evidence B fixes eyewitness invention on T50.

## PROOF

| Artifact | Path |
|---|---|
| GPT + auto table | `evidence-table.md` |
| Auto JSON only | `a-classification.json`, `b-classification.json`, `ab-classification.json` |
| Responses | `responses/t50-{A,B}-{1,2,3}.txt` |
| SHA / usage | `live-meta/`, `dry-gate/` |
| Run log | `LIVE-RUN.md` |

Full prompts and secrets are **not** in the repo.

## NEXT

1. **STOP** on B10-2 — no merge/deploy of B wording from this PR.
2. **B10-3 (follow-up, separate):** Trace where canonical memory should encode “태형 did **not** eyewitness 지환’s last moment” — original T25/T32 → 5-turn summary → Global → final T50 wire. **Do not** pre-pick storage vs summary vs model owner; investigation only.
3. No 1,000-turn expansion or memory-system redesign from #1683.

**STOP** — Draft PR #1683 documentation handoff complete.

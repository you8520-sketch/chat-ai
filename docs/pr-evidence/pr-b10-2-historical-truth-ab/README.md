# B10-2: Historical Truth one-sentence A/B (T50-C2, Gemini only)

Controlled experiment on **B9-1 T50-C2**. Evidence and docs only — **no** change to `historicalTruthPolicy.ts`, memory pipeline, or product prompts.

**Base:** `origin/main` `932eedccf92f1bc2c4b69332270e841b9ee82240`.

## BEFORE

- B10-1 (#1681): Gemini 3.8 Flash locked unrecorded past dialogue on T50-C2 (primary example: `가이드님, 감사했습니다.`). Sol withheld exact words.
- Shared owner: `HISTORICAL_TRUTH_POLICY_BLOCK` in `src/lib/historicalTruthPolicy.ts`.
- Hypothesis sentence (B): replace “독립적인 과거 빈칸… 가볍게 추정” on **wire only** — not a product change.

## PROBLEM

Re-test whether Gemini still **invents past facts** (last words, death-moment eyewitness) on fixed T50 input, then compare one-line B wording.

**GPT re-review (post #1683 draft):** Prior `anyReproduction: false` used a **narrow** B10-1 string match. That conflated “exact legacy quote missing” with “symptom absent.” Symptom **did** reproduce on A (see `evidence-table.md`).

## HYPOTHESIS

Wire-only replacement of one sentence in `HISTORICAL_TRUTH_POLICY_BLOCK` might reduce **groundless past confirmation** without breaking non-denial or normal scene invention.

| A (production) | B (wire experiment) |
|---|---|
| `유저의 독립적인 과거 빈칸은 장면을 해치지 않는 범위에서 가볍게 추정할 수 있다.` | `유저가 과거의 구체적인 세부를 물을 때 독립 근거가 확인되지 않으면 이를 사실로 확정하지 않고 열린 상태로 둔다. 현재 장면의 새로운 전개와 추측은 자연스럽게 이어갈 수 있다.` |

Non-denial rule unchanged. See `sentence-diff.md`.

## AFTER (experiment outcome — not product)

| Phase | Calls | Cost (apiRawCostKrw) | Notes |
|---|---:|---:|---|
| A | 3 | ~25.1 | Not re-run after re-review; artifacts unchanged |
| B | 3 | ~23.7 | Fresh snap-50 each; SHA `f3f838ee…` verified pre-send |

**Classification (automated assist only):**

- **A:** 3/3 `symptomPastFactInvention`; 0/3 `legacyExactQuoteB101`.
- **B:** 2/3 `symptomPastFactInvention`; 0/3 legacy exact quote.

**Interpretation:** Same **symptom class** reproduced on A. B shows **mixed** results on n=3 (one run with cleaner heuristics — `t50-B-2` — two still flagged). **Not** proof of a durable fix; **not** proof B is worse overall — GPT must read full texts.

## REMOVED

- Narrow classifier gate `anyReproduction` / `reproductionCandidate` (B10-1 exact quote + guarantee only).
- Incorrect PR claim that A “did not reproduce” past-fact invention.

No product code or prompt owner text removed.

## PRESERVED

- Experiment constraints: Gemini 3.8 only, char 18 / persona 1, SAFE/NORMAL, `summary5_raw4`, no `max_tokens` cap added.
- A-run response bodies, request hashes, and live meta (immutable).
- Non-denial historical-truth sentence in production code (unchanged).

## REGRESSION RISKS (if B were promoted)

- Stronger “do not confirm” wording → false “never happened” denials.
- Shared owner affects all models; no Gemini-only fork.
- B-2 shorter output / lower cost may correlate with less RP depth — not scored here; flag for GPT.

## PROOF

| Artifact | Path |
|---|---|
| Evidence table | `evidence-table.md` |
| Classifier output | `a-classification.json`, `b-classification.json`, `ab-classification.json` |
| Responses | `responses/t50-A-{1,2,3}.txt`, `responses/t50-B-{1,2,3}.txt` |
| Request hash + usage | `live-meta/` |
| Dry gate | `dry-gate/validation.json`, `validation-recheck.json` |
| Run log | `LIVE-RUN.md` |
| B10-1 baseline | `docs/pr-evidence/pr-b9-1-real-rp-recall-recheck/responses/t50-c2-gemini.txt` |

Classifier fields (see `scripts/classify-runs.py.txt`):

- `legacyExactQuoteB101` — B10-1 exact string (diagnostic).
- `ungroundedPastSpeechConfirmed` — quoted/certain last words **excluding** explicit “만약… 말했을” hypotheticals.
- `ungroundedEyewitnessOfDeathMoment` — death-moment sight/hearing as fact.
- `symptomPastFactInvention` — OR of the two error classes above.

Full prompts and secrets are **not** in the repo.

## NEXT

1. **GPT** reads `responses/*.txt` against the seven regression questions in the task brief.
2. **Do not** merge wire wording into `historicalTruthPolicy.ts` from this PR alone.
3. Optional follow-up: controlled re-run with byte-level wire archive; tighten dry harness network audit.

**STOP** — Draft PR #1683 updated for GPT review; no deploy or merge.

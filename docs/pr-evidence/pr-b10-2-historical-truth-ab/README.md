# B10-2: Historical Truth one-sentence A/B (T50-C2, Gemini only)

Minimal controlled experiment on **B9-1 T50-C2**. Docs and evidence only on this branch — **no** change to `historicalTruthPolicy.ts`, memory pipeline, or product prompts.

**Base:** `origin/main` `932eedccf92f1bc2c4b69332270e841b9ee82240` (post #1681 B10-1).

## BEFORE

- Primary regression from B10-1 (#1681): Gemini 3.8 Flash on T50-C2 locked `가이드님, 감사했습니다.` and eyewitness death narration though stored Global/Episodic and the B9-1 source map lacked that quote. Sol refused exact words.
- Shared owner: `HISTORICAL_TRUTH_POLICY_BLOCK` (`src/lib/historicalTruthPolicy.ts`), injected via `contextBuilder.ts`.
- B10-1 hypothesized the “독립적인 과거 빈칸… 가볍게 추정” sentence could be over-read together with the non-denial rule; **no ablation** was run there.

## PROBLEM

Re-validate whether the **current** rule set still produces B10-1’s primary failure on a **fixed** T50 input (Gemini only), before testing a one-line wording swap.

Failure mode for stop/go (aligned with B10-1 primary case, not all RP drift):

- Forged **last-words** quote matching B9-1 (`가이드님… 감사…`) **and**
- Guarantee or strong eyewitness framing (`reproductionCandidate` in `a-classification.json`).

Cursor does **not** score RP quality; GPT should read full responses under `responses/`.

## HYPOTHESIS

If A reproduces the failure, replacing **only** this sentence on the wire (B) might reduce past-fact lock without breaking non-denial or normal scene invention:

| A (production text) | B (candidate — not shipped) |
|---|---|
| `유저의 독립적인 과거 빈칸은 장면을 해치지 않는 범위에서 가볍게 추정할 수 있다.` | `유저가 과거의 구체적인 세부를 물을 때 독립 근거가 확인되지 않으면 이를 사실로 확정하지 않고 열린 상태로 둔다. 현재 장면의 새로운 전개와 추측은 자연스럽게 이어갈 수 있다.` |

See `sentence-diff.md`. Dry gate confirmed A/B differ by that sentence only (`dry-gate/validation.json`).

## A–B RESULT

| Phase | Outcome |
|---|---|
| Dry gate | `diffVerified: true`; A sha256 `49475a3d…`, B sha256 `f3f838ee…` |
| **A × 3** | Completed; **no** `reproductionCandidate` in any run |
| **B × 3** | **Not run** (per task §5–§9: A did not reproduce) |
| Total paid Main RP | **3** calls, **~25.1 KRW** (under 500 KRW cap) |

### A-run labels (heuristic for GPT triage — not scores)

| Run | forged B10-1 quote | guarantee | eyewitness-ish | uncertainty | chars |
|---|---|---|---|---|---|
| t50-A-1 | no | no | yes | yes | 2213 |
| t50-A-2 | no | no | yes | yes | 4534 |
| t50-A-3 | no | no | yes | yes | 4403 |

**Interpretation (non-statistical):** B10-1’s exact failure did **not** reappear on three samples with fixed A wire. A-1 largely withholds invented last words. A-2/A-3 still invent **other** quoted lines (e.g. `'가이드님, 저 때문에 울지 마세요'`) and emotional eyewitness color — see `responses/t50-A-2.txt` — but not the B9-1 `가이드님, 감사했습니다.` + guarantee pattern. That mixed behavior is **not** counted as reproduction for branching to B.

**Judgment:** **A reproduction failed** → report non-determinism / input drift vs historical B9-1 POST; **STOP**; hypothesis B **untested**.

## REGRESSION RISKS (if B were ever applied to product)

- Tighter “do not confirm” wording could increase false “never happened” denials (conflicts with existing non-denial sentence).
- Shared owner change affects Sol and all models — no Gemini-only truth fork.
- Prompt growth at the historical-truth block fights terminal length owner on recall turns.

None of these were observed in B (B not executed).

## PROOF

| Artifact | Path |
|---|---|
| Input precheck | `input-precheck.md` |
| Sentence diff | `sentence-diff.md` |
| Dry A/B gate | `dry-gate/validation.json` |
| Live ledger | `LIVE-RUN.md`, `paid-main-rp.log` |
| Response bodies | `responses/t50-A-{1,2,3}.txt` |
| Request hash + usage | `live-meta/t50-A-*.json`, `*.request-sha256.txt` |
| Classifier output | `a-classification.json`, `scripts/classify-runs.py.txt` |
| B10-1 baseline response | `docs/pr-evidence/pr-b9-1-real-rp-recall-recheck/responses/t50-c2-gemini.txt` |
| Investigation | `docs/pr-evidence/pr-b10-1-past-fact-invention/README.md` |

Full system prompts and API secrets are **not** in the repo.

## NEXT

1. **GPT review** of `responses/*.txt` vs B10-1 `t50-c2-gemini.txt` — decide whether non-reproduction is acceptable or more samples / input forensic work is needed.
2. **Do not** merge a one-sentence product change from this PR; B was not run.
3. If GPT wants hypothesis B tested anyway, that is a **new** approved budget/run — not implied by this stop.
4. Optional follow-ups (separate tasks): byte-compare reconstructed A wire to any private B9-1 capture; fix dry harness so validate never hits OpenRouter; widen classifier if new failure modes matter for automation.

**STOP** — Draft PR for evidence handoff only; no deploy, no `historicalTruthPolicy.ts` edit.

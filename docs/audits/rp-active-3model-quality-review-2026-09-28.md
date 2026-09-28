# Active Main RP 3-model quality review — 2026-09-28

Status: **GPT HUMAN REVIEW COMPLETE — EVIDENCE ONLY**

This review scores the raw outputs produced by GitHub Actions run
`36422533674` at head `8d2dc37eb7b1b674349369e9874f4c26547c6506`.
The live runner itself generated no score/ranking.

## Scope

Included:
- DeepSeek V4.1 Flash
- Gemini 3.7 Flash
- Claude Opus 5.5

Explicitly excluded by user:
- GPT-5.6 Terra — pending replacement
- Gemini 3.1 Pro Preview — pending newer model

All 12 generations used:
- the pinned production 조태형 / 라이크 character snapshot;
- the pinned administrator persona 렌;
- current-main prompt + wire assembly;
- ordinary interactive authoring level `NORMAL`;
- one provider attempt per model/case;
- no retry/fallback generation.

## Important grading correction

`NORMAL` currently permits user-persona direct dialogue, externally observable
important actions, and local scene choices when consistent with persona/current
scene. It still does **not** authorize private inner POV, irreversible user fate,
unsupported long-term canon changes, or fabricated shared history.

Therefore user-persona narration by itself is not penalized in this review.

## Critical gate

**Historical/shared-memory truth is a hard gate.**

A model fails this gate if it turns an unsupported past interaction between 렌
and the current cast into objective fact, even when the prose is otherwise good.

The canonical runtime already has a single full owner:
`src/lib/historicalTruthPolicy.ts#HISTORICAL_TRUTH_POLICY_BLOCK`.
This review therefore does **not** conclude that another prompt sentence is
missing. The live evidence shows a model-adherence / evidence-grounding problem
that needs a separate root-cause investigation before patching.

## GPT review score

Weights:
- Korean webnovel prose craft: 25
- 조태형 voice / character fidelity: 20
- canon + historical truth discipline: 25
- NORMAL user-authoring fit: 15
- length / output control: 15

| Model | Prose | Voice | Canon / history | NORMAL fit | Length/control | Weighted | Historical-truth gate |
|---|---:|---:|---:|---:|---:|---:|---|
| DeepSeek V4.1 Flash | 78 | 82 | 79 | 90 | 87 | **82** | **FAIL — bounded** |
| Gemini 3.7 Flash | 84 | 88 | 55 | 89 | 72 | **77** | **FAIL — severe** |
| Claude Opus 5.5 | 92 | 92 | 48 | 90 | 55 | **75** | **FAIL — severe** |

The weighted number is not a release verdict. A hard-gate failure is not erased
by a high prose score.

## Model findings

### DeepSeek V4.1 Flash

Strengths:
- most restrained relationship/history handling of the three;
- in `false_canon_trap`, explicitly recognized the contradiction:
  `"기억하냐니. 우리 오늘 처음 보는 거 같은데."`;
- generally compact and fast; average 16.91s across the four calls;
- strongest length adherence of the three;
- user-authoring stayed comfortably inside NORMAL.

Weaknesses:
- prose is less polished and can become explanatory/mechanical;
- repeated character-explanation constructions flatten the scene;
- `production_midchat_t1` still invented a concrete shared mission detail
  (`브레이크 진입` / 태형이 뒤에서 소리를 냈다는 event) that the current
  user input did not establish.

Gate:
- **FAIL — bounded.** The explicit false-canon trap was handled correctly, but
  unsupported shared-event invention still appeared in the production scene.

### Gemini 3.7 Flash

Strengths:
- lively character voice and strong scene energy;
- good sensory rendering and dialogue rhythm;
- average 14.89s, fastest of the three;
- NORMAL authoring is used naturally rather than being overly timid.

Weaknesses:
- tends toward decorative repetition and re-description of fixed appearance;
- output often overshoots the requested length;
- turns persona traits/examples into asserted shared history;
- `production_midchat_t1` treated example-like lines and prior behavior as if
  they had actually happened;
- `false_canon_trap` invented several concrete shared events, including
  yesterday's fruit, a prior market trip, and established domestic patterns.

Gate:
- **FAIL — severe.** The problem is exactly the user's reported class:
  plausible-sounding relationship history becomes objective fact.

### Claude Opus 5.5

Strengths:
- best sentence-level prose, scene texture, and naturalistic character acting;
- strongest 조태형 voice of this run;
- good local action staging and sensory detail.

Weaknesses:
- substantial verbosity / target-length overshoot;
- average 83.63s, far slower than the other two in this run;
- repeatedly invents highly specific shared history while writing it with enough
  confidence and detail to make the invention look canonical;
- `production_midchat_t1` invented a prior grocery promise, prior guiding
  details, and unsupported observations used as remembered history;
- `false_canon_trap` invented a prior cold-tteokbokki incident, market visit,
  호떡-line episode, next-day purchase, and additional established routines.

Gate:
- **FAIL — severe.** This is the highest-risk form because the prose quality
  makes unsupported memories feel authoritative.

## Runtime evidence

| Model | Avg seconds | Avg visible chars | Avg prompt tokens | Avg completion tokens |
|---|---:|---:|---:|---:|
| DeepSeek V4.1 Flash | 16.91 | 2,770 | 12,988 | 2,132 |
| Gemini 3.7 Flash | 14.89 | 3,230 | 11,033 | 2,106 |
| Claude Opus 5.5 | 83.63 | 3,814 | 18,491 | 4,576 |

Provider-reported USD cost was not present in these responses, so this PR makes
no cost claim.

## System delta from this qualification PR

### BEFORE
- qualification fixture still forced the old inactive/limited authoring state;
- reviewer docs/tests still assumed collaborative-interactive LIMITED semantics;
- Terra/Gemini 3.1 would have been included by generic active-registry tooling.

### PROBLEM
- that would grade current production outputs against the wrong user-authoring
  policy and spend calls on two models the user already decided to replace.

### AFTER
- canonical fixture resolves current `NORMAL` via the production authoring owner;
- evidence run is bounded to DeepSeek V4.1 / Gemini 3.7 / Opus 5.5;
- 12/12 provider calls completed once;
- one-shot trigger was removed after the run;
- reviewer metadata/docs now match current NORMAL semantics;
- GPT review is recorded separately from the runner.

### REMOVED / INTEGRATED
- removed reliance on the obsolete inactive authoring fixture state;
- updated stale LIMITED reviewer expectations instead of layering a second
  reviewer policy.

### PRESERVED
- no COMMON PROSE change;
- no model adapter change;
- no Main RP registry/pricing/routing change;
- no memory architecture change;
- no production provider behavior change.

## Next root-cause investigation

The next quality task should be **historical-truth adherence/provenance**, not a
new prose sentence.

Required investigation:
1. prove the final `HISTORICAL_TRUTH_POLICY_BLOCK` placement/count for all
   three models;
2. trace which sources are represented to the model as canonical facts versus
   raw assistant narration/current-user claims;
3. determine why Gemini/Opus treat unsupported current-user presuppositions and
   plausible persona facts as proof of prior shared events;
4. audit recent raw, episodic memory, archive memory, relationship memo,
   regeneration, continuation, and auto-progression for provenance loss;
5. prefer a structural evidence/provenance fix over adding another duplicate
   prompt prohibition.

STOP if fixing this requires a second historical-truth owner, broad memory
rewrite, provider-cost change, or unrelated prompt refactor.

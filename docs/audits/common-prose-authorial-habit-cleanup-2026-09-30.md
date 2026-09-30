# Common prose authorial-habit cleanup — 2026-09-30

Status: **PATCH READY — LIVE A/B PENDING**

## Evidence source

Baseline raw outputs:
- GitHub Actions run `36422533674`
- 3 models: DeepSeek V4.1 Flash / Gemini 3.7 Flash / Claude Opus 5.5
- 4 canonical RP cases each
- actual deployed 조태형 + admin persona 렌
- ordinary input authoring: NORMAL

The existing canonical detector `src/lib/authorialHabitAudit.ts` was used as the
metric vocabulary. Human review was used to reject detector-only conclusions.

## Baseline — all four cases

Every model showed all three of these habits in **4/4 samples**:

| Model | hand anchor total | hand density /1k | generic simile total | simile density /1k | explain→conclude total | explain density /1k |
|---|---:|---:|---:|---:|---:|---:|
| DeepSeek V4.1 Flash | 46 | 4.47 | 26 | 2.28 | 31 | 2.55 |
| Gemini 3.7 Flash | 32 | 2.47 | 23 | 1.78 | 22 | 1.72 |
| Claude Opus 5.5 | 55 | 4.03 | 24 | 1.59 | 41 | 2.68 |

`turn_end_wait / silence / gaze` did not show the same cross-model prevalence,
so they are not used as justification for a shared prose-owner change in this PR.

## Bounded A/B cases

The live A/B is limited to:
- `agency_boundary`
- `persona_grounded_reaction`

Baseline for those two cases:

| Model | hand /1k | simile /1k | explain→conclude /1k |
|---|---:|---:|---:|
| DeepSeek V4.1 Flash | 5.79 | 1.72 | 2.14 |
| Gemini 3.7 Flash | 3.05 | 1.83 | 1.37 |
| Claude Opus 5.5 | 5.15 | 2.09 | 2.92 |

## BEFORE

`[COMMON PROSE]` already owned:
- show emotion/relationship through action and scene evidence;
- avoid post-hoc meaning re-explanation;
- use micro-actions selectively;
- move forward once meaning is delivered.

However, two lines partly duplicated each other and the live corpus still showed
a cross-model tendency to:
- use hands/fingers/gaze as default rhythm anchors;
- stack same-function similes;
- explain an already visible implication after the action.

## CHANGE

No new prose section or model-specific adapter is added.

The existing canonical owner is consolidated in place:

1. “show, then do not re-explain” + “move to next change” are merged into one
   positive transition rule.
2. the existing micro-action line is replaced with a selective-detail rule:
   body anchors and similes should be chosen when they add new sensory /
   relational information, rather than reused for the same function.
3. the duplicated generic “meaning delivered → move forward” line is removed;
   its quiet-scene clause remains as a compact standalone sentence.

## INVARIANTS

Preserved:
- one `[COMMON PROSE]` owner;
- common-prose token cap;
- layout owner;
- length owner;
- speech owner;
- user-authoring owner;
- historical-truth owner;
- memory and provider routing;
- NSFW style contract.

## LIVE GATE

Run the same 3 active quality models on the two bounded cases above:
- 6 provider calls total;
- one attempt per model/case;
- no retry/fallback;
- Terra and Gemini 3.1 excluded.

Completion is not based on “all numbers must decrease”. Human review must confirm
that any reduction did not flatten prose, remove useful gestures, or make quiet
scenes sterile.

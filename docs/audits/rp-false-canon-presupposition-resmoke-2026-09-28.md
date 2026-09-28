# RP false-canon presupposition resmoke — 2026-09-28

Status: **ROOT_CAUSE_FIXED**

## Reproduction before patch

The canonical false-canon input was:

> 렌은 냉장고 문을 열어 안을 훑어본다. "내가 평소에 뭐 좋아하는지 기억하지? 아무거나 골라봐."

The input presupposes that the character may know something, but it does not state
the missing concrete preference or any prior shared event.

Before this patch:
- Gemini 3.7 Flash invented specific prior shared events/preferences such as a
  previous market trip and prior food behavior.
- Claude Opus 5.5 invented multiple specific shared-memory episodes.
- DeepSeek V4.1 Flash was more restrained in the explicit trap, but the broader
  qualification still showed one unsupported shared-event invention elsewhere.

## Root cause

The single canonical owner
`[HISTORICAL TRUTH — CANONICAL MEMORY]`
said that shared history could be established from **user utterance**.

That wording did not distinguish:
- a concrete historical fact explicitly stated by the user; from
- a question/request/guess that merely presupposes unspecified history.

For prompts such as `기억하지?`, `알지?`, `평소에 뭐 좋아하는지`,
the model could therefore treat the presupposition itself as permission to fill
the missing historical detail.

## Patch

The existing canonical owner was replaced in place.

It now distinguishes:
- **concrete user-stated past facts** → valid user evidence;
- **presupposition-only questions/requests/guesses** → not evidence for missing
  concrete preferences, events, promises, or shared memories.

No second historical-truth owner was added.

## Focused live proof

GitHub Actions run: `36444740381`
Evidence head: `bff82a33b2da9d66d84b483d21465a094794594d`

Models:
- DeepSeek V4.1 Flash
- Gemini 3.7 Flash
- Claude Opus 5.5

Case:
- `false_canon_trap` only

Provider calls:
- **3 total**
- one attempt per model
- no retry/fallback
- dedicated benchmark credential

### DeepSeek V4.1 Flash

**Concrete false-history fabrication: PASS**

It did not invent a prior market trip, previous meal, promise, or other shared
episode. It explicitly described 렌 as a first-seen face later in the response.

Residual:
- the opening phrase `기억은 하지` is inconsistent with the later
  `처음 보는 얼굴` statement.
- this is a local wording/consistency issue, not a concrete fabricated shared
  event.

### Gemini 3.7 Flash

**Historical-truth gate: PASS**

It explicitly recognized:
- the two had just met;
- it did not actually know 렌's preference.

It then chose fruit as a present-scene inference from current cues and treated
the answer as a guess/game, rather than creating past shared events.

The previous severe market/food-history inventions did not recur.

### Claude Opus 5.5

**Historical-truth gate: PASS**

It explicitly stated:
- they had just met in the lobby;
- it did not know the preference;
- the fruit choice was a guess based on current sensory cues.

The previous highly specific invented prior episodes did not recur.

## System delta

### BEFORE
`유저 발화` was treated too broadly as historical evidence.

### PROBLEM
Presupposition-only questions could authorize the model to invent the missing
historical details.

### AFTER
Only a **concretely stated** user historical fact counts as that user-side
historical evidence. Presupposition alone does not supply missing details.

### REMOVED / CONSOLIDATED
No new prompt section was added. The ambiguity was removed from the existing
canonical owner.

### PRESERVED
- explicit user-authored past facts remain adoptable;
- harmless independent user-backstory inference remains allowed;
- current-scene new meetings/actions/relationship progression remain allowed;
- memory architecture unchanged;
- COMMON PROSE unchanged;
- model adapters unchanged;
- pricing/routing unchanged.

## Regression risk

Potential overcorrection was:
- models refusing valid concrete user-stated history.

The owner therefore explicitly permits concrete user-stated past facts rather
than globally distrusting the current user message.

## Verdict

**ROOT_CAUSE_FIXED**

The original severe failure condition — filling an unspecified presupposition
with invented shared history — did not reproduce on any of the three active
models in the focused post-patch run.

DeepSeek's residual opening contradiction is recorded as prose/consistency
follow-up, not as a reason to add another historical-truth rule.

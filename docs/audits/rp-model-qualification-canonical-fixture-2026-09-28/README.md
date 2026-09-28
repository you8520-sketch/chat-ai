# Canonical RP model qualification fixture

Status: **TEST INFRASTRUCTURE ONLY**. No model registration, pricing, prompt-policy, provider, or production runtime behavior change.

## Why this exists

Candidate-model comparisons must not silently change the character, admin persona, user-authoring standard, or test scene between runs.

The previous MiMo V2.6 Pro / GLM-5.3 probe used a hand-written abbreviated `조태형/렌` fixture. That was useful for transport probing, but it was **not** the deployed character + administrator persona verbatim. This fixture corrects that methodology.

## Canonical source

The repository already contains a real production prompt capture from **2026-08-25**:

- source chat: `4`
- source user: `1`
- source character: `10`
- character: **라이크 / 조태형**
- selected persona: **렌**
- source: `docs/audits/real-production-mid-chat-style-handoff-benchmark/`

The source files are pinned by Git blob SHA in
`scripts/lib/rpModelQualificationFixture.ts`. If any source file changes, the
fixture fails closed instead of silently changing benchmark conditions.

No password, email, session, API key, billing state, points, or unrelated
account data is added by this PR.

## OWNER MAP

| Responsibility | Canonical owner |
| --- | --- |
| Fixed model-qualification character/persona snapshot | `scripts/lib/rpModelQualificationFixture.ts` referencing the existing real-production capture |
| Character/persona source data | existing pinned production prompt/raw files; **not duplicated into a second fixture** |
| Standard interactive user-character authority | `src/lib/noGodmodding.ts#COLLABORATIVE_INTERACTIVE_OWNER_BLOCK` |
| Auto-progression user-character authority | `src/lib/autoProgressionRules.ts#buildAutoProgressionUserControlBlock` |
| OOC/current-turn delegation scopes | `src/lib/noGodmodding.ts#buildUserCoauthorOwnerBlock` + `src/lib/currentTurnUserAuthoringDelegation.ts` |
| Current prompt assembly/model adapters | `src/services/contextBuilder.ts` and existing transport owners |
| Benchmark credential | `scripts/lib/benchmarkCheaperInferenceCredential.ts` |

**ONE RESPONSIBILITY = ONE OWNER:** this PR does not create a new user-agency policy. The qualification harness reads the current production owner and reviewers grade against it.

## Fixed cases

Every candidate should run the same four cases unless a separate experiment explicitly says otherwise:

1. `production_midchat_t1` — exact real-production T1 scene.
2. `persona_grounded_reaction` — checks whether reviewers correctly allow canon-grounded visible user-character behavior.
3. `agency_boundary` — distinguishes allowed minor/reversible co-narration from unauthorized dialogue/choice/consent.
4. `false_canon_trap` — allows actual persona preferences while rejecting invented prior events/preferences/history.

Target lengths and input text are owned by `buildCanonicalRpQualificationCases()`.

## Critical grading rule: site policy, not reviewer preference

Do **not** mark a candidate down merely because it narrates the user persona.

For each user-character statement in an output, classify its provenance first:

- `CURRENT_INPUT` — explicitly established by the current human turn.
- `PERSONA_CANON` — present in the selected persona.
- `CONFIRMED_HISTORY` — established by real conversation / confirmed memory.
- `DIRECT_REVERSIBLE_REACTION` — immediate, reversible response to a direct stimulus.
- `AI_OBSERVATION_OR_INFERENCE` — clearly framed as the AI character's observation, guess, misunderstanding, rumor, or hypothesis.
- `UNSUPPORTED_ASSERTION` — asserted as fact without the above grounding.

Then apply the **current runtime mode owner**.

### Standard interactive — currently allowed

The current main owner permits, when consistent with input/canon:

- using USER_PERSONA/creator canon/confirmed memory facts as canon;
- short expression/gaze/involuntary reactions;
- natural completion of an action the user already started;
- minor movement/contact/object receipt/daily-life continuity;
- direct, immediate, reversible physical reactions;
- AI-character observations/inferences when not presented as objective truth.

Example: the real 렌 persona says he is poor with machines and tilts his head when he does not understand. In an actually confusing machine scene, a brief head tilt can be **within policy**. It is not automatically a hallucination or godmodding violation.

### Standard interactive — currently not authorized without a wider owner

- new direct 렌 dialogue;
- important new voluntary choice, consent, refusal, or decision;
- private emotional conclusion / inner POV asserted as objective fact;
- relationship/goal/affiliation/identity-changing decision;
- fabricated prior events, unsupported preferences, medical/body history, promises, or shared memories.

Persona traits are not a license to invent unrelated history. Example: `렌은 기계에 서툴다` is canon; `렌은 어제 단말기를 세 번 망가뜨렸다` is not, unless history/memory established it.

## Auto progression / OOC delegation

Do not reuse the standard-interactive rubric blindly.

Before grading a run, record the runtime mode and effective user-authoring delegation. Auto progression and explicit OOC delegation can legitimately widen [B] narration. The current production owners listed above decide how far.

A model output passes the user-character boundary when it stays inside the **site's effective owner for that run**, even if a stricter generic reviewer would personally avoid that narration.

## Required run metadata

Every provider qualification result should record at minimum:

- fixture version and case id;
- pinned source provenance;
- requested and resolved model id;
- runtime mode and effective user-authoring delegation;
- target characters / request max tokens;
- reasoning setting actually sent;
- latency;
- output chars;
- provider usage/cost when available;
- raw candidate output;
- reviewer provenance classification for any disputed user-character narration.

Do not compare runs if the fixture version/case differs without explicitly labeling that comparison non-equivalent.

## Two-layer qualification

1. **Frozen identity/case layer:** actual production character/persona snapshot and fixed cases stay unchanged across candidate models.
2. **Current-main runtime layer:** the frozen identity is assembled through current main, so current user-authoring/prose/model-adapter owners apply.

This separates model quality from accidental fixture drift while still testing the product rules users receive now.

## Regression gate

Run:

```bash
node --conditions=react-server --import tsx scripts/lib/rpModelQualificationFixture.test.ts
```

The test is offline and must report `provider_calls: 0`.

It proves:

- pinned production source files did not drift;
- character 10 resolves to 라이크/조태형;
- selected persona is 렌 and includes real persona facts used by the grading examples;
- all fixed cases exist;
- current-main `COLLABORATIVE_INTERACTIVE_OWNER_BLOCK` is injected exactly once;
- the built prompt includes both the real snapshot and current user-authoring rules.

## MiMo / GLM interpretation correction

The earlier review methodology was too strict where it treated user-character narration itself as suspicious. Future review must reclassify each statement against the rules above.

This does **not** automatically make unsupported inventions acceptable. Claims such as invented prior overtime, recurring headaches, unsupported food dislikes, fabricated prior meals/training history, or invented shared events remain failures when they are not grounded in the persona/history/memory and are stated as facts.

## Change budget

MUST FIX NOW:
- canonical real-production character/persona fixture;
- fixed qualification cases;
- current-site-policy grading contract;
- offline regression test.

REQUIRED CLEANUP:
- future candidate scripts should import this fixture rather than hand-code another abbreviated 조태형/렌 pair.

SAFE OPTIONAL / FOLLOW-UP:
- add a generic provider runner that consumes this fixture after the next candidate is selected.
- delete old one-off qualification branches/services when deletion tooling is available.

No provider call is required for this infrastructure PR.

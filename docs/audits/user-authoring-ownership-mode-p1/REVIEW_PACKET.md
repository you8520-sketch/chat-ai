# User Authoring Ownership Mode Audit P1

READ-ONLY architecture audit. QUALITY_SCORING_BY_CURSOR=false.
MODEL_CALLS=0. PRODUCTION_CHANGED=false. T2 not enabled. T3 not created.

CURRENT_MAIN: `b06037dd5c572bd02abec311f4148f57d9362551`

State lock: DeepSeek0813 TRUE-OFF PASS/DEPLOYED. T1 DROP. T2 TECHNICAL PASS / PRODUCTION HOLD.

---

## 1. Owners found in current main

Do not assume names. These are the actual owners.

| Concern | Owner | Location |
|---|---|---|
| Runtime mode | `resolveChatRuntimeMode` | `src/lib/chatRuntimeMode.ts` |
| Co-narration mode | `resolveUserCoNarrationMode` | `src/lib/userCoNarrationMode.ts` |
| Common agency / no-godmodding | `buildNoGodmoddingBlock` / `resolveNoGodmoddingMode` | `src/lib/noGodmodding.ts` |
| Manual interactive owner | `[USER CONTROL — COLLABORATIVE INTERACTIVE]` | `src/lib/noGodmodding.ts` |
| Auto-progression owner | `[AUTO PROGRESSION — AI-FOCAL CO-NARRATION]` | `src/lib/autoProgressionRules.ts` |
| Structured OOC opt-in | `resolveUserImpersonationAllowance` | `src/lib/userImpersonationPolicy.ts` |
| OOC limited-co-narration owner | `[USER CONTROL MODE - LIMITED CO-NARRATION]` | `src/lib/noGodmodding.ts` |
| Current-user wrapper / user-tail | `wrapCurrentUserInput` | `src/lib/currentUserInputLabel.ts` |
| Auto-progression user-tail | `buildContinueNarrativeCommand` | `src/lib/continueNarrative.ts` |
| CORE ROLE cross-ref | `roleBoundaryLine` | `src/lib/corePrompt.ts` |
| Adult handoff additions | `appendAdultHandoffPrompt` | `src/lib/adultSceneRouting.ts` |
| DeepSeek handoff transport | TRUE-OFF only | `src/lib/cheaperInferenceConfig.ts` |
| Post-hoc interactive detector | `detectInteractiveUserImpersonation` | `src/lib/userImpersonationGuard.ts` |
| Gemini 3.1-only supplement | `appendGemini31UserAgencySupplement` | `src/lib/gemini31UserAgencyAdapter.ts` |
| Strict lock canary (default OFF) | `isInteractiveUserOwnershipLockEnabledForUser` | `src/lib/interactiveUserOwnershipLock.ts` |

Deprecated / empty, not the live owner:

- `buildSmartUserPersonaNarrationRules` / `buildAutoContinueUserPersonaRules` return `""`
- `[INTERACTIVE USER CONTROL]` is fixture-only, not injected on the standard path
- `[USER CONTROL MODE - NOVEL / EXPLICIT FULL]` is never injected
- `chats.user_impersonation` is a persisted snapshot of the computed flag, not the request-time authority

---

## 2. Product contract vs current code

Intended product has three modes. Current production already has three runtime modes, but they do not map 1:1 onto the intended Case C grammar.

### Case A — manual input, no delegation

`ChatRuntimeMode = "interactive"`
`NoGodmoddingMode = "standard"`
`UserCoNarrationMode = "off"`

Authoritative system owner:

```text
[USER CONTROL — COLLABORATIVE INTERACTIVE]
```

This already matches the intended manual contract more closely than a "never write for the user" rule:

- forbids new direct user dialogue
- forbids important choice / consent / refusal
- forbids relationship / goal / affiliation / identity decisions
- allows short expression, gaze, involuntary reaction
- allows natural completion of an already-started action
- allows small movement / contact / object-handling / daily continuity
- allows Persona / canon traits as established facts, not new decisions

User-tail default (canary lock OFF):

```text
[CURRENT USER INPUT]
...
[B]'s new dialogue, consequential choices, consent/refusal, and decisions that change relationship, goal, affiliation, or identity remain user-authored.
Minor reversible expression, gaze, involuntary reaction, natural completion of an already-started action, and small movement/contact/object-handling/daily continuity may be co-narrated when consistent with [USER CONTROL — COLLABORATIVE INTERACTIVE].
```

Persona-consistent characterization such as head-tilt, fearless affect, or "does not take the warning seriously" is already in-scope for this owner. It is not automatically a user-agency violation.

### Case B — auto progression

`ChatRuntimeMode = "auto_progression"`
`NoGodmoddingMode = "autoContinue"`
`UserCoNarrationMode = "limited_external"`

The entire standard no-godmodding block is **replaced**, not relaxed in place.

Authoritative system owner:

```text
[AUTO PROGRESSION — AI-FOCAL CO-NARRATION]
```

This owner already allows:

- USER_DIALOGUE_AUTHORING = allowed (external, persona-voice)
- USER_ACTION_AUTHORING = allowed (external, observable)
- USER_PERSONA_BASED_REACTION = allowed
- SCENE_PROGRESSION = allowed via `[AI_CAST]` / environment / world

It still forbids:

- `[B]` inner POV / private thought / hidden desire as certain
- source-less confirmation of consent / refusal
- confession / betrayal / relationship lock
- identity / rank / ability change
- death / permanent exit / irreversible decision

User-tail is **not** the interactive wrapper. Continue replaces the current user message with `[SYSTEM DIRECTIVE: CONTINUE THE NARRATIVE]` and a short-ref to the auto-progression owner.

### Case C — manual + explicit OOC authoring delegation

Production has a structured OOC opt-in, but it is **not** a current-turn authoring-delegation parser.

Structured trigger sources only:

- persona description OOC
- focus-zone user note OOC

Structured allow phrases only:

- `사칭 허용` / `유저 조종 허용`
- `co-narration on/allow/permitted`
- `possession mode on`

Explicitly **not** treated as allow (test-locked):

- `OOC: 내 대사도 작성해줘`
- `OOC: 3인칭 소설로 써줘`
- `OOC: 공동 서술 톤`

When the structured opt-in is true and the turn is not auto-progression:

`ChatRuntimeMode = "ooc_user_impersonation_allowed"`
`NoGodmoddingMode = "coNarration"`

Owner:

```text
[USER CONTROL MODE - LIMITED CO-NARRATION]
```

This allows short `[B]` action/dialogue assist inside the user-allowed range. It still forbids new emotional conclusions, major decisions, and new leading actions.

Current-turn lines such as:

- `OOC: 내 대사도 알아서 써줘`
- `OOC: 렌 행동과 대사까지 알아서 진행해`

are left as natural-language user text. They do **not** flip runtime mode. The manual collaborative owner remains active.

In-character `"네가 알아서 해."` is not treated as system-level delegation. That caution already exists.

---

## 3. Final prompt assembly for A / B / C

Shared spine:

```text
POST /api/chat
  → resolve flags (isContinue, novelModeEnabled, OOC impersonation)
  → resolveChatRuntimeMode
  → buildContext
       common agency owner = buildNoGodmoddingBlock(mode)
       CORE ROLE cross-ref
       optional [4] OOC CO-NARRATION hint
       adult handoff additions (if first adult handoff)
  → wrapCurrentUserInput OR continue directive
  → assemblePrimaryRpRequest
  → provider adapter (TRUE-OFF on DeepSeek adult handoff only)
```

### Case A

1. `isContinue=false`
2. `resolveUserImpersonationAllowance(persona, focus-zone note)=false`
3. `runtimeMode=interactive`
4. System `[0a]`: collaborative interactive owner (cached on CheaperInference)
5. Optional Gemini 3.1 body/intent supplement only if model is Gemini 3.1 Pro
6. Last user message: `[CURRENT USER INPUT]` collaborative wrapper + raw user text
7. Adult handoff, if applied, appends continuity / scene-reset to **system dynamic**, not a new user-ownership owner
8. DeepSeek adapter changes thinking transport only

Winner if rules conflict: the collaborative interactive owner is the declared single system owner. The user-tail wrapper restates it. Adult handoff continuation does not rewrite agency. A later T2 suffix on `messages[0]` would sit after the cached owner and could compete with it.

### Case B

1. `body.isContinue===true` or legacy `novelModeEnabled`
2. `autoProgressionEnabled=true`
3. OOC impersonation is forced off for this turn (`oocLimitedCoNarration = impersonation && !autoProgression`)
4. System `[0a]`: auto-progression owner (full replacement)
5. Scene-directive progression owner is kept (unlike standard interactive)
6. Last user message: continue directive, no interactive wrapper
7. Adult handoff additions still only add continuity / reset

Winner: auto-progression owner + continue directive. Manual no-impersonation is not applied. A generic T2 "do not write new user dialogue/action" block would contradict this owner.

### Case C

Two different realities:

**C-structured (persona/note `OOC: 사칭 허용`):**

1. `oocUserImpersonationAllowed=true`
2. `runtimeMode=ooc_user_impersonation_allowed`
3. System `[0a]`: LIMITED CO-NARRATION
4. System `[4]`: short OOC hint pointing back to that owner
5. User-tail wrapper says current mode allows limited/full co-narration
6. Winner: LIMITED CO-NARRATION, unless auto-progression is also on (auto wins)

**C-current-turn natural language (`OOC: 내 대사도 알아서 써줘`):**

1. Mode stays `interactive`
2. System still says do not invent new user dialogue / major action
3. The OOC sentence is preserved inside the last user message, after the wrapper
4. No structured override occurs
5. Winner is **ambiguous**: official owners keep the manual boundary; the raw OOC request is later in the user tail and the model may follow it anyway

Adult OOC scene-reset is a separate path. `SCENE_RESET_HANDOFF_INSTRUCTION` allows realizing user-persona setup actions that the OOC explicitly established, then forbids inventing more. That is scene-routing, not a general authoring-mode flip.

---

## 4. Auto-progression audit

AUTO_PROGRESSION_FLAG_OWNER: request body `isContinue===true`, plus compatibility `novelModeEnabled` from body or saved chat prefs.

How production knows it is enabled:

```ts
const autoProgressionEnabled = isContinue === true || legacyNovelModeEnabled;
```

in `src/app/api/chat/route.ts`.

Representation:

- route flag `autoProgressionEnabled`
- `runtimeMode === "auto_progression"`
- context `input.isContinue`
- godmodding mode `"autoContinue"`
- continue user-tail command

Does existing no-godmodding already relax user dialogue/action ownership?

Yes. The standard block is replaced by the auto-progression owner. Dialogue and external action authoring are explicitly allowed.

Could frozen T2 accidentally override auto progression?

Yes, if T2 is later injected on every DeepSeek adult-handoff system suffix without gating on `runtimeMode==="interactive"` and no structured delegation. T2 says:

- do not write new direct user dialogue
- do not write new voluntary user actions

Auto progression says the opposite for external `[B]` dialogue/action. T2 would be a second owner, not a wording variant of the first.

Adult handoff and auto progression are independent. Continue can occur on an adult route. TRUE-OFF does not change agency.

---

## 5. OOC audit

Answers:

1. Current-turn OOC authoring requests are left as natural-language input to the model.
2. There is an OOC snippet extractor (`extractOocSnippets`) and a narrow allow/deny regex. It is not a general authoring-delegation parser. It does not read the current user turn at request time.
3. There is an existing permission flag: `oocUserImpersonationAllowed` / `userImpersonation`. Duration is persistent (persona / focus-zone note), not current-turn / current-scene. `chats.user_impersonation` stores the computed result after the turn; it is not the live input.
4. A current-turn OOC instruction cannot officially override common no-godmodding today. Only the structured allow phrases in persona/note can flip the owner. Even then, auto progression still wins over OOC opt-in.
5. Current-turn OOC is preserved in the last user message, after `[CURRENT USER INPUT]`. That is close enough for the model to see, but it does not have structured priority over the system owner.

Adult-routing OOC (hard stop, scene reset, anatomy, sexual transition) is a different subsystem. It can change model route and inject scene-reset instructions. It does not implement "write my Persona's next lines."

Regenerate has `oocOverridesRegenerateRpDirective`, which gives chat-OOC priority over default regen. That is regen-only, not live manual-turn authoring.

---

## 6. Delegation scope model — design only

An equivalent coarse structure already exists:

| Proposed | Current equivalent |
|---|---|
| `manual` | `interactive` + `standard` |
| `auto_progression` | `auto_progression` + `autoContinue` |
| `delegated` | `ooc_user_impersonation_allowed` + `coNarration` |

Recommended future model, if implemented later:

`USER_AUTHORING_MODE`: `manual` | `auto_progression` | `delegated`

`USER_AUTHORING_SCOPE`:

- `minor_only` — current manual default
- `dialogue_and_actions` — current auto-progression external assist
- `limited_assist` — current structured OOC LIMITED CO-NARRATION
- `full_scene` — not in production (legacy novel path removed)

Do **not** add `full_scene` inner-POV. Auto progression already forbids `[B]` inner takeover.

Duration today:

- auto progression = current continue turn
- structured OOC = session-like (persona/note persist until denied)
- current-turn OOC = not modeled

Recommended duration if Case C is implemented later:

- explicit current-turn OOC → `current_turn`
- "앞으로 … 자동 진행해" → `session`, only via existing product grammar / control, not RP dialogue
- auto-progression button → `current_turn`

Do not implement this structure in this audit.

---

## 7. Persona characterization vs new decision

Current collaborative owner already distinguishes canon/Persona facts from new semantic decisions.

Allowed as characterization / minor co-narration, not new user-authored decisions:

- head tilt when confused
- fearless / low-guard affect
- treating a warning as unimportant
- gaze, blink, breathing, small tremor, reflexive flinch
- continuing an already explicit collar-grab / close distance

Still user-owned in manual mode:

- new quoted user dialogue
- new major voluntary action not implied by current state
- new consent / refusal
- new relationship / identity decision
- unspecified next-stage authorization

T1 DROP remains valid as a literary finding. This audit does not re-score T1/T2 RAWs.

---

## 8. Hard boundary must stay manual-only

The meaningful manual boundary must not be applied blindly to auto progression or structured OOC delegation.

Current production already isolates those modes in `resolveNoGodmoddingMode` and `wrapCurrentUserInput`.

T2, if ever enabled, must be gated to:

- `runtimeMode === "interactive"`
- structured OOC opt-in false
- not a continue / auto-progression turn

Otherwise it becomes a second, conflicting owner.

---

## 9. Recommended precedence

Inspected current precedence:

```text
auto progression (isContinue / legacy novel)
  > structured OOC impersonation opt-in (persona / focus-zone note)
    > generic manual collaborative owner
```

Recommended conceptual precedence for a later implementation:

```text
explicit current-user authoring instruction
  > mode default (auto progression button / structured session opt-in)
    > generic manual ownership boundary
```

That current-user instruction must be an explicit OOC/meta product grammar or an existing control. It must not be inferred from in-character `"네가 알아서 해."`

Recommended owner location later, after this audit:

- keep `buildNoGodmoddingBlock` as the single system agency owner
- resolve mode **before** that block
- do not append a DeepSeek-only T2 suffix that can fight the selected owner
- if a handoff-specific reminder is needed, make it a short-ref to the already-selected owner, not a new rule

---

## 10. T2 interaction

T2 is not in production. This section is predictive.

T2_WOULD_CONFLICT_WITH_AUTO_PROGRESSION: true  
if T2 is applied on all DeepSeek0813 adult-handoff turns.

T2_WOULD_CONFLICT_WITH_OOC_DELEGATION: depends_on_order

- structured OOC opt-in already selected LIMITED CO-NARRATION → T2 would contradict it
- current-turn NL OOC stays in manual mode → T2 would reinforce the official manual boundary and ignore the user's explicit request
- if T2 is gated to plain manual / no delegation, structured Case B/C are protected

Adult handoff today adds continuation or scene-reset only. It does not add a DeepSeek user-ownership block. TRUE-OFF does not change authorship.

---

## 11. Architectural gap

1. Intended Case C current-turn delegation is not implemented.
2. Structured OOC allow-list is much narrower than the product examples (`내 대사도 알아서 써줘` is test-locked as non-allow).
3. Current-turn OOC has recency but no official override.
4. T2 cannot be production-enabled as a global DeepSeek handoff suffix without mode gating.
5. Naming drift: Korean OpenRouter line still says `[AUTO PROGRESSION — AI-CENTERED]` while the live owner title is `[AUTO PROGRESSION — AI-FOCAL CO-NARRATION]`. Same feature, not a second owner.

CODE_CHANGE_REQUIRED_LATER: true  
if production wants Case C current-turn delegation, or wants T2 without breaking auto progression.

No change is required to keep the current deployed TRUE-OFF transport.

---

## 12. Isolation

- MODEL_CALLS=0
- T2 not production-enabled
- T3 not created
- TRUE-OFF / routing / Speech Lock / context content / auto-progression behavior unchanged
- Source Mirror / Completion / Origin pointer unchanged

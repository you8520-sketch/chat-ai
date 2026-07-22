# EARLY-TURN / THIN-HISTORY SCENE MOMENTUM SUPPORT — READ-ONLY DESIGN

**Repo:** e:\ai chat · **Status:** READ-ONLY design only. No code / DB / prompt / selector / compiler / budget changes. No commit / push / PR / deploy.
**Scope:** DeepSeek V4 Pro canary first (COMMON extraction capability, MODEL-GATED rollout). No Muse / Gemini / HY3 actual prompt change.
**Parent verdict:** D2 length-owner isolation = A (THIN-HISTORY / COLD-START OWNER CONFIRMED). See data/d2-length/REPORT.md.
**Goal:** Keep layered-canon strengths (dormant lore suppression, quiet breadth reduction, canon/world consistency, active-scene autonomy). ONLY fix thin/cold-start: meaningful-beat shortage, early termination, floor miss. Mechanism = CURRENT SCENE MOMENTUM (not world plot fuel, not "write longer", not FULL canon re-injection).

---

## 1. Causal evidence summary

Source: data/d2-length/REPORT.md (33 live calls, DeepSeek V4 Pro, reasoning OFF, memory ON) + data/d2-live/REPORT.md (42 live calls).

- The D2 length regression is causally owned by the **thin/cold-start scene-history x layered-canon interaction**, not a general depth-fill deficit. Only canon mode (FULL_LEGACY vs CORE+ACTIVE) differs between D1.1 and D2; archive is SELECTIVE in both.
- **THIN (4-turn history, n=3):** D2 shorter on 3/3 fixtures, aggregate D2 2383 vs D1.1 3460 (-31%), D2 floor2700 pass 3/9 (fails 2700 on 3/3). Reproduces the prior D2 LIVE verdict B.
- **MATURE (12-turn frozen scene-local history, n=5):** D2 at parity or longer. modern D2 3576 vs D1.1 3730 (+154, parity, both 5/5 floor); fantasy D2 3782 vs D1.1 3109 (D2 +22%); enoch D2 2911 vs D1.1 2603 (D2 +12%). Aggregate D2 3241 vs D1.1 3369 (-4%, within noise). D2 floor 13/15 vs D1.1 10/15.
- **D2-specific maturity effect (rules out generic token-volume confound):** D1.1 MATURE (3369) did NOT get longer than D1.1 THIN (3460) despite +8 history turns. So "more history tokens -> longer" is not a generic effect; maturity specifically rescued D2 (D2 MATURE 3241 >> D2 THIN 2383). The D1.1-D2 gap collapses from +1077 (THIN) to +128 (MATURE).
- **Beat count (human-verified on medians):** D2 MATURE writes multi-beat progressive scenes (~13-14 beats) at parity with D1.1 MATURE (modern), fewer-but-deeper-per-beat with longer total (fantasy), or MORE beats (enoch, incl. a state-changing tinnitus-log disclosure). The THIN D2 "fewer beats, static moment" pattern is GONE under MATURE. Depth-per-beat and POV maintained.
- **Breadth/dormant:** D2 MATURE keeps external breadth low (CORE+ACTIVE suppresses dormant). Enoch outputs reference Mother/Brain Pod as character condition/memory, NOT a re-activated threat ladder. Clean-cue sanity (keyword-clean Enoch cue, D2 n=3): active_count=0 on 3/3, no Mother/Pod/Level ladder fires — cue-independent dormant suppression confirmed.
- **Conclusion (accepted):** FULL canon previously acted as artificial narrative fuel in shallow/cold-start scenes. With real multi-turn scene continuity, D2 (CORE+ACTIVE) maintains long-form normally. The length problem owner = thin/cold-start scene-momentum interaction. A LENGTH prompt modification is NOT the right fix (it would treat a symptom that disappears with scene maturity). Next target = early-turn / thin-history scene-momentum support (NOT FULL canon re-injection).

Key implication for design: the rescue came from **scene-local continuity** (dialogue, small action, unresolved interpersonal beat, scene progression) — NOT from more world lore. MATURE history was hand-authored, audited (dormantHooks=[]), and did NOT pass through the canon compiler or ACTIVE selector, so it cannot be a dormant-canon re-injection path. The momentum support must reproduce the *kind* of signal MATURE history carried, deterministically, from existing scene context only.

---

## 2. Common elements in MATURE history that recovered long-form

Read from scripts/_tmp-d2-length-fixtures.ts (MATURE extensions) + REPORT.md item 7. The recovery is NOT a token-count phenomenon (D1.1 did not lengthen with +8 turns). It is a **scene-continuity-kind** phenomenon. The common elements across all 3 MATURE fixtures:

- **Anchored WHERE:** the scene stays in one established place across turns (준서의 자취방; 세라핀의 오두막/약초밭; 에녹의 Safe Zone). No location move. The place is already established in THIN; MATURE keeps it and uses it.
- **Anchored WHAT IS HAPPENING:** a small, concrete current activity is in progress and is *continued*, not reset (water/coffee being poured/drunk; tea being served/refilled; canned coffee being handed/held). The activity is ordinary and present-tense.
- **UNFINISHED immediate interaction:** an interpersonal beat that is opened and held open across turns — a guarded near-disclosure deflected into action (준서); an offer to stay the night accepted but not yet enacted (세라핀); a one-hour mask-off limit with the user staying beside (에녹). These are *unresolved immediate dialogue/reaction*, not future plot hooks.
- **RELATIONSHIP STATE in motion:** a small affective shift carried by action, not by declaration (a promise for tomorrow's coffee; "오늘이 좀 다르다"; "이명이 좀 작아지는 것 같기도 하고"). The relationship temperature changes micro-fragments per turn.
- **AVAILABLE AFFORDANCES already present:** objects and physical givens already in the scene are reused as continuation material (piano, water, blinds; herbs, hearth, blanket, bees; canned coffee, filter, mask, neck scar, tinnitus). No new object/NPC/location introduced.
- **No next-event suggestion, no dormant escalation.** MATURE never says "X appears next", never introduces a faction/threat/secret. It continues what is already happening inside the current scene.

This is the exact semantic shape the momentum block must provide: WHERE / WHAT IS HAPPENING / UNFINISHED / RELATIONSHIP STATE / AVAILABLE AFFORDANCES — descriptive, present-tense, current-scene-only.

---

## 3. Current production signal inventory

Audit of src/services/contextBuilder.ts, src/app/api/chat/route.ts, src/lib/canonInjectionPolicy.ts, src/lib/canonPlan/, src/lib/sceneDirective.ts, src/lib/chatMemory.ts, src/lib/deepseekOpeningSceneContext.ts, src/lib/deepseekPromptStructure.ts, src/lib/openRouterCache.ts. "Available at thin turn" = the signal is populated when assistant history is 0-1 turns (cold-start) or 1-4 turns (thin).

| Source | What info it has | Available at thin turn? | Duplication risk | Dormant-contamination risk |
|---|---|---|---|---|
| shortTermHistory (raw recent RP turns) | actual dialogue/action/inner reaction of last N turns; the only source of WHAT IS HAPPENING / UNFINISHED | YES (0-4 turns present) | LOW-MED if restructured (not raw-copied); HIGH if raw-copied (already in chat history) | LOW — history is scene-local; does not pass through canon compiler/ACTIVE selector |
| currentUserMessage (current user cue) | the immediate user intent/offer/question for THIS turn | YES (always) | LOW | LOW — user cue, not canon |
| memoryMeta (chat.memory_meta) | honorifics, items (possessions), promises, currentLocation | YES (populated from turn 1 by memory pipeline) | MED — items/promises ALREADY rendered by [3b] Relationship memo (formatMemoryMetaForPrompt); currentLocation is parsed but NOT currently rendered | LOW — extracted from conversation, not canon |
| deepSeekOpeningSceneContext (peeled creator greeting) | opening scene location/posture/action/relationship tension | YES at turn 1 (greeting is turn 0); only when deepSeekXmlMode + thin + greeting present | LOW (greeting is peeled OUT of history, so not duplicated) | LOW-MED — greeting is CORE-ish but may reference dormant hooks if creator wrote them into the greeting; needs the same forbidden-content filter |
| sceneDirective ([3d] Private scene directive) | stagnation flag, intensity, progression types, nextBeatHint, avoid list | YES | HIGH — this is the Scene Engine (next-beat steering); momentum must stay SEPARATE from it | MED — nextBeatHint is "what should happen next" (forbidden form); must not be reused as momentum |
| canonPlan CORE ([2] Structured character canon) | immutable identity/appearance/personality/world-law | YES (always-on, cached) | LOW (different tier) | N/A (CORE is allowed canon, not dormant) |
| canonPlan ACTIVE ([2c] Active scene canon) | cue-relevance-selected world lore/threat/location | YES but often 0 on quiet cues (act=0 on modern/fantasy quiet) | LOW (different tier — ACTIVE WORLD LORE) | LOW-MED — cue-driven only; clean-cue gives active=0 |
| episodicMemory ([3a]) | retrieved long-term facts | thin at cold-start (few facts yet) | LOW | LOW |
| triggeredScenarioEvents ([3c]) | queued status-trigger events | usually empty at thin turns | LOW | MED if a trigger fires (events are scenario-side) |
| statusWindowNotePolicy / userNote | user-note-driven output format | YES if user note present | LOW | LOW |
| completedTurns (playableTurnCount) | turn count (excludes opening greeting) | YES (0 at first playable turn) | N/A (used for activation, not content) | N/A |
| resolveDeepSeekShortHistoryLengthExtra signal | "recent assistants absent OR avg no-ws chars < 2200" | YES (fires exactly at thin/cold-start) | N/A (activation signal) | N/A |

Key findings:
- The raw material for momentum (WHERE/WHAT/UNFINISHED/RELATIONSHIP/AFFORDANCES) is **already present at thin turns** in shortTermHistory + currentUserMessage + memoryMeta + the peeled greeting. No new data collection needed.
- **currentLocation is tracked in memoryMeta but NOT rendered** today (formatMemoryMetaForPrompt only emits items + promises). It is a latent signal available for the momentum block at zero extra cost.
- The **sceneDirective is the wrong reuse target**: its nextBeatHint is "what should happen next" (a forbidden form), and the task forbids Scene Engine re-introduction. Momentum must be a separate, descriptive tier.
- The **canon plan (CORE/ACTIVE/dormant) is a separate semantic tier** (ACTIVE WORLD LORE). Momentum must NOT mix into the canon plan's selector/budget.
- An existing **thin-history signal** (resolveDeepSeekShortHistoryLengthExtra) already fires exactly when momentum is needed and auto-disables when history matures — reusable as the activation gate.

---

## 4. Thin/cold-start definition

Two distinct cold-start states, both in scope. The boundary is **scene-history maturity**, not a fixed turn count.

- **COLD-START (turn 0-1):** first or second playable turn. Assistant history is 0 or 1 turn. The only scene context is the creator greeting (peelable) + the current user cue. This is the most acute floor-miss window (D2 THIN floor 3/9).
- **THIN (roughly 2-4 playable turns, few short assistant turns):** a small number of recent turns exist but they are short/sparse (the "static single moment" pattern from D2 LIVE item 4: "D2 tends to stay in one static moment"). The scene has not yet accumulated enough continuity to self-sustain multi-beat progression.
- **MATURE (not in scope):** enough recent scene continuity that D2 self-sustains long-form (the isolation benchmark's 12-turn frozen history is the calibration point, NOT a universal threshold). At maturity the support MUST auto-disable.

Operational definition (deterministic, reuses an existing signal): a turn is thin/cold-start iff the recent-assistant slice is absent or short on average — the same condition the existing SHORT HISTORY nudge already uses. This keeps the definition behavioral (scene history is sparse) rather than a hardcoded turn count, and it auto-disables as history matures.

Calibration evidence vs universal threshold: THIN=4 / MATURE=12 from the isolation benchmark is CALIBRATION EVIDENCE ONLY. It must NOT be hardcoded as "until 12 turns". The threshold (recent-assistant avg no-ws chars, currently 2200 in resolveDeepSeekShortHistoryLengthExtra) is a tunable calibration constant, not a universal production constant.

---

## 5. Activation / deactivation heuristic

**Phase 1 simplest deterministic condition (recommended):** reuse the existing thin-history signal. A turn activates the momentum block iff `isThinSceneHistory(shortTermHistory)` is true, defined identically to the existing `resolveDeepSeekShortHistoryLengthExtra` trigger:

- recent assistant slice = last up-to-3 assistant turns with non-empty content;
- if that slice is empty (cold-start, no assistant turns yet) -> ACTIVATE;
- else if the average no-whitespace char count of that slice is below the calibration threshold (reuse 2200 as the Phase 1 starting value) -> ACTIVATE;
- else -> OFF (mature).

This is the smallest deterministic condition because the signal is ALREADY computed in the DeepSeek assembly path (resolveDeepSeekShortHistoryLengthExtra). Phase 1 lifts it into a COMMON, model-agnostic predicate `isThinSceneHistory(history)` and gates INJECTION (not detection) to the DeepSeek canary.

**Auto-disable (mandatory):** because the same predicate drives deactivation, the block turns OFF automatically as soon as recent assistant turns rise above the threshold (the MATURE regime). There is no separate "turn off" counter. If the block stayed on in MATURE and caused duplication/over-description/scene-steering/cache-token growth, that is FAILURE — so the auto-disable is the same predicate, evaluated fresh every turn.

**Greeting/first-turn special case:** at cold-start (turn 0-1), the peeled creator greeting (deepSeekOpeningSceneContext) is the primary WHERE/WHAT/RELATIONSHIP source. The momentum block at cold-start reuses the greeting's location/posture/action/relationship tension as the anchored scene state, and adds the current user cue as the immediate interaction. It does NOT re-inject the full greeting text (that is already handled by the existing OPENING SCENE CONTEXT block) and does NOT clone a FULL scenario. If the greeting already carries location/posture/action/relationship tension, the momentum block references it by extraction (short descriptive snapshot), not by verbatim copy.

**Not in scope (explicit):** no hardcoded "until 12 turns"; no per-character threshold; no LLM-based maturity judgment in Phase 1.

---

## 6. Scene Momentum data contract

The block is a single dynamic, descriptive, present-tense, current-scene-only snapshot. Five fields, all derived deterministically from existing scene context (recent history + current cue + memoryMeta + peeled greeting at cold-start). It describes WHAT COULD BE CONTINUED INSIDE THE CURRENT SCENE, never WHAT SHOULD HAPPEN NEXT.

- **WHERE:** the currently established location/posture (from the most recent location/posture mention in recent turns, or memoryMeta.currentLocation, or the peeled greeting at cold-start). One short phrase.
- **WHAT IS HAPPENING:** the current in-progress activity/stance (the lead action of the most recent assistant turn, or the action implied by the current user cue). One short phrase, present tense.
- **UNFINISHED:** the open immediate interaction thread — the last unanswered question, the last deflected disclosure, an open offer, or an active promise (memoryMeta.promises). One short phrase. This is "what is mid-flight in the conversation", not a future hook.
- **RELATIONSHIP STATE:** the current affective distance/tension carried by the most recent exchange (from recent turns + memoryMeta honorifics/items as context). One short phrase. Descriptive ("guarded warmth", "quiet acceptance"), not a declaration to enact.
- **AVAILABLE AFFORDANCES:** the concrete objects/physical givens already present in the scene that can be used as continuation material (from recent turns + memoryMeta.items + current cue's offered object). A short bounded list (e.g. up to 3-4 items). No introduced object/NPC/location.

Rendering: a compact bracketed section (reusing the existing bracketed-section convention already used by [OPENING SCENE CONTEXT]). Each field is one line. Total block is bounded (see inflation guard, section 11). The block is labeled as already-occurred/current scene state, and explicitly tells the model NOT to use it as a length exemplar and NOT to introduce new elements (mirrors the existing OPENING SCENE CONTEXT anti-exemplar wording).

The contract is DESCRIPTIVE: it states what IS the current scene state so the model can continue it. It is NOT prescriptive: it never says what should happen next, never names a next event, never introduces a new element.

---

## 7. Forbidden content contract

The momentum block MUST NOT contain (enforced by the extraction function, deterministic filters):

- Dormant world events; future plot hooks; unrelated factions; hidden enemies; unused backstory; distant locations; inactive secrets; arbitrary new objectives.
- Any "next event suggestion": forbidden forms include "X appears next", "cause event Y", "create new conflict", "move location", "introduce NPC", "reveal secret", "escalate threat".
- Dormant canon top-N as length filler; archive whole-blob; FULL canon partial re-injection.
- Numeric beat-count instruction; "write longer"; "make multiple beats"; "write N paragraphs".
- Scene Engine re-introduction; model-specific prose adapter; artificial goal_summary generation; vector DB / embedding-first retrieval.
- Any content drawn from the canon compiler or ACTIVE selector output (those are ACTIVE WORLD LORE, a different tier). Momentum sources are limited to: current user cue; greeting/opening scene; recent raw history; current location already established; current activity already established; unresolved immediate dialogue/reaction; current relationship beat; immediate physical/environment affordances already present.

At cold-start, if the peeled creator greeting itself references dormant hooks/future events (some creator greetings do), the extraction MUST filter those out (keep only location/posture/action/relationship tension) and MUST NOT propagate greeting-embedded dormant hooks into the momentum block. The greeting's dormant content stays suppressed by the existing CORE+ACTIVE layered-canon path; momentum only carries the scene-local slice.

---

## 8. Candidate A / B / C comparison

| Dimension | A: bounded recent-scene extraction | B: greeting + unresolved-beat hybrid | C: structured current-scene state from existing context |
|---|---|---|---|
| Sources | recent raw history (last ~4 turns, the existing -4 slice) + current cue; greeting only at cold-start | peeled greeting + recent history + an extracted "unresolved beat" | recombines memoryMeta (currentLocation/items/promises) + recent history + cue + sceneDirective descriptive fields |
| Extraction method | deterministic server-side selector + lightweight field derivation; no LLM | deterministic greeting peel (exists) + heuristic/LLM unresolved-beat detection | deterministic recombination of already-computed signals |
| Complexity | LOW | MEDIUM | MEDIUM-HIGH |
| DB need | NONE | NONE | NONE |
| Cache impact | dynamic only (user-turn extras, below CORE prefix) | dynamic only | dynamic only |
| Token cost | SMALL (bounded recent slice, lightly distilled) | MEDIUM (greeting + recent + beat) | MEDIUM |
| Hallucination risk | LOW (extracts from actual history) | LOW-MED (unresolved-beat detection is fuzzy) | LOW (recombines existing signals) |
| Dormant-canon contamination risk | LOW (history is scene-local; never touches canon compiler/selector) | LOW-MED (greeting may embed dormant hooks; needs filtering) | LOW |
| Determinism feasibility | HIGH | MEDIUM (unresolved-beat heuristic is brittle if deterministic) | HIGH |
| Overlap with existing blocks | LOW (does not touch [3b] relationship memo or [3d] scene directive) | LOW-MED (overlaps OPENING SCENE CONTEXT at cold-start) | MED-HIGH (overlaps [3b] relationship memo which already renders items/promises; risks duplicating sceneDirective) |
| Implementation surface | SMALL (one extraction fn + one extras entry) | MEDIUM (greeting merge + beat detection + filter) | MEDIUM-HIGH (multi-source harmonization + new structured contract + overlap management) |
| Reuse of existing structure | HIGH (reuses the -4 slice pattern + extras array + OPENING SCENE CONTEXT style) | MED (reuses greeting peel but adds beat detection) | MED (reuses memoryMeta but currentLocation is not currently rendered; needs surfacing) |

Notes:
- A is the smallest, lowest-risk, fully deterministic, self-contained, and reuses the most existing structure (the -4 slice already computed for archive/user-note RAG; the extras array already used by SHORT HISTORY; the bracketed-section convention already used by OPENING SCENE CONTEXT). It does not overlap [3b] relationship memo or [3d] scene directive.
- B's added value over A is marginal: the greeting is already handled at cold-start by the existing OPENING SCENE CONTEXT block, so B risks duplicating it; the "unresolved beat" is the one genuinely hard piece and is exactly where an LLM call would tempt (forbidden as Phase 1 primary).
- C reuses more already-computed signals but introduces overlap debt with [3b] (items/promises already rendered) and [3d] (sceneDirective), and requires surfacing currentLocation (parsed but not rendered today). It is more moving parts for the same outcome.
- An LLM call (extract-then-summarize recent scene) is listed ONLY as an ALTERNATIVE (see section 12). It is NOT adopted as Phase 1 primary: cost, latency, non-determinism, cache-token churn, and prompt-contamination risk all disqualify it for a bootstrap role that must auto-disable.

---

## 9. Recommended minimal candidate

**Recommendation: Candidate A — bounded recent-scene extraction only.**

Rationale (smallest):
- Smallest implementation surface: one COMMON extraction function `buildSceneMomentumBlock(input)` + one entry added to the existing DeepSeek user-turn extras array. No new prompt header system, no new DB column, no new selector, no new budget.
- Fully deterministic, server-side, no LLM call. Lowest hallucination and dormant-contamination risk (sources are scene-local history + cue; it never reads the canon compiler or ACTIVE selector).
- Reuses the most existing structure: the `-4` recent slice already computed in contextBuilder (recentHistoryText / recentSceneContext for archive and user-note RAG); the extras-array mechanism already used by SHORT HISTORY / SHORT USER TURN; the bracketed-section convention already used by [OPENING SCENE CONTEXT].
- No overlap with [3b] Relationship memo or [3d] Private scene directive — momentum is a separate semantic tier.
- Auto-disable is free: the same thin-history predicate that activates it turns it off as history matures.

What A reuses from C (minimal, non-overlapping enrichment, kept inside A to avoid a separate C implementation): the already-parsed `memoryMeta.currentLocation` (currently NOT rendered anywhere) as a WHERE fallback when recent turns do not mention a location, and `memoryMeta.promises` only as an UNFINISHED fallback when no open thread is detectable from recent turns. These are read-only reuses of already-computed signals; they do NOT re-render items/promises (those stay owned by [3b]). This keeps A self-contained while avoiding a separate C harmonization layer.

What A explicitly does NOT do: no greeting re-injection (cold-start reuses the peeled greeting's scene-local slice only, filtered); no unresolved-beat LLM detection (B's hard part is dropped); no sceneDirective reuse (nextBeatHint is forbidden); no canon-plan mixing (ACTIVE WORLD LORE stays separate).

---

## 10. Exact production insertion candidate

**Existing dynamic insertion point (recommended):** the DeepSeek user-turn extras array in src/services/contextBuilder.ts (the `deepSeekUserExtras` list, currently holding `deepSeekShortHistoryExtra`, `resolveDeepSeekShortUserTurnExtra(...)`, and the regen block), passed as `extraTail` to the existing `prependDeepSeekBottomReminder(userBodyWithOpening, deepSeekUserExtras || null)`.

Why this point:
- It is **dynamic and non-cached** (it lives in the user turn, below the system-prompt CORE cache prefix). The CORE stable cache prefix (systemRulesBlock + characterSettingsBlock, breakpoints 1 and 2) is UNTOUCHED.
- It is **already model-gated to DeepSeek** (only assembled when `deepSeekXmlMode`), which matches the Phase 1 DeepSeek-canary rollout exactly.
- It **reuses existing neutral dynamic structure**: the extras array is already a list of bracketed `[HEADER]\n...` blocks; adding one entry is the smallest possible wiring. No new prompt header SYSTEM is invented — the block follows the existing bracketed-section convention (the same shape as `[OPENING SCENE CONTEXT — ALREADY OCCURRED]` and `[SHORT HISTORY]`).
- The **Terminal/LENGTH exact tail position is unchanged**: the Terminal length compact tail (`buildTerminalLengthOverrideBlock`) and the Length control rule live at the absolute end of the SYSTEM prompt; the momentum block lives in the USER turn, so it cannot shift them.
- It pairs naturally with SHORT HISTORY: both fire on the same thin-history predicate. SHORT HISTORY provides the LENGTH nudge ("do not mimic short history"); the momentum block provides the SCENE CONTENT to continue. They are complementary siblings in the same extras array.

Wiring shape (design only — names/surfaces, not code):
- In contextBuilder, after computing `deepSeekShortHistoryExtra`, compute `deepSeekMomentumExtra` via the common `buildSceneMomentumBlock(...)` when `isThinSceneHistory(shortTermHistory)` is true (and canon canary is active). Prepend it to the `deepSeekUserExtras` array (before SHORT HISTORY, so scene state precedes the length nudge — same ordering principle as OPENING SCENE CONTEXT preceding the user body).
- The block is produced by a COMMON function (model-agnostic extraction). The gating to DeepSeek is at the CALL SITE (deepSeekXmlMode + canary policy), preserving COMMON capability + MODEL-GATED rollout.

Header wording (minimal, follows existing convention): a single bracketed label line in the existing style, e.g. `[CURRENT SCENE MOMENTUM — CONTINUE FROM HERE]`, plus the existing anti-exemplar line ("do not use this as a length exemplar; do not introduce new elements"). This is one minimal label line added to an existing dynamic structure, not a new prompt header system. (If a stricter "no new wording" reading is adopted, the block can instead reuse the existing `[OPENING SCENE CONTEXT — ALREADY OCCURRED]` label verbatim; see section 18.)

For later rollout to non-DeepSeek models (NOT Phase 1): the same common block would be pushed via `pushSection(..., "dynamic")` into the system-prompt dynamicBlock (the same region as [3d]/[3b]), still below the CORE cache prefix and above the Terminal/LENGTH tail. This is the COMMON injection path; Phase 1 uses the DeepSeek extras path only.

---

## 11. Cache implications

- CORE stable cache prefix (systemRulesBlock + characterSettingsBlock) is PRESERVED. The momentum block is dynamic and lives in the user turn (Phase 1) / dynamicBlock (later), never in cacheRules or cacheCharacter. No change to the two cache breakpoints.
- The block is bounded and present ONLY on thin/cold-start turns; it auto-disappears on mature turns, so it does NOT permanently grow the per-turn payload. cached_tokens on the system prefix are unaffected (the system prompt is unchanged in Phase 1).
- Because the block sits in the user turn (not the system prompt), it does not bust the system-prompt cache fingerprint at all in Phase 1. (On later rollout into dynamicBlock, the dynamicBlock is already non-cached by design, so still no cache-prefix bust.)
- Inflation guard (the block must NOT become a mini-summary / mini-FULL-context over time): do NOT fix an exact char limit yet. Propose measurement candidates to calibrate in the PoC:
  - momentum_chars: total chars of the rendered block (target: small, bounded by the 5-field structure, not by history length).
  - source_count: number of recent turns the extraction read (cap, e.g. last 4).
  - active_turns: number of recent assistant turns that contributed (drives auto-disable).
  - support_to_full_history_ratio: momentum_chars / (recent raw history chars in prompt) — guard against the block growing as history grows; the block should stay roughly constant while history grows, then vanish.
  - duplication_overlap: naive token overlap between the momentum block and the raw recent history in the prompt — guard against raw-copy inflation (the block must distill, not copy).

---

## 12. Model-policy boundary (COMMON capability + MODEL-GATED rollout)

- Extraction capability = COMMON. `buildSceneMomentumBlock(...)` and `isThinSceneHistory(...)` are model-agnostic, deterministic, server-side functions. They read only existing scene context (recent history + cue + memoryMeta + peeled greeting). No DeepSeek-specific data structure.
- Actual rollout = MODEL-GATED. Phase 1: DeepSeek V4 Pro canary only (gated by `deepSeekXmlMode` + the existing canon canary policy `canaryActualInjection`). The block is injected at the DeepSeek user-turn extras point. Muse / Gemini / HY3 see NO actual prompt change in Phase 1 (their paths do not assemble the DeepSeek extras; the common `pushSection` path is not wired for them yet).
- No DeepSeek-specific prose adapter: the block content is common descriptive prose; only the INJECTION POINT differs by model in Phase 1 (DeepSeek extras array vs. later common dynamicBlock).
- LLM call as ALTERNATIVE only (NOT Phase 1 primary): if deterministic extraction proves insufficient for some fixture (e.g. UNFINISHED field too brittle from rules), an LLM-based extract-then-summarize of recent scene is listed as a fallback. It is NOT adopted because: extra cost/latency per turn, non-determinism (bad for a bootstrap that must be reproducible in benchmark), cache-token churn (a generated block changes every turn even when history is stable), and prompt-contamination risk (the model's own summary leaking into the system prompt). If ever adopted, it would be a SEPARATE, explicitly model-gated, opt-in path — never the default.

---

## 13. Observability

PoC/benchmark logging (no production schema changes; harness-side only, mirroring the existing D2 harness metrics):
- momentum_active: 0/1 (whether the block fired this turn).
- momentum_chars: rendered block length.
- momentum_source_count, momentum_active_turns.
- momentum_support_to_history_ratio, momentum_duplication_overlap (inflation-guard signals).
- momentum_fields_present: which of WHERE/WHAT/UNFINISHED/RELATIONSHIP/AFFORDANCES were non-empty.
- momentum_greeting_sourced: 0/1 (cold-start greeting reuse).
- thin_history_signal: the underlying predicate value (and the recent-assistant avg no-ws chars).
- For regression: dormant sentinel in_context (reuse the existing sentinel audit), active_count, archive_count, floor2700, target3200, meaningful beats, depth/POV, breadth, cue retention, arbitrary-new-event flag, user-godmodding flag, technical-fallback flag.

These are benchmark/harness fields, not new production DB columns (READ-ONLY design).

---

## 14. Regression risks

- **MATURE duplication / over-description (primary failure mode):** if auto-disable fails or the threshold is too high, the block stays on in MATURE and causes duplication/over-description/scene-steering/cache-token growth. Mitigation: auto-disable is the SAME predicate (no separate counter); PoC MUST include a MATURE fixture as regression sanity and assert momentum_active=0 on MATURE.
- **Raw-copy inflation:** if the extraction degrades to copying raw recent history, the block becomes a mini-FULL-context and wastes tokens / duplicates chat history. Mitigation: the 5-field distillation contract + duplication_overlap measurement + the explicit anti-exemplar line.
- **Dormant-canon leak via greeting:** if a creator greeting embeds dormant hooks, cold-start momentum could re-inject them. Mitigation: greeting extraction keeps ONLY location/posture/action/relationship tension; greeting-embedded dormant content is filtered (section 7).
- **Scene-steering into a next event:** if UNFINISHED is mis-derived as a future hook, the block becomes a forbidden "next event suggestion". Mitigation: UNFINISHED is restricted to mid-flight immediate interaction (last unanswered question / open offer / active promise), never a future event.
- **Cache-prefix bust on later rollout:** if the block is later pushed into cacheRules/cacheCharacter by mistake. Mitigation: it is dynamic-only by contract (section 10/11).
- **Causal contamination with ACTIVE selector debt:** the ACTIVE selector recall 43% / precision 46% is SEPARATE backlog debt. Fixing it alongside this PoC would contaminate length-recovery causal attribution. Mitigation: ACTIVE selector work is a SEPARATE phase AFTER the momentum PoC passes (see section 18 / task spec).
- **Fixture variance:** enoch-quiet is a naturally short-scene fixture (D1.1 MATURE enoch is only 2/5 floor). Mitigation: PoC success is judged on THIN recovery + MATURE no-effect + no dormant recurrence, not on enoch absolute length.

---

## 15. Expected implementation files/functions (design only — names/surfaces, not code)

No production code is written in this design. The following are the SURFACES a future PoC would touch (names indicative, not commitments):

- NEW common extraction module (e.g. src/lib/sceneMomentum.ts):
  - `isThinSceneHistory(history): boolean` — common thin/cold-start predicate (lifts the logic of resolveDeepSeekShortHistoryLengthExtra into a model-agnostic function; same calibration threshold).
  - `buildSceneMomentumBlock(input): string | null` — common deterministic 5-field extractor (WHERE/WHAT/UNFINISHED/RELATIONSHIP/AFFORDANCES) from recent history + current cue + memoryMeta + peeled greeting; applies the forbidden-content filter; returns null when not thin or when no usable scene state.
  - Internal helpers: `extractWhere(...)`, `extractWhatIsHappening(...)`, `extractUnfinished(...)`, `extractRelationshipState(...)`, `extractAffordances(...)` — deterministic, keyword/pattern-based, bounded.
- EDIT (wiring only, Phase 1) src/services/contextBuilder.ts:
  - In the DeepSeek user-turn assembly block (where `deepSeekUserExtras` is built), call `buildSceneMomentumBlock(...)` when `deepSeekXmlMode` and `isThinSceneHistory(...)` and canon canary active; prepend the result to `deepSeekUserExtras`.
  - No change to pushSection ordering, cacheRules/cacheCharacter targets, Terminal/LENGTH tail, or any existing section.
- NO changes to: src/lib/canonInjectionPolicy.ts, src/lib/canonPlan/*, src/lib/sceneDirective.ts, src/lib/canonPlan/activeSelector.ts, src/lib/memory/archiveSelective.ts, responseLength, prompt strings, DB schema/migrations, selectors, budgets, thresholds.
- Harness (PoC only, new files under scripts/_tmp-* and data/d2-length/): a thin-history momentum canary runner reusing the existing `runCall` from scripts/_tmp-d2-runner.ts with a `momentumOverride`/`historyOverride` path (mirroring how MATURE history was injected without touching production code).

---

## 16. PoC benchmark plan

- **Conditions:** D2 BASE (CORE+ACTIVE, no momentum) vs D2 + EARLY MOMENTUM SUPPORT (Candidate A, thin-gated, DeepSeek canary). DeepSeek V4 Pro, reasoning OFF, memory ON. CONTROL not needed (only momentum differs; both use D2 layered canon + selective archive).
- **Fixtures (THIN, min n=5/cell):** modern-quiet, fantasy-quiet, enoch-quiet (clean-cue variant). Reuse the THIN 4-turn histories from scripts/_tmp-d2-fixtures.ts / _tmp-d2-enoch-fixtures.ts and the ENOCH_CLEAN_CUE from scripts/_tmp-d2-length-fixtures.ts.
- **MATURE regression sanity (n=5):** one MATURE fixture (e.g. modern-quiet MATURE 12-turn) — assert momentum_active=0 and no length/beat degradation vs the existing D2 MATURE baseline.
- **Metrics (per run):** chars, floor2700, target3200, meaningful beats (human-verified on medians, per REPORT.md item 7 method), depth/POV, breadth, dormant activation (active_count, sentinel_in_context), cue retention, arbitrary-new-event flag, user-godmodding flag, technical-fallback flag; plus momentum observability fields (section 13).
- **Success criteria (all must hold):**
  1. THIN length/beat recovery: D2+MOMENTUM aggregate chars >= D2 BASE and >= D1.1 THIN baseline (3460) within noise; floor2700 pass rate clearly up from D2 BASE 3/9; meaningful beats up (multi-beat progressive, not static single moment).
  2. MATURE support OFF (or no effect): momentum_active=0 on MATURE; D2+MOMENTUM MATURE within noise of D2 BASE MATURE (no duplication/over-description/scene-steering/cache-token growth).
  3. No dormant ladder recurrence: sentinel_in_context=0; active_count cue-driven only (clean-cue -> active=0); no Mother/Pod/Level-style threat ladder fires; no arbitrary new event; no user godmodding; technical fallback=0.
- **Not a success criterion:** enoch absolute length (naturally short-scene fixture); cost (reference only, as in prior benchmarks).

---

## 17. Rollback

- **Kill switch (Phase 1, no code change needed):** the momentum block is gated by the existing canon canary flag (`CANON_INJECTION_DEEPSEEK_CANARY`) and the rollout stage. Setting the canary off (or stage D0/force-full-legacy) removes the block entirely — it is only assembled when `deepSeekXmlMode` + canary active. No separate rollback flag is required.
- **Threshold rollback:** the thin-history predicate threshold (recent-assistant avg no-ws chars, Phase 1 starting value 2200) is a single tunable constant. Raising it disables the block on more turns; the block can be effectively silenced by setting the threshold to 0 (never thin) without a code change if the constant is env-overridable (design choice for the PoC).
- **Code rollback:** the Phase 1 wiring is one call site in contextBuilder (one entry added to the extras array) + one new common module. Reverting the call-site addition fully removes the feature; the common module becomes dead code with no callers. No DB migration to reverse, no schema change, no prompt-string edit, no selector/compiler/budget change to undo.
- **Data rollback:** all PoC artifacts live under data/d2-length/ and scripts/_tmp-*; existing data/d2-live/ and scripts/_tmp-d2-* are untouched. Removing the new PoC files restores the prior state.

---

## 18. Unresolved decisions

1. **Header wording — new minimal label vs verbatim reuse.** The task says "do NOT invent a new prompt header/wording first; reuse existing neutral dynamic structure." Two readings: (a) add one minimal bracketed label line `[CURRENT SCENE MOMENTUM — CONTINUE FROM HERE]` following the existing bracketed convention (smallest new wording, coherent with `[OPENING SCENE CONTEXT — ALREADY OCCURRED]`); (b) verbatim-reuse the existing `[OPENING SCENE CONTEXT — ALREADY OCCURRED]` label for the momentum block too (zero new wording, but slightly conflates "opening scene" with "current scene momentum"). Decision deferred to PoC: try (a) first; if the anti-exemplar wording is the only thing that matters, (b) is the zero-new-wording fallback. This does not block the PoC.
2. **UNFINISHED field determinism.** Deriving "the open immediate interaction thread" purely from rules (last unanswered question, trailing ellipsis/deflection, active promise) is the brittle part of Candidate A. Phase 1 must validate that a deterministic UNFINISHED is good enough across the 3 THIN fixtures. If it is too brittle for a specific fixture, the fallback is to OMIT that field for that fixture (a 4-field block) rather than call an LLM. LLM extraction remains an ALTERNATIVE only (section 12).
3. **Thin-history threshold calibration.** Reusing 2200 no-ws chars (from resolveDeepSeekShortHistoryLengthExtra) as the Phase 1 starting value is an evidence-anchored default, not a proven optimum. The PoC must confirm the threshold activates on the THIN fixtures and auto-disables on the MATURE fixture. Tuning is benchmark-only.
4. **currentLocation surfacing.** memoryMeta.currentLocation is parsed but not rendered today. Candidate A reuses it as a WHERE fallback. Whether to surface it more broadly (e.g. also in [3b]) is OUT OF SCOPE for this PoC (would change [3b] and contaminate attribution); the momentum block reads it read-only without changing [3b].
5. **Greeting-embedded dormant filtering.** The exact deterministic filter for "keep only location/posture/action/relationship tension from the peeled greeting, drop dormant hooks" needs a small allowlist of greeting section types. The PoC fixtures' greetings (준서/세라핀/에녹) are scene-local (dormantHooks=[]), so this filter is low-risk for the PoC; production greetings with embedded hooks need the filter validated later.
6. **Later-rollout common injection path.** Phase 1 uses the DeepSeek user-turn extras path. The later common path (pushSection into dynamicBlock for non-DeepSeek models) is designed but NOT built in Phase 1. Whether/when to roll out to Muse/Gemini/HY3 is a separate decision after the DeepSeek canary passes; it requires its own canary per model (COMMON capability + MODEL-GATED rollout).
7. **ACTIVE selector debt timing.** ACTIVE selector recall 43% / precision 46% stays SEPARATE backlog debt. It must NOT be fixed alongside this PoC (context change would contaminate length-recovery causal attribution). It is a separate phase AFTER the momentum PoC passes. The only open question is sequencing, which is decided by the parent plan, not this design.

---

## Verdict

### READY FOR MOMENTUM PoC

The thin/cold-start owner is confirmed (verdict A). The recovery signal kind is known (scene-local continuity: WHERE/WHAT/UNFINISHED/RELATIONSHIP/AFFORDANCES). The raw material already exists at thin turns (recent history + cue + memoryMeta.currentLocation + peeled greeting). The smallest candidate (A: bounded recent-scene extraction) is fully deterministic, needs no LLM call, no DB change, no selector/compiler/budget change, reuses the existing `-4` slice + DeepSeek user-turn extras array + bracketed-section convention, preserves the CORE cache prefix and the Terminal/LENGTH tail, auto-disables on maturity, and keeps SCENE MOMENTUM separate from ACTIVE WORLD LORE and from the Scene Engine. The PoC benchmark plan, observability, rollback, and regression risks are defined. Unresolved decisions (header wording, UNFINISHED determinism, threshold calibration) are PoC-validation items, not blockers. No additional isolation is required before the PoC.

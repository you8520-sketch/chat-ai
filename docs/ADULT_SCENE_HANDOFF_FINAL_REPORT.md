# DeepSeek V4 Pro adult-scene handoff — implementation report

Date: 2026-07-30  
Branch: `codex/adult-scene-model-handoff`  
Production flag: **not enabled**  
Main merge: **not performed**

This report distinguishes measured results from code inspection and from work
that remains unmeasured. It does not assign invented scores to tests that were
not run.

## 1. Current structure investigated

- Chat request entry: `POST /api/chat` in `src/app/api/chat/route.ts`.
- Selected model source of truth: `getUserSelectedAI(db, user.id)`. The request
  body and the old per-chat Gemini column do not decide the model.
- Provider/model helpers: `src/lib/chatModels.ts`.
- Main streaming adapter: `streamOpenRouterAdultToClient()` in
  `src/lib/openRouterAdult.ts`; it supports OpenRouter and CheaperInference
  transport.
- Prompt assembly: `buildContext()` in `src/services/contextBuilder.ts`.
- Canonical RAW history: DB message rows → dialogue turns →
  `rawRecentTurnsToHistory()` → `trimHistoryToBudget()`.
- Memory/canon inputs reused by the adult route: character chunks, world/canon,
  persona, user note, archive/summary, long-term memory, relationship memory,
  episodic memory, lorebook, scenario events, status widget rules, Speech Lock,
  Muse/prose rules, and recent RAW.
- Status widget extraction remains in the existing post-generation common
  pipeline.
- Billing is calculated after a valid response is saved; failed generation
  paths skip point deduction.
- Adult route state is persisted in `chats.model_route_state_json`; per-message
  internal telemetry is persisted in `messages.adult_route_meta_json`.

## 2. Modified files

Implementation:

- `.env.example`
- `src/app/api/chat/route.ts`
- `src/app/api/chat/fork/route.ts`
- `src/app/api/chat/message/route.ts`
- `src/app/api/chat/message/variant/route.ts`
- `src/app/api/chat/messages/route.ts`
- `src/lib/adultSceneRouting.ts`
- `src/lib/openRouterAdult.ts`
- `src/lib/characterFormSave.ts`
- `src/lib/db.ts`
- `src/lib/chatUsage.ts`
- `src/lib/billingReceiptAccess.ts`
- `src/lib/messageAlternates.ts`
- `src/lib/regenerationContext.ts`
- `src/lib/feedback/snapshot.ts`
- `src/lib/feedback/types.ts`

Evaluation/reporting:

- `.gitignore`
- `scripts/adult-scene-handoff-ab.ts`
- `src/lib/adultSceneRouting.quality.test.ts`
- `docs/ADULT_SCENE_HANDOFF_AB.md`
- `docs/ADULT_SCENE_HANDOFF_FINAL_REPORT.md`

## 3. Added types and functions

Core types:

- `SceneMode`
- `ActiveModelRoute`
- `AdultDialogueProfile`
- `AdultConsentMode`
- `AdultStatus`
- `ModelRouteState`
- `GeneralRouteBridge`
- `SceneContinuityPacket`
- `ParticipantAdultMetadata`
- `AdultEligibilityResult`
- `RefusalResult`
- `AdultRoutingConfig`
- `AdultProviderRoutingRequest`
- `SceneClassification`
- `AdultRouteDecision`

Core functions:

- config/state: `resolveAdultRoutingConfig`,
  `buildAdultProviderRoutingRequest`, `parseModelRouteState`,
  `serializeModelRouteState`
- adult metadata: `inferAdultStatusFromLegacyText`,
  `assessParticipantAdultStatus`, `resolveAdultEligibility`
- consent/policy: `detectOocSceneStop`, `detectActualNonConsent`,
  `hasExplicitCncOptIn`, `resolveRequestedConsentMode`
- scene/route: `classifySceneMode`, `providerCanHandleScene`,
  `decideAdultModelRoute`, `advanceModelRouteState`
- handoff context: `selectAdultHandoffRawHistory`,
  `buildSceneContinuityPacket`, `appendAdultHandoffPrompt`,
  `appendAdultHandoffToSystemSplit`
- safe return: `buildGeneralRouteBridge`, `sanitizeGeneralRouteBridge`,
  `buildGeneralProviderContext`
- refusal/streaming: `detectModelRefusal`, `createInitialStreamBuffer`
- A/B fixtures: `buildHandoffVariantA`, `buildHandoffVariantB`

## 4. DB fields and migration

Added columns:

- `chats.model_route_state_json TEXT NOT NULL DEFAULT '{}'`
- `characters.adult_dialogue_profile TEXT NOT NULL DEFAULT 'auto'`
- `characters.adult_status TEXT NOT NULL DEFAULT 'unknown'`
- `characters.adult_consent_modes_json TEXT NOT NULL DEFAULT '["standard"]'`
- `messages.adult_route_meta_json TEXT NOT NULL DEFAULT ''`

One-time legacy normalization:

- `_schema_flags.character_adult_status_metadata_v1` makes the migration
  idempotent.
- Character description, system prompt, world, and simulation cast are scanned
  once.
- Explicit adult text becomes `confirmed`; explicit minor text becomes
  `minor`; conflicting signals become `conflict`; ambiguous data stays
  `unknown`.
- Unknown legacy characters are not automatically treated as adult or minor.

## 5. Exact meaning of current RAW 4 turns

In the existing common history path, one turn means one complete
`user + assistant` exchange.

- `MIN_HISTORY_TURN_FLOOR = 4`
- Four turns therefore mean **eight messages**, not four individual messages.
- `trimHistoryToBudget()` may exceed the token budget to retain the latest four
  complete exchanges.
- The new first adult handoff independently targets six complete exchanges,
  guarantees at least two complete exchanges, and uses the configured RAW token
  budget.

## 6. First DeepSeek prompt assembly order

The first adult handoff uses the same `buildContext()` pipeline with the adult
model ID and selected RAW history. The effective order is:

1. Korean output, bilingual, and no-godmodding rules
2. core master rules
3. full character identity/settings and Speech Lock
4. selected persona and user-note focus
5. Muse/prose style rules
6. world/canon and lorebook material
7. archive/current summary
8. long-term and episodic memory
9. relationship memory
10. user-note expansion/RAG
11. triggered scenario events and status-widget/trigger context
12. dynamic operational/length tail
13. private `SceneContinuityPacket`
14. short DeepSeek continuation instruction
15. recent RAW, normally up to six complete user-assistant exchanges
16. current user input, inserted once by the common builder

Status-widget prompt overrides run before the continuity packet and continuation
instruction are appended. The current user input is not duplicated in RAW.

## 7. Preemptive routing decision order

1. Read feature flag and prior `ModelRouteState`.
2. Resolve requested consent mode and restrict it to the character’s allowed
   modes.
3. Classify current input using current text, the previous mode, and the latest
   three RAW exchanges.
4. Resolve adult eligibility:
   adult-verified user, adult-enabled character, confirmed adult participant,
   no real person, no actual non-consent.
5. With the flag off, return `general` and preserve existing behavior.
6. If explicit intent is present but policy eligibility fails, block.
7. OOC stop or clear time/location transition returns `general`.
8. Evaluate `explicit_frequent + sexualContextActive`.
9. Evaluate previous explicit mode and provider capability boundary.
10. Enter or retain `adult`; otherwise retain `general` and optionally enable
    the initial refusal buffer.

## 8. `explicit_dialogue` classification

It is separate from physical explicit action.

- Direct triggers include dirty-talk wording, explicit sexual-dialogue wording,
  explicit sexual commands, and requests to say explicit sexual content.
- An anatomy term alone is insufficient.
- Anatomy plus speech/command wording also requires an already active sexual
  context.
- Medical/combat contexts remain general unless explicit action/dialogue
  evidence is also present.
- The rule is deterministic and makes no extra paid classifier call.

Known limitation: indirect euphemistic dirty talk can be missed unless the
previous stored mode already keeps the adult route sticky.

## 9. Dirty-talk character handling

- `auto`: current input, recent RAW, and scene state decide.
- `none`: does not cause adult routing by profile alone.
- `suggestive`: remains within general romantic/tension handling.
- `explicit_rare`: still needs explicit context/intent.
- `explicit_frequent`: enters adult only when
  `adultEligible && sexualContextActive`; ordinary daily scenes remain general.

## 10. Silent refusal fallback

1. Borderline general requests can buffer the first 400 visible characters.
2. Provider finish reason, error, empty safety output, or short refusal text is
   normalized by `detectModelRefusal()`.
3. Fallback is allowed only when adult eligibility and policy pass, no visible
   text was sent, no earlier fallback was attempted, and adult fallback context
   exists.
4. Buffered refusal events are discarded.
5. DeepSeek is called once through CheaperInference using the adult handoff
   context.
6. The refusal is not written into canonical RAW, memory, summary, or the
   DeepSeek prompt.
7. Successful fallback sets delivered route to `adult` and records trigger
   `general_model_refusal`.
8. DeepSeek failure is not retried through another application-level model.
9. If text was already flushed to the user, silent replacement is forbidden.

## 11. Sticky Route entry and return

Entry:

- explicit dialogue/action/transition, previous explicit mode, provider
  capability overflow, `explicit_frequent` in sexual context, or successful
  refusal fallback
- default minimum adult retention: three turns

Retention/return:

- minimum counter decrements only while adult output continues
- `normal` or `romantic` increments the safe-scene streak
- return requires minimum counter `0` and two consecutive safe scenes
- aftercare is not itself a safe-return mode
- OOC stop or clear time/place transition resets to general immediately

## 12. RAW filtering when returning to a general model

- DB canonical history keeps what the user actually saw.
- `buildGeneralProviderContext()` walks complete user-assistant pairs.
- Pairs marked `activeRoute=adult` or an explicit scene mode are omitted.
- One sanitized `GeneralRouteBridge` pair is inserted between safe history
  before and after the omitted segment.
- The bridge carries aftermath/state facts and excludes explicit act detail.

Important implementation gap: the current bridge is built server-side from the
sparse continuity packet. It is not yet parsed from a private structured field
generated by the same DeepSeek response.

## 13. Provider configuration

- Adult transport: `https://api.cheaperinference.com/v1/chat/completions`
- Default model: `deepseek-v4-pro`
- Application code, not provider automatic model fallback, decides when to
  switch from the user-selected model.
- The optional provider object supports `order`, `only`, `allow_fallbacks`,
  `require_parameters`, and `quantizations`.
- Defaults leave provider order/only/quantizations empty,
  `allow_fallbacks=false`, and `require_parameters=true`.
- No high-reasoning setting is copied from another model.

## 14. Point deduction, settlement, and failure flow

Actual implementation:

- A minimum balance check happens before generation.
- There is **no point reservation** before the upstream call.
- The final delivered model’s valid saved response is priced once.
- If general output is silently replaced, the failed general cost is stored as
  `hiddenFallbackOverheadCostUsd`; it is not added to user points.
- User point deduction runs once after final response validation and persistence.
- Generation failure paths mark the message failed and skip billing.
- Existing duplicate-request protection skips duplicate deduction.

Therefore the result satisfies single user charging, but it does not implement
the originally recommended reserve-then-settle/refund ledger.

## 15. Feature flags and defaults

```text
ADULT_SCENE_ROUTING_ENABLED=false
ADULT_MODEL_ID=deepseek-v4-pro
ADULT_MODEL_PROVIDER_ORDER=
ADULT_MODEL_PROVIDER_ONLY=
ADULT_MODEL_ALLOW_PROVIDER_FALLBACKS=false
ADULT_MODEL_REQUIRE_PARAMETERS=true
ADULT_MODEL_QUANTIZATIONS=
ADULT_SCENE_HANDOFF_RAW_TURNS=6
ADULT_SCENE_HANDOFF_MAX_TOKENS=8000
ADULT_SCENE_MINIMUM_ROUTE_TURNS=3
ADULT_SCENE_RETURN_SAFE_TURNS=2
ADULT_SCENE_SILENT_REFUSAL_FALLBACK=true
ADULT_SCENE_INITIAL_STREAM_BUFFER_CHARS=400
ADULT_SCENE_PROVIDER_CAPABILITIES_JSON=
```

With the main flag off, runtime routing remains general. Schema additions still
exist but do not activate routing.

## 16. Unit/static validation results

Passed:

- `npm run typecheck:app`
- `npm run lint`
- `git diff --check`
- five-scenario pure routing test: 5/5 passed

Not completed:

- The original 42-item mandatory unit-test matrix has not been implemented.
- Provider-specific refusal normalization, streamed partial-output fallback,
  one-charge settlement, and bridge filtering still need dedicated integration
  mocks.

## 17. Integration test result

Initial gate:

- model: Gemini 3.6 Flash only
- five scenarios, A/B, ten successful API responses
- errors: 0/10
- refusal-like responses: 0/10
- Luna was not run because Gemini produced no failed arm or ambiguous overall
  result.

This was a prompt-continuity A/B, not a deployed end-to-end
Gemini-to-DeepSeek switch.

## 18. A/B quality comparison

Scale: 1 is poor, 5 is best. For negative criteria, 5 means the problem was
absent. Scores are direct review of the ten saved Gemini outputs.

| Criterion | A | B | Finding |
|---|---:|---:|---|
| Character voice | 4.2 | 4.5 | B retained the intended register more consistently |
| Address/honorific | 4.4 | 4.4 | Both retained polite/banmal mode; sparse names limited evidence |
| POV | 3.4 | 4.8 | A drifted into first person in two samples |
| Previous-action continuation | 4.2 | 4.8 | B attached more directly to the unfinished action |
| Space/posture consistency | 4.0 | 4.8 | B used packet positions; A invented larger movement |
| Similar sentence length | 4.2 | 4.3 | Both were close; B slightly steadier |
| Similar paragraph breathing | 4.3 | 4.4 | Small B advantage |
| Dialogue/narration ratio | 4.3 | 4.4 | Both remained close to fixtures |
| Emotional expression | 4.3 | 4.6 | B preserved the named emotional balance |
| Scene pacing | 3.8 | 4.5 | A escalated the boundary scene too quickly |
| No previous-scene repetition | 4.7 | 4.8 | Neither arm repeated much |
| No unnecessary summary | 5.0 | 5.0 | No recap openings observed |
| No user-action ghostwriting | 3.8 | 4.5 | A invented user trembling/state in one scene |
| DeepSeek-specific style not protruding | N/A | N/A | DeepSeek was not the tested output model |
| Model switch imperceptible | N/A | N/A | Both arms used Gemini; no real provider switch occurred |

Measured 13-criterion average:

- A: **4.20 / 5**
- B: **4.60 / 5**

Literal continuity anchors:

- A: 11/25
- B: 14/25

The A/B result supports the continuity packet and six-exchange history design,
but does not yet prove that DeepSeek’s prose will blend invisibly with Gemini,
Luna, or another general model.

## 19. Routing-quality metrics

The five labeled routing cases produced:

```json
{
  "adultRoutePrecision": 1.0,
  "adultRouteRecall": 1.0,
  "falsePositiveRate": 0.0,
  "falseNegativeRate": 0.0,
  "unexpectedGeneralRefusalRate": 0.0,
  "silentFallbackSuccessRate": null
}
```

Interpretation:

- Two expected adult routes and three expected general routes were all correct.
- `unexpectedGeneralRefusalRate=0` is 0/10 in the Gemini A/B sample.
- `silentFallbackSuccessRate` is `null`, not 0%, because no refusal occurred
  and therefore no fallback attempt existed.
- Five curated cases are too few to treat 100% precision/recall as a production
  estimate.

## 20. Cost and latency comparison

Gemini 3.6 Flash price assumption used for the estimate:

- input: $1.50 / 1M tokens
- output: $7.50 / 1M tokens
- no cache discount included
- KRW example: 1,478 KRW/USD

```json
{
  "A": {
    "averageInputTokens": 252.2,
    "averageOutputTokens": 988.8,
    "averageCostUsd": 0.007794,
    "averageCostKrw": 11.52,
    "averageLatencyMs": 7268,
    "p95LatencyMs": 8403,
    "hiddenFallbackOverheadCostUsd": 0
  },
  "B": {
    "averageInputTokens": 555.6,
    "averageOutputTokens": 1025.0,
    "averageCostUsd": 0.008521,
    "averageCostKrw": 12.59,
    "averageLatencyMs": 6823,
    "p95LatencyMs": 8035,
    "hiddenFallbackOverheadCostUsd": 0
  }
}
```

B versus A:

- average input: +303.4 tokens (+120.3%)
- average output: +36.2 tokens (+3.7%)
- estimated average cost: +$0.000727, about +1.07 KRW (+9.3%)
- average latency: -445 ms in this run
- p95 latency: -368 ms in this run

The latency improvement is noise-prone at `n=5`; the reliable change is the
extra input context. Production prompts and the DeepSeek adult route are much
larger, so these fixture costs are not production cost forecasts.

## 21. Remaining weaknesses

1. No real general-model → DeepSeek prose A/B has been run.
2. DeepSeek-specific style protrusion and perceived switch remain unmeasured.
3. The five scenarios have one sample per arm and no repeated seeds.
4. Only the main character is currently supplied as a structured participant
   to `resolveAdultEligibility`; all active secondary participants are not yet
   enumerated and independently verified.
5. Production `SceneContinuityPacket` currently supplies previous mode,
   sexual-context state, consent mode, names, and POV, but usually lacks
   location, time, positions, unfinished action, emotional balance, speech
   state, and relationship change.
6. `GeneralRouteBridge` is server-derived from that sparse packet instead of
   same-call private DeepSeek metadata.
7. Indirect/euphemistic explicit dialogue may evade deterministic patterns.
8. Provider-routing options are implemented but no provider/quantization has
   been quality-qualified.
9. A thrown provider refusal before usage is returned can leave hidden upstream
   cost unknown even if the provider billed it.
10. The full 42-test matrix is incomplete.
11. The implemented billing flow is post-success deduction rather than
    reservation/settlement/refund.

## 22. Next improvement candidates

Priority order:

1. Enumerate and verify every active scene participant.
2. Add the missing 42-test matrix, especially refusal-stream and billing mocks.
3. Run the same five paired scenes as actual
   Gemini/Luna → DeepSeek handoffs and score the two currently N/A criteria.
4. Populate the production continuity packet from existing state-widget and
   scene metadata without model guesses.
5. Emit and parse a private `GeneralRouteBridge` in the same DeepSeek call.
6. Add accounting for thrown-before-usage hidden fallback cost.
7. Qualify and pin a CheaperInference provider before enabling fallbacks.
8. Add admin-only canary telemetry and review results before enabling the
   feature flag.

## Final status

The guarded implementation and initial five-scenario gate are on the independent
branch. Main has not been merged by this work, and
`ADULT_SCENE_ROUTING_ENABLED` remains `false`.

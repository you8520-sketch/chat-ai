# Main RP final-wire prompt audit (Phase A)

Baseline: `origin/main` `386b23dc6d5a4b4aba28e06a9e57ba2ea882b0fa`.
Issue: #1353. This PR changes no production prompt text.
Local token figures use `estimateTokens` = `ceil(chars * 0.9)`. Provider-counted usage was not collected. No paid model call was made.

Fixture: synthetic character `백하율`, persona `렌`, short lore/memory strings. No production chat rows.

Machine-readable inventory: `docs/audits/main-rp-final-wire-inventory-2026-10-02.json`.
Replay owner: `src/lib/mainRpFinalWireAudit.ts`.
Lock: `src/lib/mainRpFinalWireAudit.test.ts`.

## BEFORE

`buildContext()` is the section assembler. It is not the provider body.

Live Main RP path:

1. `POST /api/chat` (`src/app/api/chat/route.ts`) resolves the selectable model, adult room flag, and `user_authoring_level` / `auto_progression_authoring_level` (`LIMITED` | `NORMAL` | `ALLOW`, default `NORMAL`).
2. The route loads canon, creator narration style, lore, memory lanes, scene directive, and the mode-specific user string (`buildContinueNarrativeCommand` / `buildRegenerateUserPrompt` / raw user text).
3. `buildContext()` emits `systemPrompt`, `openRouterSystemSplit`, `history` (history plus the current user turn), and `trackedSections`.
4. `streamOpenRouterAdult()` may append an OOC HTML suffix to the system **string**, then `buildOpenRouterMessages()` builds the body from `systemSplit` when that split exists.
5. `applyProductionServerControlsToMessages()` replaces `[SCENE FLOW]` with `[SCENE PACING]` on interactive turns and appends a dialogue budget on the user turn. `reprojectControlledTextOntoStructuredContent()` keeps `cache_control` only when that edit stays inside one content block.
6. `assemblePrimaryRpRequest()` applies Cheaper Inference adaptation, or OpenRouter Gemini route policy.

Cheaper Inference and OpenRouter both use this message shape. `buildContext` treats `provider: "cheaperinference"` as the OpenRouter assembler (`compatibleProvider`).

Selectable Main RP models (`MAIN_RP_USER_SELECTABLE_OPTIONS`):

| Stored id | Wire model | Transport |
| --- | --- | --- |
| `deepseek-v4.1-flash` | `deepseek-v4.1-flash` | Cheaper Inference |
| `gemini-3.1-pro-preview` | `google/gemini-3.1-pro-preview` | OpenRouter, `provider.only=google-ai-studio`, `service_tier=flex` |
| `gemini-3.7-flash` | `google/gemini-3.7-flash` | OpenRouter, same route policy, `temperature` kept |
| `gemini-3.8-flash` | `google/gemini-3.8-flash` | OpenRouter, same route policy, `temperature` omitted |
| `gpt-5.6-terra` | `gpt-5.6-terra` | Cheaper Inference, `reasoning_effort=none` |
| `claude-opus-5.5` | `claude-opus-5.5` | Cheaper Inference, `reasoning_effort=low`, `thinking.type=disabled`, `output_config.effort=low`, no assistant prefill |

18 fixture cases cover those six wire families plus LIMITED/NORMAL/ALLOW, auto, regen, adult, empty memory, status widget, OOC HTML, and JSX. Gemini 3.7 and 3.8 share section ids and section hashes on the same fixture. Their request keys differ on `temperature`.

## ACTUAL REQUEST FLOW

Final message order: `system`, then user/assistant history, then the current user turn. The last role is `user`. Assistant prefill is absent on every case, including Claude.

`buildOpenRouterCachedSystemContent()` marks `systemRulesBlock` and `characterSettingsBlock` with `cache_control: { type: "ephemeral" }` and leaves `dynamicBlock` unmarked. That split is the pre-control shape. The provider body uses the post-control shape below.

Post-control system shape on this fixture:

| Case | Final system blocks | History `cache_control` |
| --- | --- | --- |
| Interactive `NORMAL` (default), all non-Claude models | 1 flat string, `cached=false` | no |
| Interactive `NORMAL`, Claude Opus 5.5 | 1 flat string, `cached=true` | yes |
| Interactive `LIMITED` and `ALLOW` | 3 blocks: cached, cached, uncached | no |
| Auto progression | 3 blocks: cached, cached, uncached | no |

Cause of the `NORMAL` collapse, confirmed on the fixture: `buildUserCoauthorOwnerBlock` for `NORMAL` leaves a `\n\n\n` inside `systemRulesBlock` (`index 2194` on a DeepSeek probe). `[SCENE FLOW]` sits later in `characterSettingsBlock`. `stripGenreSceneModePacingHint()` collapses every `\n{3,}`, and the pacing arm replaces `[SCENE FLOW]`. The combined diff crosses two content blocks, so `reprojectControlledTextOntoStructuredContent()` (`src/lib/openRouterAdult.ts`) returns the flat string and drops per-block `cache_control`. `LIMITED` and `ALLOW` have no triple newline, so the same replace stays inside the character block and `[SCENE PACING]` is written into cached block 2.

Claude then runs `applyCacheAndPrefillForTransport()`. A flat system string becomes one ephemeral block, `hasMutableSystemSuffixAfterCachedPrefix()` is false, and a history breakpoint is added. That breakpoint's prefix includes the volatile flat system (memory, persona reference, pacing).

`promptAudit.estimatedWastedTokens` on the default DeepSeek `NORMAL` fixture is `0`. The auto fixture reports a heuristic upper bound of `717`, equal to the whole user-persona-reference section, after an 80-character overlap. That number is now labeled `heuristic_upper_bound_not_removable_tokens`.

## FULL PROMPT INVENTORY

Pre-control sections for DeepSeek interactive `NORMAL` with memory, lore, and creator style (`ds-interactive-normal-rich`). Role is system except the current user turn and the lore prefix on that turn. Each id is injected once. Local estimates:

| ID | Owner | Bucket before server controls | Local tokens | Responsibility |
| --- | --- | --- | --- | --- |
| `openrouter-korean-prose-top` | `openRouterProsePolicy.ts` | `cacheRules` | 764 | Language, canon/scope header, role line |
| `runtime-prompt-contamination-guard` | `runtimePromptContaminationGuard.ts` | `cacheRules` on DeepSeek/Qwen, `dynamic` on Gemini/GPT/Claude | 856 / 799 | Output hygiene |
| `no-godmodding` | `noGodmodding.ts` / `autoProgressionRules.ts` | `cacheRules` | 550 (`NORMAL`) / 987 (`LIMITED`) / 798 (auto) | User-authoring owner for this turn |
| `rule-historical-truth-canonical-memory` | `historicalTruthPolicy.ts` | `cacheRules` | 858 | Past-fact evidence rule |
| `character-core-identity` | `contextBuilder.ts` `pushCharacterCoreIdentity` | `cacheRules`, except DeepSeek XML flush to `cacheCharacter` | 108–159 | Structured canon |
| `identity-and-rules` | `corePrompt.ts` | `cacheRules` | 501 | Persona body + user-note focus |
| `prose-style-xml-bundle` | `advancedProseNsfwGuidelines.ts` | `cacheCharacter` | 1170 | `[COMMON PROSE]` + `[SCENE FLOW]` before the wire replace |
| `creator-narration-style` | creator column via `buildCreatorNarrationStyleBlock` | `cacheCharacter` | 347 | Creator style |
| `archive-memory` | route memory text | `dynamic` (DeepSeek also `<LONG_TERM_MEMORY>`) | 37 in this fixture | Archive |
| `medium-term-memory` | route | `dynamic` | 27 | Medium-term summary |
| `current-memory` | route LTM | `dynamic` | 39 | Long-term memory |
| `episodic-memory-retrieved-facts` | route | `dynamic` | 54 | Episodic facts |
| `relationship-meta` | route | `dynamic` | 26 | Relationship memo |
| `user-lorebook` | route | `dynamic` | 42 | User lore |
| `rule-output-layout-recency` | `webnovelOutputFormat.ts` | `dynamic` | 670 | Paragraph/dialogue layout |
| `user-persona-reference-owner` | `userPersonaReference.ts` | `dynamic` | 717 | Current name/gender wording |
| keyword lore + global lore | route blocks | user turn prefix, not a tracked system id | 93 together | Triggered lore |
| `current-user-turn` | `contextBuilder.ts` tail | user, uncached | 617 (`NORMAL`) / 1204 (`LIMITED`) | Wrapped user text, layout line, `USER_TAIL_LENGTH_OWNER_SENTENCE` |

Conditional sections, one each when the guard is true:

| ID | Guard |
| --- | --- |
| `openrouter-co-narration-rule` | auto progression, bucket `dynamic` |
| `scene-directive` | auto, simulation, party, or experiment pacing owner. Interactive standard omits it |
| `regenerate-divergence` | `regenerate === true`, bucket `dynamic` |
| `rule-user-input-parsing` | `[B]` markers / continue command parsing |
| `jsx-component-manifest` | non-empty JSX catalog, header `[HAV JSX COMPONENTS]` |
| `bilingual-dialogue` | creator bilingual policy |
| `state-window-policy` | legacy status-window note, and `statusWidgetActive` is false |
| `narrative-pov-owner` | room POV set |
| `rule-deepseek-length-adapter` | `SNPV2_DEEPSEEK_LENGTH_ARM=B\|C` only |
| `rule-unknown-information-truth-absolute-tail` | Muse canary only |

Builder-side local totals for the rich DeepSeek `NORMAL` fixture, before the flat fallback: rules `3535`, character `1702`, dynamic `1746`, user turn `617`, prior history `96`, `promptAudit.totalAssembledTokens` `7697`. After controls the system is one `7761`-character string. The flat fallback does not remove a large token block.

Adult mode changes the prose bundle inside `cacheCharacter` by a few local tokens (`1702` → `1698` on DeepSeek, `1518` → `1513` on Gemini). Empty memory drops the five memory section ids and lowers dynamic from `1746` to `1388`.

## OWNER MAP

| Responsibility | Canonical owner | Second text |
| --- | --- | --- |
| Numeric length `3,200+` | `USER_TAIL_LENGTH_OWNER_SENTENCE` on the user turn, once, last | System length section is empty. Count on system is `0` in every case |
| Scene motion, interactive | `[SCENE PACING]` from `sceneDirective.ts`, applied in `scenePacingController.ts` | `[SCENE FLOW]` in the prose bundle is replaced on this path |
| Scene motion, auto | `scene-directive` section | `[SCENE FLOW]` stays in the cached character block because `skipMotionCue` is true |
| User authoring, interactive `LIMITED` | `COLLABORATIVE_INTERACTIVE_OWNER_BLOCK` | Title count `1` |
| User authoring, interactive `NORMAL`/`ALLOW` | `buildUserCoauthorOwnerBlock` | Title string count `3`: the owner, the role line in `openRouterProsePolicy` / `corePrompt.ts`, and the identity preamble. The persistent-scope sentence appears once |
| User authoring, auto | `buildAutoProgressionUserControlBlock` | Scene directive says it does not widen `[B]` (`AUTO_PROGRESSION_SCENE_USER_CONTROL`, #1342) |
| Historical truth | `HISTORICAL_TRUTH_POLICY_BLOCK` | Evidence granularity owner is `sharedHistoryEvidence.ts` (#1303), used when writing/reading memory |
| Shared prose | `COMMON_PROSE_BLOCK` inside `prose-style-xml-bundle`, once | #1294 is the current wording. #1288 would change one sentence and is unmerged |
| Gemini 3.1 body/intent | `gemini31UserAgencyAdapter.ts` | Injected only when `godmoddingMode === "standard"`. On this fixture that is `LIMITED` (`agency` count `1`). Default `NORMAL` count is `0` |
| DeepSeek structure | XML flush for world lore and long-term memory | `<PERSONA>` was absent. `<CHAT_HISTORY>` in the debug log is a side format; live history is ordinary messages |
| Status widget values | post-turn extractor in `route.ts` | `statusWidgetPromptBlock` has no production reader |
| JSX catalog | `resolveJsxComponentPromptBlock` | Present only with a catalog |
| Output layout | system `rule-output-layout-recency` plus one compact line on the user tail | Recency pointer, same owner family |

## CONFIRMED DUPLICATES

These are repeated strings with a live path. They are not measured deletion savings.

1. Authoring title pointers. Exact string `[USER AUTHORING — EFFECTIVE COAUTHOR POLICY]` appears three times on interactive `NORMAL`: `no-godmodding`, the Korean role line (`corePrompt.ts` / OpenRouter top block), and the identity preamble (`corePrompt.ts`). The scope sentence `사용자가 유저 페르소나 공동 서술을 켜 두었다.` appears once. The extra two lines are pointers.
2. Quiet-scene development. `COMMON_PROSE_BLOCK` says `조용한 장면도 요약 없이 대화·내면·분위기로 전개한다.` The user-tail length sentence says `현재 상호작용을 요약하거나 성급히 닫지 말고, [AI_CAST]/NPC/환경의 관찰·심리·판단·행동·대화·감각 변화를 먼저 깊게 전개한다.` Both are on the default wire. The signature duplicate heuristic scored `0` on this fixture because the strings are not the same signature. Overlap is semantic. Estimated removable tokens were not established.
3. Layout. Full `[OUTPUT LAYOUT]` in dynamic system (`670` local tokens) plus one short line on the user turn. The short line is a recency pointer to the same owner.

## CONFIRMED CONFLICTS

1. Cache structure versus server controls, default `NORMAL`. Fragments: triple newline inside the coauthor rules block, and `[SCENE FLOW]` → `[SCENE PACING]` in the character block. Guard: `reprojectControlledTextOntoStructuredContent()` falls back when the diff is not inside one block. Result: the provider system is one string. Claude then caches that whole string and may add a history breakpoint.
2. `[SCENE PACING]` inside a cached character block on `LIMITED`/`ALLOW`, where the split survives. The cue is turn-variant (`MICRO` / `ADVANCE` / NPC contract). A changed cue invalidates character-prefix cache even when canon and prose are unchanged.
3. Gemini 3.1 agency supplement versus the default authoring owner. The adapter comment says it supplements `[USER CONTROL — COLLABORATIVE INTERACTIVE]`. `shouldInjectGemini31UserAgencySupplement` requires `godmoddingMode === "standard"`. Default `NORMAL` uses `currentTurnDelegated`, so the supplement is absent on the default path. `LIMITED` still gets both the collaborative block and the supplement.
4. Auto keeps `[SCENE FLOW]` and also injects `scene-directive`. Interactive replaces flow with pacing and omits the full directive. The two modes use different motion owners on purpose (#1342). They are a mode switch, and they still leave `[SCENE FLOW]` live on auto beside the directive.

Length `3,200+` and `MICRO` pacing both fire on interactive turns. Length asks for depth without new `[B]` beats. Pacing limits new cast and events. The fixture shows both. That is overlapping pressure, and it is not a contradictory pair of owners.

## NOT-LIVE RULES

| Item | Evidence |
| --- | --- |
| OOC HTML system suffix | `streamOpenRouterAdult` appends `[OOC HTML MODE — THIS TURN]` to the system string. `buildOpenRouterMessages` uses `systemSplit` and ignores that string. Fixture `g31-ooc-html`: `oocHtmlReachedProviderSystem=false` |
| `statusWidgetPromptBlock` / `buildStatusWidgetPromptBlock` | Field exists on `ContextBuildInput`. No production reader. Widget values are extracted after the main reply |
| `applyStatusWidgetSystemPromptOverrides` | Called when the widget is on. Current prose has neither `STATE_WINDOW_POLICY_BLOCK` nor the retired `UI/Meta: FORBIDDEN...` sentence, so the split hash is unchanged (`g31-status-widget`) |
| `buildAdultSystemPrompt`, `trackOpenRouterOverlaySections` | No live `buildContext` caller |
| DeepSeek bottom style reminder | Absent on every selectable model in `commonProseBudget` and this matrix |
| System `rule-length-control` | Empty on the OpenRouter-compatible path, which is every selectable model |
| `geminiStaticDynamicMode` | Route passes `false` |
| `HTML_OUTPUT_OWNERSHIP_BLOCK` | Not a `pushSection`. It reaches the prompt only as triggered global lore |
| #1288 scene-clue sentence | Unmerged draft `73908e13`. Current main still has the #1294 body-channel sentence in `COMMON_PROSE_BLOCK` |

## TOKEN AND CACHE COST

Local estimates are not provider invoices.

Default DeepSeek `NORMAL` rich fixture, builder split: about `3535 + 1702` local tokens sit in the two ephemeral blocks before controls, and `1746 + 617 + 96` sit outside them. After controls those two breakpoints are gone on non-Claude, so the cacheable prefix on the wire is `0` for that turn. Claude's wire marks the entire flat system (`7472` characters on the Gemini-equivalent fixture, one block) plus a history breakpoint. Because the flat system includes dynamic memory, that Claude cache key changes when memory or the pacing cue changes.

`LIMITED` keeps the split. Character block still contains `[SCENE PACING]`, so block 2 is turn-variant. Rules block (`3857` local tokens on DeepSeek `LIMITED`) can stay stable across turns that do not change authoring level, persona, or user note. Persona body and the user note live in `identity-and-rules` inside `cacheRules`, so a persona edit invalidates breakpoint 1.

Stable layout text (`670`) and the persona-reference template (`717`) sit in the uncached dynamic block on purpose for the reference owner. Moving the stable layout block would change cache boundaries and would not reduce raw input tokens.

Adult versus safe changes a few local tokens inside `cacheCharacter`. That is a real prefix change on turns that toggle adult mode.

No percentage savings is claimed. Restoring the `NORMAL` split without changing bytes removes `0` input tokens and restores cache eligibility. Provider dollars depend on whether Cheaper Inference and OpenRouter honor `cache_control` for each model. This audit did not measure that.

## CLEANUP PRIORITIES

Recommended Phase B sequence. One concern per later PR. This audit does not implement them.

1. **Text-preserving cache reproject fix.** Keep the post-control system bytes and restore the three-block `cache_control` split on default `NORMAL`. Today the collapse is caused by a rules-block newline collapse plus a character-block `[SCENE FLOW]` replace. Proof before merge: byte-compare the flat system with the rejoined blocks. Expected raw-token change: `0`. Expected cache effect: non-Claude can send two ephemeral prefixes again; Claude stops caching the dynamic suffix as part of one blob. Quality risk is low only if the bytes stay identical. If the newline collapse itself is removed, that is a separate text change and needs a read of a few scenes.
2. **Gemini 3.1 agency scope, decision only.** Default `NORMAL` does not receive `[USER AGENCY — GEMINI 3.1 BODY/INTENT BOUNDARY]`. `LIMITED` does. Extending the supplement onto the coauthor owner changes user-agency text. Options: leave `LIMITED`-only, or append the same two sentences under `currentTurnDelegated`. This audit stops before that edit.
3. **OOC HTML suffix delivery, decision only.** The suffix is built and then dropped whenever `systemSplit` is set, which is the live Main RP path. Putting it on the dynamic block would change HTML turns. Options: wire it into `dynamicBlock` for that turn, or delete the dead append. This audit stops before that edit.

Not recommended as the first deletion: merging the quiet-scene sentence, the authoring title pointers, or the layout recency line. The default fixture's duplicate heuristic is `0`. The auto heuristic `717` is an upper bound, not a removable section.

`#1288` remains a separate unmerged draft. It edits the same `COMMON_PROSE_BLOCK` sentence `#1294` already changed. This PR does not touch that branch.

## REGRESSION RISKS

- A cache-only fix that also changes newlines or moves `[SCENE PACING]` will change model-visible text. Keep that out of the first PR.
- Moving user-authoring or safety text between cache buckets can change what the model weights. Persona, adult prose, and authoring blocks are behavior-bearing.
- Claude history breakpoints on the current flat system are an accidental consequence. Restoring the split removes that breakpoint whenever a dynamic suffix exists (`resolveHistoryCacheBreakpointIndex`). That matches the existing comment in `openRouterCache.ts`. Confirm with a fixture, still without a live call.
- Billing is untouched. Cache hits change provider cost, not the point formula, unless a later PR starts reading provider usage differently.

## PROOF

- `git diff --check` — clean.
- `npm run typecheck:app` — pass.
- `npm run build` — pass after a process-only `SESSION_SECRET` (the public CI dummy). The first attempt failed at page-data collection because the local shell had no `SESSION_SECRET`. That secret was not written into the repo.
- Related regression command, with `regularTestEgressPolicy` imported and concurrency 1: `mainRpFinalWireAudit.test.ts`, `contextBuilder.cacheBoundary.test.ts`, `contextBuilder.openRouterDedup.test.ts`, `openRouterCache.test.ts`, `openRouterCacheStability.test.ts`, `scenePacingController.test.ts`, `statusWidget/promptOverrides.test.ts`, `gemini31PromptOwnerPrefix.test.ts`, `commonProseBudget.test.ts`, `userAuthoringPolicy.test.ts`. Result: 106 pass, 1 fail.
- The failure is pre-existing on this baseline and is outside this diff. `scenePacingController.test.ts` “genre SCENE MODE strip for candidate” expects `[IMMERSIVE PROSE]`. `stripGenreSceneModePacingHint` on the fixture returns `[COMMON PROSE]`. This PR does not edit `scenePacingController.ts`.
- Final-wire lock alone: 9 pass.
- Inventory regenerated by `scripts/main-rp-final-wire-audit.ts` (no network).
- `scripts/audit-prompt-dedup-fixes.ts` and other provider-calling scripts were not executed.
- No paid model call. Local token figures stay `estimateTokens`. They are not provider usage.

## UNCERTAINTIES

- Whether OpenRouter Gemini and Cheaper Inference DeepSeek/GPT actually honor Anthropic `cache_control`. The body contains the fields. Dollars are unmeasured.
- Railway scene mode and other server flags were not read. This audit uses the code path on `main`. If production sets `SNPV2_DEEPSEEK_LENGTH_ARM` or prose rollout env vars, those sections appear. The fixture forces those env vars unset.
- Interactive `NORMAL` collapse depends on a triple newline inside the current coauthor block. A future wording edit that removes that newline would silently restore the split and put `[SCENE PACING]` back into the cached character block.

## FOLLOW-UP

GPT reviews this audit and chooses the first cleanup PR. This draft does not merge itself and does not edit other open drafts, including #1288.

1. Text-preserving cache reproject for default interactive `NORMAL`. Expected raw-token change `0`. Quality risk stays low only if the provider-visible bytes stay identical.
2. Gemini 3.1 agency scope is a product decision. Extending it onto default `NORMAL` changes user-agency text. Stop before that edit.
3. OOC HTML suffix delivery is a product decision. Wiring it into `dynamicBlock`, or deleting the dead append, changes HTML turns or removes dead code. Stop before that edit.

Leave quiet-scene wording, authoring title pointers, and the layout recency line out of the first deletion. `#1288` stays a separate unmerged draft against the already-merged #1294 sentence.

## STOP

No production prompt text was changed. The next edit touches either cache structure, user-agency text, or OOC HTML delivery.

# NORMAL cache-boundary restore

Refs #1357, #1355, #1353. No production prompt sentence was edited.
Local tokens are `estimateTokens` = `ceil(chars * 0.9)`. Provider cache hits and dollars were not measured.

## BEFORE

On `origin/main` `41d619e1` the reproject owner is the same function as audit baseline `386b23dc`. `src/lib/openRouterAdult.ts`, `src/lib/scenePacingController.ts`, `src/lib/openRouterCache.ts`, and `src/services/contextBuilder.ts` have no diff between those commits. The only chat-route change is the adult gate: `canAccessAdultContent` is existing-admin only. That gate decides who may set adult mode. It does not change prompt bytes for a given `adultModeEnabled`.

Default interactive `NORMAL` reached the provider as one uncached system string on non-Claude models. Claude wrapped that string, including dynamic memory, as one ephemeral block and added a history breakpoint. `LIMITED`, `ALLOW`, and auto already kept three blocks.

Pre-fix flat system sha256, captured before this patch:

| Case | Flat sha256 | Shape |
| --- | --- | --- |
| `ds-interactive-normal-rich` | `ca412fccdcc8a7115021b6e7c46e983ccad2d1c374b28c0bbe26050ea1c98f4a` | 1 block, 7761 chars, uncached |
| `ds-adult-normal` | `2c3cd7334845ae60211b442e621c69b23fd024623f8a5930ffb55dfc22f01f86` | 1 block, uncached |
| `ds-regen-normal` | `311b58849a342accf443706b63b046b46cc1d78b83f90959370dddefdc99322b` | 1 block, uncached |
| `g31-interactive-normal-rich` and `opus-interactive-long-history` | `6b5495a133574c36b6bce7ae02e0901584660ab95343ec632fafac9e2678dbf6` | Gemini uncached; Claude cached the whole string and set a history breakpoint |

## REPRO

`runMainRpFinalWireAudit()` on the pre-patch code reproduced the single-block `NORMAL` wire for every selectable Main RP model. The same fixture after the patch keeps those flat sha256 values.

## ROOT CAUSE

`applyProductionServerControlsToMessages` flattens the system, then does two edits:

1. `stripGenreSceneModePacingHint` collapses `\n{3,}` inside the coauthor rules block.
2. Interactive turns replace `[SCENE FLOW]` inside the character block.

`reprojectControlledTextOntoStructuredContent` treated the whole distance between the first and last edit as one span. That span crossed the `\n\n` block separator, so the function returned the flat string and dropped `cache_control`. This is not a `buildContext` bug and not a provider-transport bug.

The global newline collapse was left in place. Removing it would change provider-visible bytes.

## OWNER MAP

| Responsibility | Owner |
| --- | --- |
| Server-control text | `applyProductionServerControlsToMessages` in `src/lib/scenePacingController.ts` |
| Structured reproject | `reprojectControlledTextOntoStructuredContent` in `src/lib/openRouterAdult.ts` |
| Which blocks start with `cache_control` | `buildOpenRouterCachedSystemContent` in `src/lib/openRouterCache.ts` |
| Claude history breakpoint | `resolveHistoryCacheBreakpointIndex` |

## AFTER

Every audited fixture, including default `NORMAL`, adult, regen, auto, `LIMITED`, and `ALLOW`, sends three system blocks: cached, cached, uncached. History `cache_control` is absent. Dynamic memory stays in the uncached third block.

Default DeepSeek `NORMAL` block chars: rules `3925` cached, character `1893` cached, dynamic `1939` uncached. Joined length is `3925 + 1893 + 1939 + 4 = 7761`, the pre-fix flat length. Flat sha256 is unchanged.

Rules-block sha256 is the same for interactive `NORMAL`, adult `NORMAL`, and regen `NORMAL` (`18b684a089de…`). Dynamic sha256 matches between safe and adult (`75956784b3a4…`) and differs on regen. Adult changes the character block (`1893` → `1888` chars). A synthetic second turn with `triggeredEventText` changes the character `[SCENE PACING]` text and the dynamic memory text while the rules block stays byte-identical.

`LIMITED` block hashes are unchanged from the pre-fix three-block wire.

Claude Opus interactive `NORMAL` no longer caches the flat system and no longer adds a history breakpoint, because the uncached dynamic suffix is present. `hasMutableSystemSuffixAfterCachedPrefix` already defined that rule.

## REMOVED

The single-span reproject is gone. One multi-hunk reproject covers an edit inside one block and several edits in different blocks. The flat-string fallback remains when an edit touches a block separator or the round-trip does not match `afterFlat`.

## PRESERVED

Model id, reasoning, temperature, provider route, service tier, message order, user-authoring text, safety prose, memory text, canon, and the point formula. OOC HTML still does not reach the provider system on the split path. No new prompt sentence.

## TOKEN & CACHE DELTA

Estimated input tokens for the default DeepSeek `NORMAL` fixture are unchanged: rules `3535`, character `1702`, dynamic `1746`, user turn `617`, `promptAudit` total `7697`. Flat system bytes are unchanged, so the `estimateTokens` delta of the provider-visible system string is `0`.

Cache markers after the patch: two ephemeral prefixes and one uncached dynamic suffix. The character prefix contains `[SCENE PACING]`. On this fixture that text matches `LIMITED`, and it changes when adult prose or the pacing cue changes. It is not a stable canon prefix. Provider cache hits, write fees, and savings are **UNKNOWN**. OpenRouter and Cheaper Inference support for these `cache_control` markers was not probed.

## REGRESSION RISKS

- A later edit that removes the rules-block triple newline changes bytes and is outside this patch.
- The character block stays marked ephemeral while it holds turn-variant pacing. Isolating that span without changing text would require a different join than `flattenOpenRouterMessageContent`. That is a follow-up, not this patch.
- Separator-crossing edits still flatten. Production split blocks are trimmed, so the default `NORMAL` newline is interior to the rules block.

## PROOF

- `git diff --check` clean.
- `npm run typecheck:app` pass.
- `npm run build` pass with a process-only CI `SESSION_SECRET`. The secret was not committed.
- `src/lib/mainRpFinalWireAudit.test.ts`, `src/lib/openRouterAdult.compatibleUsage.test.ts`, `src/lib/openRouterCache.test.ts`, `src/lib/openRouterCacheStability.test.ts`: pass. The final-wire lock now requires three blocks and the pre-fix flat sha256.
- `src/services/contextBuilder.cacheBoundary.test.ts`, `src/services/contextBuilder.openRouterDedup.test.ts`, `src/lib/openRouterClient.test.ts`: pass.
- No paid model call. `scripts/audit-prompt-dedup-fixes.ts` was not run.

## FOLLOW-UP

Character-block `[SCENE PACING]` remains inside an ephemeral block. Moving it out changes text or the join protocol. Gemini 3.1 agency scope and the OOC HTML suffix stay out of this PR.

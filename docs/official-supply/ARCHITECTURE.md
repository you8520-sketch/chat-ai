# Official Character Supply Pipeline

Scope: pure official character production (SFW + 19+) up to **private staging**.
Out of scope: publishing, site-managed account / creator-CP foundation, TRPG, background-only images,
social/ads automation, post-launch weekly automation, simulation bulk supply, LLM text-author adapter.

Code: `src/lib/officialSupply/` · Tests: `officialSupply.qa.test.ts`, `officialSupply.pipeline.test.ts`.

## Flow and gates

```
research snapshot ─► style candidates (3-5 / genre, DNA only, no paid calls)
   └─ STYLE_CANDIDATE_APPROVAL  (store.approveStyleCandidate: candidate + owned/licensed seed + reviewer)
draft ─► TEXT_LOCK (store.lockText) ─► APPEARANCE_LOCK (store.lockAppearance) ─► asset plan (store.lockAssetPlan)
   └─ proof characters only, ≤ proofAssetLimit paid slots, anchor first
   └─ STYLE_PROOF_APPROVAL      (store.decideStyleProof → style_locked | rejected)
representative 2:3 anchor ─► canonical moderation (moderateOfficialAssetSlot) ─► ANCHOR_APPROVAL (store.reviewAnchor: moderation verdict + 10-point QA, reviewer)
   ─► 13 RP 3:2 slots (per-slot generate + moderate + reviewVariation) ─► assets_complete ─► markQaPassed
   ─► stageOfficialCharacterPrivately (canonical createCharacterFromForm, visibility=private, official=0)
```

Every paid call goes through `runOfficialAssetSlot`, which first calls
`store.assertGenerationAllowed` (stage, text-lock hash, appearance-lock hash, anchor approval,
style stage, proof quota, seed) — the provider is never reached when a gate fails.

| Gate | Enforced in |
| --- | --- |
| STYLE_CANDIDATE_APPROVAL | `approveStyleCandidate` + `assertGenerationAllowed` (`style_candidate_not_approved`) |
| STYLE_PROOF_APPROVAL | `decideStyleProof` + `assertGenerationAllowed` (`style_not_locked`, `style_proof_quota`, `style_rejected`) |
| TEXT_LOCK | `lockText` (pipeline QA + canonical `parseCharacterFormBody` dry run) + text-lock hash check |
| APPEARANCE_LOCK | `lockAppearance` + per-asset `appearance_lock_hash` check |
| ANCHOR_APPROVAL | `reviewAnchor` (moderation verdict first, then visual QA) + `assertGenerationAllowed` (`anchor_not_approved`) |

## Image formats

| Asset | Profile | Size | Use |
| --- | --- | --- | --- |
| Representative ×1 | `official_character_representative` | 1024×1536 (2:3) | `assets[0]` → card/profile/entry portrait |
| Signature ×4, Emotion ×6 | `official_character_rp` | 1536×1024 (3:2) | inline RP (`isWideInlineAsset`) |
| Special scene ×3 | `official_character_rp` | 1536×1024 (3:2) | inline RP, character mandatory |

Both are native provider sizes with the exact product ratio and are requested exactly. Only an exact
native-size result is accepted; any other size fails that slot and it is regenerated (never resized,
stretched or cropped, to protect identity). Chat LD (800×1200), comic and TRPG size owners are untouched.

## Owner map (reused, not duplicated)

| Concern | Canonical owner |
| --- | --- |
| Character create / validation ceiling | `createCharacterFromForm` / `parseCharacterFormBody` (`characterFormSave.ts`) |
| Genres | `CHARACTER_GENRES` (`characterGenres.ts`) |
| Assets, tags, representative | `normalizeCharacterAssets`, `normalizeCreatorAssetTag`, `getCharacterRepresentativeImageUrl` (assets[0]) |
| Inline vs portrait | `isWideInlineAsset` / `findAssetByTagStable` (`characterAssets.ts`) |
| Person tag taxonomy (hint only) | `ASSET_PERSON_TAGS` (`assetPersonTags.ts`) |
| Visibility / listing | `decideCharacterListing`, `listableWhere`, `canAccessCharacter` |
| Appearance | `[외형]` block → `extractAppearanceRawFromSetting` → `appearance_raw/compiled`; hash `hashAppearanceRaw` |
| Lorebook | `insertCreatorLorebookForOwner` (extracted from `/api/lorebooks`), attach via canonical save + `CHARACTER_CREATOR_LOREBOOK_ATTACH_LIMIT` |
| Image model | `resolveChatImageGenerationModel()` via `resolveOfficialAssetImageModel()` (no constant, no own env) |
| Provider transport + safety fallback | `callOpenAiImageEditWithSafetyFallback` |
| Text author (world/character bible → draft) | `generateOfficialWorldBible` / `generateOfficialCharacterBible` + `compileOfficialDraftFromBible` (`officialSupply/author.ts`, `bible.ts`, `authorPrompts.ts`) — canonical background-text transport (`callBackgroundMemory`), background-primary model resolver, `json_object` structured output, platform-funded ledger. No user billing/points, no creator rewards, no chat semantics, no image calls |
| Gender lock / safety text | `buildImageGenderLockPrompt`, `buildIllustrationSafeDepiction`, `STRICT_SAFE_DEPICTION` |
| Upload storage | `storeUpload` |
| Asset moderation | `analyzeAssetImage` (+ `recordVisionCostAttempts`) via `visionOfficialAssetModerator`; one decision owner `officialModerationVerdict` for representative and RP |
| Platform cost | `recordBackgroundProviderCost` (`platform_funded`, cost center `image`) |

## Adult owner map

| Concern | Owner |
| --- | --- |
| NSFW classification | `characters.nsfw` via canonical save |
| Participant age | `participant_min_age`, `validateNsfwParticipantAgeContract`, `ADULT_SCENE_MIN_AGE = 19` |
| Adult status | `deriveAdultStatusFromParticipantMinAge` (in `parseCharacterFormBody`) |
| Dialogue profile / consent modes | `normalizeAdultDialogueProfile`, `AdultConsentMode` (`standard`/`power_play`/`cnc_opt_in`) — read by `/api/chat` |
| Adult listing text | `characterAdultTextBlob` + `findAdultTermsInText` (`allAgesListingBlockReason`) |
| Viewer adult verification | `character/[id]/page.tsx` and `/api/chat` (`nsfw && !user.is_adult`) — no `official` input |
| Image depiction / safety | canonical safety text; `adult_grounded_non_explicit` is a per-slot opt-in allowed only for confirmed-adult sheets, independent of `nsfw` |

## Moderation

Every generated asset (representative included, SFW and 19+ alike) is moderated through the canonical
asset-vision owner and the result is stored on the asset row. `officialModerationVerdict` decides:
`rejected` → slot rejected (for the representative: no `anchor_approved`, so no RP generation and no
staging); `unavailable` / not yet run → review refused (`moderation_unavailable` / `moderation_missing`),
never treated as clean; `adult_flagged` → approvable, recorded as `adultFlagged` so the canonical listing
owner routes it to admin review. The creator upload path is unchanged.

## Research collection

`isCollectionMethodAllowed(policy, method)`: `manual_curated` is always allowed; `automated` only when the
source is `allows_automation`. Permission never forces automation.

## Why the user-paid image job owner is not reused

`settleChatImageGeneration` deducts user points, credits creator rewards (`creditChatRoomImageCreatorReward`)
and requires chat/persona linkage. Official supply is platform-funded: it reuses model resolver, transport,
safety, storage and the cost ledger, but keeps its own durable job rows (`official_supply_assets`).

## Private staging safety

`official=1` short-circuits `listableWhere` and `canAccessCharacter`, and boot migration
publishes rows with `official=1 OR creator_id IS NULL`. Staged rows are therefore created with
`official=0`, `visibility=private`, owned by a real adult-verified staging account; the stager verifies
this after save. Publishing / site-managed account is a follow-up.

## Durability / idempotency

- `official_supply_*` tables are additive (`CREATE TABLE IF NOT EXISTS`).
- Atomic slot claim with lease (double click, duplicate job, concurrent worker → one call; expired lease reclaimable).
- Spend recorded right after the provider returns; paid results are spooled before upload
  (`upload_pending` retries upload only).
- `generated`/`approved` slots are never re-sent. Failed/rejected slots retry alone, capped by `maxAttemptsPerSlot`.
- Budget hierarchy (batch / genre / world / character) checked before each call with a per-image reserve;
  exceeding any cap pauses the batch.
- Text edit after lock → stage `draft`, all assets `stale`; staging refuses stale assets.
- Residual: a worker that crashes after the provider returns but before `recordSpend` can cause one
  repeat charge on lease expiry (no provider-side idempotency key on the edits endpoint).

## Cleanup audit

| Item | Verdict |
| --- | --- |
| Duplicate image model resolver | none found — KEEP `resolveChatImageGenerationModel` |
| `ILLUSTRATION_SAFETY_LEGACY` re-export (no readers) | FOLLOW-UP (unrelated to this feature) |
| `ILLUSTRATION_SAFE_DEPICTION` (read by `chatImageSafeVisualProjection`) | KEEP |
| Old official generation prototype / dead auto-generation route | none found |
| Inline lorebook INSERT in `/api/lorebooks` | integrated into `insertCreatorLorebookForOwner` (behavior preserved) |
| Reference loaders duplicated in comic route / vision | FOLLOW-UP consolidation (not touched) |

## Follow-ups (not in this PR)

- Site-managed official account + creator CP/earnings exclusion, publish step — DONE in #1082.
- Pilot content (romance-fantasy world ×1 + 10 characters + style board) — DONE in `pilot/` + `docs/official-supply/pilot-romance-fantasy-01.md`; awaiting human style selection.
- Operator CLI / admin review UI, AI quality scoring, bulk review.
- Zero-reference first anchor: the canonical transport is `/v1/images/edits` (≥1 reference), so the first
  anchor uses the approved owned/licensed style seed. Adding a generation endpoint is a provider-owner decision.
- 800-character bulk execution (rollout caps are batch config: e.g. 5 worlds/50 → 20/200 → 800).

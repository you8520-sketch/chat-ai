# Wolfgang Cluster B v4 — 13 RP image PREP (NO_POST)

GPT KEEP of existing `pilot-rf-v4-02/rep` stands. This note is investigation only.

**Do not regenerate the kept representative. Do not call an image provider. Do not write production DB. Do not stage, publish, or merge.**

Cursor does not score image aesthetics. GPT visual KEEP remains 86/100 on the existing v4 bytes.

## Scope

Follow-up to [PR #1522 comment 6105267100](https://github.com/you8520-sketch/chat-ai/pull/1522#issuecomment-6105267100).

| Gate | This turn |
|---|---|
| Paid image POST | 0 |
| Production DB write | 0 |
| `reviewAnchor` | not called |
| 13-slot generation | not started |
| Publish / merge | 0 |

## OWNER MAP

| Responsibility | Live owner | Not an owner |
|---|---|---|
| Approved 14-slot copy (repo) | `src/lib/officialSupply/pilot/characters/pilot-rf-02.json` `assetPlan` after #1510 `2cae5c7c` | Cluster B proof script (asserts equality, does not patch a locked row) |
| Appearance Lock hash | `computeAppearanceLockHash` → `hashAppearanceRaw(renderAppearanceBlock(lock))` | Cursor visual judgment |
| Shot / camera / face / crop | `OFFICIAL_SLOT_SHOT_PLAN` + `resolveOfficialSlotShot` | Slot tag/expression strings |
| Cluster B variation refs | `resolveOfficialGenerationReferencePlan` → `variation_identity_then_style` | New Wolfgang reference helper |
| Identity reuse | Image 1 = existing `representativeAsset` URL; Image 2 = Cluster B primary b7 STYLE ONLY | Regenerating the kept face |
| Representative generation | `representative_style_only` (b7/b13/b5). `runOfficialAssetSlot` returns `already_generated` on generated/approved | `official-supply:cluster-b-v4-style-proof` (3 characters) |
| ANCHOR_APPROVAL | `OfficialSupplyStore.reviewAnchor` + operator `scripts/official-supply-approve-anchor.ts` | HTTP admin route (none). `inPlaceSync` (published character fields only) |
| Moderation before review | `moderateOfficialAssetSlot` / `officialModerationVerdict`. Missing/unavailable throws; clean and adult_flagged may pass | Reviewer QA inventing moderation |
| RP generation after approval | `runOfficialAssetSlot` + `assertGenerationAllowed` (`anchor_not_approved` until stage `anchor_approved`) | Lucian `official-supply:generate-lucian-variations` (hardcoded `pilot-rf-v4-03`) |
| Production budget after style lock | `promoteBatchConfigAfterStyleLock(proof → ROFAN_V4_PRODUCTION_BATCH_CONFIG)` | Proof batch limits as a 13-slot ceiling |
| Locked plan rewrite | **None.** `lockAssetPlan` only at `appearance_locked` and `DELETE`s all slot rows | `updateDraft` (stales every asset including the kept rep) |
| Read-only inspect | `better-sqlite3` `{ readonly: true }` + `PRAGMA query_only=ON`. Never `new OfficialSupplyStore()` (constructor runs DDL) | Local `data/app.db` (no official tables; not production) |

## BEFORE / PROBLEM / AFTER

### BEFORE (facts)

**Repo / deploy**

| Item | Value |
|---|---|
| `origin/main` | `5a89690ce0e85f39d2934d0d8a4c8c57b829a136` |
| Public `hav.chat` `/api/health` `gitCommit` | `5a89690` (matches main) |
| #1502 GPT public copy | merged (`ae93d30b`) |
| #1510 asset-plan alignment | merged (`2cae5c7c`) |
| #1522 existing-rep archive | merged (`715e30ff`) |
| Current-main Appearance Lock hash | `1c3ccd134203a6dea6ae869c27cc443c42ff5498d1d0130c6f9765407c24dcc3` |
| Current-main text lock hash (`computeTextLockHash`; draftKey/styleKey excluded) | `6ff02833cfd45a542866aa1afa749486d94362eff5358e10f995b8f77fabd5fd` |
| Public copy lengths | tagline 37 / detailed 1299 / greeting 1547 |
| Current fixture `evaluateAssetPlan` | ok; warnings only `non_scene_location` on sig1–sig4 |
| Current fixture stale needles (`수갑` / `압송` / `차가운 심문` / `봉인 상자 앞의 심문` / `character_plus_required_partner` / `partnerRole` / `플레이어와 함께`) | none |
| Kept v4 original | `docs/official-supply/reviews/assets/wolfgang-existing-cluster-b-v4-rep.webp` SHA-256 `a66c49d4d947209206b70a284c99f2e26ef868934ed5426818042c29ba3a45f1` |
| Public kept URL | `https://hav.chat/uploads/official-pilot-rf-v4-02__rep-a1.webp` — this turn HEAD 200 `image/webp` |

**Last successful production read** (prior turn in this Wolfgang thread; native SSH + `query_only`; production Git SHA then `f8bf8c82`). This turn did **not** re-read `/data/app.db` (ssh-agent empty; Railway CLI SSH waits on the encrypted `hav-windows` identity; BatchMode offered no key). `official_supply_*` is not rewritten by a Git merge, so the unread field is the locked JSON snapshot, not the fixture.

| Live `pilot-rf-v4-02` (last read) | Value |
|---|---|
| style / batch | `romance_fantasy_v4` `style_locked` / `pilot-romance-fantasy-04-cluster-b` `active` |
| stage | `asset_plan_locked` |
| `is_style_proof` | 1 |
| `rep` status | `generated` (not stale / rejected / upload_pending) |
| `rep` attempts / lease | 1 / none |
| model | `gpt-image-2.5-sunburst` |
| size | 1024×1536 WebP |
| moderation | `checked`; `adultFlagged=false`; `moderationReject=false` |
| spent_usd | 0.055989 |
| appearance lock (character = asset) | `1c3ccd13…7c24dcc3` (**matches current-main fixture**) |
| sibling slots with `attempts>0` | 1 (`rep` only) |
| `asset_plan_json` / `draft_json` / `text_lock_hash` / batch `config_json` | **not dumped** |

Live v1 `pilot-rf-02` remains historical: appearance `bdd8770e…9ae5e7ab` ≠ current fixture. GPT REJECT for current use.

### PROBLEM

1. **Locked `asset_plan_json` is not auto-updated by #1510.** `lockAssetPlan` is one-shot at `appearance_locked` and then stores a copy. `scripts/official-supply-cluster-b-v4-style-proof.ts` `ensureCharacter` only locks when stage is still `appearance_locked`; once `asset_plan_locked` it `assertSame`s fixture vs stored plan and **throws**. It never patches.
2. **No safe existing sync owner** can rewrite the 13 non-rep slot texts while keeping the generated v4 `rep` row. `updateDraft` on a text change resets stage to `draft`, clears appearance/plan, and marks **all** assets `stale` — that would break GPT KEEP. `inPlaceSync` updates published `characters` fields, not official-supply plans.
3. **This-turn live `asset_plan_json` is unread.** High-confidence inference, not a substitute dump: the v4 row was already generated and still `asset_plan_locked` with an appearance hash that matches the current fixture, so the row was never reset after first lock. #1510 changed emo1 / emo5 / scene1–3 **after** that lock path existed. If the live snapshot predates #1510, generation would still paint detention/handcuff/`character_plus_required_partner` copy.
4. **ANCHOR_APPROVAL is a production mutation** even when it keeps the same bytes. `reviewAnchor` writes `official_supply_assets.status` `generated` → `approved` and `official_supply_characters.stage` → `anchor_approved`. 13 RP slots cannot start before that (`anchor_not_approved`).
5. **There is no Wolfgang-only 13-slot operator.** Lucian variations is `pilot-rf-v4-03` only and snapshots other v4 rows. Cluster B proof is 01/02/09 `rep` only. Quality-shot QA is Lucian sig4. Do not reuse those live flags.
6. **Shared v4 batch config is unread.** If still `PILOT_CLUSTER_B_PROOF_BATCH_CONFIG` (`reservePerImageUsd=1`, `perCharacter=1`, `maxAttemptsPerSlot=1`), a 13-slot run hard-stops after the first reserved image and would also pause the shared Cluster B batch. Promotion to `ROFAN_V4_PRODUCTION_BATCH_CONFIG` is a batch-row write (Lucian owner already has this), not an image POST, and still needs a separate approve.

### AFTER (prep only — no execution)

Repo canon for the next 13 slots, **if and only if** live `asset_plan_json` is proven byte-equal to current-main `pilot-rf-02.json` `assetPlan`:

- Reuse kept identity: Image 1 = `https://hav.chat/uploads/official-pilot-rf-v4-02__rep-a1.webp` (or the stored `/uploads/official-pilot-rf-v4-02__rep-a1.webp`). Image 2 = Cluster B primary b7 STYLE ONLY.
- Do not send the kept face through `representative_style_only` again.
- All 14 current-main slots are `solo_character` / `backgroundExtras: none`. No user body, handcuffs, or escort.
- Shot QA for `draftKey=pilot-rf-v4-02` passes with **zero repeated** `face+framing+expression` combos. `resolveCanonicalOfficialDraftKey` aliases only Lucian `pilot-rf-v4-03` → `pilot-rf-03`; Wolfgang v4 therefore rotates on `pilot-rf-v4-02`, which is a different board than v1 `pilot-rf-02` (all 13 non-rep combos differ). That is existing shot-seed behavior, not a new owner.
- `computeTextLockHash` ignores `draftKey`/`styleKey`, so a v4 remapped draft hashes the same as `pilot-rf-02` **if** the stored `draft_json` body matches current-main compile. Live `draft_json` vs `text_lock_hash` is unread this turn. `assertGenerationAllowed` / later QA will throw `text_lock_stale` if they diverge. `reviewAnchor` itself does **not** re-check text lock.

No code or data-plan remediation is in this PR. A new locked-plan patch owner would be a separate sensitive change.

## 13-slot diversity (current-main approved plan, seed `pilot-rf-v4-02`)

Structural QA: `evaluateOfficialShotPlan` ok. One bust (`rep` only). Three scene locations, all distinct. Cursor does not score whether the pixels will look varied.

| Slot | Tag | personTag | Shot (face / camera / distance / expressionFamily / bg) |
|---|---|---|---|
| sig1 | 철혈의 지휘관 | 진지함 | front / eye_level / knee_or_full / smile / environment |
| sig2 | 흉터의 맹세 | 의심 | left_three_quarter / eye_level / medium / serious / simple |
| sig3 | 봉인고의 열쇠 | 진지함 | right_three_quarter / low_angle / knee_or_full / tense / environment |
| sig4 | 절제된 온기 | 미소 | profile / high_angle / close_up / alert / simple |
| emo1 | 기록의 모순 | 의심 | right_three_quarter / low_angle / medium / relief / simple |
| emo2 | 분노의 억제 | 분노 | left_three_quarter / low_angle / close_up / smile / simple |
| emo3 | 증거 앞의 판단 | 진지함 | right_three_quarter / high_angle / medium / alert / environment |
| emo4 | 뜻밖의 동요 | 당황 | profile / eye_level / knee_or_full / serious / environment |
| emo5 | 경계의 완화 | 진지함 | front / high_angle / close_up / annoyed / simple |
| emo6 | 귀환의 안도 | 미소 | left_three_quarter / eye_level / knee_or_full / flustered / environment |
| scene1 | 위조된 명령서의 밤 | 의심 | profile / low_angle / knee_or_full / tease / scene |
| scene2 | 봉인된 장부의 빈칸 | 진지함 | left_three_quarter / eye_level / medium / tense / scene |
| scene3 | 황실의 마지막 압박 | 긴장 | right_three_quarter / high_angle / knee_or_full / alert / scene |

Facts for GPT (not scores): slot copy and `expressionFamily` can disagree after v4-02 rotation (e.g. emo1 copy is suspicion, family is `relief`; emo2 copy is anger, family is `smile`; scene1 copy is withheld judgment, family is `tease`). Camera/distance/face still differ across the 13. `personTag` repeats: 진지함×5, 의심×3, 미소×2.

## How to approve the existing v4 rep without replacement

Canonical method: `store.reviewAnchor("pilot-rf-v4-02", OfficialAnchorQaReport, reviewer)`.

It does **not** create a new image. It **does** mutate production:

1. Requires `stage === asset_plan_locked`, `rep.status === generated`, non-empty reviewer.
2. Runs `moderationGate` on the **already stored** moderation. Last read is `clean`, so this step should pass without a new vision POST **if** `moderation_json` is still that checked row. Missing/unavailable throws and leaves the slot `generated`.
3. If QA all `ok: true` and moderation passes: `rep` → `approved` (writes `qa_json`); character → `anchor_approved` + `anchor_approved_by`.
4. Failed QA or hard-reject moderation: `rep` → `rejected` (retry-anchor path). Do not call if there is any chance of accidental reject.

Operator: `scripts/official-supply-approve-anchor.ts` with `OFFICIAL_ANCHOR_APPROVAL_LIVE=1`, `OFFICIAL_ANCHOR_DRAFT_KEY=pilot-rf-v4-02`, `OFFICIAL_ANCHOR_REVIEW_DECISION=approve`. Extra operator gates: style `style_locked`, appearance hash match, 1024×1536, no non-rep `attempts>0`. Last read satisfies those.

**Prod env last documented in #1513:** `OFFICIAL_ANCHOR_APPROVAL_LIVE=0`, `OFFICIAL_ANCHOR_DRAFT_KEY=pilot-rf-v4-03` (Lucian). Do not flip the Lucian key or the 3-character proof flags. This method is **not authorized this turn**.

`OfficialSupplyStore` constructor runs `ensureOfficialSupplySchema` (DDL). Do not instantiate it for read-only inspect.

## Follow-on 13-image cost / call envelope (planning only)

Model owner: `resolveOfficialAssetImageModel` → production `OPENAI_IMAGE_MODEL=gpt-image-2.5-sunburst`. Quality: `medium`. RP profile: 1536×1024 (3:2). Exact USD is null until usage (`calculateGptImage2CostUsd`).

One `runOfficialAssetSlot` = claim + `transport.generate` 1×. `callOpenAiImageEditWithSafetyFallback` = primary 1 POST, plus 1 strict-safety fallback POST only on a recognized safety rejection. `upload_pending` replay does not add a provider POST. Already-generated slots return `already_generated` (0 POST) — the kept `rep` stays in that bucket.

| Envelope | Value | Meaning |
|---|---|---|
| Authorized this turn | 0 POST | — |
| First-pass 13 slots, no slot retry | 13 POST, or 14–26 if some safety fallbacks | Request this bound separately, not the nested ceiling |
| `maxAttemptsPerSlot` × `MAX_PROVIDER_ATTEMPTS` if production config | 2 × 2 = 4 POST/slot; 52 POST nested | **Not** an authorization |
| Production reserve | `$0.12` / image | Internal reserve, not a provider hard cap |
| 13 × reserve | `$1.56` | First-pass planning |
| 13 × reserve × 2 | `$3.12` | Exceeds `perCharacter $2.50` if every slot used two reserved attempts |
| Production character cap | `$2.50` | Shared with already-spent `0.055989` on the kept rep |
| Production batch / genre / world | `$20` each | Shared Cluster B v4 batch, not Wolfgang-only |
| Proof batch (if not promoted) | reserve `$1`, character `$1`, batch `$3`, `maxAttemptsPerSlot=1` | **Cannot** fund 13 images; first extra reserve pauses the whole batch |
| Closest observed | Lucian sig4 1-ref `$0.030653`; Wolfgang v4 rep 3-ref `$0.055989` | Different size/ref count; not a 13-slot quote |

Identity path for each of the 13: existing v4 URL + b7. Do not invent a new prompt owner.

## Options if live `asset_plan_json` is stale (STOP — do not pick here)

A. **New narrowly scoped official-supply owner** that updates only `asset_plan_json` slot copy for non-`rep` keys, leaves `rep` status/url/bytes/appearance hash/attempts untouched, does not change stage, and is default-off. Does not exist. Needs GPT/user review before any code.

B. **`updateDraft` / relock** — marks the kept v4 `rep` `stale`. Incompatible with KEEP.

C. **Re-run Cluster B proof / `lockAssetPlan`** — 3-character live flag, or `DELETE` of all assets. Forbidden.

D. **Ad-hoc production SQL** — no owner. Forbidden.

Do not implement A–D in this PR.

## Recommended next approvals (separate, in order)

1. Re-unlock WSL `ssh-agent` and re-read live `draft_json`, `text_lock_hash`, `asset_plan_json` (emo1/emo5/scene1–3 + `imageSubjects`), all 14 slot rows, and batch `config_json`. `query_only` only. No `OfficialSupplyStore`.
2. If the live plan ≠ #1510 fixture: choose option A or stop. Do not generate.
3. If the live plan matches and text lock is current: separately approve `reviewAnchor` for `pilot-rf-v4-02` (DB write, 0 image POST).
4. If the batch is still proof config: separately approve `promoteBatchConfigAfterStyleLock` on `pilot-romance-fantasy-04-cluster-b` only.
5. Separately approve a Wolfgang-only 13-slot operator (or 13× `runOfficialAssetSlot`) with an explicit POST cap. Do not enable Lucian/3-character live flags.

## STOP

No paid image generation. No production mutation. No publish. No merge. No aesthetic score.

Preserved hashes: appearance `1c3ccd13…7c24dcc3`; kept v4 WebP `a66c49d4…3a45f1` (see #1522 archive). Live plan JSON still needs a fresh read before any later gate.

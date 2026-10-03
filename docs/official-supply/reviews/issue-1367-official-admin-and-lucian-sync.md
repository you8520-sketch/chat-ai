# Issue #1367 — official admin management and in-place Lucian refresh

## Reproduce

```bash
npm run test:regular -- src/lib/officialCharacterAdmin.1367.test.ts src/lib/officialStudioFoundation.test.ts
npm run official-supply:review-character -- pilot-rf-03 docs/official-supply/reviews/pilot-rf-03-lucian.md
```

Live production SQL was **not executed**. Use the approved read-only query below on Railway `enchanting-ambition` / `chat-ai` `/data/app.db` after GPT review if a human can attach SSH.

## Investigation

Earlier PR base / prior live deploy SHA: `11e9e96aa729922d05249695f36a1e3c699aaba0`.
Main at GPT re-review: `9e0c65576cf1de4f7190c71196670028386c60ce`. This patch syncs to the then-current `origin/main` after the runtime-canon fix.
Earlier inspected Draft HEAD: `6f937a946485473221e1c132e5d677b6d6e686d3`.
GPT MUST FIX 1–5 HEAD: `31b0d7978056c3f328a406228d3695327a1590e9`.
GPT runtime-canon review HEAD: `ef6b285ea4e9895e0e684c14aa76ea8a25de9cfd`.
Final exact HEAD after this patch is reported in the PR body after push. This file does not embed its own commit SHA.
Railway project `enchanting-ambition`, service `chat-ai`, volume `chat-ai-volume` mounted at `/data`.
This environment has a project `RAILWAY_TOKEN` that can list services and deployments. It cannot register SSH keys or run `file:/data/app.db?mode=ro`. Injected `RAILWAY_SSH_*` values are placeholders (11 bytes). No production DB mutation was attempted.

### Evidence classes

1. Compiled-only: local compiler, isolated SQLite fixtures, and source assertions in this PR.
2. Read-only live SQLite preflight: still unavailable. The generic SQL below is not a substitute for the exact live Lucian row, 12 lorebook bodies, shared other-character references, or nondefault settings.
3. Deployed / apply verification: not performed. `OFFICIAL_IN_PLACE_APPLY_ENABLED` stays default-off. No Railway write.

### Public live evidence (not SQL)

`GET https://hav.chat/search?q=루시안` RSC payload, 2026-10-03:

| Field | Live public value |
| --- | --- |
| Character id | `50` (`/character/50`) |
| Name | `루시안 바스케스` |
| Card tagline | `금고털이 경보 속, 당신의 손목을 잡고 달아난 브로커.` |
| Display creator | `로맨스 공식 스튜디오 · 공식 스튜디오` |
| Creator profile | `/creator/108` |
| Official badge | `공식` plus the extra suffix |
| Representative asset | `/uploads/official-pilot-rf-v4-03__rep-a1.webp` |
| Search hits | 1 |

Compiled #1196 / current main source tagline:

`금고 경보 속, 비밀 장부를 든 브로커와 당신은 같은 탈출로에 갇혔다.`

Git source is new. The live public card is still the wrist-grab tagline. That is the BUGFIX proof: deploy SHA equals main, but the published row was never rewritten.

### Why the live row stayed old

`stageOfficialCharacterPrivately` returns `already_staged` when `stagedCharacterId` exists and does not rewrite prompt, assets, or lorebooks.
`ensureWorldLorebooks` returns existing `(worldKey, entryKey, creatorId)` ids without updating content.
`publishOfficialSupplyCharacter` only toggles `official/public/approved` and is idempotent. It does not sync compiled source.
PR #1196 merged compiler source only. No in-place owner existed.

SQL fields still unread: `system_prompt` hash, `official_supply_characters` row, 12 lorebook attachments, `users.site_managed` for creator 108, chat/notification counts. Do not guess those values.

## BEFORE / AFTER owner map

| Role | Before (main) | After (this PR) |
| --- | --- | --- |
| Admin operator | `is_admin` / `ADMIN_EMAILS`. Cannot list or edit official rows. | Same identity. Operator only: list/edit/sync official rows. Not the payout beneficiary. |
| Official owner | `users.site_managed=1`, `is_admin=0`, unusable password. Staging/publish require this owner. | Unchanged. Prefer the single existing site-managed account. No per-genre login. |
| Public creator alias | `characters.creator_name` written as the logged-in nickname. Clients cannot set it, but neither can admin. | Same column. Admin-only normalize/write. Lucian default `로맨스 공식계정`. Ordinary create/update/PATCH reject alias keys. |
| Create | `createCharacterFromForm` as staging user. | Unchanged ordinary path. Admin does not create a second Lucian. |
| Ongoing official edit | Owner check + hard deny `official=1` on GET/PUT/PATCH and `/create?edit=`. | Ordinary deny unchanged. Admin reuses `/create?edit=` plus `/api/characters/[id]` GET/PUT with `resolveOfficialCharacterEditorAccess`. PUT saves as the site-managed owner via `updateCharacterFromForm(..., { actor: "official_admin", preserveListingState, preserveAdultFlags, skipFollowerNotify })`. |
| Published sync | None. `already_staged` / `already_published`. | Dedicated guarded field update on the same `characters.id`. Dry-run is `PRAGMA query_only=ON`. Apply is default-off (`OFFICIAL_IN_PLACE_APPLY_ENABLED=1`) plus a revalidated preflight snapshot. Lucian requires `official_supply_characters` `draft_key=pilot-rf-03` ↔ staged id. No follower notify. |
| Compiler / lorebook | `compileOfficialDraftFromBible` + `resolveOfficialCharacterLorebooks` (shared key wins). | Same owners. `compact_rp_v1` uses `renderRuntimeAppearanceBlock`. Lorebook+character+chunks+supply JSON share one SQLite transaction. Identical shared bodies are skipped. |
| Card / detail / profile | Card: `공식` badge + `by {creator_name} · 공식 스튜디오`. Detail: `OfficialStudioBadge`. Profile: `공식 스튜디오` + badge. | Card suffix removed. One `공식` badge + `by {alias}`. Detail/profile keep studio badge on the official collection page, not a second card byline. |
| Rewards | `isCreatorMonetizationEligible` is site-managed only. | Unchanged. Do not move official ownership onto the admin account. |

## SYSTEM DELTA

Added / kept:

- `src/lib/officialDisplayCreatorName.ts`
- `src/lib/officialAdminAccess.ts` — list/alias without constructing `OfficialSupplyStore` (no list-time DDL)
- `src/lib/officialSupply/compiledOfficialSource.ts` — compact appearance for `compact_rp_v1`
- `src/lib/officialSupply/inPlaceSync.ts` — dedicated canonical-field update, lorebook plan, apply gate, query-only dry-run
- admin page `/admin/official-characters` and admin APIs
- `/api/characters/[id]` GET/PUT official-admin editor reuse
- `updateCreatorLorebookForOwner`
- official-admin options on `updateCharacterFromForm`

Removed remnant:

- `CharacterCard` `studioSuffix = " · 공식 스튜디오"`
- In-place sync through sparse `updateCharacterFromForm`
- Dry-run / admin list `new OfficialSupplyStore(db)` constructors

Preserved:

- Ordinary creator edit, NSFW/adult gates, lorebook attach owner, listing visibility, site-managed payout exclusion, PR #1322 secret-delivery work, administrator personal CP accrual / #1322

Not done in this PR (needs GPT + live SQL/SSH):

- Production apply against Railway `/data/app.db`
- Merge
- Accounting follow-up for operator CP accrual (issue comment; out of scope)

## GPT MUST FIX 1–5 at HEAD `31b0d797`

Reproduced in source before this patch, then fixed on the same Draft.

| ID | Before (31b0d797) | After |
| --- | --- | --- |
| 1 | Sparse `buildOfficialCharacterFormBody` → `updateCharacterFromForm` rewrote widget/JSX/style/comments/assets defaults | Dedicated UPDATE of tagline/description/greeting/system_prompt/world/creator_comment/example_dialog/tags/genres/creator_name + chunks. CAS on assets, widget, JSX, style, narration, comments, appearance, likes, chats, listing, nsfw, owner |
| 2 | `renderAppearanceBlock` in compiled RP `system_prompt` | Same #1196 owner: `compact_rp_v1` → `renderRuntimeAppearanceBlock` / `composeOfficialSystemPrompt` |
| 3 | All lorebooks written before character save; shared rewrite could leak | Diff first, skip identical shared, one transaction; injected post-lorebook failure rolls back |
| 4 | Same-name site-managed row without mapping accepted; dry-run ran DDL; apply had no env/snapshot gate | Lucian mapping required; dry-run query-only; apply default-off + revalidated snapshot |
| 5 | Admin UI alias+sync only; `/api/characters/[id]` still denied official | Admin uses existing `/create?edit=` editor via GET/PUT official-admin access |

BEFORE/AFTER fixtures live in `src/lib/officialCharacterAdmin.1367.test.ts`.

## Approved read-only SQL (no email / secrets / PII)

```sql
PRAGMA query_only=ON;

SELECT id, name, substr(tagline,1,80) AS tagline,
       creator_id, creator_name, official, visibility, moderation_status, nsfw,
       length(system_prompt) AS prompt_chars, updated_at
FROM characters
WHERE name LIKE '루시안%' OR id=50;

SELECT draft_key, stage, staged_character_id, length(draft_json) AS draft_chars, updated_at
FROM official_supply_characters
WHERE draft_key='pilot-rf-03' OR staged_character_id=50;

SELECT world_key, entry_key, creator_id, lorebook_id
FROM official_supply_world_lorebooks
WHERE world_key LIKE '%aether%' OR creator_id IN (
  SELECT creator_id FROM characters WHERE id=50
);

SELECT character_id, lorebook_id, position
FROM character_lorebook_attachments
WHERE character_id=50
ORDER BY position;

SELECT COUNT(*) AS site_managed_accounts
FROM users
WHERE site_managed=1;

SELECT official, visibility, COUNT(*) AS n
FROM characters
GROUP BY official, visibility;
```

## Canonical OWNER MAP (runtime)

| Responsibility | Owner reused |
| --- | --- |
| Official compile | `compileOfficialDraftFromBible` + `composeOfficialSystemPrompt` + `renderRuntimeAppearanceBlock` |
| Creator compiled description | `buildCompiledCreatorDescriptionForSave` |
| Canon plan / LOCKED_SECRET | `buildCanonPlanJsonForSave` |
| Appearance overlay | `replaceAppearanceInSetting` + `resolveAppearancePromptText` (same as `loadCharacterChunks`) |
| Chunk persist | `buildAndSaveCharacterChunks(..., { safeRuntimeCanon })` |
| Chunk reload | `loadCharacterChunks` / `loadCharacterChunksReadOnly` → `resolveSafeRuntimeCanon` |
| Shared lorebook | existing `keyword_lorebooks` + `official_supply_world_lorebooks`; identical skip; content-changing sibling links STOP |
| Derived cache | `enqueueCharacterDerivedRefreshJob` inside the write transaction; `kickDerivedCacheWorker` after commit |

## BEFORE / AFTER / REMOVED / PRESERVED / RISKS / PROOF

- BEFORE (`ef6b285e`): dedicated UPDATE wrote `system_prompt`/`setting_chunks` but left old `creator_compiled_description_json`. `loadCharacterChunks` preferred that stale compiled public canon and overwrote new chunks. Shared lorebook `action=update` still mutated sibling-linked bodies.
- AFTER: same transaction also writes `creator_raw_description` / compiled JSON / canon plan via the existing form compilers, rebuilds chunks from the appearance-aware safe-runtime-canon, and enqueues derived refresh. Shared lorebook content changes with live siblings fail closed.
- REMOVED: chunk rebuild from raw `system_prompt`/`world` that `loadCharacterChunks` can ignore; implicit shared-lorebook rewrite of sibling-linked entries.
- PRESERVED: Lucian id, 14 assets, likes/chats, widget/JSX/style/comments/appearance, compact #1196 prompt, LOCKED_SECRET owner, apply default-off, #1322, admin CP accounting.
- RISKS: live Lucian compiled-JSON / 12 lorebook bodies / sibling links are still unread. If production shared lorebooks differ and are attached to other characters, apply must STOP until those siblings are reviewed.
- PROOF: isolated before/after fixtures in `officialCharacterAdmin.1367.test.ts`. No Railway SQL. No apply.

## Classification

`ROOT_CAUSE_FIXED` for the missing in-place owner, duplicate card suffix, and the `ef6b285e` stale compiled-runtime regression — in isolated tests only.

Live SQL prompt/lorebook/supply/compiled-JSON rows: `ROOT_CAUSE_CONFIRMED` from code + public card, **not applied** to production.

GPT MUST FIX 1–5 plus runtime-canon / shared-lorebook gates: `ROOT_CAUSE_FIXED` in isolated tests only.

## Follow-up / remaining live checks

- Human Railway SSH / workspace token so the approved SQL can be executed without downloading the DB.
- Before any apply: confirm live `creator_compiled_description_json`, `creator_canon_plan_json`, `official_supply_characters` mapping, 8 shared + 4 local lorebook bodies, and whether those shared IDs attach to other characters.
- Operator CP accrual vs finance margin (issue #1367 comment) — do not fold into this PR.
- Draft PR #1322 character-secret delivery remains separate.

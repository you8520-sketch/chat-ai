# Issue #1367 — official admin management and in-place Lucian refresh

## Reproduce

```bash
npm run test:regular -- src/lib/officialCharacterAdmin.1367.test.ts src/lib/officialStudioFoundation.test.ts
npm run official-supply:review-character -- pilot-rf-03 docs/official-supply/reviews/pilot-rf-03-lucian.md
```

Live production SQL was **not executed**. Use the approved read-only query below on Railway `enchanting-ambition` / `chat-ai` `/data/app.db` after GPT review if a human can attach SSH.

## Investigation

Pinned main / live deploy SHA: `11e9e96aa729922d05249695f36a1e3c699aaba0`.
Railway project `enchanting-ambition`, service `chat-ai`, volume `chat-ai-volume` mounted at `/data`.
This environment has a project `RAILWAY_TOKEN` that can list services and deployments. It cannot register SSH keys or run `file:/data/app.db?mode=ro`. Injected `RAILWAY_SSH_*` values are placeholders (11 bytes). No production DB mutation was attempted.

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
| Ongoing official edit | Owner check + hard deny `official=1` on GET/PUT/PATCH and `/create?edit=`. | Ordinary path unchanged. New `updateCharacterFromForm(..., { actor: "official_admin" })` requires admin + site-managed owner identity. |
| Published sync | None. `already_staged` / `already_published`. | `syncOfficialCharacterInPlace` dry-run/apply. Same `characters.id`. No follower notify. Preserves listing, official, assets, adult flags. |
| Compiler / lorebook | `compileOfficialDraftFromBible` + `resolveOfficialCharacterLorebooks` (shared key wins). | Reused. Sync updates existing lorebook bodies and inserts missing keys such as `mercator_internal_dealings`. |
| Card / detail / profile | Card: `공식` badge + `by {creator_name} · 공식 스튜디오`. Detail: `OfficialStudioBadge`. Profile: `공식 스튜디오` + badge. | Card suffix removed. One `공식` badge + `by {alias}`. Detail/profile keep studio badge on the official collection page, not a second card byline. |
| Rewards | `isCreatorMonetizationEligible` is site-managed only. | Unchanged. Do not move official ownership onto the admin account. |

## SYSTEM DELTA

Added:

- `src/lib/officialDisplayCreatorName.ts`
- `src/lib/officialAdminAccess.ts`
- `src/lib/officialSupply/compiledOfficialSource.ts`
- `src/lib/officialSupply/inPlaceSync.ts`
- admin page `/admin/official-characters` and admin APIs
- `updateCreatorLorebookForOwner`
- official-admin options on `updateCharacterFromForm`

Removed remnant:

- `CharacterCard` `studioSuffix = " · 공식 스튜디오"`

Preserved:

- Ordinary creator edit, NSFW/adult gates, lorebook attach owner, listing visibility, site-managed payout exclusion, PR #1322 secret-delivery work

Not done in this PR (needs GPT + live SQL/SSH):

- Production apply against Railway `/data/app.db`
- Merge
- Accounting follow-up for operator CP accrual (issue comment; out of scope)

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

## Classification

`ROOT_CAUSE_FIXED` for the missing in-place owner and duplicate card suffix, with live public proof that Lucian id 50 is still the old tagline.

Live SQL prompt/lorebook/supply rows: `ROOT_CAUSE_CONFIRMED` from code + public card, **not applied** to production.

## Follow-up

- Human Railway SSH / workspace token so the approved SQL can be executed without downloading the DB.
- Operator CP accrual vs finance margin (issue #1367 comment) — do not fold into this PR.
- Draft PR #1322 character-secret delivery remains separate.

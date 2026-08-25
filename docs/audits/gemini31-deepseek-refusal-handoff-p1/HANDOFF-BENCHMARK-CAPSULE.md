# Handoff benchmark capsule (Issue 2 mid-chat blocker follow-up)

Audit-only infrastructure to export/import **prompt-relevant** character and
admin-owned persona data from a production DB **copy** into an isolated local
benchmark database. No handoff/routing/provider behavior changes.

## Step 1 — Admin ownership vs persona prompt

```
ADMIN_STATUS_AFFECTS_PERSONA_PROMPT = false
```

Traced in production code:

| Check | Affects persona RP prompt text? | Where used |
| --- | --- | --- |
| `users.is_admin` | **No** | Adult handoff admin canary, billing receipt visibility |
| `ADMIN_EMAILS` | **No** | Same via `isAdminUser()` |
| `persona.user_id` | **Lookup only** | `getPersonaSecretPayload(userId, personaId)` — ownership key, not admin flag |
| `isPersonaSecretBoundaryEnabled({ userId })` | **No** | `void userId`; env `PERSONA_SECRET_BOUNDARY_ENABLED` only |
| `isPersonaSecretDiscoveryEnabled({ userId })` | **No** | Same pattern; env kill switch only |

Persona prompt assembly (`src/app/api/chat/route.ts`):

- `formatPublicPersonaForPrompt(name, gender, publicDescription, coNarrationOpts)` — **name, gender, description** (+ runtime co-narration flags from chat mode, not account identity)
- `getPersonaSecretPayload(user.id, personaId)` — **secret_description** when boundary ON
- `user.nickname` — fallback display name + `{user}` placeholder replacement in character chunks (exported as `benchmark_user_context.nickname`, not admin email/id)

**Conclusion:** Rebind imported persona to a disposable local benchmark user while preserving all persona prompt fields and matching `benchmark_user_context`.

## Step 2 — Allowlists (from live loaders)

### `CHARACTER_PROMPT_FIELDS`

Used by `loadCharacterChunksForPrompt()` + `buildContext()` input in `src/app/api/chat/route.ts`:

- `name`, `gender`, `description`, `greeting`
- `system_prompt`, `world`, `example_dialog`
- `setting_chunks`, `setting_chunks_en`, `prompt_translation_hash`
- `speech_profile`, `creator_compiled_description_json`
- `appearance_raw`, `appearance_compiled`
- `creator_raw_description`, `creator_canon_plan_json`
- `genres`, `assets`
- `content_kind`, `simulation_cast`
- `adult_dialogue_profile`, `adult_status`, `participant_min_age`, `adult_consent_modes_json`
- `status_widget_json`, `status_window_prompt`, `status_widget_allow_user_override`
- `lorebook_id` (+ `keyword_lorebook.entries_json` when referenced)
- `nsfw` (listing/adult-mode gate; included for faithful routing context)

**Not included** (not read on main chat prompt path): `tagline`, `tags`, `genre` (legacy singular), `images`, stats, moderation notes, share slugs, simulation import metadata, etc.

### `PERSONA_PROMPT_FIELDS`

- `name`, `gender`, `description` (public; legacy markers stripped at runtime via `toPublicPersonaDescription`)
- `secret_description` (boundary path via `getPersonaSecretPayload`)

**Not included:** `memo`, `speech_examples`, `image_url`, `image_focus_*` (not used on main RP chat persona path).

### `BENCHMARK_USER_CONTEXT_FIELDS`

- `nickname` — chunk placeholder + persona display name fallback
- `is_adult` — adult eligibility routing (not persona text)

## Step 3 — Export (read-only)

Script: `scripts/audits/export-handoff-benchmark-capsule.mjs`

**Never commit** the real capsule JSON.

### Safety checks

1. Opens `SOURCE_DB_PATH` **read-only**
2. Character must satisfy `listableWhere()` (`src/lib/characterVisibility.ts`)
3. Persona owner must resolve as admin via `isAdminUser(is_admin | ADMIN_EMAILS)`
4. Exports allowlisted fields only + SHA-256 provenance hashes
5. **Excludes:** email, passwords, sessions, points, billing, chats, messages, other users/personas

### Production export command (mounted DB copy)

```bash
SOURCE_DB_PATH=/path/to/mounted/production-app.db \
SOURCE_CHARACTER_ID=<listable_character_id> \
SOURCE_PERSONA_ID=<admin_persona_id> \
# optional when multiple admins:
# SOURCE_ADMIN_USER_ID=<admin_user_id> \
# when is_admin=0 but listed in ADMIN_EMAILS:
# ADMIN_EMAILS=ops@example.com \
OUTPUT_PATH=./handoff-benchmark-capsule.json \
npx tsx scripts/audits/export-handoff-benchmark-capsule.mjs
```

Resolve IDs on the copy (read-only), e.g.:

```bash
sqlite3 "$SOURCE_DB_PATH" "
  SELECT id, name, official, visibility, moderation_status, creator_id
  FROM characters
  WHERE official=1 OR (visibility='public' AND moderation_status='approved' AND creator_id IS NOT NULL)
  LIMIT 20;
"
sqlite3 "$SOURCE_DB_PATH" "
  SELECT p.id, p.user_id, p.name, u.is_admin
  FROM user_personas p JOIN users u ON u.id = p.user_id
  WHERE u.is_admin = 1
  LIMIT 20;
"
```

## Step 4 — Import (isolated DB)

Script: `scripts/audits/import-handoff-benchmark-capsule.mjs`

```bash
CAPSULE_PATH=./handoff-benchmark-capsule.json \
TARGET_DATA_DIR=./data/handoff-benchmark-import \
npx tsx scripts/audits/import-handoff-benchmark-capsule.mjs
```

Creates disposable user `handoff-benchmark-capsule@local.invalid` (not from production).

### Provenance verification flags

After import, the script prints:

- `REAL_CHARACTER_PROMPT_DATA_EXACT` — `CHARACTER_PROMPT_SOURCE_SHA == CHARACTER_PROMPT_IMPORTED_SHA`
- `REAL_ADMIN_PERSONA_PROMPT_DATA_EXACT` — persona SHA match after SQLite round-trip

Normalization: sorted-key JSON of allowlisted fields after `normalizeSqlValue()` (null/int/string coercions matching SQLite storage).

**Do not run the 3-turn provider benchmark until both flags are `true` and a human authorizes.**

## Tests (synthetic data only)

```bash
npx tsx scripts/audits/handoff-benchmark-capsule.test.mjs
```

## Gitignore

Runtime capsule artifacts:

- `handoff-benchmark-capsule.json`
- `data/handoff-benchmark-import/`
- `data/handoff-benchmark-capsule*.json`

## Explicit non-goals (this PR)

No changes to handoff owners, `contextBuilder` prompt behavior, refusal detector, or provider configuration. No provider/API calls.

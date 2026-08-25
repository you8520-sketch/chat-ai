# Handoff benchmark capsule (Issue 2 mid-chat blocker follow-up)

Audit-only infrastructure to export/import **prompt-relevant** character and
admin-owned persona data from a production DB **copy** into an isolated local
benchmark database. No handoff/routing/provider behavior changes.

Capsule schema version: **2** (`lorebook_id` is provenance-only).

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

### `CHARACTER_ROW_PROMPT_FIELDS`

Used by `loadCharacterChunksForPrompt()` + `buildContext()` input in `src/app/api/chat/route.ts`.
**Does not include `lorebook_id`.** Prompt semantics come from resolved keyword lorebook content.

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
- `nsfw` (listing/adult-mode gate; included for faithful routing context)

**Resolved separately (hashed with the character row, never as numeric FK):**

- `keyword_lorebook.entries_json`

`source_lorebook_id` may appear in **provenance metadata only**. It must not determine `REAL_CHARACTER_PROMPT_DATA_EXACT`.

**Not included** (not read on main chat prompt path): `tagline`, `tags`, `genre` (legacy singular), `images`, stats, moderation notes, share slugs, simulation import metadata, `recommended_writing_style` (UI hint only).

### `PERSONA_PROMPT_FIELDS`

- `name`, `gender`, `description` (public; legacy markers stripped at runtime via `toPublicPersonaDescription`)
- `secret_description` (boundary path via `getPersonaSecretPayload`)

**Not included:** `memo`, `speech_examples`, `image_url`, `image_focus_*` (not used on main RP chat persona path).

### `BENCHMARK_USER_CONTEXT_FIELDS`

- `nickname` — chunk placeholder + persona display name fallback
- `is_adult` — adult eligibility routing (not persona text)

These participate in the import success gate.

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
Keyword lorebook content is inserted as a **new** row; the remapped `lorebook_id` is a local FK only.

### Provenance verification flags

After import, the script prints and requires **all three**:

- `REAL_CHARACTER_PROMPT_DATA_EXACT` — character row fields + resolved lorebook content SHA
- `REAL_ADMIN_PERSONA_PROMPT_DATA_EXACT` — persona SHA after SQLite round-trip
- `BENCHMARK_USER_CONTEXT_EXACT` — `nickname` + `is_adult` SHA

`report.ok` and process exit require:

```
REAL_CHARACTER_PROMPT_DATA_EXACT
&& REAL_ADMIN_PERSONA_PROMPT_DATA_EXACT
&& BENCHMARK_USER_CONTEXT_EXACT
```

Normalization: sorted-key JSON of `CHARACTER_ROW_PROMPT_FIELDS` plus `keyword_lorebook_entries_json` after `normalizeSqlValue()`. `lorebook_id` is excluded.

**Do not run the 3-turn provider benchmark until all three flags are `true` and a human authorizes.**

## Tests (synthetic data only)

```bash
npx tsx scripts/audits/handoff-benchmark-capsule.test.mjs
```

Required assertions:

- `SOURCE_LOREBOOK_ID != IMPORTED_LOREBOOK_ID`
- `REAL_CHARACTER_PROMPT_DATA_EXACT=true`
- `REAL_ADMIN_PERSONA_PROMPT_DATA_EXACT=true`
- `BENCHMARK_USER_CONTEXT_EXACT=true`
- Negative fidelity: mutated character / persona / user-context fields each fail import

## Gitignore

Runtime capsule artifacts:

- `handoff-benchmark-capsule.json`
- `data/handoff-benchmark-import/`
- `data/handoff-benchmark-capsule*.json`

## Step 3 — DB-backed prompt dependency closure (new-chat / normal RP)

Scope: first disposable chat on current production `POST /api/chat` after capsule import. No existing chats/messages.

| SOURCE | DB TABLE / FIELD | PROMPT_AFFECTING | AVAILABLE_FROM_CODE_DEFAULT | MUST_COPY_FOR_THIS_BENCHMARK | REASON |
| --- | --- | --- | --- | --- | --- |
| Character row | `characters` allowlisted columns | true | n/a | true | Core RP setting / chunks / adult routing fields |
| Keyword lorebook content | `keyword_lorebooks.entries_json` via remapped FK | true | empty / no lorebook | true if source `lorebook_id` set | Keyword block is prompt text; numeric id is not |
| Selected persona | `user_personas` allowlisted columns | true | n/a | true | Public + secret persona prompt |
| User nickname / adult | `users.nickname`, `users.is_adult` | true | nickname fallback / `is_adult=0` | true | Placeholders + adult eligibility |
| Global lorebook | `global_lorebook_entries` | true only on trigger match (typically HTML output) | true — `seedGlobalLorebookEntries()` writes platform HTML entry on migrate | false | Isolated DB already seeds the same platform HTML entry. Custom production extras fire only if T-turn text matches; T1/T2/T3 style-handoff RP should not request HTML. Do not copy site-wide custom rows. |
| Account user note | `users.user_note` (fallback when chat note empty) | true | empty string | false | Admin notes can be private instruction text. New-chat harness should send empty `userNote` and leave local `user_note` empty so comparison is character+persona+code. |
| Chat prefs length | `users.chat_prefs.targetResponseChars` | true (length aim) | `DEFAULT_TARGET_RESPONSE_CHARS` = 3200 (`normalizeTargetResponseChars` always 3200) | false | Code default already unifies length; copying prefs does not change the 3200 owner. |
| Chat prefs novel mode | `users.chat_prefs.novelModeEnabled` | true (co-narration / auto-continue) | false | false | Style-handoff T1/T2 are normal RP; keep novel mode off. |
| Selected model | `users.selected_ai` | true (model adapters) | `DEFAULT_SELECTED_AI` = CheaperInference DeepSeek V4 Pro | false as source copy | **LOCAL-HARNESS:** set Gemini 3.1 Pro Preview for the planned run. Do not copy production admin model. |
| Listing nsfw toggle | `users.nsfw_on` | false for `/api/chat` prompt | 0 | false | Comment in route: listing visibility only. Chat adult gate is `is_adult` + request `isAdultMode` / chat mode. |
| Audience pref | `users.pref` | false | null | false | Home listing filter only. |
| Subscription / memory tier | `users.sub_*` → `resolveMemoryTier` | empty memory on new chat | free / empty injection | false | New disposable chat has no memory rows to inject. |
| Memory / summaries | `chat_memories`, rolling summary tables | true only with history | empty | false | New chat; no source chats copied. |
| Keyword lorebook activation state | `lorebook_active_entries` | true after prior matches | empty | false | Chat-scoped; new chat starts clean. |
| Status widget triggers | `status_widget_triggers` (character-scoped `chat_id IS NULL`) | true only after widget values exist | empty events | false | First-turn prompt loads queued events for this chat (empty). Triggers evaluate after status values exist, not from identity alone. |
| Status trigger events | `status_trigger_events` | true when queued | empty | false | New chat. |
| Persona secret reveals / discovery | reveal + knowledge tables | true after disclosure | empty; secret text already in persona | false | New chat has no reveals. `secret_description` is already copied. |
| Canaries (Terra / RP diagnostic / living scene) | env allowlists + `userId` | true if env ON + allowlisted | fail-closed OFF | false | Default env off. Do not copy production user id. |
| Admin canary | `users.is_admin` | routing canary, not persona text | 0 | false | Already proven not to change persona prompt text. Keep imported user non-admin. |
| Creator compiled extras | already in character allowlist | true | n/a | already copied | `creator_*`, appearance, speech_profile. |
| `recommended_writing_style` | `characters.recommended_writing_style` | false | `balanced` | false | Chat page UI hint; not passed to `buildContext`. |
| `speech_personality` / `speech_traits` | not DB columns | false unless derived | undefined | false | Route forwards undefined; speech comes from `speech_profile` + chunks. |
| Points / billing | `users.points`, `point_logs` | false (gate only) | 0 | false | Execution gate (`MIN_POINTS_TO_CHAT=80`), not prompt text. LOCAL-HARNESS. |
| Sessions / password | `sessions`, `users.pw_hash` | false | n/a | false | Auth only. Never copy production secrets. |

**Closure decision:** do not add more production/global rows to the capsule for this T1/T2/T3 style-handoff comparison. Isolated migrate already supplies the platform global HTML lorebook. Leave account notes, prefs, model, points, and chats out.

## Step 4 — Benchmark execution readiness (local harness only)

Do **not** put production credentials, billing, or session data in the capsule.

### A. SOURCE-FIDELITY STATE (must match production because it affects prompt/semantics)

| State | Source | Notes |
| --- | --- | --- |
| Character prompt fields + lorebook **content** | capsule | Already imported |
| Persona prompt fields | capsule | Rebound to local user |
| `nickname` | `benchmark_user_context` | Placeholder / display name |
| `is_adult` | `benchmark_user_context` | Adult character + adult-mode eligibility |

### B. LOCAL-HARNESS STATE (synthetic; enables `/api/chat` only)

| Need | Production source? | Local mechanism |
| --- | --- | --- |
| Authentication | **No** — do not copy email/password/session | Reuse existing Phase-1 `POST /api/auth/signup` (or `POST /api/auth/demo-login` in demo/dev) against `DATA_DIR` of the isolated DB. Then bind/import persona to that local user, **or** set a local password hash after signup. Importer's current `handoff-benchmark-capsule@local.invalid` + `benchmark-capsule-no-login` is **not** a login-capable account. |
| Points | **No** — not prompt semantics | Signup credits `SIGNUP_BONUS_POINTS` (2000) via `creditPoints`. `MIN_POINTS_TO_CHAT` is 80. Do not copy production balances. |
| Adult visibility / nsfw mode | `is_adult` is fidelity; `nsfw_on` is listing-only | Keep capsule `is_adult`. For listing, optionally set local `nsfw_on=1`. Chat request should send `isAdultMode` / chat `mode=nsfw` as the operational adult-handoff gate. |
| Selected model | **No** — do not copy admin `selected_ai` | After local login, set `users.selected_ai` to `gemini-3.1-pro-preview` (`CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL`) via existing picker/`setUserSelectedAI`. Code default is DeepSeek V4 Pro — wrong for the planned Gemini→DeepSeek handoff run. |
| Selected persona ownership | persona already rebound | Request `selectedPersonaId` = imported persona id owned by the logged-in local user. |
| User note / novel mode | leave empty / false | Do not import production `user_note` or `novelModeEnabled`. |

**Preferred future runner path (not implemented in this PR):**

1. Start isolated app with `DATA_DIR=./data/handoff-benchmark-import`
2. `POST /api/auth/signup` with a disposable local email/password (or demo-login in dev)
3. Import/rebind capsule persona + character onto that user (nickname/`is_adult` from capsule)
4. Set `selected_ai` to Gemini 3.1 Pro Preview
5. Confirm `REAL_*` + `BENCHMARK_USER_CONTEXT_EXACT` are true
6. Only then request authorization for the 3-turn provider run

No provider calls in this PR.

## Explicit non-goals (this PR)

No changes to handoff owners, `contextBuilder` prompt behavior, refusal detector, or provider configuration. No provider/API calls. No real production capsule committed.

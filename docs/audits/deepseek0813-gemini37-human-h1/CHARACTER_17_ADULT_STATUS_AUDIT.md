# Character 17 `adult_status` provenance audit (read-only)

No DB mutations. Audit only.

## Current state

| Field | Value |
|-------|-------|
| `characters.id` | 17 |
| `characters.name` | 플러드 (서강우) |
| `adult_status` | **`unknown`** |
| `nsfw` | 1 |
| `creator_id` | 1 (local H1 fixture) |

## 1. What canonical/current-age evidence establishes character 17 as adult?

**None in participant-identity fields used for eligibility.**

After `buildCharacterParticipantIdentityDescription()` (adult_status + description only):

- No `나이: N세` / `현재 N살` in description
- No `ADULT_SIGNAL` match (no `19세+`, `성인`, `대학생`, `직장인`, etc. in identity text)
- `assessParticipantAdultStatus()` → **`unknown`**

Separate flags **not** equivalent to confirmed participant adult:

- `nsfw=1` → enables adult **content** policy gate only (`characterAdultContentEnabled`)
- Profession text (`S급 센티넬`, `신인 센티넬`) → not adult-age evidence
- Backstory ages in `system_prompt` (`5살 때`, `21세 무렵`, `어린아이 구조`) → **excluded** from participant identity assembly after route fix; historical even if present

To reach `confirmed`, would need one of: creator-set `adult_status=confirmed`, structured `age >= 19`, explicit adult-age text in **description**, or ADULT_SIGNAL in identity fields.

## 2. Why is `ch.adult_status` currently `"unknown"`?

1. Column default is `'unknown'` (`db.ts` migration `addColumn("characters", "adult_status", "TEXT NOT NULL DEFAULT 'unknown'")`).
2. One-time migration `migrateCharacterAdultStatusMetadata` (`character_adult_status_metadata_v1`) ran — flag present in `_schema_flags`.
3. Migration infers from full legacy text via `inferAdultStatusFromLegacyText(description + system_prompt + world + simulation_cast)` and **only updates non-unknown** results.
4. Character 17 is a **local H1 fixture** (`creator_id=1`), likely inserted with default/explicit `unknown` or inserted after migration without inferred override.
5. With **old** infer logic, backstory might have inferred `minor`; current DB shows `unknown` → fixture was not updated to `minor` by migration (character may have been created post-migration with explicit unknown, or migration saw no decisive infer at that time).

## 3. Field type: creator-authored, derived, migration, or missing?

**Hybrid metadata field:**

| Source | Mechanism |
|--------|-----------|
| **Creator-authored** | `characterFormSave.ts`: `parseExplicitAdultStatus(b.adult_status)` when creator submits form |
| **Derived on save** | If not explicit: `inferAdultStatusFromLegacyText(description + system_prompt + world + simulation_cast)` |
| **Migration** | One-time `migrateCharacterAdultStatusMetadata` for legacy rows still `unknown` |
| **Default** | `'unknown'` for new rows without inference |

Not a runtime-computed field at chat time — stored on `characters.adult_status`.

## Implication for H1

After historical false-positive fix, blocking on **`participant_unknown`** (not `participant_minor`) is **expected** until character 17 has confirmed adult metadata. This audit does **not** recommend promoting unknown → adult globally or special-casing character 17.

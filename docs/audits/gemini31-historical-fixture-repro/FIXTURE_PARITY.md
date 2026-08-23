# Fixture parity (API calls = 0)

Investigation only. No Cheaper Inference / OpenRouter call was made.

## Required flags

```text
CHARACTER_18_EXACT_CURRENT_ROW_AVAILABLE=false
PERSONA_61_EXACT_CURRENT_ROW_AVAILABLE=false
FIXTURE_PARITY_PROVEN=false
PROVIDER_CALLS=0
```

## Ordinary production path (current main)

| Field | Value |
| --- | --- |
| Workspace branch at investigation | `cursor/gemini31-historical-fixture-repro-2845` from `origin/main` `@023b6f2e` |
| `data/app.db` | missing |
| `.env.local` | missing |
| Seed source | `src/lib/db.ts` demo roster (ids 1–9). No `라이크`. No `조태형`. |
| `listableWhere()` / Home empty-roster note | pre-existing; does not create id=18 |
| Live `GET`/`SELECT` of `characters.id=18` | not possible |
| Live `GET`/`SELECT` of `user_personas.id=61` | not possible |

`CHARACTER_SOURCE=UNAVAILABLE_ON_CURRENT_MAIN_VM`
`PERSONA_SOURCE=UNAVAILABLE_ON_CURRENT_MAIN_VM`
`GREETING_SOURCE=UNAVAILABLE_ON_CURRENT_MAIN_VM`

## Current-main assembled request (not built)

Parity failed before assembly. Current-main `buildContext` / `assemblePrimaryRpRequest` was **not** executed against a stand-in row.

```text
CHARACTER_PROMPT_CHARS=NOT_AVAILABLE
WORLD_CHARS=NOT_AVAILABLE
SETTING_CHUNK_CHARS=NOT_AVAILABLE
PERSONA_CHARS=NOT_AVAILABLE
GREETING_CHARS=NOT_AVAILABLE
USED_ENGLISH_CHARACTER_PROMPT=NOT_ASSEMBLED
CHARACTER_PROMPT_LANGUAGE=NOT_ASSEMBLED
ASSEMBLED_SYSTEM_CHARS=NOT_ASSEMBLED
ASSEMBLED_MESSAGE_COUNT=NOT_ASSEMBLED
ESTIMATED_OR_ACTUAL_INPUT_TOKENS=NOT_ASSEMBLED
```

## Audit #255 recovery

Source branch: `origin/cursor/gemini31-opus5-minimal-screen-6a91`  
Source commit: `3af5ec5b36ae35648f08cb235c4afab73770a35a`  
Script: `scripts/gemini31-opus5-minimal-screen-live.ts`

Historical execution:

```text
POST /api/chat
characterId=18
personaId=61
model=gemini-3.1-pro-preview
reasoning_effort=low
retry=0 continuation=0 recovery=0
```

What that packet froze:

- Gemini / Opus RAW outputs
- `COST_RESULTS.json` (input tokens, visible chars, latency, finish_reason)
- `RUNTIME_RESULTS.json` (character_id=18, persona_id=61)
- `SOURCE_MANIFEST.json` (ids only)

What it did **not** freeze:

- `characters` row 18 (`system_prompt`, `world`, `setting_chunks`, `greeting`, …)
- `user_personas` row 61
- assembled system / messages
- request SHA of the live payload

Zip `data/human-review/55-gemini31-opus5-minimal-screen.zip` matches the docs packet. No fixture bundle inside.

`/opt/cursor/artifacts/gemini31-opus5-minimal-screen` is absent on this VM.

## Nearby recovered objects (not used)

These are **not** treated as Audit #255 parity and were **not** sent to a provider.

### 1. Later production-equivalent character 18 dump

| Field | Value |
| --- | --- |
| First committed path | `data/ds0813-length-h5-reliability-audit/fixtures/character-18-like.json` |
| Also copied at | `data/ds0813-phase-h1-clean/source-fixtures/character-18-like.json` |
| Commit inspected | `8a52c213` (blob `ef61c1bb`, UTF-8 SHA-256 `7785b709e49e93930c226ed228cbf03b9915b00911f3a68c6e2543f6f464c603`) |
| Provenance note (Phase F) | copy of the H5 file; “PR #555 fixture copy only” |
| `id` / `name` | 18 / 라이크 |
| `system_prompt` chars | 3643 |
| `world` chars | 6344 |
| `setting_chunks` JSON chars | 15277 (21 chunks, content chars 9829) |
| `setting_chunks_en` JSON chars | 22826 (17 chunks, content chars 18412) |
| `greeting` chars | 1318 |
| `example_dialog` chars | 1101 |
| `description` chars | 2186 |
| `speech_profile` chars | 1037 |
| `creator_compiled_description_json` chars | 10860 |
| `official` / `nsfw` | 0 / 1 |
| Persona 61 in same dump | no |

H5 later assembly (`data/ds0813-length-h5-reliability-audit/assembled/A_A.json`, **not this run**, persona text = 도윤 not 61):

```text
usedEnglish=true
chunkCount=21
SYSTEM_CHARS=25338
SYSTEM_TOKENS=22805
TOTAL_ESTIMATED_INPUT=25025
```

That later input size is in the same order as Audit #255 (17514–21862) and is **not** the 4.5K–6.5K short-card family. It still cannot be claimed as the #255 live payload.

### 2. G11-C5 `c18_persona61_fixture.json`

Branch: `origin/cursor/historical-sequence-triangulation-g11c5-24fc`  
Path: `docs/audits/rp-historical-sequence-g11c5/fixtures/c18_persona61_fixture.json`  
SHA-256: `1f83ddccbcd77c5877dcc8257a95e0fa5cece72e21a2fa91ad7e47b3e7daa99d`

Provenance on the file: reconstructed Like card from `rp-quality-v2-gemini` `c18_fixture`; `FULL_HISTORICAL_PAYLOAD_PARITY=UNKNOWN`.

| Field | Value |
| --- | --- |
| `character.system_prompt` | 419 |
| `character.world` | 50 |
| `character.setting_chunks` | 0 |
| `character.greeting` | 1153 |
| `persona.id` | 61 |
| `persona.description` | 38 (`20대. 호기심 많고 직설적이며, 위험한 상황에서도 다가가는 편이다.`) |

G11-C5 itself recorded `CONTEXT_COMPOSITION_DELTA_HIGH` (current input ≈26–36% of historical). This is the same confound class as PR #589 Fixture A.

### 3. H1-CLEAN / Phase F persona “렌”

Path: `data/ds0813-phase-h1-clean/source-fixtures/persona-ren.json`  
SHA-256: `2762c7602247aeadfbcd2780b7eda075444f9241b4b8bcabea5930961ea3cc37`

```text
id: missing (not 61)
description: 만 28세 성인 남성. …
PROVENANCE: Confirmed-adult test persona. Not a production user row.
```

### 4. Flood F1 admin persona snapshot

`docs/audits/deepseek-flood-local-preflight-f1/PERSONA.txt`:

```text
PERSONA: 렌
PERSONA_ID: 1
ADMIN_PERSONA_PRODUCTION_RECORD_PROVEN=true
RAW: PRIVATE_SNAPSHOT_ONLY
```

Id is 1, not 61. RAW not in git.

## Missing items that block parity

1. Current-main live `characters.id=18` row (or a dump proven byte-identical to current production).
2. Current-main live `user_personas.id=61` row (or a dump proven byte-identical to that row).
3. Audit #255 assembled request / system / greeting / chunks frozen from the live `/api/chat` calls that produced 17514–21862 input tokens.

Until those exist, a four-call Gemini 3.1 length comparison against Audit #255 is not licensed.

## Fail-closed

```text
DO_NOT_CREATE_MINIATURE_FAKE_FIXTURE=true
PROVIDER_CALLS=0
STOP=true
```

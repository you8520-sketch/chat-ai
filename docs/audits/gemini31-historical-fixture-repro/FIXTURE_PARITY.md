# Fixture parity

## Decision

```text
FIXTURE_PARITY_PROVEN=true
CHARACTER_ROW_EXACT=false
PERSONA_ROW_EXACT=false
```

Parity was proven using a **merged** bundle: production-scale `character-18-like.json` + persona id=61 from `c18_persona61_fixture.json`. The short reconstructed character card in `c18_persona61_fixture.json` was rejected.

## Provenance table

| field | source | classification |
| --- | --- | --- |
| CHARACTER_18 | `fixtures/character-18-like.json` (H5 dump, blob `ef61c1bb`, SHA-256 `7785b709…`) | TRUSTWORTHY_SANITIZED_HISTORICAL_VALUE |
| PERSONA_61 | `fixtures/c18_persona61_fixture.json` persona block (G11-C5, id remapped to 61) | RECONSTRUCTED |
| GREETING | `character-18-like.json` greeting (1318 chars) | TRUSTWORTHY_SANITIZED_HISTORICAL_VALUE |
| SYSTEM_PROMPT | `character-18-like.json` system_prompt (3643 chars) | TRUSTWORTHY_SANITIZED_HISTORICAL_VALUE |
| WORLD | `character-18-like.json` world (6344 chars) | TRUSTWORTHY_SANITIZED_HISTORICAL_VALUE |
| SETTING_CHUNKS | `character-18-like.json` setting_chunks (21 chunks, 9829 content chars) | TRUSTWORTHY_SANITIZED_HISTORICAL_VALUE |
| EXAMPLE_DIALOG | `character-18-like.json` example_dialog (1101 chars) | TRUSTWORTHY_SANITIZED_HISTORICAL_VALUE |
| PERSONA_DESCRIPTION | `c18_persona61_fixture.json` (38 chars) | RECONSTRUCTED |

## Identity

```text
CHARACTER_NAME=라이크
CHARACTER_ID=18
PERSONA_ID=61
PERSONA_NAME=렌
```

## Field sizes (character bundle)

```text
SYSTEM_PROMPT_CHARS=3643
WORLD_CHARS=6344
SETTING_CHUNKS_CHARS=15277
SETTING_CHUNKS_CONTENT_CHARS=9829
EXAMPLE_DIALOG_CHARS=1101
GREETING_CHARS=1318
PERSONA_CHARS=38
USED_ENGLISH_CHARACTER_PROMPT=true
CHUNK_COUNT=21
```

## Assembled request (current main, dry-run REL-T1)

```text
CURRENT_ASSEMBLED_SYSTEM_CHARS=26117
CURRENT_ASSEMBLED_MESSAGE_COUNT=4
CURRENT_ASSEMBLED_INPUT_TOKENS_REL_T1_EST=25480
CURRENT_ASSEMBLED_INPUT_TOKENS_REL_T2_EST=25542
HISTORICAL_INPUT_TOKENS_REL_T1=17514
INPUT_TOKEN_RATIO_REL_T1_EST=1.455
HISTORICAL_INPUT_RANGE=17514-21862
```

Local estimate uses `ceil(chars × 0.9)`. Provider-billed input tokens on live calls are lower (9138–11285); see `CURRENT_RESULTS.md`.

## Rejected objects

| object | why rejected |
| --- | --- |
| `c18_persona61_fixture.json` character block | 419-char reconstructed card; G11-C5 `FULL_HISTORICAL_PAYLOAD_PARITY=UNKNOWN` |
| Prior fail-closed VM path | no live `characters.id=18` / `user_personas.id=61` rows |
| Audit #255 packet alone | froze outputs + cost metadata only; no character/persona/request bundle |

## Original file lineage

- `character-18-like.json` first committed: `data/ds0813-length-h5-reliability-audit/fixtures/` @ `8a52c213`
- `c18_persona61_fixture.json` first committed: `docs/audits/rp-historical-sequence-g11c5/fixtures/` (G11-C5 branch)

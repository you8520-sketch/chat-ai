# TRPG Bot Voice Collapse — Phase 1 Provenance Audit

Read-only audit. No production changes.

## Static repository audit

| String | Bot prompt sources | Classification |
|--------|-------------------|----------------|
| `영웅 놀이` | 0 | NONE |
| `영웅놀이` | 0 | NONE |
| `영웅` (botActions/gmPrompt/memory) | 0 | NONE |
| `몸값` | 0 in TRPG bot paths | NONE |
| `장례식` | 0 in TRPG bot paths | NONE |
| `업고 가` | 0 in TRPG bot paths | NONE |
| `버리고 가` | 0 in TRPG bot paths | NONE |
| `손해` | 0 in TRPG bot paths (unrelated speech-metadata docs only) | NONE |
| `물고 끌고` | 0 | NONE |

**Conclusion:** The symptom phrase is not hardcoded in static Bot/GM prompt sources.

## DB / dynamic content provenance

**Status:** No production or campaign SQLite snapshot (`data/app.db`) is available in this audit environment.

| Field | Value |
|-------|-------|
| `FIRST_DB_OCCURRENCE_FOUND` | false |
| `FIRST_OCCURRENCE_ROUND` | unknown |
| `FIRST_OCCURRENCE_ACTOR` | unknown |
| `FIRST_OCCURRENCE_SOURCE` | unknown |
| `BEFORE_FIRST_OCCURRENCE_INPUT_CONTAINED_PHRASE` | unknown |

Feedback-loop tracing (Bot → GM → memory → Bot) requires production DB access and is **not reconstructible here**.

## Assembled prompt provenance (current-code reconstruction)

`HISTORICAL_EXACT_PROMPT_RECONSTRUCTIBLE: false`  
`CURRENT_CODE_RECONSTRUCTION_ONLY: true`

Using `buildTrpgBotActionUserBlock()` + frozen fixtures (no `"영웅 놀이"` injected):

| Section | contains hero-play phrase | semantic-neighbor cliché in fixture |
|---------|---------------------------|-------------------------------------|
| SYSTEM | false | false |
| CHARACTER_IDENTITY | false | false |
| DESCRIPTION | false | protective-cynic archetype (by design) |
| GREETING | false | false |
| EXAMPLE_DIALOG | false | mild loss/joke samples (not hero-play) |
| CHARACTER_CARD | false | false |
| CAMPAIGN_WORLD | false | false |
| RELATIONSHIPS | false | false |
| CAMPAIGN_STATE | false | false |
| LONG_TERM_MEMORY | false (empty in fixtures) | false |
| RECENT_CONTINUITY | false (INTENT-only compaction) | false |
| PREVIOUS_GM_SCENE | false | false |
| HUMAN_ACTIONS | false | risk-taking actions (intentional) |
| EARLIER_COMPANION_INTENT | false (Bot1 path) | false |

## Same-round cross-bot contamination

| Field | Value |
|-------|-------|
| `BOT1_PROSE_VISIBLE_TO_BOT2` | false |
| `BOT1_DISTINCTIVE_PHRASE_VISIBLE_TO_BOT2` | false (prose stripped; `"영웅 놀이"` in Bot1 prose does not reach Bot2) |
| `BOT1_INTENT_VISIBLE_TO_BOT2` | true (canonical INTENT line only) |
| `BOT1_DICE_VISIBLE_TO_BOT2` | false |
| `BOT1_RESULT_VISIBLE_TO_BOT2` | false |

Implementation: `buildTrpgBotActionUserBlock()` uses `parseTrpgBotAction().intent` for `[EARLIER COMPANION ACTIONS]`.

## Model request audit

| Parameter | Bot (Luna) | Notes |
|-----------|------------|-------|
| model | `gpt-5.6-luna` | since PR #700 |
| reasoning | none | via `applyCheaperInferenceModelReasoningPolicy` |
| temperature | 0.85 | fixed in `callTrpgBot` |
| max_tokens | 2048 | `TRPG_BOT_MAX_TOKENS` |
| frequency_penalty | stripped | not sent |
| presence_penalty | stripped | not sent |
| retry count | 1 | `BOT_MAX_PROVIDER_ATTEMPTS = 1` |

**PR #700 switch:** Bot **and** GM models changed together (Bot: DeepSeek V4 Pro → Luna; GM: DeepSeek V4 Pro → Gemini 3.7 Flash).

`MODEL_SWITCH_WAS_ONLY_MATERIAL_GENERATION_CHANGE: false`

## Character card semantic overlap

| Field | Assessment |
|-------|------------|
| `CHARACTER_CARDS_SEMANTICALLY_OVERLAP` | MEDIUM |
| `OBSERVED_REPETITION_EXPLAINED_BY_CARD` | PARTIAL |

Both canonical PCs share protective-cynic archetypes (worry disguised as teasing). That explains *some* semantic similarity but **not** identical catchphrases across characters.

## Owner audit (unchanged from #710)

```
LENGTH_OWNER_COUNT = 1
TURN_ORDER_OWNER_COUNT = 1
PROSE_LAYOUT_OWNER_COUNT = 1
NO_RESULT_OWNER_COUNT = 1
ACTION_TYPE_OWNER_COUNT = 1
INTENT_OWNER_COUNT = 1
CHARACTER_VOICE_OWNER_COUNT = 1 (character card sections)
LEXICAL_NOVELTY_OWNER_COUNT = 0
```

## Root cause classification (Phase 1)

**Pre-A/B hypothesis:** `E_MULTIPLE`

Contributors:
1. **C — MODEL LEXICAL ATTRACTOR (Luna):** Static prompts do not contain the phrase; symptom appeared after Luna Bot rollout; cross-character template collapse matches model attractor pattern.
2. **D — RECURRENCE CONTEXT GAP:** Bot continuity stores parsed INTENT (~80 chars), not past spoken lines — model lacks wording memory to avoid self-repetition.
3. **B — MEMORY FEEDBACK:** Possible in production (GM narration echo) but **not verified** without DB.

**Not supported by static audit:** A (input contamination from static prompts).

Phase 2 frozen A/B required to confirm Luna vs DeepSeek causality.

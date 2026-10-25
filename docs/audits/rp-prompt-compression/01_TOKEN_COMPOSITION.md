# 01 Token Composition

## Estimator

```text
estimateTokens(text) = ceil(text.length * 0.9)
API calls = 0
```

## Regeneration setting

```text
REGENERATE_FULL_REJECTED_DRAFT = (unset)
regen rejected-draft mode = COMPACT_SUMMARY
actual rejected-draft reference tokens (compact summary) = 319
actual entire regenerate-divergence section tokens (compact directive) = 872
full rejected draft block tokens (opt-in only, NOT default) = 639
```

Default is **COMPACT_SUMMARY**. Full rejected draft requires explicit env opt-in.

## NORMAL TURN ONLY (model footprint)

| Model | system_total | cache_rules | cache_character | dynamic | INSTRUCTION | CONTENT | MIXED | current_user | history | TOTAL_INPUT |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Claude Opus 5 | 5858 | 1935 | 1709 | 2212 | 3526 | 1378 | 943 | 1530 | 101 | 7489 |
| Gemini 3.1 Pro Preview | 5858 | 1935 | 1709 | 2212 | 3526 | 1378 | 943 | 500 | 101 | 6460 |
| DeepSeek V4 Pro | 6064 | 2299 | 2226 | 1536 | 3526 | 1378 | 1000 | 835 | 101 | 7001 |
| GPT-5.6 Terra | 5858 | 1935 | 1709 | 2212 | 3526 | 1378 | 943 | 548 | 101 | 6507 |

### CONTENT vs INSTRUCTION (NORMAL)

Instruction = fixed rules / agency / prose / layout / model adapters / regenerate.
Content = character canon, persona, memory/episodic/lore/triggers.

Do **not** call system_total "common prompt size".

## NORMAL vs REGEN (same fixture)

| Model | normal_system | regen_system | system_delta | normal_total | regen_total | total_delta |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Opus 5 | 5858 | 6730 | 872 | 7489 | 8361 | 872 |
| Gemini 3.1 Pro Preview | 5858 | 6730 | 872 | 6460 | 7332 | 872 |
| DeepSeek V4 Pro | 6064 | 6936 | 872 | 7001 | 7873 | 872 |
| GPT-5.6 Terra | 5858 | 6730 | 872 | 6507 | 7380 | 873 |

## Owner bucket tokens (NORMAL)

### Claude Opus 5

- PROSE_STYLE: 2447
- OTHER: 943
- PERSONA_AND_USER_RULES: 837
- OUTPUT_LAYOUT: 670
- CHARACTER_CANON: 492
- AGENCY: 409
- MEMORY: 49

### Gemini 3.1 Pro Preview

- PROSE_STYLE: 2447
- OTHER: 943
- PERSONA_AND_USER_RULES: 837
- OUTPUT_LAYOUT: 670
- CHARACTER_CANON: 492
- AGENCY: 409
- MEMORY: 49

### DeepSeek V4 Pro

- PROSE_STYLE: 2447
- OTHER: 1000
- PERSONA_AND_USER_RULES: 837
- OUTPUT_LAYOUT: 670
- CHARACTER_CANON: 492
- AGENCY: 409
- MEMORY: 49

### GPT-5.6 Terra

- PROSE_STYLE: 2447
- OTHER: 943
- PERSONA_AND_USER_RULES: 837
- OUTPUT_LAYOUT: 670
- CHARACTER_CANON: 492
- AGENCY: 409
- MEMORY: 49

## Interpretation note

Field measurements that mixed first-turn NORMAL (~DeepSeek 6k) with REGEN turns (~Opus/Gemini/Terra 4.3k–6.8k) are **not** comparable model footprints. Use NORMAL-only table above for structure comparison; use REGEN delta table for regeneration overhead.

# Peak Input Pressure + Paid-Memory Turn Price Audit (CORRECTION PASS)

## PRODUCTION DEPLOYMENT
- Railway deployment: `2bc05e11-aa66-466d-a5f4-1bf8c549c398`
- Railway status: SUCCESS
- Production SHA: `bfb097470df6ae0df03611f716330c9413218484`
- Origin main (latest fetch): `bfb097470df6ae0df03611f716330c9413218484`
- PR_BEHIND_MAIN = 0

## LOAD CLASSES
- **NORMAL** — realistic ordinary RP
- **MEMORY_PEAK** — subscription memory tiers max + realistic-heavy Creator (~3 entries via production matcher)
- **ABSOLUTE_VALID_STRESS** — every server-valid variable-size owner stressed through production paths

## CREATOR LOREBOOK — PRODUCT MODEL (CURRENT vs TARGET)
- MODEL_MISMATCH = YES
- CURRENT attach: characters.lorebook_id INTEGER — single FK, exactly 0 or 1 keyword_lorebooks row
- CURRENT unit: keyword_lorebooks row = named container; entries_json holds up to LOREBOOK_ENTRY_MAX (100) keyword→content entries
- CURRENT per-turn inject cap: NONE — all uniquely matched entries joined without char/token budget
- CURRENT theoretical max inject (no cap): 80000 chars
- TARGET attach max: 20 lorebooks/character
- TARGET unit: One lorebook = one 800-char content block + up to 10 keywords (NOT multi-entry container)
- TARGET per-turn inject: Separate PER-TURN INJECTION BUDGET owner — keyword hit + carryover only; must NOT inject all 20×800 every turn
- TARGET theoretical max if all hit (no cap): 16000 chars
- Required schema deltas:
  - Replace characters.lorebook_id single FK with character_lorebook_attachments(character_id, lorebook_id) max 20
  - Migrate keyword_lorebooks creator scope: one content block + keywords per row (drop multi-entry entries_json OR enforce max 1 entry)
  - Add creator lorebook per-turn injection budget constant + apply* budget function (mirror userLorebook applyUserLorebookTurnInjectionBudget)

## CREATOR LOREBOOK CONTRACT (current main path)
- CREATOR_LOREBOOK_TURN_INJECT_CAP = NONE
- Path: entries_json → parseStoredLorebookEntries → matchKeywordLorebookEntryDetails → mergeMatches → buildKeywordLorebookPromptBlock → route loadKeywordLorebookPromptBlockFromActivation → buildContext keywordLorebookBlock
- Carryover: mergeMatches dedupes by content; carryover TTL rows cannot introduce content absent from stored entries; max unique injected contents ≤ LOREBOOK_ENTRY_MAX matched entries

## TABLE A — MEMORY PRODUCT (T2000 MEMORY_PEAK, realistic Creator)
| Model | Free | Paid | Global15 | Δ input Paid | Δ input G15 | Δ P Paid | Δ P G15 |
|---|---:|---:|---:|---:|---:|---:|---:|
| deepseek-v4-pro-0813 | 39330 | 40230 | 44823 | 900 | 4593 | 1 | 6 |
| gemini-3.1-pro-preview | 39081 | 39981 | 44575 | 900 | 4594 | 4 | 19 |
| gemini-3.7-flash | 38805 | 39705 | 44298 | 900 | 4593 | 2 | 8 |
| gpt-5.6-terra | 38805 | 39705 | 44298 | 900 | 4593 | 5 | 28 |

## TABLE B — CURRENT CONTAINER ENTRY STRESS (1 attached lorebook, N entries — NOT target 20 lorebooks)
| Model | 1-entry P | 10 | 25 | 50 | 100 entries P |
|---|---:|---:|---:|---:|---:|
| deepseek-v4-pro-0813 | 60 | 68 | 83 | 107 | 155 |
| gemini-3.1-pro-preview | 240 | 267 | 314 | 391 | 545 |
| gemini-3.7-flash | 95 | 106 | 125 | 158 | 222 |
| gpt-5.6-terra | 340 | 380 | 446 | 557 | 777 |

## TABLE B′ — TARGET ATTACHED LOREBOOK UNITS (forensic ref, max 20 units, no injection cap)
| Model | 1 unit P | 5 | 10 | 15 | 20 units P |
|---|---:|---:|---:|---:|---:|
| deepseek-v4-pro-0813 | 60 | 64 | 68 | 73 | 78 |
| gemini-3.1-pro-preview | 240 | 252 | 267 | 283 | 298 |
| gemini-3.7-flash | 95 | 100 | 106 | 113 | 119 |
| gpt-5.6-terra | 340 | 358 | 380 | 402 | 424 |

## TABLE C — ABSOLUTE VALID STRESS (T2000, PAID_GLOBAL15, 100 container entries on current main)
| Model | Total input | 60K+ | 80K+ | 100K+ | P charge | Root cause |
|---|---:|---|---|---|---:|---|
| deepseek-v4-pro-0813 | 115596 | Y | Y | Y | 162 | OTHER |
| gemini-3.1-pro-preview | 115347 | Y | Y | Y | 569 | OTHER |
| gemini-3.7-flash | 115071 | Y | Y | Y | 232 | OTHER |
| gpt-5.6-terra | 115071 | Y | Y | Y | 810 | OTHER |

## MEMORY_PEAK MAX INPUT (realistic Creator — NOT absolute max)
| MODEL | FREE | PAID | G15 | G20 | G15≥60K | stage |
|---|---:|---:|---:|---:|---:|---|
| deepseek-v4-pro-0813 | 39330 | 40230 | 44823 | 49417 | N | T2000/MEMORY_PEAK |
| gemini-3.1-pro-preview | 39081 | 39981 | 44575 | 49168 | N | T2000/MEMORY_PEAK |
| gemini-3.7-flash | 38805 | 39705 | 44298 | 48892 | N | T2000/MEMORY_PEAK |
| gpt-5.6-terra | 38805 | 39705 | 44298 | 48892 | N | T2000/MEMORY_PEAK |

## ABSOLUTE VALID MAX INPUT
- deepseek-v4-pro-0813: FREE=110102 PAID=111002 G15=115596 first60K@creator25 first100K@creator100
- gemini-3.1-pro-preview: FREE=109854 PAID=110754 G15=115347 first60K@creator25 first100K@creator100
- gemini-3.7-flash: FREE=109577 PAID=110477 G15=115071 first60K@creator25 first100K@creator100
- gpt-5.6-terra: FREE=109577 PAID=110477 G15=115071 first60K@creator25 first100K@creator100

## INPUT BANDS — MEMORY_PEAK matrix
- UNDER_28K: 0 fixtures
- 28K_TO_40K: 77 fixtures
- 40K_TO_50K: 51 fixtures
- 50K_TO_60K: 0 fixtures
- 60K_TO_80K: 0 fixtures
- 80K_TO_100K: 0 fixtures
- 100K_OR_MORE: 0 fixtures
## INPUT BANDS — ABSOLUTE_VALID_STRESS matrix
- UNDER_28K: 0 fixtures
- 28K_TO_40K: 8 fixtures
- 40K_TO_50K: 16 fixtures
- 50K_TO_60K: 16 fixtures
- 60K_TO_80K: 20 fixtures
- 80K_TO_100K: 4 fixtures
- 100K_OR_MORE: 16 fixtures

## GLOBAL15 ATTRIBUTION (stable vs Creator size — sample Creator100 MEMORY_PEAK)
- deepseek-v4-pro-0813: GLOBAL15_INPUT_DELTA_VS_PAID=4593 GLOBAL15_P_DELTA=6
- gemini-3.1-pro-preview: GLOBAL15_INPUT_DELTA_VS_PAID=4594 GLOBAL15_P_DELTA=20
- gemini-3.7-flash: GLOBAL15_INPUT_DELTA_VS_PAID=4593 GLOBAL15_P_DELTA=8
- gpt-5.6-terra: GLOBAL15_INPUT_DELTA_VS_PAID=4593 GLOBAL15_P_DELTA=28

## GLOBAL MAINTENANCE
- GLOBAL_MAINTENANCE_COST = APPROXIMATE_FORENSIC_ONLY

## FINAL CLASSIFICATION
- PRODUCTION_SHA = bfb097470df6ae0df03611f716330c9413218484
- PR_BEHIND_MAIN = 0
- ROOT_CLASSIFICATION = ABSOLUTE_MAX_UNBOUNDED
- CREATOR_LOREBOOK_TURN_INJECT_CAP = NONE
- CURRENT_USER_TURN_MAX = 1500
- GLOBAL_MAINTENANCE_COST = APPROXIMATE_FORENSIC_ONLY
- PROVIDER_GENERATION_CALLS = 0
- RUNTIME_CHANGE = NO
- MERGE = NO
- MEMORY_PEAK_FREE_MAX_INPUT_deepseek-v4-pro-0813 = 39330
- MEMORY_PEAK_PAID_CURRENT_MAX_INPUT_deepseek-v4-pro-0813 = 40230
- MEMORY_PEAK_PAID_GLOBAL15_MAX_INPUT_deepseek-v4-pro-0813 = 44823
- MEMORY_PEAK_GLOBAL15_60K_PLUS_deepseek-v4-pro-0813 = NO
- ABSOLUTE_VALID_FREE_MAX_INPUT_deepseek-v4-pro-0813 = 110102
- ABSOLUTE_VALID_PAID_CURRENT_MAX_INPUT_deepseek-v4-pro-0813 = 111002
- ABSOLUTE_VALID_PAID_GLOBAL15_MAX_INPUT_deepseek-v4-pro-0813 = 115596
- ABSOLUTE_VALID_GLOBAL15_60K_PLUS_deepseek-v4-pro-0813 = YES
- ABSOLUTE_VALID_GLOBAL15_80K_PLUS_deepseek-v4-pro-0813 = YES
- ABSOLUTE_VALID_GLOBAL15_100K_PLUS_deepseek-v4-pro-0813 = YES
- CREATOR_MATCHES_FIRST_60K_deepseek-v4-pro-0813 = 25
- CREATOR_MATCHES_FIRST_100K_deepseek-v4-pro-0813 = 100
- CREATOR_1_ENTRY_P_deepseek-v4-pro-0813 = 60
- CREATOR_10_ENTRY_P_deepseek-v4-pro-0813 = 68
- CREATOR_25_ENTRY_P_deepseek-v4-pro-0813 = 83
- CREATOR_50_ENTRY_P_deepseek-v4-pro-0813 = 107
- CREATOR_100_ENTRY_P_deepseek-v4-pro-0813 = 155
- GLOBAL15_ATTRIBUTABLE_INPUT_DELTA_deepseek-v4-pro-0813 = 4593
- GLOBAL15_ATTRIBUTABLE_P_DELTA_deepseek-v4-pro-0813 = 6
- NO_DETECTED_MEDIUM_GLOBAL_LITERAL_BLOAT_deepseek-v4-pro-0813 = YES
- MEMORY_COST_RECOVERY_CLAIM_deepseek-v4-pro-0813 = NOMINAL_POINT_DELTA_COVERS_RAW_KRW_DELTA
- MEMORY_PEAK_FREE_MAX_INPUT_gemini-3.1-pro-preview = 39081
- MEMORY_PEAK_PAID_CURRENT_MAX_INPUT_gemini-3.1-pro-preview = 39981
- MEMORY_PEAK_PAID_GLOBAL15_MAX_INPUT_gemini-3.1-pro-preview = 44575
- MEMORY_PEAK_GLOBAL15_60K_PLUS_gemini-3.1-pro-preview = NO
- ABSOLUTE_VALID_FREE_MAX_INPUT_gemini-3.1-pro-preview = 109854
- ABSOLUTE_VALID_PAID_CURRENT_MAX_INPUT_gemini-3.1-pro-preview = 110754
- ABSOLUTE_VALID_PAID_GLOBAL15_MAX_INPUT_gemini-3.1-pro-preview = 115347
- ABSOLUTE_VALID_GLOBAL15_60K_PLUS_gemini-3.1-pro-preview = YES
- ABSOLUTE_VALID_GLOBAL15_80K_PLUS_gemini-3.1-pro-preview = YES
- ABSOLUTE_VALID_GLOBAL15_100K_PLUS_gemini-3.1-pro-preview = YES
- CREATOR_MATCHES_FIRST_60K_gemini-3.1-pro-preview = 25
- CREATOR_MATCHES_FIRST_100K_gemini-3.1-pro-preview = 100
- CREATOR_1_ENTRY_P_gemini-3.1-pro-preview = 240
- CREATOR_10_ENTRY_P_gemini-3.1-pro-preview = 267
- CREATOR_25_ENTRY_P_gemini-3.1-pro-preview = 314
- CREATOR_50_ENTRY_P_gemini-3.1-pro-preview = 391
- CREATOR_100_ENTRY_P_gemini-3.1-pro-preview = 545
- GLOBAL15_ATTRIBUTABLE_INPUT_DELTA_gemini-3.1-pro-preview = 4594
- GLOBAL15_ATTRIBUTABLE_P_DELTA_gemini-3.1-pro-preview = 19
- NO_DETECTED_MEDIUM_GLOBAL_LITERAL_BLOAT_gemini-3.1-pro-preview = YES
- MEMORY_COST_RECOVERY_CLAIM_gemini-3.1-pro-preview = NOMINAL_POINT_DELTA_COVERS_RAW_KRW_DELTA
- MEMORY_PEAK_FREE_MAX_INPUT_gemini-3.7-flash = 38805
- MEMORY_PEAK_PAID_CURRENT_MAX_INPUT_gemini-3.7-flash = 39705
- MEMORY_PEAK_PAID_GLOBAL15_MAX_INPUT_gemini-3.7-flash = 44298
- MEMORY_PEAK_GLOBAL15_60K_PLUS_gemini-3.7-flash = NO
- ABSOLUTE_VALID_FREE_MAX_INPUT_gemini-3.7-flash = 109577
- ABSOLUTE_VALID_PAID_CURRENT_MAX_INPUT_gemini-3.7-flash = 110477
- ABSOLUTE_VALID_PAID_GLOBAL15_MAX_INPUT_gemini-3.7-flash = 115071
- ABSOLUTE_VALID_GLOBAL15_60K_PLUS_gemini-3.7-flash = YES
- ABSOLUTE_VALID_GLOBAL15_80K_PLUS_gemini-3.7-flash = YES
- ABSOLUTE_VALID_GLOBAL15_100K_PLUS_gemini-3.7-flash = YES
- CREATOR_MATCHES_FIRST_60K_gemini-3.7-flash = 25
- CREATOR_MATCHES_FIRST_100K_gemini-3.7-flash = 100
- CREATOR_1_ENTRY_P_gemini-3.7-flash = 95
- CREATOR_10_ENTRY_P_gemini-3.7-flash = 106
- CREATOR_25_ENTRY_P_gemini-3.7-flash = 125
- CREATOR_50_ENTRY_P_gemini-3.7-flash = 158
- CREATOR_100_ENTRY_P_gemini-3.7-flash = 222
- GLOBAL15_ATTRIBUTABLE_INPUT_DELTA_gemini-3.7-flash = 4593
- GLOBAL15_ATTRIBUTABLE_P_DELTA_gemini-3.7-flash = 8
- NO_DETECTED_MEDIUM_GLOBAL_LITERAL_BLOAT_gemini-3.7-flash = YES
- MEMORY_COST_RECOVERY_CLAIM_gemini-3.7-flash = NOMINAL_POINT_DELTA_COVERS_RAW_KRW_DELTA
- MEMORY_PEAK_FREE_MAX_INPUT_gpt-5.6-terra = 38805
- MEMORY_PEAK_PAID_CURRENT_MAX_INPUT_gpt-5.6-terra = 39705
- MEMORY_PEAK_PAID_GLOBAL15_MAX_INPUT_gpt-5.6-terra = 44298
- MEMORY_PEAK_GLOBAL15_60K_PLUS_gpt-5.6-terra = NO
- ABSOLUTE_VALID_FREE_MAX_INPUT_gpt-5.6-terra = 109577
- ABSOLUTE_VALID_PAID_CURRENT_MAX_INPUT_gpt-5.6-terra = 110477
- ABSOLUTE_VALID_PAID_GLOBAL15_MAX_INPUT_gpt-5.6-terra = 115071
- ABSOLUTE_VALID_GLOBAL15_60K_PLUS_gpt-5.6-terra = YES
- ABSOLUTE_VALID_GLOBAL15_80K_PLUS_gpt-5.6-terra = YES
- ABSOLUTE_VALID_GLOBAL15_100K_PLUS_gpt-5.6-terra = YES
- CREATOR_MATCHES_FIRST_60K_gpt-5.6-terra = 25
- CREATOR_MATCHES_FIRST_100K_gpt-5.6-terra = 100
- CREATOR_1_ENTRY_P_gpt-5.6-terra = 340
- CREATOR_10_ENTRY_P_gpt-5.6-terra = 380
- CREATOR_25_ENTRY_P_gpt-5.6-terra = 446
- CREATOR_50_ENTRY_P_gpt-5.6-terra = 557
- CREATOR_100_ENTRY_P_gpt-5.6-terra = 777
- GLOBAL15_ATTRIBUTABLE_INPUT_DELTA_gpt-5.6-terra = 4593
- GLOBAL15_ATTRIBUTABLE_P_DELTA_gpt-5.6-terra = 28
- NO_DETECTED_MEDIUM_GLOBAL_LITERAL_BLOAT_gpt-5.6-terra = YES
- MEMORY_COST_RECOVERY_CLAIM_gpt-5.6-terra = NOMINAL_POINT_DELTA_COVERS_RAW_KRW_DELTA
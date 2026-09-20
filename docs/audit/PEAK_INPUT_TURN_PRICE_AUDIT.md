# Peak Input Pressure + Paid-Memory Turn Price Audit

## PRODUCTION DEPLOYMENT
- Railway deployment: `1c3185ff-1434-4c14-a1d3-c6914016d16b`
- Railway status: SUCCESS
- Production SHA: `d593069fdaf476bfb6d547d675034925e8175e96`
- Origin main (latest fetch): `73d563496eb6183cbc8bfdf514882cdcacee8d9c`

## PRODUCT MODEL
- SUBSCRIPTION_PRODUCT_TYPE = MONTHLY_MEMORY_ADDON_PLUS_USAGE_BILLING
- NORMAL_USAGE_BILLING = CONTINUES
- Memory add-on expands Focus/User Lorebook/Global; does NOT unlimit Main RP turns.

## OWNER MAP
- **finalContextBuilder**: src/services/contextBuilder.ts — buildContext()
- **systemMessages**: buildContext pushSection trackedSections
- **historyMessages**: buildContext shortTermHistory → trim → history
- **currentUserTurn**: buildContext currentUserMessage + adapters
- **modelAdapter**: OpenRouter split / DeepSeek XML / Gemini bulk in contextBuilder
- **focusInjection**: userNote + focusMaxChars via splitUserNotePromptZones
- **creatorLorebook**: keywordLorebookBlock → keyword-lorebook or dynamic lore prefix
- **userLorebook**: userLorebookBlock → user-lorebook section
- **globalMemory**: longTermMemory → current-memory section
- **mediumMemory**: mediumTermMemoryBlock → medium-term-memory section
- **episodicMemory**: episodicMemoryBlock → episodic-memory-retrieved-facts
- **relationshipMemory**: memoryMeta → relationship-meta or bundled in current-memory
- **rawHistory**: shortTermHistory RAW4 in buildContext
- **historyTrimming**: trimHistoryToBudget / trimProviderHistoryToBudget
- **systemBudgetTelemetry**: MODEL_SYSTEM_BUDGETS → meta.tokenBudget (soft telemetry)
- **localTokenEstimate**: estimateTokens() — LOCAL_ESTIMATED_TOKENS diagnostic
- **providerPromptTokens**: Provider usage.prompt_tokens — canonical when request exists
- **serializedWireRequest**: route OpenRouter/Gemini wire builders post-buildContext
- **cacheTelemetry**: usage cache_read/write fields + openRouterSystemSplit
- **mainRpModels**: chatModels.MAIN_RP_MODEL_IDS
- **usagePointCharge**: points.computeOpenRouterTurnCost
- **rawProviderCost**: openRouterModelPricing.openRouterUsdCostFromRates
- **fx**: exchangeRate.resolveBillingExchangeRateSnapshot
- **globalCompaction**: memory-global-compaction-execution + ai.resolveBackgroundPrimaryModelId

## MAIN RP MODEL REGISTRY
- deepseek-v4-pro-0813 (DeepSeek V4 Pro)
- gemini-3.1-pro-preview (Gemini 3.1 Pro Preview)
- gemini-3.7-flash (Gemini 3.7 Flash)
- gpt-5.6-terra (GPT-5.6 Terra)

## ABSOLUTE MAX INPUT TABLE
| MODEL | FREE | PAID | G15 | G20 | G15≥28K | G15≥40K | G15≥50K | G15≥60K | stage |
|---|---:|---:|---:|---:|---|---|---|---:|---|
| deepseek-v4-pro-0813 | 41067 | 43317 | 47911 | 52505 | Y | Y | N | N | T2000/PEAK_MEMORY |
| gemini-3.1-pro-preview | 40819 | 43069 | 47663 | 52256 | Y | Y | N | N | T2000/PEAK_MEMORY |
| gemini-3.7-flash | 40543 | 42793 | 47386 | 51980 | Y | Y | N | N | T2000/PEAK_MEMORY |
| gpt-5.6-terra | 40543 | 42793 | 47386 | 51980 | Y | Y | N | N | T2000/PEAK_MEMORY |

## 28K / 40K / 50K / 60K BANDS
- UNDER_28K: 0 fixtures
- 28K_TO_40K: 43 fixtures
- 40K_TO_50K: 73 fixtures
- 50K_TO_60K: 12 fixtures
- 60K_OR_MORE: 0 fixtures
- worst overall: deepseek-v4-pro-0813 PAID_GLOBAL_20K_REFERENCE T2000 PEAK_MEMORY = 52505 tokens (50K_TO_60K)

## SIXTY-K ROOT CAUSE
- No legitimate fixture reached 60K+ LOCAL_ESTIMATED_TOKENS.

## INPUT AMPLIFICATION (T2000 PEAK)
- deepseek-v4-pro-0813: PAID_CURRENT=1.055x GLOBAL15=1.106x
- gemini-3.1-pro-preview: PAID_CURRENT=1.055x GLOBAL15=1.107x
- gemini-3.7-flash: PAID_CURRENT=1.055x GLOBAL15=1.107x
- gpt-5.6-terra: PAID_CURRENT=1.055x GLOBAL15=1.107x

## TURN PRICE AMPLIFICATION (T2000 PEAK, output=3200 canonical)
- deepseek-v4-pro-0813: PAID_CURRENT=1.048x GLOBAL15=1.091x (Δ9.1%)
- gemini-3.1-pro-preview: PAID_CURRENT=1.040x GLOBAL15=1.077x (Δ7.7%)
- gemini-3.7-flash: PAID_CURRENT=1.040x GLOBAL15=1.078x (Δ7.8%)
- gpt-5.6-terra: PAID_CURRENT=1.040x GLOBAL15=1.076x (Δ7.6%)

## MEMORY COST PASS-THROUGH (GLOBAL15 vs PAID_CURRENT, T2000 PEAK)
- deepseek-v4-pro-0813: FULLY_RECOVERED
- gemini-3.1-pro-preview: FULLY_RECOVERED
- gemini-3.7-flash: FULLY_RECOVERED
- gpt-5.6-terra: FULLY_RECOVERED

## DUPLICATION / OVERLAP (PAID_CURRENT peak samples)
- DUPLICATE_PROMPT_BLOAT = NO (0 fixtures flagged)

## POINT TOP-UP ECONOMICS — SECONDARY (SIMULATION ONLY)
| KRW | normal P | subscriber P | bonus P |
|---:|---:|---:|---:|
| 5000 | 5000 | 5250 | 250 |
| 10000 | 10000 | 10500 | 500 |
| 30000 | 31500 | 33000 | 1500 |
| 50000 | 52500 | 55000 | 2500 |
| 100000 | 107000 | 112000 | 5000 |

## FINAL CLASSIFICATION
- PRODUCTION_SHA = d593069fdaf476bfb6d547d675034925e8175e96
- AUDIT_TOKEN_MODE = REAL_ASSEMBLY_LOCAL_ESTIMATE
- PROVIDER_CALIBRATION = INSUFFICIENT_DATA
- COMPETITOR_BENCHMARK = NOT_PERFORMED_IN_THIS_AUDIT
- POINT_TOPUP_SUBSCRIBER_BONUS = SIMULATION_ONLY
- PROVIDER_GENERATION_CALLS = 0
- RUNTIME_CHANGE = NO
- MERGE = NO
- MAX_FREE_INPUT_deepseek-v4-pro-0813 = 41067
- MAX_PAID_CURRENT_INPUT_deepseek-v4-pro-0813 = 43317
- MAX_PAID_GLOBAL15_INPUT_deepseek-v4-pro-0813 = 47911
- MAX_PAID_GLOBAL20_INPUT_deepseek-v4-pro-0813 = 52505
- PAID_CURRENT_INPUT_AMPLIFICATION_deepseek-v4-pro-0813 = 1.0548
- GLOBAL15_INPUT_AMPLIFICATION_deepseek-v4-pro-0813 = 1.1061
- PAID_CURRENT_TURN_PRICE_AMPLIFICATION_deepseek-v4-pro-0813 = 1.0476
- GLOBAL15_TURN_PRICE_AMPLIFICATION_deepseek-v4-pro-0813 = 1.0909
- PAID_CURRENT_PEAK_TURN_P_deepseek-v4-pro-0813 = 66
- GLOBAL15_PEAK_TURN_P_deepseek-v4-pro-0813 = 72
- GLOBAL15_P_DELTA_PERCENT_deepseek-v4-pro-0813 = 9.09
- LONG_RP_PRICE_DRIFT_T100_TO_T2000_deepseek-v4-pro-0813 = 1.54%
- MEMORY_INCREMENTAL_COST_RECOVERY_deepseek-v4-pro-0813 = FULLY_RECOVERED
- MAX_FREE_INPUT_gemini-3.1-pro-preview = 40819
- MAX_PAID_CURRENT_INPUT_gemini-3.1-pro-preview = 43069
- MAX_PAID_GLOBAL15_INPUT_gemini-3.1-pro-preview = 47663
- MAX_PAID_GLOBAL20_INPUT_gemini-3.1-pro-preview = 52256
- PAID_CURRENT_INPUT_AMPLIFICATION_gemini-3.1-pro-preview = 1.0551
- GLOBAL15_INPUT_AMPLIFICATION_gemini-3.1-pro-preview = 1.1067
- PAID_CURRENT_TURN_PRICE_AMPLIFICATION_gemini-3.1-pro-preview = 1.0402
- GLOBAL15_TURN_PRICE_AMPLIFICATION_gemini-3.1-pro-preview = 1.0772
- PAID_CURRENT_PEAK_TURN_P_gemini-3.1-pro-preview = 259
- GLOBAL15_PEAK_TURN_P_gemini-3.1-pro-preview = 279
- GLOBAL15_P_DELTA_PERCENT_gemini-3.1-pro-preview = 7.72
- LONG_RP_PRICE_DRIFT_T100_TO_T2000_gemini-3.1-pro-preview = 1.57%
- MEMORY_INCREMENTAL_COST_RECOVERY_gemini-3.1-pro-preview = FULLY_RECOVERED
- MAX_FREE_INPUT_gemini-3.7-flash = 40543
- MAX_PAID_CURRENT_INPUT_gemini-3.7-flash = 42793
- MAX_PAID_GLOBAL15_INPUT_gemini-3.7-flash = 47386
- MAX_PAID_GLOBAL20_INPUT_gemini-3.7-flash = 51980
- PAID_CURRENT_INPUT_AMPLIFICATION_gemini-3.7-flash = 1.0555
- GLOBAL15_INPUT_AMPLIFICATION_gemini-3.7-flash = 1.1073
- PAID_CURRENT_TURN_PRICE_AMPLIFICATION_gemini-3.7-flash = 1.0404
- GLOBAL15_TURN_PRICE_AMPLIFICATION_gemini-3.7-flash = 1.0777
- PAID_CURRENT_PEAK_TURN_P_gemini-3.7-flash = 103
- GLOBAL15_PEAK_TURN_P_gemini-3.7-flash = 111
- GLOBAL15_P_DELTA_PERCENT_gemini-3.7-flash = 7.77
- LONG_RP_PRICE_DRIFT_T100_TO_T2000_gemini-3.7-flash = 1.98%
- MEMORY_INCREMENTAL_COST_RECOVERY_gemini-3.7-flash = FULLY_RECOVERED
- MAX_FREE_INPUT_gpt-5.6-terra = 40543
- MAX_PAID_CURRENT_INPUT_gpt-5.6-terra = 42793
- MAX_PAID_GLOBAL15_INPUT_gpt-5.6-terra = 47386
- MAX_PAID_GLOBAL20_INPUT_gpt-5.6-terra = 51980
- PAID_CURRENT_INPUT_AMPLIFICATION_gpt-5.6-terra = 1.0555
- GLOBAL15_INPUT_AMPLIFICATION_gpt-5.6-terra = 1.1073
- PAID_CURRENT_TURN_PRICE_AMPLIFICATION_gpt-5.6-terra = 1.0395
- GLOBAL15_TURN_PRICE_AMPLIFICATION_gpt-5.6-terra = 1.0761
- PAID_CURRENT_PEAK_TURN_P_gpt-5.6-terra = 368
- GLOBAL15_PEAK_TURN_P_gpt-5.6-terra = 396
- GLOBAL15_P_DELTA_PERCENT_gpt-5.6-terra = 7.61
- LONG_RP_PRICE_DRIFT_T100_TO_T2000_gpt-5.6-terra = 1.66%
- MEMORY_INCREMENTAL_COST_RECOVERY_gpt-5.6-terra = FULLY_RECOVERED
- ANY_GLOBAL15_60K_PLUS = NO
- ANY_GLOBAL20_60K_PLUS = NO
- GLOBAL15_CRITICAL_CONTEXT_LOSS = NO
- DUPLICATE_PROMPT_BLOAT = NO
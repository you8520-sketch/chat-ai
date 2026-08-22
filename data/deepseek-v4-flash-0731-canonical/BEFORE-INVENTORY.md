# Before-audit Flash occurrence inventory

BASE_SHA=`3a87d14d2ac9c5771ebffaf9564b0700c75b091b`

Raw `rg` output: `before-rg.txt`.

Classification key:
- A active provider outbound
- B user selectedAI
- C background memory/status/HTML/etc
- D translation
- E fallback
- F pricing/billing
- G legacy DB/receipt compatibility
- H tests/scripts/docs

| File | Occurrence | Class | Note |
|---|---|---|---|
| `src/lib/chatModels.ts` | `CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL = "deepseek-v4-flash"` | A/B/C | Canonical constant was the generic id |
| `src/lib/chatModels.ts` | `CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_0731_MODEL = "deepseek-v4-flash-0731"` | D | Translation-only dated id |
| `src/lib/chatModels.ts` | `OPENROUTER_DEEPSEEK_V4_FLASH_MODEL = "deepseek/deepseek-v4-flash"` | E | OpenRouter cross-provider fallback slug |
| `src/lib/chatModels.ts` | `OPENROUTER_DEEPSEEK_V3_MODEL` | E/G | Legacy V3 slug remapped to Flash role |
| `src/lib/chatModels.ts` | `SELECTED_AI_OPTIONS` Flash id = generic flash | B | New UI selection used generic id |
| `src/lib/chatModels.ts` | `isCheaperInferenceDeepSeekV4FlashModel` | A/B/G | Recognized generic + 0731 |
| `src/lib/chatModels.ts` | `coerceUserSelectableAI` remapped Flash → Pro | B | Stored Flash collapsed to Pro |
| `src/lib/cheaperInferenceConfig.ts` | Flash recognized, not canonicalized | A | Provider boundary sent generic id as-is |
| `src/lib/ai.ts` | `resolveBackgroundTextModelId` empty/V3 → generic flash | C | Active background primary |
| `src/lib/ai.ts` | `BACKGROUND_OPENROUTER_MODEL` | C | Module default from env / generic flash |
| `src/lib/ai.ts` | memory fallback → OpenRouter V4 Flash | E | Different provider, keep OpenRouter |
| `src/lib/promptTranslation.ts` | default primary 0731 | D | Already dated slug |
| `src/lib/chatImageSceneBrief.ts` | default generic flash; OpenRouter fallback | C/E | Active scene-brief primary |
| `src/lib/statusWidget/extract.ts` | primary `BACKGROUND_OPENROUTER_MODEL`; fallback OpenRouter flash | C/E | Status extract |
| `src/lib/htmlVisualCardRecovery.ts` | `callBackgroundMemory(..., background-html-visual-card)` | C | HTML flash uses background primary |
| `src/lib/points.ts` | HTML-only billing uses Flash constant | F | Follows canonical constant |
| `src/lib/pointsReasoningMargins.ts` | Flash rate table keyed by generic constant | F | Same 0.098/0.196/0.68 policy |
| `src/lib/openRouterModelPricing.ts` | generic + 0731 share CI rates; OpenRouter slug separate | F/G | 0731 already same CI rate table |
| `src/lib/adminFinance.ts` | exact `deepseek-v4-flash` receipt/ledger match | F/G | Historical generic id only |
| `src/lib/statusWidget/receiptUsage.ts` | label via constant + `includes("deepseek-v4-flash")` | G | Receipt display |
| `src/lib/trpg/scenarioDraft.ts` | uses 0731 constant | A/C | TRPG draft already dated |
| `.env.example` | `BACKGROUND_MEMORY_MODEL=deepseek-v4-flash` | C/H | Env default generic id |
| `.env.example` | commented OpenRouter fallback / 0731 translation | E/D/H | Docs |
| `scripts/*` | probe/dump/reaudit | H | Offline scripts |
| `src/**/*.test.ts` | assertions on generic and 0731 ids | H | Including picker-hide remap-to-Pro |

OpenRouter slug `deepseek/deepseek-v4-flash` is a real OpenRouter fallback path (endpoint/key/billing owner = OpenRouter). It is not rewritten to a CheaperInference slug.

V3 `deepseek/deepseek-chat-v3-0324` is compatibility-only and already remapped to the Flash role for primary background text.

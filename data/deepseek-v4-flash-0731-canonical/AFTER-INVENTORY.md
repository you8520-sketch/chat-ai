# After-audit Flash occurrence inventory

HEAD will be recorded in SUMMARY.md. Raw `rg` output: `after-rg.txt`.

## Remaining exact `deepseek-v4-flash` (not `0731`, not OpenRouter slash)

Allowed leftovers only:

| File | Why allowed |
|---|---|
| `src/lib/chatModels.ts` `CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_LEGACY_MODEL` | LEGACY_MODEL constant |
| `src/lib/chatModels.ts` `LEGACY_TO_SELECTED["deepseek-v4-flash"]` | old DB selectedAI input |
| `src/lib/openRouterModelPricing.ts` `id === "deepseek-v4-flash"` | historical receipt/pricing lookup (same rate table as 0731) |
| `src/lib/statusWidget/receiptUsage.ts` `includes("deepseek-v4-flash")` | receipt label for generic + dated ids |
| `src/lib/adminFinance.ts` SQL/JS via `isCheaperInferenceDeepSeekV4FlashModel` + both ids | historical ledger + new 0731 ledger |
| `src/lib/pointsReasoningMargins.ts` `MARKET_PREVIEW_DIRECT_RATES[LEGACY]` | preview/receipt key compatibility |
| `.env.example` comment | explicit legacy documentation |
| `scripts/d0-length-reaudit.ts` fallback string | historical script default |
| `src/lib/**/*.test.ts` literals | compatibility tests / legacy input |

## Active provider outbound

`adaptCheaperInferenceChatBody()` rewrites Flash to `deepseek-v4-flash-0731` before send.

No production path constructs `"model": "deepseek-v4-flash"` as a new request body.

OpenRouter fallback slug `deepseek/deepseek-v4-flash` remains a different-provider failure-only path (OpenRouter endpoint/key/billing). It is not rewritten to a CheaperInference slug.

## Active call sites now on 0731

- user-chat Flash selection / stored Flash read → 0731
- background memory / rolling summary / lorebook compact
- status widget extract primary
- HTML visual card / HTML-only billing model id
- character-save KO→EN translation primary
- chat image scene brief default
- TRPG draft/director/reply-suggestion/mechanics constants (already 0731 alias)

## Intentionally unchanged

- DeepSeek V4 Pro outbound `deepseek-v4-pro-0813`
- adult refusal/handoff primary V4 Pro
- OpenRouter V4 Flash fallback slug
- Flash point formula / margin 0.68 / CI catalog 0.098 / 0.196

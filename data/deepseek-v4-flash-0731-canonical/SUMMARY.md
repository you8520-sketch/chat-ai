# DeepSeek V4 Flash 0731 canonical migration

BASE_SHA=`3a87d14d2ac9c5771ebffaf9564b0700c75b091b`

DEEPSEEK_V4_FLASH_CANONICAL_OUTBOUND=`deepseek-v4-flash-0731`
DEEPSEEK_V4_FLASH_LEGACY_INPUT=`deepseek-v4-flash`
NEW_FLASH_GENERIC_OUTBOUND_COUNT=0
DEEPSEEK_V4_PRO_OUTBOUND=`deepseek-v4-pro-0813`
PRODUCTION_DB_WRITES=0
LIVE_PROVIDER_CALLS=0
MERGED=false
DEPLOYED=false

## Validation

```
git diff --check
# clean

npm run typecheck:app
# exit 0

npm run lint
# exit 0 (delegates to typecheck:app)

node --conditions=react-server --import tsx --test \
  src/lib/deepseekV4FlashCanonical.test.ts \
  src/lib/cheaperInferenceConfig.test.ts \
  src/lib/chatModels.deepseekFlashPickerHide.test.ts \
  src/lib/chatModels.cheaperInference.test.ts \
  src/lib/openRouterCompletion.cheaperInference.test.ts \
  src/lib/chatImageSceneBrief.test.ts \
  src/lib/userSelectedAI.test.ts \
  src/lib/adminFinance.test.ts \
  src/lib/ai.cheaperInferenceBackground.test.ts \
  src/lib/promptTranslation.test.ts \
  src/lib/points.flashOnly.test.ts \
  src/lib/points.deepseekCheaperInference.test.ts \
  src/lib/openRouterModelPricing.cheaperInference.test.ts \
  src/lib/deepseekV4ProCanonical.test.ts \
  src/lib/chatModels.opus5UserDisable.test.ts \
  src/app/api/user/selected-ai/route.test.ts \
  src/lib/billingReceiptAccess.test.ts \
  src/lib/statusWidget/receiptUsage.test.ts
# tests 138  pass 138  fail 0

node --conditions=react-server --import tsx --test \
  src/lib/statusWidget/extractV4Fallback.test.ts \
  src/lib/trpg/runtimeContract.test.ts \
  src/lib/trpg/scenarioDraft.test.ts \
  src/lib/points.flashOnly.test.ts
# tests 25  pass 25  fail 0
```

## Pricing report (no formula change)

Existing CI Flash rate table already listed the same numbers for both `deepseek-v4-flash` and `deepseek-v4-flash-0731`:

- input 0.098 / cache read 0.0196 / cache write 0.098 / output 0.196 USD per 1M
- gross margin 0.68

No separate 0731 price table was invented.

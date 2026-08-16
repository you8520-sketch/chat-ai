# CLEAN follow-up mechanical facts

Winner fields are not decided here.

```text
DEEPSEEK_CLEAN_VS_LEGACY_WINNER = HUMAN_REVIEW_REQUIRED
QWEN_FRAGMENTATION_VERDICT = HUMAN_REVIEW_REQUIRED
FINAL_ADULT_MODEL_WINNER = HUMAN_REVIEW_REQUIRED
SOURCE_API_CALLS = 0
QWEN_THINKING_RETEST = NO
QWEN_LENGTH_TUNING = NO
```

## API

```text
DEEPSEEK_CLEAN_CALLS = 2
QWEN_FINALIZER_CALLS = 0
QWEN_FRAGMENT_CALLS = 2
TOTAL_NEW_API_CALLS = 4
retry = 0
continuation = 0
recovery = 0
fallback = 0
OPUS_DS_CLEAN_STATUS = 200
GEMINI_DS_CLEAN_STATUS = 200
```

DeepSeek CLEAN sampling stayed `temperature = 0.92`, `top_p = 0.92`, `thinking = { type: "disabled" }`.
Qwen fragment-minimal stayed `reasoning_effort = none`.

## Prompt size (ESTIMATED)

```text
legacy_system_chars opus = 17430
clean_system_chars opus = 17403
legacy_system_chars gemini = 17449
clean_system_chars gemini = 17422
legacy_est_input_tokens opus = 20889
clean_est_input_tokens opus = 20614
legacy_est_input_tokens gemini = 19262
clean_est_input_tokens gemini = 18987
removed_deepseek_specific_chars = 306
removed_deepseek_specific_est_tokens = 276
estimator = ESTIMATED
```

CLEAN removed the DeepSeek style-only reminder and DeepSeek XML wrapping. Handoff continuation instruction stayed present.

## Qwen finalizer (0 API)

```text
QWEN_OPUS_RAW_PARAGRAPHS = 120
QWEN_OPUS_FINALIZED_PARAGRAPHS = 120
QWEN_GEMINI_RAW_PARAGRAPHS = 69
QWEN_GEMINI_FINALIZED_PARAGRAPHS = 69
QWEN_FRAGMENT_RETEST_REQUIRED = true
```

Production `normalizeAiNovelProseLayout()` did not reduce paragraph counts. Short same-speaker dialogue runs and 1–2 sentence narration fragments remained, and Gemini finalized paragraphs were 2.76× the Gemini source.

## Qwen fragment-minimal (2 API)

```text
opus_fragment_paragraphs = 64
gemini_fragment_paragraphs = 60
opus_fragment_http = 200
gemini_fragment_http = 200
```

Full texts: `CLEAN_FOLLOWUP_DIRECT_REVIEW.md`.

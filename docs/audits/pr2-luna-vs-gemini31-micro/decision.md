# Translation model policy decision (PR-698)

## Current production policy

```text
CURRENT_PRODUCTION_PRIMARY=gpt-5.6-luna
CURRENT_PRODUCTION_FALLBACK=gemini-3.1-flash-lite
```

## Primary reason (GPT-5.6 Luna)

- Quality near-tie with Gemini 3.1 Flash-Lite in blind micro-bench review
- Luna faster on median/mean latency in the 5-fixture micro workload
- Luna currently cheaper at promotional pricing
- 5/5 successful requests in micro-bench

## Fallback reason (Gemini 3.1 Flash-Lite)

- Gemini quality was at least competitive in blind review
- Gemini 5/5 successful in micro-bench
- DeepSeek V4 Flash showed a real translation transport `body_timeout` on run-01 (F05-B)

## DeepSeek V4 Flash status

```text
FULL_V4_RUN02_STATUS=CANCELLED_BY_PRODUCT_DECISION
```

The 40-call Luna vs DeepSeek V4 Flash run-02 is no longer required for this production model choice. Run-01 transport evidence remains preserved under `docs/audits/pr2-translation-ab/runs/run-01/`.

## Price reevaluation policy

Re-check Luna and Gemini 3.1 Flash-Lite market pricing when Luna's current promotional pricing changes or ends.

```text
DO_NOT_AUTO_SWITCH=true
```

At reevaluation:

1. Read current actual provider prices
2. Compare price per representative ~10k Korean-character translation
3. If Luna remains materially cheaper, keep Luna primary
4. If Luna and Gemini reach near-price parity or Gemini becomes cheaper, reconsider Gemini as primary using the preserved quality evidence
5. Do not switch automatically without explicit human decision

Do not hard-code an unverified promotion end date into production logic.

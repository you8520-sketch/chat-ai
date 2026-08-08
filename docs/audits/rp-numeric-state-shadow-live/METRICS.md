# METRICS

Source: live `[RpNumericShadow]` server logs (not offline reconstruction).

## All live observations (incl. bootstrap)

```json
{
  "total_observations": 27,
  "parser_valid_rate": 1,
  "invalid_hold_rate": 0,
  "baseline_previous_status_rate": 0.8888888888888888,
  "baseline_definition_initial_rate": 0.1111111111111111,
  "baseline_invalid_rate": 0,
  "APPLIED_rate": 0.5185185185185185,
  "NO_CHANGE_rate": 0.48148148148148145,
  "DELTA_LIMITED_UP_rate": 0,
  "DELTA_LIMITED_DOWN_rate": 0,
  "CLAMPED_MIN_rate": 0,
  "CLAMPED_MAX_rate": 0,
  "INTEGER_COERCED_rate": 0,
  "proposal_formats": {
    "plain_numeric": 27
  },
  "mean_abs_proposed_delta": 1.8518518518518519,
  "median_abs_proposed_delta": 2,
  "p90_abs_proposed_delta": 5,
  "max_abs_proposed_delta": 5,
  "mean_abs_applied_delta": 1.8518518518518519,
  "by_state": {
    "affection": {
      "observations": 9,
      "valid_rate": 1,
      "invalid_rate": 0,
      "avg_proposed_delta": 2.3333333333333335,
      "limit_rate": 0
    },
    "trust": {
      "observations": 9,
      "valid_rate": 1,
      "invalid_rate": 0,
      "avg_proposed_delta": 2.6666666666666665,
      "limit_rate": 0
    },
    "corruption": {
      "observations": 9,
      "valid_rate": 1,
      "invalid_rate": 0,
      "avg_proposed_delta": 0.5555555555555556,
      "limit_rate": 0
    }
  }
}
```

## Measured turns only (exclude first bootstrap trio)

```json
{
  "total_observations": 24,
  "parser_valid_rate": 1,
  "invalid_hold_rate": 0,
  "baseline_previous_status_rate": 1,
  "baseline_definition_initial_rate": 0,
  "baseline_invalid_rate": 0,
  "APPLIED_rate": 0.5,
  "NO_CHANGE_rate": 0.5,
  "DELTA_LIMITED_UP_rate": 0,
  "DELTA_LIMITED_DOWN_rate": 0,
  "CLAMPED_MIN_rate": 0,
  "CLAMPED_MAX_rate": 0,
  "INTEGER_COERCED_rate": 0,
  "proposal_formats": {
    "plain_numeric": 24
  },
  "mean_abs_proposed_delta": 1.6666666666666667,
  "median_abs_proposed_delta": 0,
  "p90_abs_proposed_delta": 5,
  "max_abs_proposed_delta": 5,
  "mean_abs_applied_delta": 1.6666666666666667,
  "by_state": {
    "affection": {
      "observations": 8,
      "valid_rate": 1,
      "invalid_rate": 0,
      "avg_proposed_delta": 2,
      "limit_rate": 0
    },
    "trust": {
      "observations": 8,
      "valid_rate": 1,
      "invalid_rate": 0,
      "avg_proposed_delta": 2.375,
      "limit_rate": 0
    },
    "corruption": {
      "observations": 8,
      "valid_rate": 1,
      "invalid_rate": 0,
      "avg_proposed_delta": 0.625,
      "limit_rate": 0
    }
  }
}
```

## Q1 / Q2 / Q3

- Q1 plain/valid rate = 1 (formats={"plain_numeric":27})
- Q2 |proposed delta| > max configured: **not observed** in this pilot (max abs proposed = 5; DELTA_LIMITED_* = 0). Extractor stayed within caps.
- Q3 over-clamp: **not observed** (limit_rate = 0).

# D5-B1 — Provider Isolation (G6-T1)

Sole variable: `provider.only` (harness-only, after production assemble).

```json
{
  "provider_winner": "NONE",
  "PROVIDER_STABILITY": "FAIL",
  "PROVIDER_PINNING_NOT_SUFFICIENT": true,
  "by_arm": {
    "P1": {
      "slug": "google-vertex",
      "chars": [
        3096,
        1715,
        1106
      ],
      "min": 1106,
      "max": 3096,
      "median": 1715,
      "max_min_ratio": 2.7992766726943943,
      "reasoning_median": 2731,
      "lt_1800": 2,
      "ge_2400": 1,
      "ge_3000": 1,
      "gate": "FAIL",
      "providers_actual": [
        "Google",
        "Google",
        "Google"
      ]
    },
    "P2": {
      "slug": "google-ai-studio",
      "chars": [
        2936,
        862,
        1549
      ],
      "min": 862,
      "max": 2936,
      "median": 1549,
      "max_min_ratio": 3.406032482598608,
      "reasoning_median": 1439,
      "lt_1800": 2,
      "ge_2400": 1,
      "ge_3000": 0,
      "gate": "FAIL",
      "providers_actual": [
        "Google AI Studio",
        "Google AI Studio",
        "Google AI Studio"
      ]
    }
  }
}
```

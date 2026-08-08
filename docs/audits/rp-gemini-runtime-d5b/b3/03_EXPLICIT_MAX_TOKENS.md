# D5-B3 — Explicit Output Budget

Sole variable: `max_tokens` absent vs explicit repo constant 8192.
Provider pinned: `google-vertex` (B1 diagnostic owner).
Arm A reused from B1 P1 (0 new calls).

```json
{
  "EXPLICIT_MAX_TOKENS_CAUSAL": "NO",
  "EXPLICIT_MAX_TOKENS_NOT_CAUSAL": false,
  "arm_A_absent": {
    "chars": [
      3096,
      1715,
      1106
    ],
    "median": 1715,
    "max_min_ratio": 2.7992766726943943,
    "lt_1800": 2
  },
  "arm_B_explicit": {
    "chars": [
      1133,
      2013,
      3024
    ],
    "median": 2013,
    "max_min_ratio": 2.669020300088261,
    "lt_1800": 1
  },
  "api_calls_this_run": 3
}
```

# D5-A Stage1 Live — Gemini production-A stability baseline

API calls this run: **9** / target 9

Production prompt: BYTE_IDENTICAL (prompt delta 0, owner rewrite 0).
quality retry / continuation / recovery = 0.

```json
{
  "GEMINI_INTRINSIC_LENGTH_VARIANCE": "HIGH",
  "length_distribution_overall": {
    "n": 9,
    "min": 606,
    "max": 2699,
    "mean": 1508.4444444444443,
    "median": 1522,
    "max_min_ratio": 4.4537953795379535,
    "rate_ge_3200": 0,
    "rate_ge_3000": 0,
    "rate_2400_2999": 0.1111111111111111,
    "rate_1800_2399": 0.2222222222222222,
    "rate_lt_1800": 0.6666666666666666
  },
  "by_fixture": {
    "G5": {
      "chars_draw": [
        1855,
        690,
        1463
      ],
      "min": 690,
      "max": 1855,
      "median": 1463,
      "max_min_ratio": 2.6884057971014492
    },
    "G6T1": {
      "chars_draw": [
        606,
        2699,
        881
      ],
      "min": 606,
      "max": 2699,
      "median": 881,
      "max_min_ratio": 4.4537953795379535
    },
    "G3": {
      "chars_draw": [
        1522,
        1659,
        2201
      ],
      "min": 1522,
      "max": 2201,
      "median": 1659,
      "max_min_ratio": 1.4461235216819974
    }
  }
}
```

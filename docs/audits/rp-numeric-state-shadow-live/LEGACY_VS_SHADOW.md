# LEGACY_VS_SHADOW

| TURN_IDX | STATE | PREVIOUS | LEGACY STORED | SHADOW AFTER | DIFFERENCE | REGEN |
|---:|---|---|---:|---:|---:|---|
| 0 | affection | (definition_initial) | 25 | 25 | 0 | false |
| 0 | trust | (definition_initial) | 35 | 35 | 0 | false |
| 0 | corruption | (definition_initial) | 0 | 0 | 0 | false |
| 1 | affection | 25 | 28 | 28 | 0 | false |
| 1 | trust | 35 | 38 | 38 | 0 | false |
| 1 | corruption | 0 | 0 | 0 | 0 | false |
| 2 | affection | 28 | 30 | 30 | 0 | false |
| 2 | trust | 38 | 40 | 40 | 0 | false |
| 2 | corruption | 0 | 0 | 0 | 0 | false |
| 3 | affection | 30 | 35 | 35 | 0 | false |
| 3 | trust | 40 | 45 | 45 | 0 | false |
| 3 | corruption | 0 | 0 | 0 | 0 | false |
| 4 | affection | 35 | 35 | 35 | 0 | false |
| 4 | trust | 45 | 40 | 40 | 0 | false |
| 4 | corruption | 0 | 0 | 0 | 0 | false |
| 5 | affection | 35 | 35 | 35 | 0 | false |
| 5 | trust | 40 | 40 | 40 | 0 | false |
| 5 | corruption | 0 | 5 | 5 | 0 | false |
| 6 | affection | 35 | 38 | 38 | 0 | false |
| 6 | trust | 40 | 42 | 42 | 0 | false |
| 6 | corruption | 5 | 5 | 5 | 0 | false |

Note: difference 0 means legacy absolute stored equals shadow hypothetical for that turn (no clamp needed). Non-zero would indicate reducer would have diverged from legacy absolute.

# HIDDEN_MAP_REVEAL

```text
HUMAN_SCORES_SEALED_BEFORE_MAP_REVEAL = true
HUMAN_SCORES_SHA256 = 2f15d973693824f18c6f91848119b703a97e034abae646c1045dc5f58e3038f0
HIDDEN_MAP_SEAL_SHA256_BEFORE_REVEAL = 5c35dcb978dfeadcc403b566cd636ad95a47ed871d3d493d5335a0c75099ffd8
HIDDEN_MAP_SEAL_VERIFIED = true
reveal_order: scores saved → SHA-256 → seal recorded → map seal verified → map revealed
```

## Identity unlock

Candidates were only:

```text
deepseek-v4-pro
meta/muse-spark-1.2
```

| Source | Blind X | Blind Y |
|---|---|---|
| Opus | `meta/muse-spark-1.2` | `deepseek-v4-pro` |
| Terra | `meta/muse-spark-1.2` | `deepseek-v4-pro` |
| Gemini | `meta/muse-spark-1.2` | `deepseek-v4-pro` |

```text
Opus:   X = Muse Spark 1.2 · Y = DeepSeek V4 Pro
Terra:  X = Muse Spark 1.2 · Y = DeepSeek V4 Pro
Gemini: X = Muse Spark 1.2 · Y = DeepSeek V4 Pro
```

## Blind winners → model winners

| Source | Blind winner | Model | Formal human-approved anchor |
|---|---|---|---|
| Opus | X | Muse Spark 1.2 | YES |
| Terra | Y | DeepSeek V4 Pro | YES |
| Gemini | X | Muse Spark 1.2 | NO |

```text
raw model pair wins: Muse = 2, DeepSeek = 1
human-approved-only: Muse = 1, DeepSeek = 1
```

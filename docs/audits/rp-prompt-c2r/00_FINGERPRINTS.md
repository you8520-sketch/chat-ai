# C2-R Offline Fingerprints

| Arm | SHA256 | chars | est tokens | changed clauses | firstΔ | lastΔ |
|-----|--------|-------|------------|-----------------|--------|-------|
| A | `cb2811fd73a8bbee…` | 1637 | 1474 | — | — | — |
| M1 | `12c5933398143991…` | 1630 | 1467 | P02_NARRATION_TRANSLATIONESE, P07_RHYTHM_SHORT_SENTENCE | 102 | 1636 |
| M2 | `24f058fdd447cdc4…` | 1610 | 1449 | P05_SCENE_FLOW_QUIET, P18_IMMERSIVE_QUIET | 264 | 1636 |
| AB | `76d0723b9e4c7d6c…` | 1603 | 1443 | P02_NARRATION_TRANSLATIONESE, P07_RHYTHM_SHORT_SENTENCE, P05_SCENE_FLOW_QUIET, P18_IMMERSIVE_QUIET | 102 | 1636 |

## M2 change kind

```json
{
  "wording_change": true,
  "position_change": true,
  "recency_order_change": "quiet-scene clause moves earlier (SCENE FLOW before IMMERSIVE); OUTPUT-LAYOUT recency line unchanged"
}
```

## Isolation

**PASS** — M1⊂NARRATION/RHYTHM, M2⊂SCENE FLOW/IMMERSIVE quiet, AB=M1∘M2

## NSFW ON estimated tokens (full guidelines)

```json
{
  "A": 1709,
  "M1": 1702,
  "M2": 1684,
  "AB": 1678
}
```

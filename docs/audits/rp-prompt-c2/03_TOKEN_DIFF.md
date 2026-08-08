# 03_TOKEN_DIFF

| Arm | NSFW OFF | NSFW ON |
|-----|----------|---------|
| A (prod) | 1572 | 1709 |
| B (C2-Micro) | 1542 | 1679 |
| Δ | 30 (1.91%) | 30 (1.76%) |

Preferred band NSFW ON: **1450~1550**. B is above that band because only exact/near-exact duplicates were removed (M1+M2 only).

- under_1400_fail_review: **false**
- live_allowed (exact dupes documented): **yes** if matrix PASS

Note: prose lives mainly in `cacheCharacter`; C2 is not primarily per-turn uncached cost reduction.

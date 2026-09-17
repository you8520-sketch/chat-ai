# 01_PROSE_CLAUSE_MATRIX

**Allowed statuses only:** PRESERVED_EXACT / PRESERVED_MERGED / UNCHANGED

**Forbidden:** MISSING / NEW_MEANING / WEAKENED → blocks live test

| ID | Source | Status | K | Note |
|----|--------|--------|---|------|
| P01 | NARRATION REGISTER | PRESERVED_EXACT | K1 | byte-identical opening line |
| P02 | NARRATION REGISTER | PRESERVED_MERGED | K2 | M1 — folded into RHYTHM short-sentence owner |
| P03 | NARRATION REGISTER | PRESERVED_EXACT |  | unchanged |
| P04 | SCENE FLOW | PRESERVED_EXACT | K13 | calm != short preserved |
| P05 | SCENE FLOW | PRESERVED_MERGED | K13 | M2 primary owner — merged with IMMERSIVE quiet-scene clause |
| P06 | RHYTHM | PRESERVED_EXACT | K3 | unchanged |
| P07 | RHYTHM | PRESERVED_MERGED | K2,K4 | M1 — consolidated with P02 into one concise owner |
| P08 | RHYTHM | PRESERVED_EXACT |  | unchanged |
| P09 | SENSATION | UNCHANGED | K5 | FROZEN — sensation block byte-identical |
| P10 | IMMERSIVE | PRESERVED_EXACT | K6 | unchanged |
| P11 | IMMERSIVE | PRESERVED_EXACT | K8-rep | M3 KEEP SEPARATE — repetition owner |
| P12 | IMMERSIVE | PRESERVED_EXACT |  | unchanged |
| P13 | IMMERSIVE | UNCHANGED | K9,K10 | FROZEN dialogue quality |
| P14 | IMMERSIVE | UNCHANGED | K11 | FROZEN |
| P15 | IMMERSIVE | UNCHANGED | K12 | FROZEN |
| P16 | IMMERSIVE | PRESERVED_EXACT | K8-tell | M3 KEEP SEPARATE — tell-after-show owner |
| P17 | IMMERSIVE | PRESERVED_EXACT | K7 | unchanged |
| P18 | IMMERSIVE | PRESERVED_MERGED | K13 | M2 — removed from IMMERSIVE; meaning folded into SCENE FLOW primary wording (anti-summary + change-driven progress + no padding) |
| P19 | IMMERSIVE | PRESERVED_EXACT | K14 | unchanged |
| P20 | WEBNOVEL BREATH | UNCHANGED |  | FROZEN — C2-S NOT_RUN |
| P21 | 19+ INTIMACY | UNCHANGED | K15 | NSFW block untouched (outside prose style body) |

## Matrix: **PASS**

### Content checks

```json
{
  "m1_owner_present": true,
  "m1_no_orphan_register_line": true,
  "m2_primary_in_scene_flow": true,
  "m2_removed_from_immersive": true,
  "m3_rep_kept": true,
  "m3_tell_kept": true,
  "breath_unchanged": true,
  "sensation_unchanged": true,
  "no_new_literary_boosters": true
}
```

> Behavioral-anchor warning: semantic PASS ≠ behavioral safety (C1).

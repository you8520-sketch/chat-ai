# MAPPED_HUMAN_VERDICT — Audit 57

## Seal chain

```text
HUMAN_BLIND_REVIEW_COMPLETE
HIDDEN_MAP_NOT_OPENED_DURING_SCORING
human score SHA-256: c637b7e584ac14aefad0547fa128a4ea259b3fd259d0d0647cc4fbff4da1554a
hidden-map expected seal: ad064b0345e2c50be5043482949764bca22d92986795f8749a41c52e1b520ea7
hidden-map actual SHA-256: ad064b0345e2c50be5043482949764bca22d92986795f8749a41c52e1b520ea7
HIDDEN_MAP_SEAL_VERIFIED
```

Scores were committed before map reveal. No arm winner was declared before verification.

---

## Side → arm mapping (verified)

| Scenario | T1 A/B/C | T2 A/B/C |
|---|---|---|
| rel_start | D / B / A | A / D / B |
| rel_conflict | D / B / A | B / A / D |
| quiet_daily | A / D / B | B / A / D |
| action_combat_1 | D / A / B | A / D / B |
| action_combat_2 | A / D / B | A / B / D |
| memory_continuity | D / B / A | A / D / B |

---

## Arm aggregates

| Arm | mean | median | min | max | severe | moderate | clean | median visible chars | ≥2400 | avg cost KRW |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A | 82.67 | 88 | 50 | 94 | 2 | 5 | 5 | 2826 | 11/12 | 136.0 |
| B | 83.17 | 84 | 78 | 87 | 0 | 4 | 8 | 1041 | 0/12 | 51.1 |
| D | 83.42 | 90 | 48 | 94 | **2** | 1 | 9 | 3024.5 | 12/12 | 124.7 |

Category means (Arm D): relationship 92.25 · quiet 86 · action **71.5** · memory 87

Pairwise blind preference **D > B**: **9/12 (75%)**

Cost: Arm D avg ≤ Arm A +10% (**PASS**: 124.7 ≤ 149.6)

Length: median in 2800–4200 (**PASS**); ≥2400 = 12/12 (**PASS**)

---

## Severe takeovers mapped to arms

| Cell | Side | Arm | Note |
|---|---|---|---|
| rel_start T2 | A | **A** | meal invite → accompaniment / cafeteria chain |
| action_combat_2 T1 | B | **D** | enter circle → hands to camera → continue instructions |
| action_combat_2 T2 | A | **A** | look-behind escalated into multi-step compliance |
| action_combat_2 T2 | C | **D** | camera/weight/hand/observation prep chain |

---

## Arm D verdict

```text
OPUS_UNIFIED_TERMINAL_PHASE1_FAIL
```

Hard fail triggers (no relaxation):

```text
severe user takeover = 2/12  (required 0/12)
mean = 83.42 < 85
action category mean = 71.50 < 80
action meaningful AI-owned change/result proxy = 2/4 < 3
```

Passed sub-checks (insufficient alone):

```text
median = 90 >= 85
D > B preference = 75% >= 65%
median total visible chars = 3024.5 ∈ 2800–4200
≥2400 chars = 12/12
avg cost <= Arm A +10%
```

### Failure typology

```text
D severe takeover in instruction-following scenes
D action-result failure
```

Both Arm D severes are in `action_combat_2`, where user says roughly “지시만 해요”.

Boundary to preserve for any **minimal** future terminal edit (not applied in this PR):

```text
"지시만 해요" means:
NPC may issue instructions.
AI may not perform the instructed user actions in the same response,
except for one immediate action explicitly begun in the current input.
```

Do **not** auto-add a new terminal string in this turn.

---

## Next step

```text
PHASE2_NOT_AUTHORIZED
PHASE2_NOT_RUN
MODEL_LINEUP_DECISION_NOT_RUN
PRODUCTION_CHANGE_NO
```

Qualitative notes from pre-map review remain valid:

```text
OPUS_HIGH_QUALITY_CEILING_CONFIRMED
LONG_FORM_WITHOUT_USER_TAKEOVER_EXISTS
ACTION_COMBAT_2_IS_CRITICAL_STRESS_TEST
OPUS_UNIFIED_TERMINAL_POTENTIAL_CONFIRMED
```

Potential is confirmed; phase-1 pass is **not**.

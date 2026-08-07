# Adult Scene Handoff — Final Model Selection

```text
FINAL_ADULT_MODEL = deepseek-v4-pro
FINAL_MODEL_LOCKED = true
AION_ADULT_PRIMARY_CANDIDATE = NO
MUSE_REPLACEMENT = NO
KEEP_CURRENT_ADULT_MODEL = FINAL
ADULT_SCENE_HANDOFF_READY = true
```

## Evidence closed

| Source | Result |
|---|---|
| Muse vs DeepSeek fidelity (#262) | `MIXED_PRODUCTION_HANDOFF_RESULT` / `NO_REPLACEMENT` |
| Aion challenger (3 calls, #265 add-on) | `AION_ADULT_HANDOFF_BUNDLE_WIN = NO` |
| Admin-canary T1→T4 live smoke | PASS on DeepSeek primary |

Adult model selection is **closed**. No further model bakeoffs, Stage 2, Aion/Muse retests, or additional T1→T4 smokes are required for this lock.

## Shipping posture (merge ≠ general enable)

```text
ADULT_SCENE_AION_PRIMARY_ENABLED = false
ADULT_SCENE_HANDOFF_GENERAL_ENABLED = false
Railway global enable = NOT THIS PR
pricing change = NOT THIS PR
Aion code path = retained (inactive legacy / future fallback-compatible)
MAIN_MERGED = false  (human merge only; no auto-merge)
```

See also:

- `docs/audits/adult-scene-handoff-final/FINAL_LIVE_SMOKE.md`
- `docs/audits/adult-handoff-aion-challenger/AION_CHALLENGER_RESULTS.md`

# G10-SD1 — API=0 matrix + production facts

**base main:** `7f0c54b60e7ace11bc6e4eea9c820caadde24853`  
**branch:** `cursor/scene-pacing-controller-g10sd1-96c2`  
**API CALLS:** 0  
**PR #288 / #289:** not stacked (historical seals preserved)

## Production assert — standard SceneDirective injection

`src/services/contextBuilder.ts` ARM D:

```
keepModeSpecificProgression =
  autoProgressionEnabled || contentKind === "simulation" || !!party
if (!keepModeSpecificProgression) return; // no SceneDirective section
```

| Mode | SceneDirective prompt |
|---|---|
| standard interactive / single_primary | **OFF** |
| auto progression | ON (legacy) |
| simulation | ON (legacy) |
| party | ON (builder; route rarely sets) |

**standard legacy SceneDirective: still OFF** for this experiment’s Arm A (production path).

## Candidate sole architecture

`SERVER MOTION BUDGET` via `src/lib/scenePacingController.ts`  
Harness Arm P injects compact `[SCENE PACING]` cue only — **not** legacy `[PRIVATE SCENE ENGINE RULE]` dump.

## API=0 matrix (`src/lib/scenePacingController.test.ts`)

| Case | Result |
|---|---|
| A calm single_primary | DYAD HOLD/AMBIENT · external ineligible |
| B established relationship | DYAD |
| C private intimate | intimate DYAD · EXTERNAL ineligible |
| D investigation | EXPLORATION · LOCAL |
| E active operation | OPERATION · LOCAL/EXTERNAL |
| F simulation | ENSEMBLE · multi-beat |
| G triggered event | trigger priority |
| H external cooldown | N blocked through N+3; N+4 eligible |
| I genre independence | dinner DYAD; attack OPERATION |
| HOLD valid | YES (no env+rel floor) |
| DYAD stagnation | no EXTERNAL promote |
| Compact renderer | no negative list / no legacy pressure |
| Genre SCENE MODE strip | candidate removes pacing hint |

**All 16 tests PASS.**

## Genre owner note

`narrativeStyle.ts` genre → tension remains in production code.  
Arm P strips `[SCENE MODE]` from system text so it cannot compete with the pacing controller.  
DeepSeek/Terra production untouched.

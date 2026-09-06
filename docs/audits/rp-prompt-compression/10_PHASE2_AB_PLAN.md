# 10 Phase 2 A/B Plan (NOT STARTED)

Human review required before any production prompt edit.

## Recommended A/B order

1. **Opus Arm E compact candidate** vs frozen Arm E  
   - Metrics: agency severe violations, length band hit rate, literary preference blind score  
   - Stop if agency regresses

2. **Layout dedupe** (merge repeated dialogue/paragraph blank-line rules)  
   - Models: Gemini + DeepSeek + Opus  
   - Metrics: dialogue separation, paragraph quality

3. **Prose MERGE candidates only** (short-burst / translationese)  
   - Prefer KEEP floor; avoid rewriting IMMERSIVE core

## Exclusions from Phase 2 first wave

```text
P3 content compression
Railway / pricing / general flags
Numeric state work
API bakeoffs for Muse/Aion
```

## Normalization rule for future measurements

Always report:

```text
NORMAL TURN footprint
REGEN OVERHEAD (delta)
```

separately. Never mix regeneration overhead into model prompt structure comparisons.

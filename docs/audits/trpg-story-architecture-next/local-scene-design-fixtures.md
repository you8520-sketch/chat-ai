# Local scene progress — design fixtures (conceptual)

Acceptance tests for any future implementation. Not automated yet.

## L1 — Route discovery

**Given:** investigation SUCCESS opens vent route  
**Persist:** `openRoutes: ["환풍구"]`  
**Next round GM prompt must include:** vent route still available  
**Forbidden:** route absent while location unchanged

## L2 — New pressure

**Given:** vent route open, enemies arrive  
**Persist:** route remains in `openRoutes`; new blocker in `remainingBlockers`  
**Forbidden:** `nextRoundContext` alone replaces route knowledge

## L3 — Resolved obstacle

**Given:** fungal barrier destroyed  
**Persist:** `resolvedObstacles: ["fungal_barrier"]`  
**Next round:** no functionally identical barrier without new causal event

## L4 — Causal reversal

**Given:** route open, later collapse seals it  
**Delta:** explicit reversal removing route with reason `building_collapse`  
**Allowed**

## L5 — Player stays

**Given:** exit available, players investigate further  
**Expected:** no forced location change; `sceneState` may stay `active`

## L6 — Boss encounter

**Given:** complex hazard legitimately unresolved  
**Expected:** scene not marked `exhausted` prematurely

## L7 — Quiet social

**Given:** low danger social scene  
**Expected:** no manufactured danger to fake progress

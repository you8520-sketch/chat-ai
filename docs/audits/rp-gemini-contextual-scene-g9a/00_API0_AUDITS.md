# G9-A — API=0 audits (G8.1 + domain + genre)

**base main:** `7f0c54b60e7ace11bc6e4eea9c820caadde24853`  
**branch:** `cursor/gemini-contextual-scene-dynamics-g9a-96c2`  
**API CALLS:** 0  
**PR #288 stack:** forbidden (evidence-only)

## 1. G8 Agency V2

See `docs/audits/rp-gemini-living-scene-g8/G8_AGENCY_V2_ADDENDUM.md`.

| | Old severe (B) | New severe decision (B) |
|---|---:|---:|
| count | 3 | 1 |
| reclassified | N2_B_D1 → ALLOWED_CONTINUITY; N1_B_D1 → MODERATE + REPLAY FAIL |

`PHASE_G8_FINAL` not modified.

## 2. FIXTURE_DOMAIN_BIAS

**FIXTURE_DOMAIN_BIAS = YES**

D5→G8 Gemini live harnesses concentrate on **c10 에녹 / 회색 생태권** only. Tone variety inside that apocalypse (rest / world-motion / assist) does not create genre/world diversity for a general prompt claim. Catalog fixtures (c5, c18) were not live-wired in those phases.

## 3. GENRE_IS_NOT_SCENE_INTENSITY

Code (`src/lib/narrativeStyle.ts`):

```ts
아포칼립스 → tension
센티넬버스 → tension
공포/추리 → tension
…
```

Injected via `buildNarrativeStyleLayer` → `[RUNTIME STYLE]` / `[SCENE MODE] ${genre} → ${mode}` whenever `genres` is provided to `buildContext`.

`[SCENE FLOW]` already says calm/tension/combat are not length levels, but genre still pins a **static** mode for the whole character, not the current interaction.

**On G8 harness path:** `genres` was **not** passed → `[SCENE MODE]` absent from G8 payloads → G8 FAIL was **not** caused by this line.

**Product question answer:** Yes — genre-derived scene mode incorrectly acts as turn-level intensity when present.

**GENRE_IS_NOT_SCENE_INTENSITY = CONFIRMED**  
(causality on G8 c10 harness = NOT_CAUSAL; production risk when genres are set = YES)

Production change this phase: **0**.

## 4. G9-A sole variable

`CONTEXTUAL_SCENE_DYNAMICS_ONLY`  
- REPLACE overlapping `[SCENE FLOW]` semantics (Gemini experiment Arm C)  
- Agency / CURRENT USER wrapper / PROSE / LAYOUT = production BYTE_IDENTICAL  
- No G8 living-scene contract / wrapper V2  
- No new negative “don’t escalate” lists  

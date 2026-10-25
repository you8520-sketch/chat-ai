# PHASE_G9A_FINAL

```
PHASE_G9A_FINAL:
base: 7f0c54b60e7ace11bc6e4eea9c820caadde24853
branch: cursor/gemini-contextual-scene-dynamics-g9a-96c2
commit: 73a5c2d9f7d9e24dce4532e6a47725db07c6a280
draft PR: https://github.com/you8520-sketch/chat-ai/pull/289

API0:
G8 Agency V2:
old severe: 3
new severe: 1
reclassified cases:
  - N2_B_D1 SEVERE → ALLOWED_CONTINUITY (declared follow/silence horizon)
  - N1_B_D1 SEVERE → MODERATE + USER_DIALOGUE_RESTAGE FAIL (separated)
PHASE_G8_FINAL: unchanged (GEMINI_LIVING_SCENE_CONTRACT_FAIL preserved)
PR #288: historical only (not stacked)

FIXTURE_DOMAIN_BIAS: YES
GENRE_IS_NOT_SCENE_INTENSITY: CONFIRMED
  (G8 harness omitted genres → not causal on G8 path; product risk when genres set)

G9-A variable: CONTEXTUAL_SCENE_DYNAMICS_ONLY
  (SCENE FLOW → SCENE DYNAMICS replace; agency/wrapper/prose/layout BYTE_IDENTICAL)

N1S:
A chars: 3357 / 2270 (med 2813.5)
C chars: 1474 / 3992 (med 2733)
scene fidelity: A 0/2 · C 1/2 → FAIL seal
new scene value: A 3.5 · C 5.0
dialogue share: A 0.047/0.060 · C 0.071/0.035
anchors: A 3/3 · C 2/2
agency: A ALLOWED · C ALLOWED (SEVERE 0)
user replay: A 1 FAIL · C 0
human: A 59.5 · C 68.5
auto threat escalation: A 1/2 · C 0/2

N2:
A chars: 1555 / 540
C chars: 5112 / 4718
world motion: A 6.5 · C 9.5 PASS
NPC/env autonomy: A 6.5 · C 9.5 PASS
new scene value: A 6.5 · C 9.0 PASS
dialogue usability: A 7.5 · C 7.0 FAIL non-inferior
anchors: A 3/3 · C 5/7 OVERLOAD FAIL
agency: SEVERE 0 (V2)
user replay: PASS
human: A 70.5 · C 84.5

N3: NOT_RUN

world motion: PASS
quiet fidelity: FAIL
severe decision takeover: 0

classification: CONTEXTUAL_SCENE_DYNAMICS_FAIL

notes:
- C reduces auto-threat on true-calm vs A and improves N2 living-world craft
- quiet fidelity not reliable (C_D2 still canon-lecture fills rest)
- N2 C overshoots into dialogue-starved multi-event / anchor overload
- do not add negative “no combat” lists; next work must separate calm carriers from event stacking (compression/exemplar later)

production changes: 0
production wire: NOT_RUN
merge: NOT_RUN
STOP.
```

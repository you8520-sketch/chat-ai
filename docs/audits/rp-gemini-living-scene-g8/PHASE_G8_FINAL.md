# PHASE_G8_FINAL — Gemini Compact Living-Scene Contract

```
PHASE_G8_FINAL:
latest main: 7f0c54b60e7ace11bc6e4eea9c820caadde24853
branch: cursor/gemini-living-scene-contract-g8-96c2
commit: 4f1c1d7c23e4615a83f580ce492cf9a183a02918
draft PR: https://github.com/you8520-sketch/chat-ai/pull/288

CURRENT A:
system tokens: ≈3284
fixed instruction: ≈3284
current-user instruction: ≈282
negative clauses: 35 semantic (39 surface)
semantic owner count: agency1 + layout2 + immersive1 + collab1
agency owner count: 1 (collab) + wrapper prose
layout owner count: 2
positive scene channels: many IMPLICIT/CONSTRAINED (world/NPC/time/space)

CANDIDATE B:
system tokens: ≈2235
fixed instruction: ≈2235
current-user instruction: ≈186
fixed reduction: 31.9%
negative reduction: 45.7% semantic (35→19)
agency SoT: 1 (living-scene)
layout SoT: 1 (form inside living-scene)
canon/data parity: PASS (SHA equal; history/runtime/length equal)

PASS / FAIL: FAIL

N1:
A chars: 1245 / 2577 (med 1911)
B chars: 1814 / 4177 (med 2995.5)
A/B narration share: 0.957·0.925 / 0.940·0.926
A/B dialogue share: 0.043·0.075 / 0.060·0.074
scene value: A thin→escalate · B escalate+length but rest aborted / replay on D1
human score: A 64 · B 57 (B−A = −7)
agency: A ALLOWED/MODERATE · B SEVERE×2 (dialogue restage; multi-step follow)

N2:
A chars: 1045 / 1983 (med 1514)
B chars: 3124 / 1913 (med 2518.5)
A/B narration share: 0.779·0.891 / 0.876·0.857
A/B dialogue share: 0.221·0.109 / 0.124·0.143
scene value: B clearly better world/NPC motion
human score: A 66.5 · B 78 (B−A = +11.5)
agency: A MODERATE · B SEVERE on D1 (hide/compliance chain) · D2 MODERATE

N3:
A chars: 1873 / 752 (med 1312.5)
B chars: 2283 / 2209 (med 2246)
A/B narration share: 0.904·0.918 / 0.890·0.863
A/B dialogue share: 0.096·0.082 / 0.110·0.137
scene value: mixed; B more sustained but lore padding
human score: A 68 · B 64 (B−A = −4)
agency: A SEVERE×1 + ALLOWED · B ALLOWED/MODERATE (no severe)

Stage1 blind mean:
A: 66.17
B: 66.33
B-A: +0.17  (gate prefer +5 → FAIL)

systematic length collapse: NO
new-scene-value replacement: FAIL (N2 yes; N1/N3 not net win; filler/canon lecture still present)
severe agency: B=3  (gate =0 → FAIL)

Stage1: GEMINI_LIVING_SCENE_CONTRACT_FAIL

failure_class:
- AGENCY_TAKEOVER (primary)
- TOO_VERBOSE_FILLER (secondary on long B cells)

regression G3/G5/G6: NOT_RUN
overall: GEMINI_PROMPT_ARCHITECTURE_NOT_PROVEN
production wire: NOT_RUN
merge: NOT_RUN
STOP.
```

## Interpretation (no phrase patch)

Offline architecture goals largely hit: fixed surface −32%, negatives −46%, agency/layout SoT=1, canon/data parity, positive channels opened.

Live Stage1 does **not** convert that into a quality win:
- Blind mean flat (~+0.2).
- Living-scene permission improves N2 world motion craft, but co-narration overshoots into multi-step user chains (SEVERE).
- N1 calm rest is frequently aborted; one B draw restages user dialogue (replay).
- Length collapse is **not** the D6-C1 failure mode here — B is generally longer — but length without agency safety / calm fidelity is insufficient.

Do **not** add more DO NOT lists to “fix” agency. Next candidate (if any) needs a different architecture for the allowed-assist boundary, not suppression stacking. Few-shot / G9 compression: not opened (Stage1 FAIL).

PHASE_G11_C5_FINAL:
github_pr_base_sha: 7f0c54b60e7ace11bc6e4eea9c820caadde24853
experiment_payload_reference_sha: 3af5ec5 (PR #255 tip) / C3B sealed 2bb55f0
branch: cursor/historical-sequence-triangulation-g11c5-24fc
draft PR: https://github.com/you8520-sketch/chat-ai/pull/304
tested_object: HISTORICAL_SEQUENCE_BUNDLE
FULL_HISTORICAL_PAYLOAD_PARITY: UNKNOWN
historical_reference:
PR #255
historical chars:
REL_T1: 4659
REL_T2: 4254
ACT_T1: 4743
ACT_T2: 4327
mean: 4496
frozen current cell hashes:
REL_T1: f3dfb336e8cdf97fdd4d6436e3650aa451801e4e36fe8565dbf7fd70796905b2
REL_T2: 14b0d804ad22a1d5c49a98024fc769c8ad7bf01eff84e842e4c989711727f0bd
ACT_T1: 5b6331f9f11ea8295db9ef8cb9a4b9711f41fae402442b376bd6ec22ef8e548f
ACT_T2: 431650235313ee537a21046843ba0a84b1b2ef5b5cfcfd84c3aeb3e330074272
CURRENT OR:
REL_T1: 3084
REL_T2: 2261
ACT_T1: 2864
ACT_T2: 2655
mean: 2716
median: 2760
<2000: 0/4
>=3000: 1/4
>=4000: 0/4
CURRENT CI:
REL_T1: 1956
REL_T2: 2820
ACT_T1: 2917
ACT_T2: 4140
mean: 2958
median: 2869
<2000: 1/4
>=3000: 1/4
>=4000: 1/4
length table:
CELL | HISTORICAL CI | CURRENT OR | CURRENT CI
REL_T1 | 4659 | 3084 | 1956
REL_T2 | 4254 | 2261 | 2820
ACT_T1 | 4743 | 2864 | 2917
ACT_T2 | 4327 | 2655 | 4140
input token comparison:
REL_T1:
historical: 17514
current OR: 4613 (ratio 0.263) CONTEXT_COMPOSITION_DELTA_HIGH
current CI: 4609 (ratio 0.263) CONTEXT_COMPOSITION_DELTA_HIGH
REL_T2:
historical: 21726
current OR: 7528 (ratio 0.346) CONTEXT_COMPOSITION_DELTA_HIGH
current CI: 7528 (ratio 0.346) CONTEXT_COMPOSITION_DELTA_HIGH
ACT_T1:
historical: 17536
current OR: 4627 (ratio 0.264) CONTEXT_COMPOSITION_DELTA_HIGH
current CI: 4623 (ratio 0.264) CONTEXT_COMPOSITION_DELTA_HIGH
ACT_T2:
historical: 21862
current OR: 7771 (ratio 0.355) CONTEXT_COMPOSITION_DELTA_HIGH
current CI: 7765 (ratio 0.355) CONTEXT_COMPOSITION_DELTA_HIGH
context composition delta: HIGH on all 8 cells (current input ≈26–36% of historical)
quality:
OR repetition: low ×4
CI repetition: low ×4
canon padding: low ×8
agency severe: 0 ×8
narration share:
OR: 0.828 / 0.803 / 0.921 / 0.901
CI: 0.792 / 0.770 / 0.951 / 0.865
finish reasons: stop ×8
scene affordance audit:
historical REL: novelty/unresolved/info HIGH; causal LOW; physical/spatial MEDIUM
historical ACT: physical/spatial/mechanics/causal/decision/env HIGH
B: mostly LOW–MEDIUM (quiet relationship)
D: action/causal/spatial HIGH (matches C3B CI long D)
F: novelty HIGH; causal/spatial LOW
relationship test: current REL did not reproduce 3.5k–4k+ pair (OR 3084/2261; CI 1956/2820) — “relationship is inherently quiet” not fully falsified on this thinner context
action test: CI ACT_T2=4140 shows concrete action scaffolding can still reach 4k on current Arm A; OR ACT stayed ~2.6–2.9k
classification: MIXED_INCONCLUSIVE
  (not both≥3500; not both<2500; not pure route split; not strict REL-short/ACT-long gate)
  dominant measured confound: CONTEXT_COMPOSITION_DELTA_HIGH (card/persona/runtime richness ≪ #255)
next: G11-C6 CONTEXT_COMPOSITION_DELTA_AUDIT
  (also retain G11-C5B AFFORDANCE_DECOMPOSITION as secondary if context parity restored)
production wire: NOT_RUN
merge: NOT_RUN
new LLM calls: 8
ONE TURN = ONE PRIMARY LLM CALL
STOP.

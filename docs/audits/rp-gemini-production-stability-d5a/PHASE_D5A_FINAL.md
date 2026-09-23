# PHASE_D5A_FINAL

```
PHASE_D5A_FINAL:

production prompt:
BYTE_IDENTICAL

prompt delta:
0

owner rewrite:
0

new rule:
0

calls:
9

G5:
  chars draw1/draw2/draw3: 1855 / 690 / 1463
  min/max: 690 / 1855
  median: 1463
  max/min: 2.69
  dialogue share: 0.083 / 0.190 / 0.128
  fragmentation: 4 / 0 / 2
  replay: CURRENT_INPUT 1–2 · INTRO/RECENT 2 (greeting shutter restage)
  recital: SETTING 2–3 (Mother/fog/ecology)
  completion: COMPLETE / EARLY_STOP / COMPLETE

G6:
  chars draw1/draw2/draw3: 606 / 2699 / 881
  min/max: 606 / 2699
  median: 881
  max/min: 4.45
  dialogue share: 0.139 / 0.100 / 0.184
  fragmentation: 2 / 2 / 2
  replay: CURRENT_INPUT alarm on all 3 draws
  recital: ecology/tactical briefing (esp. D2)
  completion: EARLY_STOP / COMPLETE / EARLY_STOP

G3:
  chars draw1/draw2/draw3: 1522 / 1659 / 2201
  min/max: 1522 / 2201
  median: 1659
  max/min: 1.45
  dialogue share: 0.183 / 0.154 / 0.168
  fragmentation: 2 / 4 / 0
  replay: low input restage
  recital: gunshot-death canon lecture moderate
  completion: COMPLETE / COMPLETE / COMPLETE
  ACTIVE_CANON_USE: strong (gun seized; refuses shot)

overall:
  >=3200: 0/9 (0%)
  >=3000: 0/9 (0%)
  <2400: 8/9 (88.9%)
  <1800: 6/9 (66.7%)
  max/min: 2699/606 = 4.45

provider variance:
  observed
  routes: Google AI Studio (6) · Google (3)
  same fixture can flip route across draws
  reasoning_tokens range: 1219–4078
  latency_s range: 16.2–76.3

REPLAY_SOURCE_DISTRIBUTION:
  current user: 0.18
  last assistant: 0.16
  character canon: 0.28
  world canon: 0.26
  persona: 0.04
  LTM: 0.00
  generic: 0.08

dialogue:
  median share: 0.1537 (ideal 10–15% edge / acceptable)
  response anchor count median: 2 (ACCEPTABLE)
  response overload: G3-D3 (=4)
  dialogue function load median: 3
  fragmentation: intermittent (0–4 same-speaker fragments)

fingerprint:
  BYTE_IDENTICAL per fixture across 3 draws: PASS
  generation_config: temperature=0.95 · reasoning.effort=low · max_tokens omitted · seed null

GEMINI_INTRINSIC_LENGTH_VARIANCE:
  HIGH
  (G5 max/min 2.69 · G6 max/min 4.45; both ≥1.8)

final classification:
GEMINI_INTRINSIC_LENGTH_VARIANCE_HIGH
(with MIXED secondary notes: G6 median short; G3 more stable; provider-route variance)

next:
RUNTIME_PARAMETER_AUDIT

D5-B status:
NOT_RUN
(temperature / reasoning / history trim / canon removal / memory removal /
 prompt reorder / user-tail reorder / continuation / retry — all NOT_RUN)

PR #280:
GEMINI_POSITIVE_FORWARD_OWNER_FAIL — historical evidence only
MERGE = NO
PRODUCTION WIRE = NO
D2/D3/D4 candidates: NOT USED

production changes:
0

merge:
NOT_RUN
```

## Case routing (from brief §11)

**CASE A primary** — identical production A payload swings 606↔2699 within G6 and 690↔1855 within G5.

Do **not** treat as prompt-wording problem. Stop D2/D3/D4 wording experiments.

Secondary observations (do not override CASE A):
- G6 median 881 → fixture-leaning early-stop tendency (CASE B flavor)
- Canon/world recital mass high but not the sole driver of length collapse (CASE C not primary)
- Provider route Google vs Google AI Studio co-varies with draws → include in D5-B runtime audit

## Evidence paths

- Live matrix: `docs/audits/rp-gemini-production-stability-d5a/d5a/01_STAGE1_LIVE.json`
- Agent quality/replay: `docs/audits/rp-gemini-production-stability-d5a/d5a/02_AGENT_QUALITY_REVIEW.json`
- RAW: `docs/audits/rp-gemini-production-stability-d5a/d5a/raw/`
- Artifacts: `/opt/cursor/artifacts/rp-quality-d5a-production-stability/live/`
- Harness: `scripts/rp-quality-d5a-gemini-production-stability.ts`

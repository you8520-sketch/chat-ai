# PHASE_D4_FINAL

```text
PHASE_D4_FINAL:

baseline main: 268b8a70556f3392e7eb89283ba2e07689e2e332
branch: cursor/rp-gemini-positive-forward-owner-d4-96c2
commit: a48e7ba8ef92c206910b4fb77b16d14f343df6ae
draft PR: https://github.com/you8520-sketch/chat-ai/pull/280
note: commit = harness tip; docs tip may advance after seal

D2/D3 continuity block:
NOT_USED

new system sections:
0

new negative directives:
0

system prompt token delta:
0  (system unchanged)

total instruction token delta:
+35 ~ +36 (user-tail owner only; exact brief wording longer than production)

D4-A:
  old length owner:
    "…장면으로 전개한다. 현재 상호작용을 요약하거나 성급히 닫지 말고, …충분히 전개한다."
  new positive owner:
    "…장면으로 완성한다. 직전 장면과 현재 입력에서 이미 성립한 상황의 바로 다음 변화에서 시작해, …다음 변화를 낳도록 충분히 전개한다."
  G5 A/B chars: 3858 / 2037
  G6 A/B chars: 1073 / 661
  G3 A/B chars: 2388 / 4003
  input replay A/B: 1/1 ; 2/2 ; 1/1
  intro replay A/B: 1/1 ; 0/0 ; 0/0
  setting recital A/B: 2/1 ; 1/1 ; 1/1
  new scene value A/B: HIGH/MEDIUM ; MEDIUM/LOW ; HIGH/HIGH
  completion A/B: PASS/PASS all cells
  length gates:
    median B = 2037 (<3000 FAIL)
    B < 2400 HARD FAIL: G5, G6
    B < 0.80A RELATIVE FAIL: G5 (0.53), G6 (0.62)
  REPLAY_SAVED_CHARS_REPLACED_BY_NEW_SCENE:
    G5 NO · G6 NO · G3 PARTIAL
  verdict: POSITIVE_OWNER_ATTEMPT_FAIL

D4-A2:
  NOT_RUN
  result: blocked by D4-A length collapse stop policy

D4-B:
  NOT_RUN

D4-C:
  NOT_RUN

FINAL A/B:
  NOT_RUN
  calls: 0 additional
  median chars A/B: 2388 / 2037 (D4-A only)
  >=3000 rate A/B: 1/3 / 1/3
  dialogue share median A/B: 0.1267 / 0.1646
  response anchors A/B: NOT_SCORED (D4-B not run)
  replay A/B: non-inferior on scored cells, but moot under length fail
  recital A/B: G5 slight↓; others same
  active canon A/B: preserved where scored
  fidelity A/B: preserved
  new scene value A/B: not improved under length collapse
  completion A/B: PASS/PASS

prompt:
  new section count: 0
  negative directive delta: 0 (candidate has none; production had legacy "말고")
  token delta: owner +35; system 0

final:
GEMINI_POSITIVE_FORWARD_OWNER_FAIL

production wire:
NOT_RUN

merge:
NOT_RUN

STOP.
```

## Why STOP

D4 brief §13 / §40: if D4-A length collapses, do not add sentences, do not run A2/B/C.

Observed pattern matches D2/D3 failure mode on the hard cells:

- G6 especially collapses further under the positive owner (1073 → 661)
- G5 loses ~47% length (3858 → 2037)
- G3 alone benefits (2388 → 4003) — insufficient for cohort PASS

## Evidence

- Live summary: `docs/audits/rp-gemini-positive-forward-d4/d4a/01_STAGE1_LIVE.json`
- Agent seal: `docs/audits/rp-gemini-positive-forward-d4/d4a/02_AGENT_SEAL.json`
- RAW: `docs/audits/rp-gemini-positive-forward-d4/d4a/raw/`
- Experiment module (not production-wired): `src/lib/geminiPositiveForwardOwnerD4.ts`

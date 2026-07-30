# Adult scene handoff A/B — micro-fixture prompt-continuity test

This document preserves the first small synthetic experiment. It is **not a
production-equivalent handoff test**, a production cost forecast, or evidence
of a real general-model → DeepSeek transition. The production-equivalent gate
is documented separately in `ADULT_SCENE_HANDOFF_PRODUCTION_AB.md`.

## Models

- Primary: `google/gemini-3.6-flash`
- Optional confirmation: `gpt-5.6-luna`
- No other general model is accepted by the harness.
- Run Luna only when Gemini has a failed arm, a refusal, or an unclear A/B
  result.

## Fixed scenarios

1. `romantic_voice` — romantic dialogue, honorific and voice continuity
2. `tension_position` — close-range tension, position and unfinished action
3. `explicit_dialogue_boundary` — adult-only explicit-dialogue boundary
4. `aftercare_emotion` — immediate aftercare, emotional continuity
5. `safe_return_transition` — time/location transition back to a safe scene

All fictional participants are explicitly adults. Fixtures exclude minors, real
people, and actual non-consensual violence.

## Arms

### A — compact baseline

```text
existing common prompt
+ latest 4 RAW messages (only 2 complete user-assistant exchanges)
+ current user input
```

### B — continuity packet

```text
existing common prompt
+ latest 6 RAW messages (only 3 complete user-assistant exchanges)
+ SceneContinuityPacket
+ current user input
+ short continuation instruction
```

These message counts were a harness defect. Production RAW 4 turns means four
complete exchanges (eight messages), while handoff RAW 6 turns means six
complete exchanges (twelve messages). The current user input was inserted once.

## Evaluation

Each A/B output is reviewed on the existing 1–5 criteria:

- character voice and address
- POV
- unfinished action
- position and space
- sentence rhythm and paragraph breathing
- dialogue/narration ratio
- emotion
- pacing
- repetition or unnecessary recap
- user-action ghostwriting
- perceived model-switch discontinuity

Runtime output also records input/output tokens, latency, finish reason, empty
or refusal-like output, and continuity anchor hits. The five paired samples are
the entire initial gate; expanding beyond five requires a separate decision.

## Commands

```powershell
npx tsx scripts/adult-scene-handoff-ab.ts --model=gemini
npx tsx scripts/adult-scene-handoff-ab.ts --model=luna
```

Results are written under `data/adult-scene-handoff-ab/` and are ignored by
Git. The harness performs exactly 10 calls per selected model: five scenarios
times two arms, without automatic retries.

## Initial Gemini 3.6 Flash micro-fixture run

Run date: 2026-07-30

- 10/10 calls completed
- 0 errors
- 0 refusal-like responses
- A anchor retention: 11/25
- B anchor retention: 14/25
- A average input/output: 252.2 / 988.8 tokens (micro-fixture only)
- B average input/output: 555.6 / 1,025.0 tokens (micro-fixture only)
- A/B average latency: 7,268 / 6,823 ms

Paired review favored B in four of five scenarios. The clearest difference was
`explicit_dialogue_boundary`: A drifted from third-person character POV into
first person, while B retained named third-person POV and the unfinished
interaction. B also retained more of the time/location transition in
`safe_return_transition`. The aftercare pair was effectively tied; A happened
to repeat one more literal anchor, while both preserved the intended emotional
continuity.

The low prompt-token totals occurred because the harness used a short
`COMMON_SYSTEM`, short synthetic dialogue, and message slicing instead of the
production `buildContext()` path. The numbers above must not be mixed with
production prompt sizes, costs, latency, or handoff-quality claims.

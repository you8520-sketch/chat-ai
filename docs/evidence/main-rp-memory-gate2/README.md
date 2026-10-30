# Main RP memory Gate 2 evidence (evidence-only branch)

Base main: `de266eb88f63ae9b6c4a3ef6d7e93a897250eb5f`. Tracking issue: #1486. No feature code is changed on this branch. No new provider call was made to produce this package; every output is the text already generated in the Gate 2 run (18 real calls). Cursor assigns no RP quality score.

## Read in this order (blinded first)

1. `blinded/blinded-packets.md` -- all 18 raw outputs in one file, arm labels shuffled per case (X/Y/Z).
2. `blinded/outputs/<CASE>__<model>__<X|Y|Z>.txt` -- the same 18 outputs, one file each (full text, unedited).
3. `fixture/source-80-turns.json`, `fixture/evaluation-scenes.json` -- the 80-turn source fixture and the two evaluation scenes (A_direct_quote, B_npc_no_cue; user input per scene).

## UNBLINDED -- open only after scoring

These reveal which arm (OLD / B-1 / CURRENT) each output belongs to or contain analysis that does:

- `key/blinded-key.json` -- X/Y/Z to arm mapping per case x model
- `unblinded-results/` -- per-call raw provider results with usage
- `memory-blocks/` -- injected memory block per arm (`per-arm-memory-blocks.md`)
- `final-wire/` -- final assembled provider input per arm (`wire-comparison.md`; 18 request bodies under `requests/`)
- `usage-cost/` -- tokens / provider-reported cost / no-cache estimate (`cost-ledger.md`, `execute.log`)
- `observations-cursor-unblinded.md` -- existing Cursor observations (not a score)
- `c-prime-feasibility.md`, `c-prime-probes/` -- B-2 Core C′ feasibility audit and provider-free probes

## Fixture caveats (state of the experiment)

- Only the episodic block differs across arms (see `final-wire/wire-comparison.md`). The Current Memory block is an identical synthetic extractive stand-in (user lines only) for all arms, not a real Luna summary.
- Outputs are single samples per cell, not a distribution.
- Model arms: deepseek-v4.1-flash, gemini-3.8-flash, gpt-6.1-sol. No hard output cap was sent.
- Opus 5.5 (6 planned calls) was not run.

## Not included

Secrets, credentials, production DB data. The fixture is synthetic (character/persona names are test names).

## Harness

`harness/` holds the scripts that produced the dumps and executed the 18 calls (`g2-execute.ts`, `zz-g2-dump.test.ts`, `zz-g2-prepare.test.ts`). They are evidence, not part of the build; they do not live under `src/`.

# Issue 2 — handoff owner experiment report

**STOP for human/ChatGPT review. Do not merge automatically.**

## Single change
Replaced `DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION` only.

Unchanged:
- shared 3200+ length owner
- max-4 dialogue owner
- model / provider / temperature / max_tokens / context / user turn / character / persona

## Experimental replay (one call)
Base: frozen Phase-1 `B-DEEPSEEK-input.json` with only the handoff owner patched in the system block.

| Metric | Run 1 (Phase-1) | Run 2 (Phase-1 replay) | Exp (owner replace) |
|---|---:|---:|---:|
| visible chars | 1701 | 2346 | **2569** |
| dialogue blocks | 8 | 10 | **14** |
| paragraph count | 17 | 20 | **30** |
| dialogue ratio | 0.471 | 0.500 | **0.467** |
| finish_reason | stop | stop | **stop** |
| requested progression completed | no | yes | **no** |
| redundant-confirmation candidate | — | — | **yes** |
| user-preemption candidate | — | — | no |
| user-agency-consistency candidate | — | — | **yes** |
| repetition candidate | no | no | no |
| canon contradiction candidate | no | no | no |

No prose quality or Gemini-similarity score.

## Human-review flags on experimental RAW
- `REDUNDANT_CONFIRMATION_THEN_PREEMPTION_REPEATED` class still present (`redundant_confirmation_candidate=true`)
- Dialogue blocks increased (14 > 4) despite dialogue owner unchanged
- Length still materially under 3200 (2569)
- Requested destination (`오르가슴`) not lexically completed in experimental RAW

Artifacts:
- `requests/B-DEEPSEEK-input-exp.json`
- `raw/B-DEEPSEEK-EXP-RAW.txt`
- `ISSUE2-EXPERIMENT-REPORT.json`

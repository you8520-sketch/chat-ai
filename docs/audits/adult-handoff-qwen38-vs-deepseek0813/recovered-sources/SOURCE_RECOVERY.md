# Source recovery

This VM did not have `/opt/cursor/artifacts/opus-instruction-boundary`,
`/opt/cursor/artifacts/final-production-model-smoke/live`, or
`/opt/cursor/artifacts/gemini31-opus5-minimal-screen`.

Exact source RP bodies were recovered from the same prior-audit documents
that those artifact paths were published into. Visible-char counts match
`docs/audits/adult-handoff-style-fidelity-muse12/SOURCE_ANCHORS.md`.

| Source | Recovered file | chars | Origin |
|---|---|---:|---|
| Opus 5 Arm E T1 | `opus-t1.txt` | 2261 | Audit 58 `RAW_OUTPUTS_FULL_OPERATOR_ONLY.md` |
| Opus 5 Arm E T2 (anchor) | `opus-t2.txt` | 2858 | Audit 58 `RAW_OUTPUTS_FULL_OPERATOR_ONLY.md` |
| Terra action T1 (anchor) | `terra-t1.txt` | 3751 | `final-production-model-smoke/RAW_OUTPUTS_FOR_HUMAN_REVIEW.md` |
| Gemini 3.1 REL T1 | `gemini-t1.txt` | 4659 | Audit 55 `RAW_OUTPUTS_FULL.md` |
| Gemini 3.1 REL T2 (anchor) | `gemini-t2.txt` | 4254 | Audit 55 `RAW_OUTPUTS_FULL.md` |

No new Opus / Terra / Gemini generation calls were made.

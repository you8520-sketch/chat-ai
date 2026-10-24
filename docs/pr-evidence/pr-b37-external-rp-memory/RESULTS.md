# B37 — external RP 100 turns through the real HAV memory path (de-identified aggregates)

No raw external text, character names, wires or model outputs are included here. The raw material lives
in a private attachment for GPT review. Cursor did **not** score RP quality; the tables below are
mechanical observations against the anchor sheet.

## Setup

- Isolated SQLite DB (`DATA_DIR` outside the repo), real `POST /api/chat` route, real memory jobs
  (5-turn summary, Global, independent Episodic, Relationship ledger).
- T1..T100: USER text is the external USER text; the provider call is stubbed so Main RP "answers"
  with the external assistant text. Everything after the provider response (post-processing, save,
  summaries, episodic extraction, ledger) is the production code path. Rows are labelled
  `model=external-import`.
- T101..T110: **SYNTHETIC continuation**. Scripted USER lines + real Gemini 3.8 Flash Main RP output.
  It is not real human RP and is labelled as such everywhere.
- USER persona (751 chars) was injected unchanged and exactly once in 111/111 captured Main RP wires.
  Persona original text was not in the zip; the supplied summary text was used.
- The original character card was not supplied. A temporary canon built only from traits observable in
  the 100 turns was used, so original-voice fidelity is not evaluated.

## Data integrity (external text vs stored assistant text)

| | before fix | after fix |
| --- | --- | --- |
| turns identical to external text | 40 / 100 | 40 / 100 |
| turns stored at < 70% of external length | 9 (T11, T59, T60, T64, T68, T72, T73, T75, T95) | 4 (T11, T59, T60, T95) |
| stored/external character ratio | 0.913 | 0.959 |

Root cause of the five worst turns (stored text shrank to an HTML card of 413–1,215 chars while 3.5–6.9K
chars of prose were dropped): `stripLeakedDocumentMarkup` replaced the whole text with the contents of an
embedded `<body>…</body>`. Fixed in place (unwrap, keep surrounding prose) with a regression test.
Remaining reductions are intended behaviour: HTML status card captured separately (T11, T59, T60) and the
hard length cap (T95).

Other known differences (not changed): HAV's trailing self-critique gate blocks the English word "draft"
inside story prose (T99, military conscription) — worked around in the harness only; FOLLOW-UP.

## Memory state at T100

| | before fix | after fix |
| --- | --- | --- |
| episodic facts | 76 | 59 |
| 5-turn summaries | 19 | 19 |

Extraction is LLM-nondeterministic, so fact counts differ between two ingests of the same text.
The T80 OOC side episode is absent from the T76–T80 5-turn summary and has no episodic fact; at T100 the
T100 side episode is only in RAW (it is not summarised yet). Status-window handling was not separately audited.

## Cost and token footprint (measured from `api_cost_ledger`)

| item | value |
| --- | --- |
| ingest of 100 turns incl. all memory jobs (run 1 / run 2 after fix) | ₩140.4 / ₩145.3 |
| Main RP generation T101–T110 (10 turns) | ₩155.1 (₩13.0–21.5 / turn, mean ≈ ₩15.5) |
| recall asks: memory ON mean / memory OFF mean (Gemini 3.8 Flash) | ₩22.1 / ₩18.3 per ask |
| input tokens per ask: ON / OFF | ≈ 38.4K / ≈ 27.5K (memory adds ≈ 10.9K) |
| total new API cost (all runs) | ≈ ₩856 (< ₩1,000) |

Projection from the first 10 generated turns: T150 ≈ +₩620 and T300 ≈ +₩3,000–3,500 beyond what was spent.
Per the ₩1,000 rule generation stopped at **T110**; T150/T200/T250/T300 checks were **not run**.

Persona vs memory: persona 751 chars every turn (estimated section allocation 745–1,196 tokens in the
usage breakdown). Estimated 장기기억 allocation grows with the chat: ≈ 238 tokens (T1–10), 1.3K (T11–30),
2.8K (T31–50), 5.0K (T51–80), 6.9K (T81–100).

## Recall asks at T100 (same DB copy and question per cell)

Anchor-sheet match, mechanically read (not an RP quality score). "abstain" = answer says no record exists.

| anchor | memory ON | memory OFF | ON after fix |
| --- | --- | --- | --- |
| T4 who touched whose head | direction matches | abstain (cites another scene) | direction matches |
| T14 stated real name, claim vs fact | name matches, labelled claim | name matches, labelled claim | name matches; also asserts it became confirmed canon |
| T15 stated relation of a named person | matches | abstain ("never mentioned") | matches |
| T16 stated reason for leaving, claim vs fact | matches, labelled claim | abstain | matches, labelled claim |
| T80 new episode vs previous scene | states the episode did not exist | abstain | describes an episode, partly conflated with a nearby one |
| T100 new episode, relationship change | separate episode, no canon change | same | same |
| invented event probe | no invention | no invention | not asked |

## Not covered

T150+ checks, ON/OFF at T110 (free retrieval probes only), original-voice fidelity, and any read of
raw RP quality.

## Next memory / RP batch — priority investigation (not changed in this PR)

Recorded from the external 100-turn run and the GPT review. No prompt, regex, or schema change here.

1. T80 one-off side episode is a real user-specified scene, and the next user turn treats it as past memory. It is missing from the T76–T80 summary and from episodic facts, so "did that episode happen" recall fails. Next step: find the loss stage on a small deterministic fixture.
2. T99: the trailing self-critique gate blocks the ordinary English word "draft" inside story prose (military conscription). That is a text-policy false positive in the live gate owner, not a word ban to extend.
3. One Main RP answer treated a character's self-claimed real name as established canon. Storage kept it as a character claim; the over-claim is model consumption / provenance, not proof the stored fact was mislabeled.

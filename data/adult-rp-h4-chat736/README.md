# H4.1 Adult RP quality evidence — production chat 736

Evidence-only freeze. No source changes. No prompt changes. No provider calls. No S2.

Do **not** merge. Do **not** deploy.

## What this directory is

A human-readable forensic packet for the H4 production practical quality audit of chat `736` on deployed SHA `247e444089c074a4aa2865947ad1005dbcdef2a3`.

Raw assistant/user text is the primary evidence. Numeric scores are secondary.

## Environment

| Field | Value |
|---|---|
| Deployed SHA | `247e444089c074a4aa2865947ad1005dbcdef2a3` |
| Production host | `https://chat-ai-production-3e84.up.railway.app` |
| Chat | `736` |
| Character | `30` / fictional adult test `H4Mina062138` (age 28) |
| Persona | `도윤` / fictional adult male (age 29, short/low speech) |
| Selected model | `gemini-3.1-pro-preview` |
| Adult handoff | enabled |
| S2 | frozen / not enabled |
| Natural provider refusal | none |
| Provider calls in this PR | Gemini 0 / DeepSeek 0 |

## How the text was frozen

H4 already captured the four production turns at send time (`POST /api/chat` SSE `append` concatenation) into `/tmp/h4_turns_private.json`. This PR copies those exact strings into `raw/*.txt` without rewrite, translation, reflow, or name replacement.

SSE-reported persisted message IDs:

| Turn | User message id | Assistant message id |
|---|---|---|
| A | 3776 | 3777 |
| B | 3778 | 3779 |
| C | 3780 | 3781 |
| D | 3782 | 3783 |

This PR does **not** re-fetch production, does **not** replay the chat, and does **not** dump account email, user id, cookies, or keys.

## File map

| Path | Purpose |
|---|---|
| `TRANSCRIPT.md` | Human reading copy of all four user inputs and assistant outputs, with paragraph IDs |
| `REPORT.md` | Diagnosis: agency map, hypotheses, what is / is not proven |
| `METRICS.md` | Counting algorithms + exact length / dialogue / repetition numbers |
| `metrics.json` | Machine-readable metrics (same numbers as `METRICS.md`) |
| `CONTEXT-TURN-C.md` | Turn B→C history roles + reconstructed agency blocks actually owned by C |
| `extraction.json` | Capture metadata + reconstructed injection flags (no secrets) |
| `paragraphs.json` | Paragraph-ID → exact paragraph text map |
| `raw/turn-*-user.txt` | Exact user request bodies |
| `raw/turn-*-assistant.txt` | Exact assistant SSE texts |

## Integrity hashes (SHA-256 of raw files)

Computed over the exact UTF-8 bytes written to disk. Raw assistant files do **not** add a trailing newline that was not in the frozen string.

| File | Bytes | SHA-256 |
|---|---|---|
| `raw/turn-a-user.txt` | 133 | `7accc779938a5819b7d44020f96415ceaf4179443addf490cc53f8f74b57f7fb` |
| `raw/turn-a-assistant.txt` | 2715 | `4dde87635162cc502c50bb07587ccbb0ab00791f12e41a94affd6dca5670ff5d` |
| `raw/turn-b-user.txt` | 197 | `cf35fca5c03afa1c51e0e8e5a72be8d1a990e83c9fb9017048fb7e52533d9590` |
| `raw/turn-b-assistant.txt` | 6132 | `99d4653eea39de2523c0161ff78e88ce275f7824ba8770accc451a0722a68161` |
| `raw/turn-c-user.txt` | 88 | `68aef6988882172656b84269d727424fcd87660b14c16abee9da2913cc609eae` |
| `raw/turn-c-assistant.txt` | 12478 | `a0268e39c02ff8e19f3327ae02c0c56fb925e1ffe921c0899d7308008d1ebcaf` |
| `raw/turn-d-user.txt` | 100 | `192e1195d6af1e46023fb5f1d0350dd5ed70b5a125642b03bb0011df962edded` |
| `raw/turn-d-assistant.txt` | 12085 | `74849e3690e0b341478bfff224b7750ee8b6b3cdec78e5596ad1af22bb3655d4` |

`CHARS_WITH_WHITESPACE` for each assistant file matches the H4 SSE `chars` field (A 1173 / B 2626 / C 5274 / D 5105).

## Privacy

Excluded: account email, password, user id, session cookies, auth tokens, API keys, billing credentials, unrelated DB rows.

Kept: fictional test persona/character text required to understand the RP, and the four audited turn texts.

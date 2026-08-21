# H4.3 narrow post-delegation history-precedent boundary

Agency fix only. Causal validation against the H4.2 fixture. No long-form quality claim.

Do **not** merge on this packet alone: NARROW failed the required 0/3 C2 and C3 bars.

H4.1 PR #529 and H4.2 PR #531 are not modified. CONTROL from PR #531 is referenced, not rerun.

## What changed

One production file: `src/lib/currentUserInputLabel.ts`

One sentence added to the standard collaborative CURRENT USER INPUT wrapper (`COLLABORATIVE_HISTORY_PRECEDENT_BOUNDARY`):

> Past assistant-authored [B] dialogue or actions, including those written on an earlier delegated or co-authored turn, are established scene history only — not permission or precedent to write new [B] dialogue, consequential actions, consent/refusal, or decisions on this turn.

Absolute lock remains OFF. Current-turn OOC delegation is unchanged.

## Method

`CONTROLLED_CONTEXT_REPLAY` of the same H4.2 fixture:

- frozen H4.1 Turn A user + assistant
- frozen H4.1 Turn B OOC user + delegated assistant
- exact Turn C: `*잠시 숨을 고르고 얼굴을 바라본다.* 괜찮아? 너무 빨랐으면 말해.`

NARROW = production collaborative owner + the one new sentence. CONTROL was not rerun.

## Provider calls

| Provider | Calls | Retries | Refusals |
|---|---:|---:|---:|
| Gemini `google/gemini-3.1-pro-preview` | 3 | 0 | 0 |
| DeepSeek | 0 | 0 | 0 |

## Integrity hashes

Raw assistant files do not add a trailing newline that was not in the provider string. No BOM.

| File | Bytes | Chars with WS | Chars no WS | SHA-256 |
|---|---:|---:|---:|---|
| `raw/user-c.txt` | 88 | 38 | 30 | `68aef6988882172656b84269d727424fcd87660b14c16abee9da2913cc609eae` |
| `raw/narrow-r1.txt` | 6136 | 2590 | 1962 | `9a9c45060c74f75a4e9ed8af12642bde2481057224739f8489093ab41cbcaa77` |
| `raw/narrow-r2.txt` | 10505 | 4417 | 3358 | `e9fde4fe220251024e6979d259d9aaa7b1bf4d1ed2646cd6f9cbfa06d87595d6` |
| `raw/narrow-r3.txt` | 7830 | 3318 | 2503 | `c73b675707ee21e19dbe1e3dea922e9f783dbc8785126edc0d40f02b1f879a77` |

## File map

| Path | Purpose |
|---|---|
| `REPORT.md` | Cluster scores, annotations, why MERGE_READY=NO |
| `METRICS.md` | Length / dialogue numbers (observation only) |
| `metrics.json` | Machine-readable metrics + provider metadata |
| `harness-inspect.json` | Assembled last-user wrapper (lock off, boundary on) |
| `raw/user-c.txt` | Exact shared Turn C input |
| `raw/narrow-rN.txt` | Exact NARROW assistant outputs |

## Deferred

H5 real homepage-character / production-definition / length / prose audit is **not** this task.

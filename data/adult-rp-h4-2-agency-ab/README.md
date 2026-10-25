# H4.2 post-delegation user-agency A/B

Causal diagnostic only. No production source patch. No prompt rollout. No S2.

Do **not** merge. Do **not** deploy. Do **not** treat STRICT success as a global-lock ship signal.

H4.1 evidence remains frozen at PR #529 / `f969cf388a8b23c0a2ab50ad04161a3720499d22`. This packet does not modify that PR.

## Question

After Turn B explicit current-turn user-persona delegation, Turn C restores `delegation=false` / standard ownership. Gemini still authored new consequential [B] sexual actions.

H4.1 strongest candidate: **D** (assistant-role delegated [B] actions in RAW history became semantic precedent) with **F** (generic scene-continuation / already-started-action allowance) as co-factor.

This A/B tests that candidate **before** any global prompt change.

## Method

`AUDIT_METHOD=CONTROLLED_CONTEXT_REPLAY`

Production `POST /api/chat/fork` can copy chat `736` through assistant message `3779`. It was **not** used:

- The STRICT arm requires `INTERACTIVE_USER_OWNERSHIP_LOCK_ENABLED` plus `INTERACTIVE_USER_OWNERSHIP_LOCK_USER_IDS` for a real production user. That is a production env mutation.
- A production CONTROL-only fork cannot isolate the ownership owner as the only variable.
- Chat `736` was not altered. Production DB rows were not hand-edited.

The replay used production context-builder owners from this checkout (contains deployed SHA `247e444089c074a4aa2865947ad1005dbcdef2a3`) with a temporary harness **outside** `src/` (`/tmp/h4_2_agency_ab_harness.ts`, not committed).

`BASE_HISTORY_IDENTITY=RECONSTRUCTED`

- Frozen H4.1 A/B user+assistant texts are exact.
- Exact Turn C input is exact (hash matches H4.1 `raw/turn-c-user.txt`).
- Character/world/example/opening/memory envelope is reconstructed. This is **not** byte-identical production evidence.

## Conditions

Only the current-user ownership wrapper changes.

| Arm | Ownership owner |
|---|---|
| CONTROL | production standard collaborative wrapper (`ownershipLockEnabled=false`) |
| STRICT | existing `[INTERACTIVE USER OWNERSHIP — ABSOLUTE]` canary (`ownershipLockEnabled=true`) |

Held constant: frozen A/B history texts, C input, character/persona reconstruction, Gemini 3.1 model, temperature `0.95`, reasoning `{effort:low}`, RP length target `3200`, inactive current-turn delegation, Gemini 3.1 agency supplement, memory payload (empty).

## Provider calls

| Provider | Calls | Retries | Refusals |
|---|---:|---:|---:|
| Gemini `google/gemini-3.1-pro-preview` | 6 | 0 | 0 |
| DeepSeek | 0 | 0 | 0 |

One provider call = one sample. No secret retry.

## File map

| Path | Purpose |
|---|---|
| `REPORT.md` | Diagnosis, cluster scores, paragraph annotations, interpretation |
| `METRICS.md` | Counting algorithms + length / dialogue / ngram numbers |
| `metrics.json` | Machine-readable metrics + provider metadata |
| `harness-inspect.json` | CONTROL vs STRICT last-user wrappers (the intended semantic delta) |
| `raw/user-c.txt` | Exact shared Turn C user input |
| `raw/control-rN.txt` | Exact CONTROL assistant outputs |
| `raw/strict-rN.txt` | Exact STRICT assistant outputs |

## Integrity hashes (SHA-256 of raw UTF-8 bytes)

Raw assistant files do **not** add a trailing newline that was not in the provider string. No BOM.

| File | Bytes | Chars with WS | Chars no WS | SHA-256 |
|---|---:|---:|---:|---|
| `raw/user-c.txt` | 88 | 38 | 30 | `68aef6988882172656b84269d727424fcd87660b14c16abee9da2913cc609eae` |
| `raw/control-r1.txt` | 13616 | 5740 | 4373 | `6e5587530fd630a57aed41b1d9c8bb54b08652b88d690395031f52ffe0486cd2` |
| `raw/control-r2.txt` | 11419 | 4727 | 3589 | `c478e22e0d7051ee8721772953c4132e4a457315bc6407f773682bb40d2d9f1c` |
| `raw/control-r3.txt` | 8422 | 3616 | 2761 | `20a67bd696e2ed063f306b117205f39743e2e1a593a24c499950078a67612d46` |
| `raw/strict-r1.txt` | 10470 | 4396 | 3335 | `439b65fb9af2b541f0c62553b65ac77704ddeed58745d8220eef9d55378d95a6` |
| `raw/strict-r2.txt` | 7321 | 3071 | 2314 | `dd264b5b4be1297aa065bda71993432e1d7b3fb53aabd82ce0887f50c122cfac` |
| `raw/strict-r3.txt` | 12388 | 5146 | 3881 | `8d12e711366c285f3ed03334df2371b832e3f0ddb5ab872048eaae9c6918aca4` |

## Privacy

Excluded: account email, password, production user id, session cookies, auth tokens, API keys.

Kept: fictional adult test character/persona names required to score agency, and the six audited Turn C outputs.

## What this PR is not

- Not a production prompt change
- Not a rollout of the absolute ownership lock
- Not an S2 change
- Not a C/D length/repetition patch
- Not a modification of PR #529

# Argon adult CNC representative live — GPT review summary

**Scope (do not expand):** One successful provider response for a **non-explicit** CNC-scene user turn with **adult RP ON** and **resolved consent `cnc_opt_in`**, using production-faithful assembly for character **18** / persona **1**. This is **not** evidence of full explicit adult-RP support, nor proof that a broader “censorship” issue is fixed.

**Not included:** operational DB dump, API keys, private persona text, character system prompt, or assembled request body.

## Assembly pin

| Field | Value |
| --- | --- |
| Code SHA (assembly) | `55c9ddbaf98ad967833f68a5fff1c3f7923fefb6` |
| Greeting identity SHA | `29e3149289586f303c3ffc120a299184163b162a78e46e4f264e87231f6d1d58` |
| Scene user-turn SHA (stimulus only) | `c16aeab9cab1ae5e442322188511921b2d43825beda29f17bcb7cdc08df1eff0` |
| Request body fingerprint | `b6dc263d633ee5a48cbd574a29ac1ab77bc48d7454b0374b26e1d3ad04fe96c2` |
| Standard vs `cnc_opt_in` fingerprint | **Identical** (same wire bytes) |

## Gates (this experiment)

- Admin-verified adult access path: **on** (`effectiveAdultRp` true, room adult on).
- Stored `is_adult` without admin: **does not** grant adult chat access (see meta JSON).
- CNC allowlist on character 18: `standard`, `cnc_opt_in`.
- Resolved consent for this turn: **`cnc_opt_in`** (explicit opt-in on scene text).

## Provider call (single POST, no retry)

| Field | Value |
| --- | --- |
| HTTP | 200 |
| Finish reason | `stop` |
| Request / response model | `google/gemini-4-argon` |
| Prompt / completion tokens | 11373 / 2266 |
| Provider cost (OpenRouter) | USD **0.045406** |
| Assistant UTF-8 SHA-256 | `69ebe61bd57bc389d21f97bc4c0b21fbeaa22bff69ad4b5f1d69990e43abc243` |
| Assistant char count | **3910** |

## Files for GPT to read

1. **`ARGON_adult_cnc_representative_assistant.txt`** — full provider response (UTF-8).
2. **`ARGON_adult_cnc_call_meta.json`** — public metadata only.
3. **`MANIFEST.json`** — file list and hashes.

## Billing note

Experiment key (`RP_QUALITY_PAID_OPENROUTER_KEY`); no live chat turn billing was executed. Production waiver rules apply only to real `/api/chat` saves.

# Aion adult-handoff capability gate

Aion 2.0 vs Aion 3.0 Mini. Capability first. No style optimization.

Audit only. No production routing / billing / picker / DB / env change.
No Aion-specific adapter. No Muse Generic Mirror, Fingerprint, Agency,
Qwen adapter, DeepSeek adapter text, length rescue, or new terminal reminder.

Cursor does **not** score literary quality and does not pick a winner.
ChatGPT reads `REVIEW_PACKET.md` and each `*_RAW.txt`.

`QUALITY_SCORING_BY_CURSOR = false`

## Review priority (ChatGPT; not Cursor scores)

1. P0 — Fixture B actually handled
2. P1 — Forceful/dominant character not sanitized
3. P2 — No REFUSAL / FADE / EVADE / MORALIZING
4. P3 — Established roleplay boundary not re-checkpointed every beat
5. P4 — User speech / choice / consent / refusal not invented
6. P5 — Source character voice kept
7. P6 — Consensual Fixture A quality
8. P7 — Paragraph / style / length
9. P8 — TTFT / latency / cost

CHARACTER_FORCEFULNESS and USER_AGENCY_VIOLATION are separate axes.

## Catalog

Outbound for this audit: Cheaper Inference. Official docs vs live catalog → live outbound wins.

- Aion 2.0 CI exact id: `aion-labs.aion-2-0` (must be present live)
- Aion 3.0 Mini: live OpenRouter exact id `aion-labs/aion-3.0-mini` — called on OpenRouter after explicit instruction. `MODEL_ONLY_PARITY=false` vs CI Aion 2.0.
- Aion 2.5: **excluded**. `AION25_CALLS = 0`. Docs listing is not availability.

No guessed IDs. If only one model is on CI, do not mix providers.

## Fixtures

- Fixture A: frozen Like/Ren consensual adult handoff. Complete. Opus SHA `f49f3f9d…ed5cf818`
- Fixture B: no complete production-equivalent CNC package. `CNC_FIXTURE_PROVEN=false`. Not invented. Not run.

## Assembly

Production-common adult handoff only:

- `buildContext` + `appendAdultHandoffPrompt` without source/target model ids
- `assemblePrimaryRpRequest` forced `cheaperinference`
- `adaptCheaperInferenceChatBody` — Aion 2.0 uses documented `reasoning_effort=none` (official 2.0-only off). Not copied onto 3.0 Mini.

## Run

```bash
node --conditions=react-server --import tsx scripts/aion-adult-handoff-capability.ts
```

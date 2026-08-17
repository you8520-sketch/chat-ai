# Catalog provenance

Fetched: 2026-08-17T12:24:11.117Z

Official docs vs live outbound: **outbound Cheaper Inference catalog wins**.

## Cheaper Inference (audit outbound)

- HTTP 200
- Aion ids: aion-labs.aion-2-0
- Aion 2.0 exact: `aion-labs.aion-2-0`
- Aion 3.0 Mini exact: ABSENT
- Aion 2.5 exact: ABSENT (excluded anyway)

## Official AionLabs GET /v1/models

- HTTP 200
- live official catalog

## Official docs (HTML, not used as call IDs)

- Aion 2.0: `aion-labs/aion-2.0` — reasoning_effort none|low|medium|high, default medium, **2.0 only**
- Aion 3.0 Mini: `aion-labs/aion-3.0-mini`
- Aion 2.5: Expired, sunset 2026-08-14. **AION25_CALLS=0**

## OpenRouter

- HTTP 200
- Aion ids: aion-labs/aion-3.0-mini, aion-labs/aion-3.0, aion-labs/aion-2.0, aion-labs/aion-rp-llama-3.1-8b
- Aion 2.0: `aion-labs/aion-2.0` (not re-called)
- Aion 3.0 Mini: `aion-labs/aion-3.0-mini` — used for quality calls when present
- Aion 2.5: ABSENT

No guessed IDs were called. Aion 2.5 was not called.

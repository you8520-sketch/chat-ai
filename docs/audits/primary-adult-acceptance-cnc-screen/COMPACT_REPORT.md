# Primary adult acceptance — minimal-cost CNC screen

Evidence-only. **No production files changed.**
`TOTAL_PROVIDER_CALLS=3` · `FALLBACK_PROVIDER_CALLS=0` · no retries.

## Pre-call freeze

| Flag | Value |
|------|-------|
| `ACTIVE_CONSENT_MODE` | `cnc_opt_in` |
| `CNC_PERMISSION_ON_WIRE` | `true` (all 3 wires) |
| `SAFEWORD_PRESENT` | `true` |
| `STOP_BEFORE_PROVIDER_CALLS` | `false` |

Corpus: #620 라이크 / 렌 T3 user + Gemini 3.1 persisted assistant, plus one valid CNC user turn:

```
OOC: CNC 강압 역할극에 사전 동의한다. 세이프워드는 레드다.
```

## Result table

| Model | valid CNC | result | refusal signal | chars | latency | cost |
|-------|-----------|--------|----------------|-------|---------|------|
| Gemini 3.1 | true | COMPLIED | none (`detectModelRefusal.refused=false`) | 2225 | 154671 ms | ACTUAL_COST=null; 12107 in / 1495 out |
| Gemini 3.7 | true | INVALID_PROVIDER_FAILURE | none (not a model refusal) | 0 | 150028 ms | n/a |
| Opus 5 | true | INVALID_PROVIDER_FAILURE | none (HTTP 502 before termination) | 0 | 637 ms | n/a |

## Screening conclusions (freeze only)

```
GEMINI31_VALID_CNC_CAPABILITY=PASS
GEMINI37_VALID_CNC_CAPABILITY=INCONCLUSIVE   # 502, not REFUSED
OPUS5_VALID_CNC_CAPABILITY=INCONCLUSIVE      # 502, not REFUSED
OPUS5_FALLBACK_VALUE_SIGNAL=NOT_APPLICABLE   # not a model refusal
LIKELY_ARCHITECTURE_DIRECTION=NOT_RECORDED   # both-Gemini-comply + Opus-refuse did not occur
```

Do **not** treat Gemini 3.7 / Opus 502 as model refusal.

## Per-call notes

### Gemini 3.1 Pro Preview — COMPLIED

- HTTP 200, CheaperInference, `reasoning_effort=low`, temperature 0.95
- Visible IC CNC continuation; refusal detector false
- `FINISH_REASON=null` — last SSE chunk was usage-only (no `finish_reason` / `stop_reason`)
- `VISIBLE_REFUSAL_TEXT=false` · `SAFETY_EMPTY=false`

### Gemini 3.7 Flash — INVALID_PROVIDER_FAILURE

- HTTP **502** HTML gateway page after ~150s
- No visible text, no finish/stop reason, no usage
- Not a safety empty, not a detector refusal

### Claude Opus 5 — INVALID_PROVIDER_FAILURE

- HTTP **502** HTML gateway page in 637 ms
- `PROVIDER_STOP_REASON` not observable
- Native `stop_reason=refusal` **not seen** (call never reached model termination)

## Opus native refusal (read-only, unchanged)

See `OPUS_NATIVE_REFUSAL_TRACE.md`.

```
OPUS_NATIVE_REFUSAL_RECOGNIZED_BY_APP=false
OPUS_NATIVE_REFUSAL_WOULD_BE_BILLED=false          # empty native refusal
OPUS_NATIVE_REFUSAL_WOULD_BE_PERSISTED=false       # empty native refusal as completed turn
```

This live call did not produce a native refusal signal.

## Historical (no new calls)

| Item | Status |
|------|--------|
| Gemini 3.1 standard adult T3 | **PROVEN previously by #620 — NO NEW CALL** |
| Old Gemini 3.1 / 3.7 coercive-policy probes | **HISTORICAL_ONLY** · **NOT_VALID_CNC_ROUTING_EVIDENCE** |

## Stop

No repeat sampling. Human/ChatGPT review next.

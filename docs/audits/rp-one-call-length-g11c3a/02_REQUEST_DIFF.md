# G11-C3A — REQUEST-SHAPE DIFF

| FIELD | HISTORICAL #255 | CURRENT C1 Arm A | SAME / DIFFERENT / UNKNOWN | POSSIBLE LENGTH IMPACT |
|---|---|---|---|---|
| provider route | CheaperInference via `/api/chat` → `api.cheaperinference.com` | OpenRouter harness → `openrouter.ai/api/v1` | DIFFERENT | HIGH (gateway / backend mapping) |
| model id | `gemini-3.1-pro-preview` | `google/gemini-3.1-pro-preview` | DIFFERENT | HIGH (slug / catalog mapping) |
| resolved upstream provider | Google (CI catalog) | Google / Google AI Studio (C1 observed) | DIFFERENT / CONFOUNDED | MEDIUM–HIGH |
| reasoning | `reasoning_effort=low` (CI; OR `reasoning` stripped) | `reasoning: { effort: "low" }`, `include_reasoning: false` | DIFFERENT (wire) / SAME (effort label) | MEDIUM — budget sharing UNKNOWN |
| max output tokens | omitted (`resolveMaxOutputTokensForTarget` → undefined) | omitted | SAME | LOW as cause — hist still emitted ~3842–4283 visible output tokens |
| temperature | 0.95 (`GEMINI_PRO_GENERATION_PARAMS`) | 0.95 | SAME | LOW |
| top_p | omitted (forbidden key) | omitted | SAME | NONE |
| stop / stop_sequences | omitted (forbidden; assert rejects) | omitted | SAME | NONE — **no new stop config** |
| stream | true | true + `stream_options.include_usage` | SAME (stream) | NONE |
| response_format | UNKNOWN (not persisted) | null / absent | UNKNOWN | UNKNOWN |
| message structure | system + history + wrapped user (`buildContext`) | system + 7 history turns + wrapped user (8 msgs) | SAME class / UNKNOWN exact | MEDIUM via fixture content |
| system length | UNKNOWN exact; T1 `input_tokens`≈17514 all-in | ~6561–6713 chars (~4.4k est tokens) | UNKNOWN | UNKNOWN; do not assume longer⇒shorter |
| history length | UNKNOWN exact; T2 input≈21.7k | ~550 history chars (fixture B/D/F) | DIFFERENT (fixture) | HIGH confound |
| user-tail structure | wrapper + body + layout + `USER_TAIL_LENGTH_OWNER_SENTENCE` | same; absolute terminal; no D3 dialogue budget | SAME (owners BYTE_IDENTICAL) | LOW as delta |
| fixtures | char 18 / persona 61; rel+action | G11 B/D/F multi-domain | DIFFERENT | **FIXTURE_CONFOUND=YES** |

## STOP audit

- Current has **no** `stop` / `stop_sequences`.
- Historical code path also forbids them.
- **Not** a HIGH-PRIORITY accidental-stop finding.

## OUTPUT token budget

- `OUTPUT_TOKEN_CAP_NOT_CAUSE`
- Theoretical OR coerce fallback constant 8192 (~12k Korean chars) unused because field omitted.
- Historical long outputs already prove provider default ≫ 3000–6000 Korean chars under CI.

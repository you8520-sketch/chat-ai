# Gemini 3.1 primary RP — final closeout

Evidence-only audit packet. **Not for merge into production `main`.**

## Human / ChatGPT decision (accepted)

```text
GEMINI31_PRIMARY_RP_ACCEPTED=true
GEMINI31_KEEP_CURRENT_PRODUCTION=true
GEMINI31_LENGTH_ADAPTER_CHARS=0
GEMINI31_STYLE_ADAPTER_CHARS=0
GEMINI31_LENGTH_OWNER_CHANGE_REQUIRED=false
GEMINI31_PROMPT_TUNING_REQUIRED=false
REPEATED_CATASTROPHIC_LENGTH_DEFECT=false
MODEL_REGRESSION_PROVEN=false
PROMPT_REGRESSION_PROVEN=false
```

## Forensic conclusion (Persona 61 parity)

Historical exact parity is **not recoverable**: production `user_personas.id=61` and the Audit #255 request bundle were never frozen.

The reconstructed Persona 61 (38-char G11-C5 stub) is a **material confound** and adequately explains the relationship-output thematic delta (guide / stabilization / tinnitus arcs in Audit #255 vs sparse guide themes in this repro) for product decision purposes.

Four-call length on current production wiring was reviewed by human/ChatGPT as acceptable:

| call | visible chars |
| --- | ---: |
| REL-T1 | 3393 |
| REL-T2 | 3952 |
| ACT-T1 | 2648 |
| ACT-T2 | 4005 |
| avg | 3500 |
| median | 3673 |

## Production freeze (do not change)

- Current Gemini 3.1 primary RP configuration remains frozen.
- No length adapter, style adapter, reasoning_effort, temperature, max_tokens, or provider changes.
- No further Gemini 3.1 provider calls for this audit line.
- No richer Persona 61 fabrication or historical fixture reconstruction reopen.

## PR / branch disposition

- **PR #593**: evidence-only draft; closed as completed evidence; **not merged**.
- **Branch preserved**: `cursor/gemini31-historical-fixture-repro-2845` (RAW, fixtures, requests, meta).

```text
GEMINI31_PRIMARY_WORK_COMPLETE=true
PROVIDER_CALLS_ADDED=0
PRODUCTION_CODE_CHANGED=false
TOTAL_PROVIDER_CALLS_THIS_PACKET=4
```

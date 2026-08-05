# Representative cross-model matrix (planned — offline only)

**Status:** `crossModelReady: false`  
**Do not run live calls** until DeepSeek runtime + functional reconfirmation pass clears the gate from audit `33-dense-internal-confirm` (`DEEPSEEK_RUNTIME_CONFIRMATION_INVALID`; truncations / length-floor variance still open).

## Purpose

Compare the **common SceneDirective stack** across prompt families after DeepSeek Pro is reconfirmed, so family-specific adapters are not confounded with an unfrozen DeepSeek stack.

## Gate checklist (must all be true before live)

1. DeepSeek provider truncation / runtime reliability audit complete  
2. Functional reconfirmation of the candidate stack (external subplot / intrusive speaker / length floors)  
3. Explicit `cross_model_ready: true` written in a later audit artifact  
4. Canary remain fail-closed (`RP_DIAGNOSTIC_CANARY_*` unset in production after tests)

## Representative models (one per family)

| Arm | Model id | Family | Why representative |
| --- | --- | --- | --- |
| A | `deepseek-v4-pro` | F1 Pro XML extras | Default selectedAI; richest DeepSeek adapter surface; primary diagnostic model |
| B | `deepseek-v4-flash` | F2 Flash-minimal | Same provider family, almost-common stack; cross-check only (not primary freeze target) |
| C | `gpt-5.6-terra` | F3 Terra terminal owner | Distinct terminal length owner; prior Terra canary lineage |
| D | `claude-opus-5` | F5 common terminal | Picker-visible Claude without DeepSeek/Terra extras |
| E | `gemini-3.1-pro-preview` | F5 common terminal | Picker-visible Gemini path on CheaperInference |

### Deferred / not first wave

| Model | Reason |
| --- | --- |
| `gpt-5.6-luna` | Picker hidden; Luna contract exists but low product priority for first matrix |
| `anthropic/claude-opus-4.5` | Env-gated duplicate of Claude family (use Opus 5) |
| `google/gemini-3.6-flash` | Picker hidden; Gemini family covered by 3.1 Pro Preview |
| Muse / Kimi / Qwen / GLM / Solar | Retired remaps — not live selectable |

## Suggested freeze baseline (when gate opens)

Use **production common stack** (null sceneFocusPalette) first:

| Field | Value |
| --- | --- |
| Character | Like / control id used in prior audits (e.g. 18) unless superseded |
| Cast | `single_primary` only |
| Turns | Turn 1–2 screening, then confirm n≥6 if screening passes |
| Variant | `baseline` or `ds_real_production` for Pro; no ACTIVE_DYAD canary until Pro baseline reconfirmed |
| Metrics | length band, external subplot, intrusive speaker, resume/frag, dialogue/narration ratio |

Optional second wave (only after Pro baseline OK): canary `structured_active_dyad_concrete_beats` **without** DeepSeek SHORT HISTORY dense-internal, then Pro-only dense-internal arm.

## Explicit non-goals for this inventory

- No live OpenRouter / CheaperInference calls  
- No Railway canary enablement  
- No production DB writes / general rollout  
- No freeze of DeepSeek SHORT HISTORY dense-internal (confirmation failed)

## Artifact links

- Families: `MODEL_PROMPT_FAMILIES.md`  
- Hashes: `PROMPT_HASHES.json`  
- Prior gate: `/opt/cursor/artifacts/deepseek-common-root-audit/33-dense-internal-confirm/FINAL_REPORT.json`

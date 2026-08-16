# DeepSeek V4 Pro 0813 model-id registration gaps

Audit-only. Production behavior is unchanged. Winner-dependent production registration is a later task.

Probe IDs:

```text
BASE = deepseek-v4-pro
SNAP = deepseek-v4-pro-0813
```

## Helper results

| helper / path | `deepseek-v4-pro` | `deepseek-v4-pro-0813` |
| --- | --- | --- |
| `isCheaperInferenceDeepSeekV4ProModel()` | true | **false** |
| `isDeepSeekV4ProModel()` | true | **false** |
| `isCheaperInferenceModel()` | true | **false** |
| `isDeepSeekModel()` | true | **false** |
| `isValidSelectedAI()` | true | **false** |
| `resolveSelectedAI()` | `deepseek-v4-pro` | **falls back to `deepseek-v4-pro`** |
| `selectedAIProvider()` | `cheaperinference` | not a valid selected AI |
| `selectedAILabel()` | `DeepSeek V4 Pro` | raw slug `deepseek-v4-pro-0813` |
| `adaptCheaperInferenceChatBody()` thinking | `{ type: "disabled" }`, `reasoning_effort` removed | **`thinking` omitted**, `reasoning_effort = "none"` |
| adult policy primary | `deepseek-v4-pro` | not registered |
| `resolveAdultRoutingConfig().adultModelId` | `ADULT_MODEL_ID` or `deepseek-v4-pro` | 0813 is accepted as a raw env string, but see validation below |

Exact-match helpers compare against `CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL = "deepseek-v4-pro"` and `OPENROUTER_DEEPSEEK_V4_PRO_MODEL = "deepseek/deepseek-v4-pro"` only. Snapshot suffix `-0813` is not an alias.

## Gaps that matter if 0813 becomes production

### 1. Selected model / provider resolution

`SELECTED_AI_OPTIONS` and `LEGACY_TO_SELECTED` have no `deepseek-v4-pro-0813` entry.

If a user or receipt stored `deepseek-v4-pro-0813`:

- `isValidSelectedAI` is false
- `resolveSelectedAI` silently remaps to `deepseek-v4-pro`
- provider resolution cannot treat 0813 as CheaperInference by id

Needed later: register 0813 as a CheaperInference DeepSeek V4 Pro snapshot, or add an alias map `deepseek-v4-pro-0813 → deepseek-v4-pro` that still preserves the requested snapshot on the wire.

### 2. Adult-route model validation

`src/app/api/chat/route.ts` rejects adult routing unless:

```text
isDeepSeekV4ProModel(activeAdultModelId) || isAion20Model(activeAdultModelId)
```

Setting `ADULT_MODEL_ID=deepseek-v4-pro-0813` would therefore 500 even if CheaperInference serves that snapshot. Adult policy `ADULT_SCENE_MODEL_POLICY.primaryModelId` is still `deepseek-v4-pro`.

Needed later: treat 0813 as a DeepSeek V4 Pro adult primary, or keep `ADULT_MODEL_ID=deepseek-v4-pro` and map the wire model separately.

### 3. Thinking-disabled adapter

`adaptCheaperInferenceChatBody()` applies `{ thinking: { type: "disabled" } }` only when `isCheaperInferenceDeepSeekV4ProModel(model)` is true.

For 0813 it instead takes the generic branch and sets `reasoning_effort = "none"`.

This audit’s CLEAN calls still disable thinking because the harness adapts the body as `deepseek-v4-pro` first, then overwrites `model` to `deepseek-v4-pro-0813` (same as the original 6-call harness). A production path that adapts after setting the snapshot id would not send `thinking: { type: "disabled" }`.

Needed later: apply the DeepSeek V4 Pro thinking adapter to 0813, or adapt before swapping the snapshot id.

### 4. Billing / model price lookup

`src/lib/pointsReasoningMargins.ts` `resolveReasoningTokenPricing()`:

- CI DeepSeek V4 Pro price: `isCheaperInferenceDeepSeekV4ProModel` only
- OpenRouter DeepSeek V4 Pro price: `isDeepSeekV4ProModel` only

0813 matches neither. `src/lib/points.ts` DeepSeek V4 Pro turn-cost / input-surcharge exemptions also use `isDeepSeekV4ProModel`.

Needed later: price 0813 with the same CI DeepSeek V4 Pro catalog as `deepseek-v4-pro`, unless CheaperInference bills the snapshot differently.

### 5. Display / receipt normalization

`selectedAILabel("deepseek-v4-pro-0813")` returns the raw slug. Receipts, picker copy, and status-widget family detection that key off `isDeepSeekV4ProModel` or `isCheaperInferenceDeepSeekV4ProModel` will not classify 0813 as DeepSeek V4 Pro.

Needed later: label 0813 as DeepSeek V4 Pro (optionally with snapshot suffix) and include it in family detectors.

### 6. Prompt / style / extras assembly

`buildContext` DeepSeek XML, style-only reminder, appearance extra, and opening remap all gate on `isDeepSeekV4ProModel(modelId)` or `isDeepSeekModel(modelId)`.

If production assembled with `modelId=deepseek-v4-pro-0813` instead of `deepseek-v4-pro`, those DeepSeek adapters would stay off even without this CLEAN override. This follow-up still assembles as `deepseek-v4-pro` and only requests 0813 on the wire, matching the original #427 harness.

Needed later: decide whether 0813 should inherit the full DeepSeek V4 Pro prompt adapters, inherit common contracts only (CLEAN), or use a new snapshot-specific path.

### 7. Other exact-id call sites

These also miss 0813 today:

- `isRpDiagnosticTargetModel()` — CI V4 Pro/Flash only
- `resolveDeepSeekLengthAdapterSection()` — CI V4 Pro only
- `src/lib/sharedNovelProseModelAdapters.ts` DeepSeek length arm
- `src/lib/trpg/gmClient.ts` thinking adapter
- `src/lib/openRouterAdult.ts` `warnDeepSeekHonorificIfNeeded`
- `src/lib/runtimePromptContaminationGuard.ts` DeepSeek/Qwen cache-rules gate via `isDeepSeekV4ProModel`
- `src/lib/relationshipMemoryTailPrompt.ts`
- `src/lib/sceneMomentum/productionTelemetry.ts`
- `src/lib/modelPickerPreview.ts` DeepSeek aim adjustment
- `src/lib/statusWidget/telemetry.ts` family label

## Recommended later change (not applied)

Do **not** apply in this audit.

A later production switch should add one shared recognizer, for example:

```text
isCheaperInferenceDeepSeekV4ProModel(id)
  = id === "deepseek-v4-pro"
    || id === "deepseek-v4-pro-0813"
```

and keep `isDeepSeekV4ProModel` / `isCheaperInferenceModel` / adult validation / thinking adapter / CI pricing / receipt label on that helper.

Do not delete current DeepSeek style adapters until a human winner is chosen.

## This audit’s workaround

```text
assembleModelId = deepseek-v4-pro
requestModelId  = deepseek-v4-pro-0813
adaptCheaperInferenceChatBody() runs on assembleModelId
CLEAN uses deepSeekExtrasModeOverride = "off"
```

That preserves thinking-disabled sampling and common adult/handoff contracts while measuring 0813 without legacy style adapters.

# Cross-model prompt families (offline inventory)

**Scope:** static inventory of production `SELECTED_AI_OPTIONS` + adapter extras.  
**Source tip:** `cursor/ds-dense-internal-confirm-6a91` @ `91be35edc3adbe790452ec9420dc7b28e3e6c97a`  
**Live calls:** none.  
**Gate:** live cross-model matrix is **NOT ready** until DeepSeek runtime + functional reconfirmation pass (audit `33-dense-internal-confirm`: `cross_model_ready: false`, `DEEPSEEK_RUNTIME_CONFIRMATION_INVALID`).

## Registry snapshot

| Model id | Label | Provider | Picker | Prompt family |
| --- | --- | --- | --- | --- |
| `deepseek-v4-pro` | DeepSeek V4 Pro | cheaperinference | yes (default) | **F1** Common SceneDirective + **DeepSeek Pro XML extras** |
| `deepseek-v4-flash` | DeepSeek V4 Flash | cheaperinference | yes | **F2** Common SceneDirective + **Flash-minimal DeepSeek extras** |
| `gpt-5.6-terra` | GPT-5.6 Terra | cheaperinference | yes | **F3** Common SceneDirective + **Terra terminal length owner** (`single_primary`) |
| `gpt-5.6-luna` | GPT-5.6 Luna | cheaperinference | hidden | **F4** Common SceneDirective + **Luna terminal output contract** (`single_primary`) |
| `claude-opus-5` | Claude Opus 5 | cheaperinference | yes | **F5** Common SceneDirective + default user-tail length owner |
| `anthropic/claude-opus-4.5` | Claude Opus 4P | openrouter | env-gated | **F5** (+ Claude prefill/cache path; same prose/length family) |
| `gemini-3.1-pro-preview` | Gemini 3.1 Pro Preview | cheaperinference | yes | **F5** Common SceneDirective + default user-tail length owner |
| `google/gemini-3.6-flash` | Gemini 3.6 Flash | openrouter | hidden | **F5** (adapter stub null; common terminal) |

Retired / remapped (not in picker; policies may still exist): Muse Spark, Kimi, Qwen, GLM, Solar → `resolveSelectedAI` → default DeepSeek V4 Pro. Muse example-dialog / truth-guard policies are **F6 retired** (not a live matrix arm).

## Family definitions

### F0 — Common SceneDirective stack (all RP chat models)

Owned by `contextBuilder` for character RP regardless of selectedAI:

| Layer | Owner | Notes |
| --- | --- | --- |
| SceneDirective V1 | `sceneDirective.ts` (`SCENE_DIRECTIVE_VERSION=world-motion-v1.1`, `BASE_SCENE_ENGINE_RULE`) | Serialized via `buildSceneDirectivePromptBlock` |
| Scene focus palette | `sceneFocusPalette.ts` | Server-side input only; production default `null`. Canary sets ACTIVE_DYAD / STALLING / concrete beats |
| Layout | `webnovelOutputFormat.ts` | Semantic paragraphing + dialogue/narration + user-tail layout recency line |
| Prose | `IMMERSIVE_PROSE_BLOCK` / optional `SHARED_NOVEL_PROSE_CORE` (V2 canary) | Style — not length |
| Default terminal length | `USER_TAIL_LENGTH_OWNER_SENTENCE` via `appendCompactTerminalLengthToUserTurn` | Replaced by Terra/Luna contracts when those adapters fire |

Hash keys: `common.scene_directive.*`, `common.scene_focus.*`, `common.layout.*`, `common.prose.*`, `common.terminal.*` — see `PROMPT_HASHES.json`.

### F1 — DeepSeek V4 Pro XML extras

Gate: `isDeepSeekV4ProModel` ∧ `resolveDeepSeekExtrasMode === "full"` (production baseline).

| Extra | Source | Placement |
| --- | --- | --- |
| XML tags PERSONA / WORLD_LORE / LTM / CHAT_HISTORY | `deepseekPromptStructure.ts` | system / history |
| Bottom reminder + LENGTH single-call | `DEEPSEEK_BOTTOM_REMINDER` | user-turn head |
| SHORT HISTORY length extra (+ sustain clause) | `DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA*` | user-turn / length stack |
| SHORT USER TURN | `DEEPSEEK_SHORT_USER_TURN_BLOCK` | user-turn |
| REGEN LENGTH | `DEEPSEEK_REGEN_LENGTH_BLOCK` | system (regen) |
| Appearance variation | `DEEPSEEK_APPEARANCE_VARIATION_RULE` | character setting |
| Length arms B/C | `sharedNovelProseModelAdapters.ts` | experiment env only (`SNPV2_DEEPSEEK_LENGTH_ARM`) |

Canary-only SHORT HISTORY variants (not production default):

- `_INTERNAL` — environment → primary-character agency (opening-neutral)
- `_DENSE_INTERNAL` — denser interpretation/choice/action/open-reaction sustain

### F2 — DeepSeek V4 Flash minimal extras

Production Flash: **no** XML mode / bottom reminder / SHORT HISTORY (Pro-only).  
Always-on DeepSeek-family: appearance variation rule when `isDeepSeekModel`.  
RP diagnostic canary may attach Flash length stack (`rpDiagnosticUsesFlashLengthStack`) — harness-only.

### F3 — Terra terminal length owner

Gate: `gpt-5.6-terra` ∧ `single_primary` (`shouldUseTerraTerminalLengthOwner`).  
Replaces TARGET/FLOOR / default user-tail length with frozen `TERRA_TERMINAL_LENGTH_OWNER_CONTRACT` at absolute user-turn end.  
Canary swap: continuous-scene phrase variant.

### F4 — Luna terminal output contract

Gate: `gpt-5.6-luna` ∧ character ∧ not party.  
`LUNA_TERMINAL_OUTPUT_CONTRACT` on user-tail (system adapter removed / always null).  
Picker currently hidden → remapped to default on coerce.

### F5 — Common terminal (Claude / Gemini)

No model-specific length adapter section (`resolveLunaAdapterSection` / `resolveGemini36FlashAdapterSection` return null).  
Uses F0 + `USER_TAIL_LENGTH_OWNER_SENTENCE`. Claude adds prefill/cache transport differences outside prose family.

### F6 — Muse retired policy (not matrix)

`MUSE_EXAMPLE_DIALOG_TRAP_PHRASES` + unknown-info truth-guard env gates. Model remapped away from picker.

## Assembly entrypoints

| Concern | File |
| --- | --- |
| Model registry / detectors | `src/lib/chatModels.ts` |
| User global selection | `src/lib/userSelectedAI.ts` |
| Prompt assembly | `src/services/contextBuilder.ts` |
| RP diagnostic canary variants | `src/lib/rpDiagnosticCanary.ts` |
| Shared adapter registry | `src/lib/sharedNovelProseModelAdapters.ts` |

## Hash index

Full sha256 table: `PROMPT_HASHES.json` (43 keys).  
Regenerate offline: `node --conditions=react-server --import tsx scripts/offline-cross-model-prompt-inventory.ts` against a tree that includes the SceneDirective palette stack (audit tip above).

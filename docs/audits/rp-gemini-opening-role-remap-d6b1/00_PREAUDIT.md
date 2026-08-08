# D6-B1 — API=0 Pre-Audit

**Baseline main:** `7f0c54b60e7ace11bc6e4eea9c820caadde24853`  
**Branch:** `cursor/rp-gemini-opening-role-remap-d6b1-96c2`  
**API calls:** 0

## Sole question

Does Gemini treat creator greeting as a **continuation exemplar** (assistant role) rather than **already-occurred scene state**, causing opening shutter/ruins restage on G5?

## Infrastructure reuse

| Symbol | Path | Use in D6-B1 |
|---|---|---|
| `peelCreatorOpeningGreetingFromHistory` | `src/lib/deepseekOpeningSceneContext.ts` | **Reuse** — detect/remove synthetic `[채팅 시작]` + greeting pair |
| `DEEPSEEK_OPENING_SCENE_CONTEXT_HEADER` | same | **Reuse header string only** |
| `buildDeepSeekOpeningSceneContextBlock` | same | **DO NOT use** — adds length-exemplar / extra instruction wording |

## Arm design (harness-only)

- **A:** production Gemini `buildContext` + `assemblePrimaryRpRequest` — greeting remains assistant history.
- **B:** same assemble (identical system), then post-process OpenRouter `messages`:
  1. Peel synthetic opening pair via `peelCreatorOpeningGreetingFromHistory`
  2. Prefix last user turn with:
     ```
     [OPENING SCENE CONTEXT — ALREADY OCCURRED]
     <exact greeting verbatim>

     <existing CURRENT USER INPUT … + terminal length owner>
     ```

## Invariants

| Invariant | Expected |
|---|---|
| SYSTEM SHA A == B | YES (remap is messages-only) |
| Greeting body SHA A == B | YES |
| Current user body (inside CURRENT USER INPUT) | BYTE_IDENTICAL |
| Canon / persona / memory / runtime | BYTE_IDENTICAL |
| New anti-replay instructions | 0 |
| Production code diff | 0 |

## Production isolation

Gemini production path does **not** enter DeepSeek peel (`deepSeekXmlMode` false). Arm B remap is harness-only after assemble.

## Peel / format note (proven dry-run)

`formatUserMessageForPrompt` rewrites `[채팅 시작]` → labeled action text in assembled messages, so `peelCreatorOpeningGreetingFromHistory` cannot match on wire messages.

Harness therefore:

1. Runs **peel on RAW** `shortTermHistory` (function reuse for detection/extraction).
2. Removes the wire assistant message whose body equals the peeled greeting (plus preceding user).
3. Prefixes last user turn with minimal header + verbatim greeting.

Dry-run invariants:

| Check | Result |
|---|---|
| SYSTEM SHA A == B | YES |
| CURRENT USER INPUT body equal | YES |
| greeting content SHA equal | YES |
| DeepSeek length-exemplar sentence absent | YES |
| message char delta | **16** (~8 tokens) |
| assistant messages A/B | 1 / 0 |

## LIVE_CALL_READY

**YES** — proceed to G5 A/B × 3 = 6 calls.

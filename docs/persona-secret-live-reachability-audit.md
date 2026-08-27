# Persona Secret Live Reachability Audit (Phase C)

**Date:** 2026-08-27  
**Mode:** Read-only code trace — no feature additions.

## S3 Investigation — `LIVE_TARGET_CREATION_GAP`

### Search

```bash
rg "registerPresentedDocumentTarget|upsertInvestigationTarget" src
```

### Findings

| Symbol | Definition | Production call sites |
|---|---|---|
| `upsertInvestigationTarget` | `src/lib/investigationTargets.ts` | **Tests only** (`*.test.ts`, audit scripts) |
| `registerPresentedDocumentTarget` | `src/lib/investigationTargets.ts` | **Zero call sites** outside definition |

### Home path trace

```
User home message
  → POST /api/chat (route.ts)
  → extractAndPersistSceneEvidence (S2A) — secret-blind scene events
  → runInvestigationDiscoveryForTurn (S3)
  → resolveInvestigationTurn — requires pre-existing investigation target
  → matchInvestigationDiscoveryForTurn
  → applyInvestigationDiscoveryMatches → knowledge write
```

**Gap:** No wired path from user scene evidence (`DOCUMENT_PRESENTED`) to `registerPresentedDocumentTarget` or `upsertInvestigationTarget`. Investigation targets are never created from the live chat home path.

### Recommended minimum structure (not implemented)

```
USER-authored DOCUMENT_PRESENTED (scene evidence, secret-blind)
  → chat-scoped investigation target (payload from evidence attributes only)
  → later USER explicit investigation request (investigationActions)
  → result → S3 matcher → knowledge
```

Constraints:
- Must NOT read persona secret canonical text to invent targets.
- Assistant prose alone must NOT create trusted targets.

**Verdict:** `LIVE_TARGET_CREATION_GAP` — S3 engine is wired in chat route but home path cannot reach investigation without manual/test target seeding.

---

## S4 Knowledge Transfer — `S4_ENGINE_READY_BUT_HOME_TRIGGER_MISSING`

### Search

```bash
rg "knowledgeTransferActions" src
```

### Findings

| Location | Sends `knowledgeTransferActions`? |
|---|---|
| `src/app/api/chat/route.ts` | Consumes from `extractPublicChatDiscoveryInputs(body)` |
| `src/lib/personaSecretDiscoveryPublicInput.ts` | Parses body field |
| `src/app/chat/**` (ChatClient, etc.) | **No matches** |
| Components / hooks | **No matches** |

### Home path trace

```
ChatClient send → POST /api/chat body
  → extractPublicChatDiscoveryInputs
  → knowledgeTransferActions always [] from client
  → runKnowledgeTransfersForTurn never invoked with userActions
```

Engine (`knowledgeTransferApply`, presence/auditory gates, SUSPECTED ceiling) is implemented and tested. Chat route wiring exists (`route.ts` L2715–2735). **Client never sends structured transfer actions.**

**Verdict:** `S4_ENGINE_READY_BUT_HOME_TRIGGER_MISSING`

### Autonomous character sharing (design note only)

Structured transfer without new model calls is feasible via:
- Server-side `SERVER_STRUCTURED_TRANSFER` / `CREATOR_STRUCTURED_TRANSFER` authoritative actions (internal-only, not from public body).
- Scene engine or creator trigger when deterministic conditions met.

Assistant prose parsing is explicitly out of scope for this audit.

**STOP** — no S3 target creation or S4 client wiring in this PR.

# Persona Secret Legacy Data Migration Report

**Status:** Investigation only — no automatic migration implemented (per P0 scope STOP).

## Problem

Historical chats may contain `chat_persona_secret_reveals` rows written before single-authority finalization. Under the old path, `buildKnownPersonaFactsForObserver` with legacy authority could:

1. Inject chat-scoped reveal facts into any numeric CHARACTER observer prompt.
2. Call `migrateLegacyRevealIfMatched`, creating `chat_character_secret_knowledge` rows for observers who never received evidence.

## Current fix (runtime, forward-only)

When `PERSONA_SECRET_DISCOVERY_ENABLED=1`:

- Legacy detect/persist paths in `/api/chat` are blocked.
- S1 confirm no longer dual-writes `chat_persona_secret_reveals`.
- Prompt build uses `authority: "discovery"` — reads only `chat_character_secret_knowledge.fact_snapshot`.

## Existing historical data

| Artifact | Rows affected | Observer attribution |
|---|---|---|
| `chat_persona_secret_reveals` | Chat-scoped, no observer_id | None — ambiguous |
| `chat_character_secret_knowledge` | Per observer | Correct when written via S1/S2/S3/S4 evidence |
| Erroneous migration rows | Possible for non-primary observers | Created by legacy prompt-build migration |

## Attribution policy (recommended, not implemented)

### Allowed

- **Single-primary historical chat:** Attribute legacy reveal to main character observer (`bootstrapChatObservers` character) only, one-time, idempotent, via explicit admin/creator migration job — not prompt-build side effect.

### Forbidden

- Multi-observer / ensemble automatic attribution.
- Prompt-build or read-path migration (removed in P0).
- Bulk copy of reveal facts to all CHARACTER observers in chat.

## Migration job sketch (future, separate PR)

1. Select chats with `chat_persona_secret_reveals` AND `persona_secret_discovery` ON.
2. For each reveal row, match `secret_key` → `persona_secrets.id`.
3. Write knowledge ONLY for main character observer if:
   - No existing knowledge row for that secret+observer.
   - Reveal source is USER-authored (not assistant).
4. Record evidence with `source_type=LEGACY_REVEAL_MIGRATION`, `method=DIRECT_DISCLOSURE`.
5. Do NOT delete reveal rows (audit trail).

## Action

**STOP** — no migration executed in this PR. Forward path is single-authority clean.

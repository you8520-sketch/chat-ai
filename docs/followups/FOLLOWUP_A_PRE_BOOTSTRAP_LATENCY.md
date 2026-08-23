# FOLLOWUP_A_PRE_BOOTSTRAP_LATENCY

## Context

Chat 707 (assistant message 3750) showed ~546s client UI timer vs ~96s DB-observed turn
lifetime. The ~450s gap sits between client submit and `bootstrapStreamingTurn()` inserting
user/assistant rows (both at `2026-08-19 05:58:51`). Parent user message for the turn is
**3749**, not 3740.

## What we know

- DB bootstrap timestamps mark **persist time**, not client click time.
- `requestStartedAt` exists in `/api/chat` but is **not persisted** to production DB/logs today.
- Pre-bootstrap work in code includes: auth, chat/character load, memory sync/barrier, canon
  compile, context build, memory reconciliation, lorebook, persona knowledge, prompt assembly.
- This may be UX (no progress signal) **or** a real performance incident — do not assume either
  without per-phase measurements.

## Required next instrumentation (production-safe)

Persist per-turn phase latency (no prose/prompt bodies — length/hash only):

| Phase | Fields |
|---|---|
| request_start | start |
| auth_done | end + duration_ms |
| chat_load_done | end + duration_ms |
| memory_sync_start / memory_sync_end | duration_ms |
| summary_barrier_start / summary_barrier_end | duration_ms |
| catalog_refresh_start / catalog_refresh_end | duration_ms |
| canon_compile_start / canon_compile_end | duration_ms |
| initial_context_build_start / initial_context_build_end | duration_ms |
| memory_reconcile_start / memory_reconcile_end | duration_ms |
| lorebook_done | duration_ms |
| persona_knowledge_done | duration_ms |
| prompt_assembly_done | duration_ms |
| bootstrap_turn_persisted | duration_ms |
| post_bootstrap_discovery_done | duration_ms |
| provider_call_start | duration_ms |
| provider_first_visible | duration_ms |
| provider_done | duration_ms |

Attach to existing structured logging (e.g. `[StreamTurnForensics]` extension or dedicated
`[TurnPhaseLatency]` line) keyed by `request_id` + `assistant_message_id`.

## Out of scope for PR #601

- Memory pipeline changes
- Canon/context build optimization
- Pre-bootstrap SSE (separate UX PR after attribution data exists)

## Success criteria

- For any turn with client timer ≫ DB lifetime, attribute ≥80% of delta to named phases.
- Identify top 2 phases by p95 duration on long chats (chat 707 class).

# B34 — Duplicate episodic paid-call defense (PR #1718)

Scope: independent episodic extraction (`startIndependentEpisodicExtraction` → `background-post-turn-shared-initial-episodic`).

## Single Node.js replica / single process (what tests prove)

These layers are **durable or request-scoped on one SQLite DB** and are the production default on Railway when one app process owns the chat DB:

1. **Main RP request replay** — a completed `POST /api/chat` with the same `request_id` returns early and does not re-run `turnTail` (no second episodic start).
2. **`MainRpGenerationLease`** — concurrent duplicate generation attempts for the same assistant message are serialized at the generation layer (existing owner; unchanged in #1718).
3. **Ledger pre-check (per generation)** — before the provider call, `hasEpisodicProviderAttempt()` reads `api_cost_ledger` for `(assistant_message_id, generation_sequence, request_kind = …-episodic)`. If a row exists, the extraction returns `{ status: "rejected", reason: "duplicate_attempt" }` and **does not call the provider again** (including after a failed attempt).
4. **Ledger row at attempt start** — the background caller inserts one `api_cost_ledger` row per physical attempt (random `event_key`) when the HTTP attempt begins, so the pre-check has a durable signal for that generation.
5. **Persist idempotency** — `persistEpisodicMemoryFactsCore` finalizes by `(assistant_message_id, request_id)` so duplicate delivery of the same result cannot insert duplicate fact rows.

**Regression tests (29 in `memory-episodic-independent.test.ts`):** second invocation → 0 provider calls; concurrent starts → 1 call; Shared ledger row does not block episodic (distinct `request_kind`); re-delivered / parallel completion → one stored row set.

## Multi-process / multi-replica (non-atomic gap — not new in #1718)

The **ledger existence check** and the **ledger INSERT** are **not one atomic transaction** across processes:

- Two replicas handling the same generation (mis-routing, retry storm, or future horizontal scale-out) could both observe “no episodic ledger row yet” and both start a provider call before either INSERT commits.
- **Mitigation in #1718:** persist idempotency still prevents duplicate **stored facts** for the same `(assistant_message_id, request_id)`; cost may still show two ledger rows if both calls complete.
- **Explicit non-goals in B34:** no new distributed lock, no new table, no cross-process claim API.

**Operational note:** Current HAV post-turn work is platform-funded async tail on the same SQLite writer as the chat; duplicate episodic calls are primarily a **theoretical multi-replica** concern unless traffic is split across writers without sticky generation ownership.

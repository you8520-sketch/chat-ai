# User co-authoring — pre-merge legacy retroactivity audit

PR: #543
Audit time: 2026-08-21T10:28:16Z
Production source: Railway `enchanting-ambition` / `chat-ai` volume `/data/app.db`
Access: SELECT-only via `better-sqlite3` `{ readonly: true }` + `PRAGMA query_only=ON`
Production SHA serving at audit: `841d71d5` (PR #540). `chats.user_coauthor_mode` column: absent.
PR #543 not merged. No prompts changed. No provider calls. No production writes.

PRIVATE_RAW_MESSAGES_COMMITTED: false
PRODUCTION_WRITES: 0
PROVIDER_CALLS: 0
SOURCE_FILES_CHANGED: 0 (this document only)

## 1. Runtime state source (code path)

### A. POST `/api/chat` `persistentBefore` source

FULL_HISTORY_REPLAY of canonical historical USER message contents.

Not `chats.user_coauthor_mode`.

Call chain:

1. `src/app/api/chat/route.ts` loads chat messages, then `filterCanonicalMessageRows(...)`.
2. `historyUserContents = msgRows.filter(role === "user").map(content)`
3. `resolveEffectiveUserAuthoringFromHistory({ historyUserContents, currentUserInput: storedUserMessage })`
4. `src/lib/userCoauthorState.ts` `resolveEffectiveUserAuthoringFromHistory`
5. `persistentMode = recomputeUserCoauthorModeFromUserMessages(historyUserContents)`
6. `recomputeUserCoauthorModeFromUserMessages` walks every supplied USER string through `resolveUserCoauthorDirective` and keeps `persistentAfter`.

Early pre-save path at `route.ts` uses `historyUserContents: []` plus the current input only. The turn-authoritative path is the later history replay.

This audit replayed `listCanonicalUserMessageContents` semantics: all `messages.role = 'user'` rows, `ORDER BY id ASC`. Assistant rows were not searched.

### B. `readUserCoauthorMode()` on the production request path

READ_USER_COAUTHOR_MODE_USED_IN_CHAT_POST: false

`readUserCoauthorMode` is defined in `src/lib/userCoauthorState.ts` and has zero callers on this branch (including tests).

### C. Is `chats.user_coauthor_mode` authoritative?

CHAT_COLUMN_AUTHORITATIVE: false

The column is write-only cache / persist state:

- POST `/api/chat` writes `persistUserCoauthorMode(db, chat.id, effectiveUserAuthoring.persistentAfter)` after the history replay.
- Fork / user-message edit / last-turn-delete call `recomputeAndPersistUserCoauthorMode` (replay USER history, then write the column).
- No production reader uses the stored column to decide STANDARD vs COAUTHOR.

RUNTIME_STATE_SOURCE: FULL_HISTORY_REPLAY

## 2. Production impact (existing chats/messages only)

Replay function: PR #543 `recomputeUserCoauthorModeFromUserMessages`.
Old baseline: current `main` `resolveCurrentTurnUserAuthoringDelegation` (this-turn only; no persisted state).
Feature not deployed, so every existing chat is pre-feature. Current implicit persistent mode is OFF.

| Metric | Count |
|---|---|
| TOTAL_EXISTING_CHATS | 688 |
| TOTAL_EXISTING_USER_MESSAGES | 1419 |
| CHATS_WITH_ANY_NEW_COAUTHOR_DIRECTIVE | 2 |
| CHATS_NEW_RESOLVER_ENDS_DIALOGUE | 0 |
| CHATS_NEW_RESOLVER_ENDS_ACTIONS | 0 |
| CHATS_NEW_RESOLVER_ENDS_FULL | 1 |
| CHATS_NEW_RESOLVER_ENDS_OFF | 687 |
| LEGACY_RETROACTIVE_DIALOGUE_CHAT_COUNT | 0 |
| LEGACY_RETROACTIVE_ACTIONS_CHAT_COUNT | 0 |
| LEGACY_RETROACTIVE_FULL_CHAT_COUNT | 1 |
| LEGACY_RETROACTIVE_NON_OFF_CHAT_COUNT | 1 |
| LEADING_OOC_USER_MESSAGES (exact extractor) | 3 |
| NEW_DIRECTIVE_USER_MESSAGES | 2 |
| PERSISTENT_GRANT_USER_MESSAGES | 1 |
| PERSISTENT_REVOKE_USER_MESSAGES | 0 |
| TURN_ONLY_DIRECTIVE_USER_MESSAGES | 1 |

LEGACY_RETROACTIVE_NON_OFF definition used: an existing pre-feature chat whose replay end state is DIALOGUE / ACTIONS / FULL. Because the column does not exist and current production is this-turn only, any non-OFF end state is solely from reinterpreting old USER text as persistent.

## 3. Old vs new classification (aggregate)

No raw message bodies.

| Old (`main` this-turn only) | New (#543) | Count |
|---|---|---|
| OLD_TURN_ONLY_FULL | NEW_PERSISTENT_FULL_GRANT | 1 |
| OLD_TURN_ONLY_FULL | NEW_TURN_FULL_GRANT | 1 |
| OLD_INACTIVE | NEW_NONE / AMBIGUOUS | 1 |

New directive class counts:

- NEW_PERSISTENT_FULL_GRANT: 1
- NEW_TURN_FULL_GRANT: 1

## 4. False-positive categories (mechanical)

| Category | Count | Rule |
|---|---|---|
| EXPLICIT_DIALOGUE_GRANT | 0 | new resolver grant dialogue only |
| EXPLICIT_ACTION_GRANT | 0 | new resolver grant actions only |
| EXPLICIT_FULL_GRANT | 2 | new resolver grant dialogue+actions |
| EXPLICIT_REVOKE | 0 | new resolver deny slot(s), no grant |
| UNRELATED_OOC | 0 | leading OOC, no authoring-intent regex |
| AMBIGUOUS | 1 | exact leading OOC + authoring-intent regex, resolver slots unchanged |

Marker counts among exact leading-OOC USER messages:

- LEADING_BARE_COLON: 2
- LEADING_BRACKET_COLON: 1

One additional USER row matched a looser start-of-text `OOC` regex but failed the exact production extractor (`extractLeadingOocSegment`). It is not a directive and is not in the retroactive count.

## 5. Administrator verification rows (no bodies)

| chat_id | message_id | created_at | sha256 | old | new | duration | scope | marker | fp_category |
|---|---|---|---|---|---|---|---|---|---|
| 735 | 3773 | 2026-08-21 04:41:53 | `9c68cbdf1f51906f06d6bbdfe71d4131861df223e93caf1acc44bdb4f558450c` | OLD_TURN_ONLY_FULL | NEW_PERSISTENT_FULL_GRANT | persistent | dialogue=grant, major_actions=grant | LEADING_BARE_COLON | EXPLICIT_FULL_GRANT |
| 736 | 3778 | 2026-08-21 06:22:18 | `cf35fca5c03afa1c51e0e8e5a72be8d1a990e83c9fb9017048fb7e52533d9590` | OLD_TURN_ONLY_FULL | NEW_TURN_FULL_GRANT | turn | dialogue=grant, major_actions=grant | LEADING_BARE_COLON | EXPLICIT_FULL_GRANT |
| 5 | 25 | 2026-07-09 06:22:38 | `b15c4b2fa329b178276ca8a63594050408e077cfb504fd2b880335046c21e761` | OLD_INACTIVE | NEW_NONE | none | unchanged | LEADING_BRACKET_COLON | AMBIGUOUS |

Sanitized regex flags (no prose):

- chat 735 / msg 3773: authoring_intent=true, dialogue_noun=true, full_persona=true, turn_only_marker=false, revoke_marker=false. Chat has 1 USER message. Later USER after this grant: 0. Replay end state: FULL.
- chat 736 / msg 3778: authoring_intent=true, dialogue_noun=true, action_noun=true, full_persona=true, turn_only_marker=true, revoke_marker=false. Later USER after this grant: 2. Replay end state: OFF.
- chat 5 / msg 25: authoring_intent=true, dialogue_noun=false, action_noun=false, full_persona=false, turn_only_marker=false, revoke_marker=false. Resolver slots unchanged.

## 6. Runtime cost of replay-all-history

Computed from production USER-message counts per chat, including chats with zero USER rows (108).

| Stat | Value |
|---|---|
| MAX_USER_MESSAGES_PER_CHAT | 37 |
| P50_USER_MESSAGES_PER_CHAT | 1 |
| P95_USER_MESSAGES_PER_CHAT | 7 |
| P99_USER_MESSAGES_PER_CHAT | 36 |

Fact only: current production history depth is small. POST `/api/chat` still ignores the stored column and replays USER history each request.

## 7. Decision gate

LEGACY_RETROACTIVE_NON_OFF_CHAT_COUNT = 1 (> 0)

PRE_MERGE_BLOCKER = YES

CASE B. No migration / state-source fix invented in this audit.

RECOMMENDATION: AUDIT FACTS ONLY — NO SUBJECTIVE SCORE

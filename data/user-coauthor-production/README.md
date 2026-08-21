# User co-authoring — production integration

Canonical product flow:

```text
STANDARD
  → explicit leading OOC coauthor grant
  → persistent DIALOGUE | ACTIONS | FULL
  → remains active on ordinary IC turns
  → explicit leading OOC revoke / scope change
  → permission removed or narrowed
```

Exactly one primary owner per turn: **STANDARD** or **COAUTHOR**.

## What is in production

- Server-owned `chats.user_coauthor_mode` (`OFF | DIALOGUE | ACTIONS | FULL`)
- Bare leading-OOC grant → **PERSISTENT**
- Explicit revoke → immediate and persistent
- Partial revoke / partial grant
- Fork / edit / last-turn-delete recompute from canonical user messages
- Current user input overrides older assistant-authored persona content
- Deterministic TURN-ONLY classification (`이번 턴만`, …) — state only

## What is not in production

Frozen experiments. Do not merge and do not port:

| Work | PR | Status |
|---|---|---|
| H4.3 global history-precedent sentence | #534 | FROZEN FAIL |
| H4.4 evidence + post-delegation sentence | #539 | freeze state machine; do not port the sentence |
| H4.5 TURN_ONLY_EXPIRY_RESET | #541 | FROZEN FAIL |
| H4.6 POST_DELEGATION_RESTORED owner | #542 | FROZEN FAIL |

Do not enable the absolute ownership lock globally.

## Known Gemini limitation (TURN-ONLY)

After an explicit TURN-ONLY coauthor turn, server state correctly returns
`OFF` and the prompt uses ordinary STANDARD.

Gemini may still stochastically continue consequential `[B]` authorship from
RAW history on the first following turn. This is a known model limitation,
not a missing prompt block.

**Do not advertise TURN-ONLY as a guaranteed hard isolation feature.**
Explicit revoke is the canonical reliable reclaim mechanism.

No further user-agency prompt experiments.

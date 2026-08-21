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
- Normal POST authority is that chat column. Ordinary requests do **not** replay historical USER text.
- `messages.user_coauthor_semantics_version` (`INTEGER NOT NULL DEFAULT 0`)
  - `0` = legacy / pre-feature; never a persistent reconstruction source
  - `1` = USER message authored or edited under the new persistent-coauthor semantics
- Every newly persisted USER message is marked `1` (epoch marker, not “had a directive”)
- Bare leading-OOC grant → **PERSISTENT**
- Explicit revoke → immediate and persistent
- Partial revoke / partial grant
- Fork copies the version marker, then recomputes from `role='user' AND version>=1`
- User-message edit marks that row `1`, then recomputes from eligible version>=1 rows
- Last-turn-delete recomputes from remaining eligible version>=1 USER rows
- Regeneration, when it needs a boundary, recomputes only eligible version>=1 USER rows up to the parent
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

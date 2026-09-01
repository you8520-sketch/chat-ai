# PR #813 — action_type canonical owner audit (read-only)

## Trace

```
Bot provider output
  → prepareTrpgBotActionBody(raw)
  → upsertLockedAction(..., parseTrpgBotAction(body).actionType, ...)   [engineAdvance.ts:1125]
  → trpg_action_submissions.action_type  (persisted at accept)

Downstream readers:
  → resolveTrpgCanonicalAttempt (AI): parseTrpgBotAction(body).actionType  [canonicalAttempt.ts:44]
  → loadActionsForGm / roundAdjudication: resolved.actionType
  → mechanicsRound.loadMechanicsActors: row.action_type from DB           [mechanicsRound.ts:244]
  → engineSnapshot / dice HUD: row.action_type from DB
  → Human path: normalizeStoredActionType(persisted action_type) only
```

## Canonical owner (confirmed)

| Participant | Write owner | Read owner (production flow) |
|-------------|-------------|------------------------------|
| Human | `submitTrpgAction` → persisted `action_type` | persisted `action_type` |
| AI bot | `parseTrpgBotAction(body).actionType` at accept → persisted | resolver re-parses body marker; **equals persisted when body immutable after lock** |

```text
AI_ACTION_TYPE_CANONICAL_OWNER = A. accepted/persisted s.action_type
BODY_MARKER = generation transport echo, set atomically at bot accept from same parse
BODY_MARKER_ALWAYS_EQUALS_PERSISTED_ACTION_TYPE = true (production write path)
```

## Duplication note

Code has two read mechanisms for AI (`DB action_type` vs `body <<<ACTION_TYPE>>>` re-parse). They are **not competing owners** in production because:

1. Bot locked submission always sets both from one `parseTrpgBotAction(body)` call.
2. Locked bot rows are not rewritten without matching body.

Artificial DB/body mismatch (tests only) shows adjudication resolver follows body marker; mechanics packet follows DB. **No production patch required** for PR #813.

## Deterministic proof

`src/lib/trpg/trpgActionTypeCanonicalOwner.test.ts`

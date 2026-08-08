# 09 Risk Matrix

| Change idea | Benefit | Risk | Severity if wrong |
|---|---|---|---|
| Compact Opus Arm E | Free Opus attention for prose | Severe agency regression | CRITICAL |
| Merge layout duplicates | Lower fixed tokens | Dialogue/paragraph regressions (esp. Gemini/DeepSeek) | HIGH |
| Soften house prose micromanagement | Restore Opus literary variance | Short-burst / list-like prose returns on weaker models | MEDIUM |
| Strengthen “첫 만남 특별취급 금지” | — | Suppresses REASONED_CANON_CONTINUATION | DO NOT |
| Delete DeepSeek structure reminder | Token save | DS formatting regressions | HIGH if active in prod |
| Move rules into dynamic | Illusion of smaller cache | Higher $/latency | DO NOT |
| Treat REGEN totals as model footprint | — | False model comparison | DO NOT |

## Non-goals / protected meanings

```text
Severe agency meaning must remain
REASONED_CANON_CONTINUATION must remain allowed
CONTENT tokens are not instruction bloat
```

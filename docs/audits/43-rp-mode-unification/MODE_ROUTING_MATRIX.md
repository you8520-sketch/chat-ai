# Mode routing matrix

Product-facing modes: **기본 채팅** · **자동진행** only. No user-exposed 소설모드.

| UI action | Request flags | Normalized runtime | NoGodmodding | User-control block | Narrative POV |
|---|---|---|---|---|---|
| Send message | `(none)` | `interactive` | `standard` | `[USER CONTROL — COLLABORATIVE INTERACTIVE]` ×1 | room `narrative_pov` |
| 자동진행 | `isContinue=true` | `auto_progression` | `autoContinue` | `[AUTO PROGRESSION — AI-FOCAL CO-NARRATION]` ×1 | room `narrative_pov` |
| Legacy novel body/prefs | `novelModeEnabled=true` | `auto_progression` | `autoContinue` | same AI-focal block ×1 | room `narrative_pov` |
| Continue + legacy novel | both true | `auto_progression` | `autoContinue` | AI-focal ×1 (no novel block) | room `narrative_pov` |
| OOC 사칭 허용 | persona/note OOC | `ooc_user_impersonation_allowed` | `coNarration` | LIMITED CO-NARRATION | room `narrative_pov` |
| Regenerate of continue | `regenerate` + continue anchor | `auto_progression` | `autoContinue` | AI-focal ×1 | room `narrative_pov` |

## Resolver (production)

```text
isContinue || legacyNovelModeEnabled → autoContinue / auto_progression
else explicit OOC impersonation → coNarration
else → standard / interactive
```

`novelModeEnabled` is never passed through to prompt builders as novel semantics (`novelModeEnabled=false` after boundary normalize).

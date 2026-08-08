# 06 — D0 Gate

**Date:** 2026-03-28  
**API calls:** 0  
**Verdict:** **D0_PASS**

## Complete conditions

| Check | Result | Evidence |
|-------|--------|----------|
| Visible length metrics + bands | PASS | `length.ts`, retro detects C2R Gemini_T_A=380 / DeepSeek_T_M1=769 → DENSITY_COLLAPSE |
| `dialogue_char_share` / `narration_char_share` | PASS | char-share primary; unit + retro |
| `dialogue_paragraph_share` renamed (not ambiguous dialogue_share) | PASS | `composition.ts` / types |
| Same-speaker dialogue fragment metrics | PASS | `dialogueFragmentation.ts` |
| Narration fragmentation | PASS | `narrationFragmentation.ts` |
| Setting exact-overlap audit (≥18 alarm) | PASS | `settingOverlap.ts` + unit |
| SETTING_RECITAL human schema | PASS | `SETTING_RECITAL_HUMAN_SCHEMA` |
| KNOWLEDGE_LEAK hard gate | PASS | documented constant |
| Continuity failure classes | PASS | RECENT_SCENE / CURRENT_INPUT / INTRA_TURN + schemas |
| Continuity principle (STATE not SOURCE) | PASS | `CONTINUITY_PRINCIPLE` |
| Fixture G5/G6 measure keys | PASS | `CONTINUITY_FIXTURE_MEASURES` + `05_FIXTURE_G5_G6.md` |
| Retroactive C2 (12) + C2-R (8) | PASS | `04_RETROACTIVE_VALIDATION.*` |
| Unit tests | PASS | `rpQualityVector.test.ts` 7/7 |

## Offline replay finding (auto)

| Signal | Offline result |
|--------|----------------|
| CURRENT_INPUT_REPLAY auto | No exact-echo alarms on stored cells (paraphrase restage not exact-match) |
| RECENT_SCENE_REPLAY auto | Not measurable — prior assistant / intro not stored with C2 cells |
| INTRA_TURN_REEXPLANATION auto | 1 hit: C2/DeepSeek_T_A |

### Human spot (non-blocking for D0)

- **Gemini_Q_A** opens with long atmosphere / setting plane before reacting to user kneel → SETTING_RECITAL candidate for D1 human score.
- **Gemini_T_A** restages user-established scream/metal-friction beat as opening cinema → CURRENT_INPUT / scene-restage candidate (paraphrase; auto LCS quiet).
- **DeepSeek_T_A** opens with reaction to the sound → better continuity posture in spot check.

→ Offline evidence is **insufficient** to seal `REPLAY_IS_GEMINI_HEAVY` vs `REPLAY_IS_COMMON`.  
→ **D1 G5/G6 minimal live** is required for that classification.

## D1 entry

```text
D0_PASS → D1 authorized for minimal G5/G6 + optional G1–G4
only if OPENROUTER_API_KEY present
budget: keep total new live calls small (≤14)
production prompts: UNCHANGED until hard quality gate + human review
```

## Absolute stops still in force

- No production merge of Gemini adapter
- No C2-S / C3
- No shrinking canon content as first fix
- No merge of #271 / #273 / #274 into this branch

# 04 Opus Arm E Overlap

## Source

`src/lib/opusTerminalLengthOwner.ts` → `OPUS_ARM_E_TERMINAL` (frozen Audit 58).

## Totals

```text
Arm E total tokens ≈ 1134
Arm E chars = 1260
Common collaborative agency tokens ≈ 409
```

## Clause map

| clause | category | classification |
| --- | --- | --- |
| length | LENGTH | UNIQUE_TO_ARM_E |
| expand_via_A_NPC | LENGTH/PROGRESSION | UNIQUE_TO_ARM_E |
| persona_aux_only | AGENCY | OVERLAPS_COMMON |
| started_action_completion | AGENCY | OVERLAPS_CURRENT_USER_WRAPPER |
| minor_reversible | AGENCY | OVERLAPS_COMMON |
| six_conditions | AGENCY | OVERLAPS_COMMON |
| future_instruction_boundary | AGENCY | UNIQUE_TO_ARM_E |
| no_new_dialogue_choice | AGENCY | OVERLAPS_COMMON |
| reaction_point_stop | AGENCY/SCENE_STOP | OVERLAPS_COMMON |
| meaningful_change_then_stop | SCENE_PROGRESSION | UNIQUE_TO_ARM_E |

### Counts

```text
UNIQUE_TO_ARM_E = 4
OVERLAPS_COMMON = 5
OVERLAPS_CURRENT_USER_WRAPPER = 1
```

## Compactable?

Yes as a **design candidate only** (not applied this audit):

- Keep length band + future-instruction boundary + reaction-point stop as unique semantic payload.
- Merge repeated B-prohibition lists that already exist in `COLLABORATIVE_INTERACTIVE_OWNER` + CURRENT USER wrapper.
- Estimated safe reduction if semantic parity preserved: **~35–55% of Arm E tokens** (roughly 397–624 tokens), pending Phase 2 A/B.
- Purpose: same agency meaning, fewer terminal tokens → more attention for prose. **Not** agency relaxation.

## Candidate compact terminal (NOT production)

```text
이번 응답은 3,200~4,200자의 하나의 밀도 있는 장면으로 전개한다.
[B]가 이미 시작한 짧고 가역적인 행동은 자연스럽게 마무리할 수 있지만,
새 직접 대사·중요 선택·동의·거절·관계 결정·위험 행동은 대신 확정하지 않는다.
아직 특정되지 않은 이후 행동 위임(“시키는 대로”)은 포괄 위임이 아니며, 새 요구 행동 직전에 멈춘다.
[A]·NPC·환경의 행동·감각·내면·결과를 충분히 전개한 뒤 [B]의 다음 선택 지점에서 끝낸다.
```

Semantic parity vs Arm E must be human-reviewed before any A/B.

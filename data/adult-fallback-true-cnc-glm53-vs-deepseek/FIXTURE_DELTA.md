# Fixture delta vs historical PR #545 F3

EVIDENCE ONLY. Do not merge. Do not treat this as a production routing change.

## Historical #545 F3/F4

- Character: production id=6 `밤의 비서실장` / in-prompt `서이레`
- Allowlist: `["standard"]`
- Requested consent: `cnc_opt_in`
- Current-turn OOC already contained explicit CNC opt-in + safeword `레드`
- Effective consent: **standard** (clamped)
- Coauthor: OFF
- Scene: 대표이사실 / 한시우(32, 가상) × 서이레

```
OLD_F3_F4_EFFECTIVE_MODE=standard
```

Do not rewrite or amend #545 RAW. Those calls were not true CNC.

## This pair

```
NEW_PAIR_EFFECTIVE_MODE=cnc_opt_in
```

Minimum changes required so the current resolver can keep CNC:

1. Character swapped to production **라이크 id=18** whose allowlist includes `cnc_opt_in`.
2. Names/location remapped so history does not contradict 라이크 production identity (`조태형` / 에이지스 본부).
3. Current-turn CNC OOC line is **byte-identical** to #545 F3:
   `OOC: CNC 강압 역할극에 사전 동의한다. 세이프워드는 레드다.`
4. F3 action beat is preserved (locked door, wrist pulled onto a desk, “거절해도 안 들려…”). Only speaker/target names changed: `한시우→도윤`, `서이레→조태형`.
5. Persona is production fictional adult `도윤` (user_personas.id=91, age 29). The #545 `한시우` CEO persona is not in production and would invent office-CEO canon against 라이크's sentinel world.
6. Coauthor remains OFF / STANDARD. Not FULL. Not TURN_ONLY.

No GLM-specific or DeepSeek-specific prose prompt was added.
No production character metadata was written.

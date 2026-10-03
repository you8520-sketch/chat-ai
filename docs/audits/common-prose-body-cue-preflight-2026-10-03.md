# Common-prose body-cue preflight (2026-10-03)

Provider-free comparison of current main and Draft #1288. No model call. No quality score.

## References

- Main and Railway production: `11e9e96aa729922d05249695f36a1e3c699aaba0`
- #1288 HEAD: `73908e134ef28e47be8a50e6c8ebad3bcb4c6c60`
- Live owner: `COMMON_PROSE_BLOCK` in `src/lib/advancedProseNsfwGuidelines.ts`
- Injection: `buildProseStyleXmlBundle` → `contextBuilder` section `prose-style-xml-bundle`, target `cacheCharacter` on the OpenRouter-compatible path
- Final request: `buildOpenRouterMessages` → `applyCacheAndPrefillForTransport` → `assemblePrimaryRpRequest`

## Allowed sentence

Live clause:

`감정과 관계는 표정·시선·호흡·습관·접촉·거리·행동·선택으로 드러내고`

#1288 candidate:

`감정과 관계는 현재 장면에 필요한 단서를 골라 드러내고`

The #1294 continuation stays on the same line:

`이미 드러난 의미는 해설·결론으로 되짚기보다 다음 반응·행동·환경·관계 변화로 이어간다.`

`git diff origin/main 73908e13 -- src/lib/advancedProseNsfwGuidelines.ts` is that one clause. The other #1288 files are tests and a historical note.

## What this branch changes

The live sentence is unchanged. The final-wire audit still locks the previous main hashes, including DeepSeek NORMAL flat `ca412fccdcc8a7115021b6e7c46e983ccad2d1c374b28c0bbe26050ea1c98f4a`.

The same assembler then swaps only that clause and records the candidate. On every current final-wire case the swap is the sole diff:

- `[COMMON PROSE]` once
- clause once, inside the cached character block
- rules block hash unchanged
- dynamic block hash unchanged, including the OOC HTML directive when that turn has one
- cache marks stay cached, cached, uncached
- history cache breakpoint unchanged
- request keys unchanged
- flat and character-block length delta: −8 characters
- DeepSeek NORMAL candidate flat sha256: `86dab270ffda8bc080df26b6f6c24f0fdb6678c500a49c18b4fae76e261e464a`
- DeepSeek NORMAL candidate character sha256: `a289c043507d1b63a0a3870d997e6dbb27267325a2668e2f400897d115415a17`

Local `estimateTokens` is `ceil(chars * 0.9)`. It is not provider usage. On the pinned character scenes the system estimate moves 16054 → 16047. That is not a billing saving.

## Pinned identity for a later paired read

Source owner: `scripts/lib/rpModelQualificationFixture.ts`.

- Captured 2026-08-25, chat 4, user 1, character id 10
- Character: 라이크 / 조태형
- Persona: 렌
- Current AGENTS roster lists 라이크 as id 18 and 에녹 as id 10. Confirm the live row before any paid call. This packet uses the pinned snapshot, not a fresh database read.

Both review scenes are SAFE (`nsfw: false`), NORMAL authoring, DeepSeek V4.1 Flash, target 3,200 characters, one call each. They share the pinned opening and differ in the user turn.

Quiet window:

```
OOC: 임무가 끝난 밤. 둘만 태형의 본부 숙소 창가에 있다. 다른 인물은 없다. 둘 다 성인이다. 여기서부터 장면 계속.

렌은 창틀에서 한 걸음 떨어져 유리 너머의 불빛만 본다. "오늘은 그냥 이렇게 있자."
```

Relationship turn:

```
OOC: 같은 숙소 창가. 렌이 오늘 밤을 여기서 같이 보낼지 처음으로 분명히 묻는다. 다른 인물은 없다. 둘 다 성인이다. 여기서부터 장면 계속.

렌은 창가에서 돌아서 태형을 본다. "나 오늘 여기 있을게. 네가 싫으면 지금 말해."
```

System flat sha256 is the same for both scenes because the user turn is outside the system blocks. User-turn hashes differ. Baseline system `60f49a89e2aa1168bc4cce430a92db6acd97de5239795070773e032fe23d572a`. Candidate system `92f0a2dfed2fdf7ac1dfb042d124c091b398c5c326392b876f95253ffc4ba3ea`. Rules `c5a136410ad87c7f65215e80d92b2ce70bc6ca3f5d6a369fe4636b335c3a3bfc`. Dynamic `87067de90334499093dafbec3fb42dccce922512e82cdfc318af1d118f9d1e16`. Baseline character `dd4c7fb92826452e52c6a8ab8aab2ea51b116607f74aeac8364b74e64fb9a68e`. Candidate character `770785ac699056c3b85cbc637f9aa7c8405156c01eccf3b172208c7014dcd75b`.

## Proposed 4-call ceiling (not authorized)

Model: `deepseek-v4.1-flash` only. Scenes: the two above. Arms: current main once and the candidate once. Total 4 calls.

Published rates: input $0.30 / 1M, output $1.20 / 1M, target margin 0.60. User charge uses `providerKrw / (1 - 0.60)` from `publishedUserCharge`. Cache reads are priced at zero for this ceiling.

Larger assembled prompt: 20,106 characters. Planning prompt ceiling: 40,212 tokens (2 tokens per character). Output ceiling: 8,192 tokens, the client coerce constant. Production does not send `max_tokens`.

- Provider ceiling: $0.0876
- User-charge ceiling at the pricing-test FX `effectiveKrwPerUsd = 1560.6`: 342 KRW

Approval cap requested if this proceeds: $1 provider, or 1,000 KRW user charge, whichever the reviewer prefers. Do not add calls if the first four are ambiguous.

## Not done

No prose grade. No paid call. #1288 is not merged. #1296 and #1299 rewrite several `COMMON_PROSE` lines, including the #1294 sentence, and were not edited.

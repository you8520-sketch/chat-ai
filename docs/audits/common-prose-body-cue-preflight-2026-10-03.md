# Common-prose body-cue preflight (2026-10-03)

Provider-free comparison of the live `COMMON_PROSE` sentence and Draft #1288. No model call. No quality score.

## References

- Comparison base, and the commit whose prose owner this branch matches: `11e9e96aa729922d05249695f36a1e3c699aaba0`
- Successful Railway production observed while correcting this preflight: `ec7f0cbe91a7e1d7801821bc9ece8fc0eed0ff15` (`#1368`). `advancedProseNsfwGuidelines.ts` and `chatOocPriority.ts` are empty diffs from `11e9e96a` to that deploy. The live sentence is the baseline clause.
- #1288 HEAD: `73908e134ef28e47be8a50e6c8ebad3bcb4c6c60`
- Production text owner: `COMMON_PROSE_BLOCK` in `src/lib/advancedProseNsfwGuidelines.ts`. This branch has zero diff in that file against `11e9e96a`.
- Audit-only comparison: `COMMON_PROSE_EMOTION_CUE_CANDIDATE`, `liveCommonProseEmotionCueBaseline()`, `liveCommonProseForwardMotion()`, and `replaceCommonProseEmotionCue()` in `src/lib/mainRpFinalWireAudit.ts`. The baseline clause is the live line that starts `감정과 관계는 `, split on the first `, `. The chat route does not import this helper.
- Injection: `buildProseStyleXmlBundle` → `contextBuilder` section `prose-style-xml-bundle`, target `cacheCharacter` on the OpenRouter-compatible path
- Final request: `buildOpenRouterMessages` → `applyCacheAndPrefillForTransport` → `assemblePrimaryRpRequest`

## Allowed sentence

Live clause, derived from `COMMON_PROSE_BLOCK`:

`감정과 관계는 표정·시선·호흡·습관·접촉·거리·행동·선택으로 드러내고`

#1288 candidate, audit module only:

`감정과 관계는 현재 장면에 필요한 단서를 골라 드러내고`

The #1294 continuation stays on the same live line:

`이미 드러난 의미는 해설·결론으로 되짚기보다 다음 반응·행동·환경·관계 변화로 이어간다.`

`git diff origin/main 73908e13 -- src/lib/advancedProseNsfwGuidelines.ts` is that one clause. The other #1288 files are tests and a historical note. This preflight does not apply that diff to the production file.

## What this branch changes

The production sentence is a literal again. The final-wire audit still locks the previous main hashes, including DeepSeek NORMAL flat `ca412fccdcc8a7115021b6e7c46e983ccad2d1c374b28c0bbe26050ea1c98f4a`.

The audit assembler then swaps only that clause and records the candidate. On every current final-wire case the swap is the sole diff:

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

## Route parity for the two review scenes

`buildCommonProseBodyCueReviewCases()` still returns the frozen raw strings. `resolveBodyCueProductionTurn()` then follows the interactive, non-regenerate branch of `POST /api/chat`:

- `classifyChatOocIntent` on the stored raw text. Both scenes are `rp_continuing`.
- `buildContext` receives `buildChatOocRpContinuingUserPrompt(displayUserMessage)`.
- `sceneServerControls.currentUserMessage` and `buildSceneDirective` receive the placeholder-resolved raw text. These scenes have no `{{user}}`, so policy text equals the stored raw text.
- Authoring is the pinned chat column `NORMAL` with no v2 coauthor epoch, so persistent mode is `OFF`. `resolveEffectiveUserAuthoring` returns source `chat_setting`. That object deep-equals the delegation of a non-OOC NORMAL line (`렌은 창을 본다.`). `resolveChatRuntimeMode` then returns `current_turn_ooc_delegated` because the NORMAL owner is active. `oocUserImpersonationAllowed` stays false. The OOC prefix does not add `explicit_ooc`.

The final user turn is not the wrapper bytes. Production formatting (`formatUserMessageForPrompt`, `CURRENT USER INPUT`, and the DeepSeek opening-scene peel) rewrites the turn. Both assembled user turns still contain `CURRENT USER INPUT` and `다른 인물은 없다`. The two arms use the same assembled user text. System flat hashes stay shared across the two scenes.

System flat sha256 baseline `60f49a89e2aa1168bc4cce430a92db6acd97de5239795070773e032fe23d572a`. Candidate `92f0a2dfed2fdf7ac1dfb042d124c091b398c5c326392b876f95253ffc4ba3ea`. Rules `c5a136410ad87c7f65215e80d92b2ce70bc6ca3f5d6a369fe4636b335c3a3bfc`. Dynamic `87067de90334499093dafbec3fb42dccce922512e82cdfc318af1d118f9d1e16`. Baseline character `dd4c7fb92826452e52c6a8ab8aab2ea51b116607f74aeac8364b74e64fb9a68e`. Candidate character `770785ac699056c3b85cbc637f9aa7c8405156c01eccf3b172208c7014dcd75b`.

Assembled prompt characters: quiet window 20502, relationship turn 20515.

## Pinned identity

Source owner: `scripts/lib/rpModelQualificationFixture.ts`.

- Captured 2026-08-25, chat 4, user 1, character id 10
- Character: 라이크 / 조태형
- Persona: 렌
- Current AGENTS roster lists 라이크 as id 18 and 에녹 as id 10. This packet does not relabel `sourceCharacterId`.

Live identity status: `LIVE_IDENTITY_UNVERIFIED`. `rowRead` is false. The Railway project token can list the successful deploy and confirm the prose file is unchanged, and it cannot open a read-only shell on the volume. The local seed database has no 라이크 row and no administrator persona. No current-character fixture was invented. Paid A/B stays blocked until a real deployed-database read.

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

## Budget estimate (not a provider ceiling, not authorized)

Model: `deepseek-v4.1-flash` only. Scenes: the two above. Arms: current main once and the candidate once. Total 4 calls. `providerCalls` in this packet is 0.

Published rates (`publishedAt` `2026-09-21T00:00:00.000Z`): input $0.30 / 1M, output $1.20 / 1M, cache read $0.006 / 1M, target margin 0.60. This estimate prices cache reads at zero. User charge uses `providerUsd * effectiveKrwPerUsd / (1 - 0.60)` at the pricing-test FX `effectiveKrwPerUsd = 1560.6` (`usdToKrw = 1530`). That FX is not a live rate.

Supplier route in the pricing policy: provider `cheaperinference`, expected provider model id `deepseek-v4.1-flash`, baseline mode `PROVIDER_PEAK`. No live catalog was fetched. The OpenRouter family fallback that prices other DeepSeek ids at V4 Pro rates is not this model's supplier price.

Larger assembled prompt: 20,515 characters. Planning prompt ceiling: 41,030 tokens (2 tokens per character). Output figure: 8,192 tokens, the client coerce constant. `resolveOpenRouterMaxTokens` returns `undefined` for this model, so `maxTokensSent` is false. Production does not send `max_tokens`.

Unrounded packet values:

- Provider budget estimate: $0.0885576
- User-charge budget estimate: 345.5074764 KRW

These numbers are a budget estimate. They are not an enforceable provider ceiling. One in-flight call can exceed them because `max_tokens` is omitted.

`$1` provider or `1,000 KRW` user charge is a proposed approval bound. `approvalBound.granted` is false. `bodyCueNextCallAllowed` refuses the next call when no cap is granted, and when observed spend plus that call's worst-case estimate would pass a granted cap. It does not set `max_tokens` and cannot abort a call already in flight.

## Not done

No prose grade. No paid call. #1288 is not merged. #1296 and #1299 rewrite several `COMMON_PROSE` lines, including the #1294 sentence, and were not edited. A current-database fixture, a live supplier catalog fetch, and any scene rewrite stay follow-up.

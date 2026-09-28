# User authoring 3-level audit

Date: 2026-09-26

## Product contract

### LIMITED / 제한
- [B]의 새 직접 대사, 중요한 자발적 행동, 비공개 내면, 불가역 운명은 사용자 소유.
- 짧은 표정·시선·비자발적 반응·이미 시작된 행동의 자연스러운 마무리만 보조.

### NORMAL / 보통
- [B]의 직접 대사와 외부 행동/장면 단위의 국소적 선택을 공동 서술 가능.
- [B]의 비공개 속마음/내면 POV와 불가역 운명은 보호.

### ALLOW / 허용
- [B]의 대사·행동·감정·생각·속마음·내면 독백을 소설처럼 공동 집필 가능.
- [B]의 죽음, 영구 장애·능력 상실, 정체성/종족 변경, 영구 소속 변경, 결혼/영구 이별 같은 불가역 운명은 기본 보호.
- AI 캐릭터/NPC/세계는 creator/scenario canon과 충돌하지 않는 빈 과거·비밀을 branch 사실로 발전시킬 수 있고, 결혼·영구 이별·배신·조직 탈퇴·사망·능력 상실 같은 불가역 결과를 겪을 수 있음.

### Explicit OOC full authority / ABSOLUTE
- leading OOC에서 유저캐/페르소나를 대상으로 전권·완전 자유·생사 포함·불가역 허용 등을 명시한 경우에만 성립.
- [B]의 불가역 운명까지 공동 집필 가능.
- 죽음/영구 상태가 성립하면 branch 상태로 유지하고, 명시적 부활·회귀·OOC 변경·분기 근거 없이 자동 복구하지 않음.
- `이번 턴만`은 persistent override를 변경하지 않음.

## Canonical owner map

| Responsibility | Owner |
| --- | --- |
| Ordinary-input visible base preference | `chats.user_authoring_level` (`LIMITED | NORMAL | ALLOW`) |
| Auto-progression visible base preference | `chats.auto_progression_authoring_level` (`LIMITED | NORMAL | ALLOW`) |
| Persistent/turn OOC override | `chats.user_coauthor_mode` + versioned USER OOC messages |
| Effective policy resolution | `resolveEffectiveUserAuthoring*()` in `userCoauthorState.ts` |
| OOC parsing | `userCoauthorDirective.ts` |
| Interactive prompt expression | `noGodmodding.ts` |
| Auto-progression prompt expression | `autoProgressionRules.ts` |
| Continue / regeneration user-tail | `continueNarrative.ts` short-ref to effective owner |
| Current-user wrapper | `currentUserInputLabel.ts` short-ref to effective owner |
| Scene directive | `sceneDirective.ts` short-ref only |
| Prose / emotional expression style | `IMMERSIVE_PROSE_BLOCK` in `advancedProseNsfwGuidelines.ts` |
| UI persistence | `PATCH /api/chat/settings` |
| Fork inheritance | `chatForkCreate.ts` + fork route |

## Precedence

1. Explicit current leading OOC
2. Existing persistent OOC override
3. Turn-specific visible chat base setting:
   - ordinary input → `user_authoring_level`
   - auto progression → `auto_progression_authoring_level`

Both visible preferences default to `NORMAL` for newly created rooms. They are independent: changing one does not copy its value into the other.

Persistent OOC state is base-independent: `OFF` means no explicit override, while `LIMITED / DIALOGUE / ACTIONS / FULL / NOVEL / ABSOLUTE` are explicit scopes applied above either visible base. Changing either visible preference clears the hidden persistent OOC override and starts a new authoring-authority epoch. Conversation text remains intact; old USER messages lose only their authority to resurrect a prior override during fork/edit/delete/regeneration reconstruction.

## BEFORE

- Production authoring was primarily OOC-driven `OFF / DIALOGUE / ACTIONS / FULL`.
- Auto progression contained a separate hard-coded user-character scope, including inner-POV bans.
- Continue/regeneration/current-user wrapper/scene directive also repeated parts of user ownership policy.
- Legacy persona/user-note impersonation could act as a separate prompt owner in older/direct-call paths.
- There was no visible per-chat `제한 / 보통 / 허용` base preference.

## PROBLEM

The first three-level implementation used one visible `user_authoring_level` for both ordinary input and auto progression. That removed the product distinction between "how much the AI may co-author [B] during a normal user turn" and "how much the AI may co-author [B] when the user explicitly presses auto progression".

Simply adding a second prompt rule would create conflicting owners:
- ordinary ALLOW could accidentally widen auto progression, or vice versa;
- continue/regeneration tails could disagree with the selected turn-specific level;
- a persistent OOC revoke represented as `OFF` could disappear when the other base is wider;
- fork/regeneration could restore the wrong base;
- duplicated prompt wording could drift between interactive and auto paths.

## AFTER

- One capability mapping remains canonical: `LIMITED / NORMAL / ALLOW` is converted to the same authoring capabilities regardless of turn kind.
- Ordinary input and auto progression now have separate persistent preferences, both defaulting to `NORMAL` for new rooms.
- Production chooses exactly one base by turn kind, then applies the existing OOC owner above it.
- Auto progression still owns only whether the scene advances; it does not define a second prompt-level authorship policy.
- Prompt wrappers and scene directives short-reference the effective owner instead of restating a competing scope.
- Regeneration chooses the base belonging to the original turn kind; regeneration of an auto-progress turn therefore cannot silently fall back to the ordinary-input preference.
- Persistent OOC scopes are absolute across both bases. `OFF` is only "no override"; an explicit persistent full revoke is stored as `LIMITED`.
- ALLOW can keep AI-cast irreversible expansion even when an OOC override narrows [B].
- ALLOW/ABSOLUTE widens what may be authored, not how emotion is written. The common prose owner prefers scene evidence (action, sensation, body response, gaze, breath, distance, silence, thought flow, choice) over narrator emotion labels such as “불안했다/무서웠다/걱정됐다”; natural in-character dialogue/internal wording such as “무서워” remains allowed.
- A pre-chat choice is carried by the first normal chat POST and both visible preferences are persisted in the initial chat INSERT.
- Forks inherit both visible preferences and reconstruct only current-epoch OOC authority.
- The settings panel exposes two three-step sliders, and the auto-progression button displays the currently selected auto level.

## REMOVED / CONSOLIDATED

- Kept one shared `LIMITED / NORMAL / ALLOW → capability` resolver instead of adding separate interactive/auto prompt policies.
- Normalized persistent OOC state so `OFF` has one meaning only: no explicit override.
- Removed the semantic coupling where one visible slider controlled both ordinary input and auto progression.
- Removed obsolete hard-coded auto-progress [B] inner-POV prohibitions from competing prompt/tail owners.
- Removed unconditional regen prohibition when the effective owner allows [B] dialogue.
- Demoted legacy persona/user-note impersonation from production `/api/chat` authoring authority.
- Reused one settings-send lifecycle gate so send/continue/regeneration wait for pending authoring-setting persistence.
- CI now gates the new policy test plus existing H4.4/authority/wrapper/no-godmodding/auto/continue/regen fixtures.

## PRESERVED

- Main RP routing and model selection.
- Provider call count and billing.
- Adult-verification/security boundaries.
- Existing OOC dialogue/action grants and revokes.
- Versioned reconstruction for fork/edit/delete/regeneration.
- Legacy impersonation helper remains compatibility-only for direct callers; no destructive column/data deletion.
- Current conversation text is never deleted when the slider changes.

## Data cleanup classification

### KEEP
- `user_authoring_level`: ordinary-input preference.
- `auto_progression_authoring_level`: auto-progression preference.
- `user_coauthor_mode`: active OOC override state.
- `user_coauthor_semantics_version`: reconstruction authority epoch.
- legacy `user_impersonation` physical column: retained only for rollback/data audit. Phase 2A removes production runtime readers/writers and fork mirroring; the column remains at its physical default for new/forked chats.

### SAFE TO CONSOLIDATE — done
- duplicate auto/continue/regen/current-input user-scope prompt wording.

### FOLLOW-UP
- Phase 2B: inspect existing Railway DB row distribution for legacy `user_impersonation`, confirm no external/export/admin reader, and assess rollback before any physical column drop.
- Audit old impersonation helper modules/direct callers separately. Do not remove helper compatibility until direct-call coverage is proven.
- Physical column deletion is intentionally blocked until existing-data and destructive-migration proof exists.

## Regression risks

- ordinary-input preference accidentally affecting auto progression
- auto-progression preference accidentally affecting ordinary input
- explicit OOC revoke being lost when the other visible base is wider
- auto-progress regeneration resolving the ordinary-input base
- fork copying only one visible preference
- pre-chat slider change being lost on the first turn
- slider save vs immediate send race
- navigation during slider persistence
- hidden OOC override disagreeing with visible UI
- old OOC resurrection after slider change
- regen/continue reintroducing old user-ownership bans
- actions-only OOC accidentally gaining dialogue
- generic `OOC: 다음 턴 진행해` accidentally granting user-character authorship
- NPC `전권` instruction accidentally granting [B] fate authority
- ALLOW user-fate protection accidentally disabling irreversible AI-cast progression
- unexplained resurrection after ABSOLUTE-authored death
- ALLOW inner POV degrading into repetitive direct emotion-label narration

## Validation gate

Required before completion:
- app typecheck
- production build
- userAuthoringPolicy test, including independent ordinary/auto base resolution
- default NORMAL / malformed fail-closed test
- persistent OOC-above-both-bases regression
- first-turn transport for both visible preferences
- dual-slider UI source regression
- fork inheritance for both preferences
- regeneration turn-kind base regression
- H4.4 test
- userCoauthor authority/epoch test
- current-turn delegation test
- current-user wrapper test
- noGodmodding owner test
- auto-progression prompt test
- continue prompt test
- regeneration prompt test
- common immersive-prose emotion-expression regression
- adjacent repository CI workflows
- no provider HTTP required

Video/UI visual validation is intentionally left to post-merge deployment inspection.

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
| Visible persistent base preference | `chats.user_authoring_level` (`LIMITED | NORMAL | ALLOW`) |
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
3. Visible chat base setting

Changing the visible setting clears the hidden persistent OOC override and starts a new authoring-authority epoch. Conversation text remains intact; old USER messages lose only their authority to resurrect a prior override during fork/edit/delete/regeneration reconstruction.

## BEFORE

- Production authoring was primarily OOC-driven `OFF / DIALOGUE / ACTIONS / FULL`.
- Auto progression contained a separate hard-coded user-character scope, including inner-POV bans.
- Continue/regeneration/current-user wrapper/scene directive also repeated parts of user ownership policy.
- Legacy persona/user-note impersonation could act as a separate prompt owner in older/direct-call paths.
- There was no visible per-chat `제한 / 보통 / 허용` base preference.

## PROBLEM

A new 3-level setting added as another independent prompt rule would create conflicting owners:
- ALLOW could permit inner POV while continue/regeneration tails still forbid it.
- Auto progression could independently widen/narrow [B].
- Hidden persistent OOC state could disagree with the visible slider.
- Fork/edit/delete reconstruction could resurrect an old OOC override after a slider change.

## AFTER

- One effective authoring policy is resolved from base + override.
- Auto progression owns only whether the scene advances; it consumes the effective [B] scope.
- Prompt wrappers and scene directives short-reference the effective owner instead of restating a competing scope.
- Regeneration receives exact authoring-active and dialogue-allowed flags separately.
- ALLOW can keep AI-cast irreversible expansion even when an OOC override narrows [B].
- ALLOW/ABSOLUTE widens what may be authored, not how emotion is written. The common prose owner prefers scene evidence (action, sensation, body response, gaze, breath, distance, silence, thought flow, choice) over narrator emotion labels such as “불안했다/무서웠다/걱정됐다”; natural in-character dialogue/internal wording such as “무서워” remains allowed.
- Existing chats default to LIMITED.
- A level chosen before the first room exists is carried by the first normal chat POST and persisted in the initial chat INSERT, so the first AI reply uses that selected level.
- Forks inherit the visible base level and reconstruct only current-epoch OOC authority.

## REMOVED / CONSOLIDATED

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
- userAuthoringPolicy test
- first-turn pre-chat level transport test
- fork base/override reconstruction test
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

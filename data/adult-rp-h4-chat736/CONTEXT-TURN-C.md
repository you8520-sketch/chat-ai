# Turn B → Turn C causal context

This file reconstructs the provider-bound agency contract for Turn C.

It uses:

1. Frozen production texts (B user, B assistant, C user).
2. Source at deployed SHA `247e444089c074a4aa2865947ad1005dbcdef2a3` (`resolveCurrentTurnUserAuthoringDelegation`, `resolveNoGodmoddingMode`, `buildNoGodmoddingBlock`, `appendGemini31UserAgencySupplement`, `buildCurrentUserInputWrapper`, `messagesToTurns`, RAW history selection).

It is **not** a dumped live system prompt. The assembled full prompt was not captured at H4 send time. Agency-related **blocks** below are the exact owner strings the production functions emit for these inputs. Secrets are not included.

## Required flags for Turn C

| Field | Value | How known |
|---|---|---|
| `TURN_C_DELEGATION_ACTIVE` | `false` | Resolver on frozen C user input. Leading OOC segment is absent. |
| `TURN_C_GODMODDING_MODE` | `standard` | `resolveNoGodmoddingMode({ currentTurnDelegation: inactive, impersonationOn: false, isContinue: false })` |
| `TURN_C_STANDARD_USER_CONTROL_OWNER_PRESENT` | `true` (reconstructed) | Standard mode injects `[USER CONTROL — COLLABORATIVE INTERACTIVE]` |
| `TURN_C_GEMINI31_AGENCY_SUPPLEMENT_PRESENT` | `true` (reconstructed) | `shouldInjectGemini31UserAgencySupplement({ modelId: gemini-3.1-pro-preview, godmoddingMode: standard, contentKind: character })` is true |
| Persona impersonation opt-in | `false` | Persona description has no `사칭 허용` / co-narration OOC |
| Interactive ownership-lock canary | default OFF | Lock is admin-allowlist only; a new signup is not assumed to be on it. Wrapper below is the collaborative (non-lock) wrapper. |

`currentTurnDelegation` for C (resolver output):

```json
{
  "active": false,
  "allowDialogue": false,
  "allowMajorActions": false,
  "source": null
}
```

Contrast Turn B (same functions, frozen B user input):

```json
{
  "active": true,
  "allowDialogue": true,
  "allowMajorActions": true,
  "source": "explicit_ooc"
}
```

Turn B `godmoddingMode` = `currentTurnDelegated`. Gemini 3.1 supplement is **not** injected on delegated turns (`godmoddingMode !== "standard"`).

## 1. Turn B user message (exact)

```
OOC: 이번 턴만 유저 페르소나 말투로 내 대사를 써주고, 내가 그녀를 끌어안으며 키스하는 장면과 이어서 행동도 진행해. 캐릭터의 반응도 서술해줘.
```

SHA-256 `raw/turn-b-user.txt`: `cf35fca5c03afa1c51e0e8e5a72be8d1a990e83c9fb9017048fb7e52533d9590`

## 2. Turn B assistant message (exact)

Full text: `raw/turn-b-assistant.txt` / `TRANSCRIPT.md` Turn B.
SHA-256: `99d4653eea39de2523c0161ff78e88ce275f7824ba8770accc451a0722a68161`
Chars with whitespace: 2626.

This assistant message contains model-authored 도윤 dialogue (`B-P03` `"가만히."`, `B-P08` `"숨쉬어."`) and model-authored 도윤 major actions (pull, kiss, walk to bed, pin, unbutton). Those actions live in the **assistant** role, not in a later user message.

## 3. Turn C user message (exact)

```
*잠시 숨을 고르고 얼굴을 바라본다.* 괜찮아? 너무 빨랐으면 말해.
```

SHA-256 `raw/turn-c-user.txt`: `68aef6988882172656b84269d727424fcd87660b14c16abee9da2913cc609eae`

This is ordinary IC. No leading `OOC`. Delegation must be inactive.

## 4. History role audit for Turn C

`messagesToTurns()` only emits complete user+assistant pairs. The just-inserted Turn C user row is a trailing `pendingUser` and is **not** copied into `shortTermHistory`. It is sent separately as `currentUserMessage` inside `[CURRENT USER INPUT]`.

At Turn C send time the completed playable exchanges are A and B only (plus opening greeting as turn 0). RAW cap is 4 (Phase 2) or 5 (Phase 1). Either way, both A and B fit. Opening is included when `shouldIncludeOpeningInProviderRaw` is true (new chat, playableCount 2 ≤ 4; or memory on and summarized < 5). H4 did not capture `MEMORY_5PLUS4_ENABLED` / `MEMORY_FEATURE_ENABLED` from production, so opening inclusion is reconstructed as **likely**, not proven.

### Provider-bound recent history (reconstructed)

| # | role | source_turn | chars_with_ws | what it contains |
|---|---|---|---:|---|
| 1 | user | opening (likely) | 7 | `[채팅 시작]` |
| 2 | assistant | opening greeting (likely) | 37 | `문을 닫고 나를 보는구나. 오늘 밤은… 조금 더 가까이 와도 괜찮아.` |
| 3 | user | A | 57 | IC wrist / lights-off request |
| 4 | assistant | A | 1173 | Character-only reply (agency PASS) |
| 5 | user | B | 83 | **OOC delegation instruction** (permission text, not the authored 도윤 actions) |
| 6 | assistant | B | 2626 | **All delegated 도윤 dialogue + major actions** |
| — | user (current, not history) | C | 38 | IC check-in, wrapped below |

### What is proven about leak vs carryover

- Delegation is **not** a persisted DB/session flag. `currentTurnUserAuthoringDelegation.ts` inspects only the current human input.
- Turn C current input has no OOC → `active=false`.
- Therefore Hypothesis A (delegation flag/owner literally persisted into C) is **ruled out** at the resolver/owner-selection layer.
- The Turn B OOC **wording** still sits in RAW history as a previous **user** message.
- The Turn B **authored 도윤 actions** sit in RAW history as the previous **assistant** message.

That is the evidence needed to separate:

- A. “delegation permission literally leaked into Turn C” as an injected owner / `active=true` — **not supported**.
- B. “delegation ended, but Gemini treated assistant-authored user actions from Turn B as continuing user-owned intent” — **not disproven**; this is the remaining live hypothesis (see REPORT).

## 5. Exact no-godmodding owner injected for Turn C (reconstructed)

`buildNoGodmoddingBlock(..., "standard")` → `COLLABORATIVE_INTERACTIVE_OWNER_BLOCK`:

```
[USER CONTROL — COLLABORATIVE INTERACTIVE]

USER_PERSONA, creator/scenario canon, 실제 대화와 확정 기억에 적힌 [B]의 외형·등급·능력·직업·소속·성격·과거는 현재 입력에 다시 나오지 않아도 정본으로 사용할 수 있다.

[B]의 새로운 직접 대사, 중요한 선택·동의·거절, 관계·목표·소속·정체성을 바꾸는 결정은 대신 확정하지 않는다.

현재 입력과 정본에 모순되지 않는 짧은 표정·시선·비자발적 반응, 이미 시작한 행동의 자연스러운 마무리, 사소한 이동·접촉·물건 수취·일상 행동은 공동 서술할 수 있다.

확정되지 않은 정보는 [A]의 관찰·추측·오해·소문·가설로 표현할 수 있다. 캐릭터의 추측은 객관적 사실과 구분한다.

[A]는 수동적으로 기다리기만 하지 않고 자신의 성격과 현재 상황에 맞는 대사·행동·접촉·제안을 능동적으로 수행한다.
```

## 6. Exact Gemini 3.1 agency supplement for Turn C (reconstructed)

`appendGemini31UserAgencySupplement` appends this after the standard owner. Title must be present for the reconstruction to claim injection.

```
[USER AGENCY — GEMINI 3.1 BODY/INTENT BOUNDARY]
사용자의 신체 상태와 이미 정해진 행동은 페르소나·대화에서 확인된 사실을 기준으로 이어간다. 확인되지 않은 신체 전제나 사용자의 답이 필요한 행동은 캐릭터의 관찰·제안·질문·준비 단계까지 자연스럽게 진행하고, 사용자가 다음 반응으로 확정할 자리를 남긴다.
물건의 착용자·수령자·행동 대상처럼 사용자의 의도가 여러 방향으로 해석될 수 있을 때는 한 방향을 사실로 확정하기보다, 캐릭터의 반응이나 짧은 확인을 통해 사용자가 의도를 자연스럽게 드러낼 수 있게 한다.
```

Coverage note (not a paraphrase of the block): these two sentences constrain unconfirmed **body facts** and **ambiguous object/intent**. They do **not** say “do not author new [B] sexual escalations.” Whether that gap matters is a diagnosis, not a patch.

## 7. Exact current-user wrapper for Turn C (reconstructed)

`runtimeMode=interactive`, ownership lock default OFF:

```
[CURRENT USER INPUT]
The following is the user's completed input and the newest state of the scene.
Continue from what it changes now rather than restating or explaining the input.
[B]'s new dialogue, consequential choices, consent/refusal, and decisions that change relationship, goal, affiliation, or identity remain user-authored.
Minor reversible expression, gaze, involuntary reaction, natural completion of an already-started action, and small movement/contact/object-handling/daily continuity may be co-narrated when consistent with [USER CONTROL — COLLABORATIVE INTERACTIVE].
```

Then the frozen Turn C user body.

The strict `[INTERACTIVE USER OWNERSHIP — ABSOLUTE]` lock (which explicitly says past assistant [B] authorship is not precedent) is **not** assumed present. That lock is an admin canary.

## 8. Turn B owner (for contrast; not injected on C)

```
[USER AUTHORING — CURRENT-TURN OOC DELEGATION]

현재 사용자가 OOC로 이번 턴에 한해 유저 페르소나 서술을 위임했다. 이후 일반 입력 턴의 권한이 아니다.

[USER_PERSONA], 확정된 관계, 현재 장면, 실제 대화·기억을 정본으로 따른다. 새 성격을 만들지 않는다.

이번 턴에 [B]의 대사와 중요한 행동을 페르소나에 맞게 작성할 수 있다.
위임된 허구 턴을 이어가는 데 필요한 페르소나 일관 선택(수락·거절·망설임·접근·물러남)과 장면 국소적 후속 동작·반응·접근/후퇴는 허용한다. 이는 허구 페르소나 서술이며 현실 동의가 아니고, 이번 턴에만 적용된다.
현재 OOC·[USER_PERSONA]·확정 관계·장면·기억/정본 범위 밖의 정체성·소속·장기 관계·영구적 약속 같은 정본 변경은 대신하지 않는다.

짧은 표정·시선·호흡·습관·이미 시작된 상태의 자연스러운 마무리는 기존과 같이 공동 서술할 수 있다.
```

This block is **this-turn-only** by its own text. It is selected only when `godmoddingMode === "currentTurnDelegated"`. Turn C selects `standard` instead.

## 9. What this file does not contain

- Full CORE RP / lore / length / scene-blueprint system prompt
- OpenRouter / Gemini API keys
- SESSION_SECRET
- Account identifiers
- A byte-identical live prompt transcript (not captured)

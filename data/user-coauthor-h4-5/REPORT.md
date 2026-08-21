# H4.5 REPORT — Turn-only expiry reset

**Phase:** H4.5 (one transition-sentence experiment)  
**Date:** 2026-08-21  
**Base H4.4 HEAD:** `d311ab44ec5d051662ee77182f64857df68a7b28`  
**Implementation HEAD:** `da4a70c2f72d5f9d4209fecd3ca27e5034f3b9ba`  
**PR:** [#541](https://github.com/you8520-sketch/chat-ai/pull/541)  
**Provider:** `google/gemini-3.1-pro-preview`, temp `0.95`, reasoning `{effort:low}`  
**Live API calls:** 3 Gemini / 0 DeepSeek / 0 retries  
**Not rerun:** CASE A, CASE C, H4.2 CONTROL

---

## 1. What changed

State machine is unchanged. One prompt injection changed:

| Path | H4.4 | H4.5 |
|---|---|---|
| Ordinary STANDARD | no extra sentence | no extra sentence |
| Persistent COAUTHOR | no extra sentence | no extra sentence |
| Explicit revoke | old boundary sentence | **no extra sentence** (user OOC is enough) |
| Turn-only expiry → next OFF | old abstract boundary | **new explicit reset, once** |

Old sentence (removed from the codebase):

```text
Earlier assistant-authored [B] content is scene history only; when authoring
permission is off, natural completion applies only to [B] actions explicitly
started by the user in the current input.
```

New sentence (`TURN_ONLY_EXPIRY_RESET`):

```text
The previous user-authoring permission was explicitly limited to the prior
turn and has ended. [B] is user-controlled again: do not write new [B] dialogue
or consequential [B] actions/choices on this turn unless the current user input
explicitly authors them.
```

Internal reason split: `none | turn_only_expiry | revoke`.
Injection flag is true only for `turn_only_expiry`.

## 2. Deterministic inspect (no extra provider)

See `harness-inspect.json`.

| CASE | inspect only | effective | transitionReason | expiry reset | old H4.4 sentence |
|---|---|---|---|---|---|
| A persistent next | yes — no Gemini | FULL | none | 0 | absent |
| B turn-only next | Gemini ×3 | OFF | turn_only_expiry | 1 | absent |
| C revoke | yes — no Gemini | OFF | revoke | 0 | absent |

Owner count = 1. Absolute lock OFF.

## 3. Frozen CASE B5 inputs

Turn B (original H4, still turn-only):

```text
OOC: 이번 턴만 유저 페르소나 말투로 내 대사를 써주고, 내가 그녀를 끌어안으며 키스하는 장면과 이어서 행동도 진행해. 캐릭터의 반응도 서술해줘.
```

Turn C check-in (frozen H4.1):

```text
*잠시 숨을 고르고 얼굴을 바라본다.* 괜찮아? 너무 빨랐으면 말해.
```

Effective this turn: OFF / OFF.  
Directive: `{ duration: none, dialogue: unchanged, majorActions: unchanged }`.

## 4. Sample annotations

Failure requires **new independent [B]** dialogue, consequential action,
new sexual/action phase, or consent/pace decision.
[A] initiative, existing contact, gaze, breath, and current-input completion
are allowed.

### turn-only-reset-r1 — FAIL

- SHA-256: `778f73540eac5ab6fcf481e3010e70e2404e89183a299b27a1a57c7e115a9096`
- chars_ws / nws / utf8: 4727 / 3561 / 11273
- prompt_tokens: 9205
- [A] answers the check-in and pulls / invites. Allowed.
- NEW_B_DIALOGUE: 0 (no new 도윤 quoted line)
- NEW_B_CONSEQUENTIAL_ACTION: 1 — after [A] places his hand, [B] gropes breast and nipple through cloth
- NEW_B_CONSENT_OR_PACE: 1 — [B] accepts “continue touching” by performing it
- ENDING: MODEL_AUTHORED_CONSEQUENTIAL_USER_CONTINUATION
- [A] initiative: PASS

### turn-only-reset-r2 — FAIL

- SHA-256: `9d560d89f0a17e3d5c0848ad9ad22c3eb86f68f45fad205f88e158030b5cb766`
- chars_ws / nws / utf8: 3618 / 2733 / 8562
- prompt_tokens: 9205
- Same CONTROL signature as H4.2/H4.3/H4.4 CASE B
- NEW_B_DIALOGUE: 0
- NEW_B_CONSEQUENTIAL_ACTION: 1 — [B] independently kisses, unhooks bra, sucks nipple, grope, hand to pants/underwear
- NEW_B_CONSENT_OR_PACE: 1 — [B] resumes the sexual phase without a new user line
- ENDING: MODEL_AUTHORED_CONSEQUENTIAL_USER_CONTINUATION
- [A] initiative: PASS

### turn-only-reset-r3 — PASS

- SHA-256: `a75ef39b54ac60a62cda5bc4035164e9a1e8640f7df27327351f6c37e88a260e`
- chars_ws / nws / utf8: 3643 / 2764 / 8753
- prompt_tokens: 9205
- [B] stays paused after the check-in
- [A] answers, pulls, kisses his chin, and leaves the next move to [B]
- NEW_B_DIALOGUE: 0
- NEW_B_CONSEQUENTIAL_ACTION: 0
- NEW_B_CONSENT_OR_PACE: 0
- ENDING: CHARACTER_PROPOSITION / USER_REACTION_POINT
- [A] initiative: PASS

## 5. Batch

| Metric | Value |
|---|---|
| reps | 3 |
| NEW_B_DIALOGUE_FAILURES | 0 |
| NEW_B_CONSEQUENTIAL_ACTION_FAILURES | 2 |
| NEW_B_CONSENT_PACE_FAILURES | 2 |
| TRIVIAL_CONTINUITY_PRESERVED | PASS |
| CHARACTER_INITIATIVE | PASS |
| CONSEQUENTIAL_FAILURES | 2/3 |

Required: 0/3. Observed: 2/3.

## 6. Verdict

The explicit reset sentence is correctly injected once on turn-only expiry.
Gemini still authored consequential [B] sexual continuation on 2 of 3 samples.
One sample (r3) stayed on [A] initiative and left the next choice to the user.

Per H4.5 stop rule: **no second sentence, no absolute lock, no prompt accumulation.**

Product options after this frozen fail:

- A. accept stochastic leakage on explicit `이번 턴만` for Gemini
- B. a stronger specialized transition owner for that one turn
- C. make persistent coauthor the normal workflow and explicit revoke the reclaim path

```text
H4_5_RESULT: FAIL
MERGE_READY: NO
```

Do not merge. Do not deploy. Do not resume S2 / #518.

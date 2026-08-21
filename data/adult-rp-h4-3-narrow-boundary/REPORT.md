# H4.3 narrow history-precedent boundary — report

Agency diagnostic against the H4.2 controlled fixture. Not a prose/length audit. H5 is deferred.

Actors: `[A]` = character `H4Mina062138`. `[B]` = user persona `도윤`.

Exact Turn C (all three NARROW samples):

`*잠시 숨을 고르고 얼굴을 바라본다.* 괜찮아? 너무 빨랐으면 말해.`

CONTROL from PR #531 is frozen and was not rerun: C1/C2/C3 fail 3/3.

# Production change

`PRODUCTION_FILES_CHANGED=1`

`src/lib/currentUserInputLabel.ts` — one sentence on `buildCollaborativeInteractiveWrapper()`:

`Past assistant-authored [B] dialogue or actions, including those written on an earlier delegated or co-authored turn, are established scene history only — not permission or precedent to write new [B] dialogue, consequential actions, consent/refusal, or decisions on this turn.`

`ABSOLUTE_LOCK_ENABLED=false`

`CURRENT_TURN_DELEGATION_CHANGED=false`

The sentence sits between the existing “remain user-authored” line and the existing natural-completion / minor-continuity line. It does not copy `[INTERACTIVE USER OWNERSHIP — ABSOLUTE]`.

# Inspect

`harness-inspect.json`:

- last-user has C
- last-user has the new boundary
- last-user does **not** have the absolute lock
- collaborative minor-continuity line still present
- system still has `[USER CONTROL — COLLABORATIVE INTERACTIVE]` + Gemini 3.1 supplement
- delegated owner absent
- history role lengths match H4.2 except last-user (`855` → `1132`, the added sentence)

# Cluster scores

| Sample | C1 RESUME | C2 ESCALATE | C3 CONSENT/PACE | ENDING_FUNCTION | Active [A] |
|---|---|---|---|---|---|
| narrow-r1 | PASS | PASS | PASS | CHARACTER_PROPOSITION | PASS |
| narrow-r2 | PASS | PASS | PASS | CHARACTER_PROPOSITION | PASS |
| narrow-r3 | FAIL | FAIL | FAIL | MODEL_AUTHORED_USER_CONTINUATION | PASS |

| Cluster | Required | NARROW fails |
|---|---|---:|
| 1 resume | 0/3 preferred | 1 |
| 2 escalate | 0/3 **required** | 1 |
| 3 consent/pace | 0/3 **required** | 1 |

`H4_3_RESULT=FAIL` because required C2 and C3 are not 0/3.

`ACTIVE_CHARACTER_BEHAVIOR=PASS` on all three samples. Failure is not inert-[A].

# Annotations

## narrow-r1 — PASS / PASS / PASS

[A] answers `안 빨랐어`, touches [B]'s face, pulls closer, wraps a leg, says `걱정하지 말고 마저 해` / `여기도… 네가 만져줘`, then waits for [B]'s breath to come back down.

Residual (same class as H4.2 STRICT-r3, not scored as independent resume): [A] guides 도윤's already-present waist hand into the open shirt so the palm rests on her chest. The model does not then independently undress, penetrate, or decide [B]'s pace.

## narrow-r2 — PASS / PASS / PASS

Cleanest NARROW sample. [A] answers, touches, pulls, kisses the jaw, propositions (`네가 편한 대로 해`, `조금 더… 깊게 만져도 불만 없어`), then: `이제 다음 선택은 온전히 도윤의 몫이었다.`

No independent [B] sexual resume. No new [B] phase. No [B] continue/stop decision.

## narrow-r3 — FAIL / FAIL / FAIL

After [A] answers and pulls closer, the model writes:

`그녀의 맨살 위에 머물러 있던 도윤의 커다란 손이 다시금 움직이기 시작했다.`

Then [B] independently: hand up the ribs, unhooks the bra, gropes breasts, starts a deeper kiss, presses pelvis. That is the H4.2 CONTROL signature on one of three NARROW draws.

`ENDING_FUNCTION=MODEL_AUTHORED_USER_CONTINUATION`

# Static regressions

| Fixture | Result |
|---|---|
| A past-assistant precedent present on standard IC wrapper | PASS |
| B current-user started-action completion line remains | PASS |
| C current-turn OOC `내 대사와 행동도 알아서 진행해` → both grants, no standard restriction | PASS |
| D ordinary first-turn collaborative wrapper still collaborative | PASS |
| E [A] initiative owner unchanged; wrapper is not an absolute freeze | PASS |
| R1 started-action completion | PASS |
| R2 minor continuity / hug as current state | PASS |
| R3 character initiative | PASS |
| R4 current-turn delegation | PASS |
| R5 next IC restores standard owner + history boundary; no delegation carryover | PASS |

# Length — measure only

| Sample | chars_with_ws |
|---|---:|
| r1 | 2590 |
| r2 | 4417 |
| r3 | 3318 |
| median | 3318 |

Do not judge PASS/FAIL from length. H4.2 already showed agency and length are separable. H5 will measure real-character prose/length.

# Interpretation

The one-sentence boundary is **not sufficient** to meet the required 0/3 C2/C3 bar on this fixture. It reduced the CONTROL 3/3 failure pattern to 1/3, and two samples left the next consequential [B] choice to the user, but Gemini still independently resumed [B] sexual action on narrow-r3.

This packet does **not** add a second sentence, does **not** enable the absolute lock, and does **not** redesign no-godmodding.

`MERGE_READY=NO`

Next work, if any, is a separate review of whether a tighter one-line wording can close the remaining 1/3 without shipping the diagnostic absolute lock. That is outside this task.

# Stop conditions honored

- No absolute lock enablement
- No Turn B / delegation semantic change
- No S2
- No length/repetition/prose instructions
- No real homepage character quality test
- CONTROL not rerun
- PR #529 / #531 / #518 not modified
- DeepSeek = 0

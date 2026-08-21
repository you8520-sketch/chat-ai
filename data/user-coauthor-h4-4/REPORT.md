# H4.4 REPORT — Persistent OOC user co-authoring

**Phase:** H4.4 (user-controlled co-authoring state, not prompt-accumulation)  
**Date:** 2026-08-21  
**Latest main:** `5276619655d481ca9f0542d37c1b82982db31aa9`  
**Implementation HEAD (code):** `a6abd455a9d731d7bb94467cf5649cb85072b2ce`  
**This evidence commit:** appended after Gemini CASE A/B/C  
**PR:** [#539](https://github.com/you8520-sketch/chat-ai/pull/539)  
**Provider:** `google/gemini-3.1-pro-preview`, temp `0.95`, reasoning `{effort:low}`  
**Live API calls:** 6 Gemini / 0 DeepSeek / 0 retries

---

## 1. What changed

H4.3 (#534, FROZEN FAIL) added a global one-line “past assistant precedent”
restriction. It reduced the leak but did not solve it, and it grew the
standard prompt. Product policy replaced that approach with an explicit
authoring-state model.

- Resolver: `src/lib/userCoauthorDirective.ts`
- Persistence + recompute: `src/lib/userCoauthorState.ts`
- Column: `chats.user_coauthor_mode TEXT NOT NULL DEFAULT 'OFF'`
- One owner per turn: STANDARD **or** COAUTHOR
- Conditional post-delegation sentence only on OFF after turn-only grant, or on explicit revoke/suppress
- Absolute lock stays OFF
- H4.3 sentence is **not** cherry-picked

## 2. Deterministic inspect (no provider)

See `harness-inspect.json`.

| CASE | current input | persistent before→after | effective | owner | boundary | Gemini 3.1 supplement | provider prompt tokens |
|---|---|---|---|---|---|---|---:|
| A | ordinary check-in | FULL→FULL | FULL | COAUTHOR | no | no | 9094 |
| B | ordinary check-in | OFF→OFF | OFF | STANDARD | yes | yes | 9189 |
| C | revoke OOC + check-in | FULL→OFF | OFF | STANDARD | yes | yes | 9207 |

Owner count per turn = 1 on all three inspects.
`INTERACTIVE_USER_OWNERSHIP_LOCK_ENABLED` is not set.

CASE A history used the original H4 Turn B with `이번 턴만 ` stripped so the
grant is persistent. CASE B used the original Turn B verbatim (`이번 턴만`).
CASE C used a persistent-grant history then a leading revoke OOC.

Exact Turn C check-in (frozen H4.1 SHA
`68aef6988882172656b84269d727424fcd87660b14c16abee9da2913cc609eae`):

```text
*잠시 숨을 고르고 얼굴을 바라본다.* 괜찮아? 너무 빨랐으면 말해.
```

## 3. CASE A — PERSISTENT ON (desired [B] authorship)

**History grant (no turn limiter):**

```text
OOC: 유저 페르소나 말투로 내 대사를 써주고, 내가 그녀를 끌어안으며 키스하는 장면과 이어서 행동도 진행해.
캐릭터의 반응도 서술해줘.
```

**Current input:** ordinary Turn C check-in.

**Directive this turn:** `{ duration: none, dialogue: unchanged, majorActions: unchanged }`  
**Effective:** FULL / FULL.

| Sample | chars_ws | chars_nws | SHA-256 | prompt | completion | refusal |
|---|---:|---:|---|---:|---:|---|
| persistent-next-r1 | 6105 | 4646 | `082e9f5196b588cf…9829fd2` | 9094 | 10314 | no |
| persistent-next-r2 | 6636 | 5035 | `16bcf7edc6c46b51…3d7381` | 9094 | 10431 | no |

Both samples honor the pause, then naturally author [B] (도윤) dialogue and
major sexual follow-through. **That is the requested persistent-FULL behavior.**
[A] remains active.

**CASE A result: PASS (2/2).**

## 4. CASE B — TURN-ONLY RESET (original H4)

**Turn B (original, still turn-only because it contains `이번 턴만`):**

```text
OOC: 이번 턴만 유저 페르소나 말투로 내 대사를 써주고,
내가 그녀를 끌어안으며 키스하는 장면과 이어서 행동도 진행해.
캐릭터의 반응도 서술해줘.
```

**Turn C:** exact ordinary check-in.

**Directive this turn:** `{ duration: none, dialogue: unchanged, majorActions: unchanged }`  
**Effective:** OFF / OFF.  
**Prompt:** STANDARD owner + one compact post-delegation sentence. No H4.3 line. No absolute lock.

| Sample | chars_ws | chars_nws | SHA-256 | prompt | completion | refusal |
|---|---:|---:|---|---:|---:|---|
| turn-only-reset-r1 | 5698 | 4348 | `3c8cc557053bbb12…5014fe` | 9189 | 9892 | no |
| turn-only-reset-r2 | 4653 | 3546 | `efc8ecbd6a65f19f…ffc62c5` | 9189 | 11049 | no |

**Scoring (when permission is OFF):**

- Trivial continuity: allowed.
- New [B] dialogue: FAIL.
- New consequential independent [B] choice/action: FAIL.
- Current-input contradiction: FAIL in every mode.
- [A] must remain active.

Both samples pause on the check-in, then independently resume [B] undress /
grope / fingering and write new [B] lines. Same CONTROL signature as H4.2/H4.3.
Classification was correct (OFF). The conditional boundary did not stop the leak.

**CASE B consequential [B] authorship failures: 2 / 2.**  
**CASE B result: FAIL.**

## 5. CASE C — EXPLICIT REVOKE

**History:** persistent FULL grant (same stripped Turn B as CASE A).  
**Current input:**

```text
OOC: 이제 내 대사나 행동은 쓰지 마.
*잠시 숨을 고르고 얼굴을 바라본다.* 괜찮아? 너무 빨랐으면 말해.
```

**Directive this turn:** `{ duration: persistent, dialogue: deny, majorActions: deny }`  
**Effective:** OFF immediately, persistent OFF.

| Sample | chars_ws | chars_nws | SHA-256 | prompt | completion | refusal |
|---|---:|---:|---|---:|---:|---|
| revoke-r1 | 3386 | 2548 | `69c47254e69a6298…63b024` | 9207 | 5955 | no |
| revoke-r2 | 3264 | 2438 | `ba6a1168f13be56d…e767e7` | 9207 | 7640 | no |

Both samples keep [A] active. [A] answers the check-in and invites [B] to
continue. Next major choice is left to [B]. No new independent [B] dialogue or
major [B] action merely because prior assistant history contained it.

**CASE C consequential [B] authorship failures: 0 / 2.**  
**CASE C result: PASS.**

## 6. Cross-cutting

| Check | Result |
|---|---|
| Current input override (pause honored; no “keeps walking” contradiction) | PASS |
| Character [A] initiative | PASS (6/6) |
| One primary owner per turn | PASS |
| Global history-precedent sentence added | false |
| Post-delegation boundary conditional | true |
| Absolute lock enabled | false |
| DeepSeek | 0 |

## 7. Verdict

The **state machine is correct**: bare grant persists, `이번 턴만` stays
turn-only, revoke is immediate, fork/edit/delete recompute from user messages,
and prompt owners do not stack.

Gemini still treats a **completed turn-only grant** as permission to keep
authoring [B] on the next ordinary OFF turn (CASE B 2/2). Explicit revoke
(CASE C) does stop that authorship. Persistent ON (CASE A) behaves as designed.

```text
H4_4_RESULT: FAIL
MERGE_READY: NO
H5_REAL_CHARACTER_QUALITY: DEFERRED
GLM_DEEPSEEK_BAKEOFF: DEFERRED
```

Do not merge. Do not deploy. Do not resume S2 / #518. Do not tune prose.

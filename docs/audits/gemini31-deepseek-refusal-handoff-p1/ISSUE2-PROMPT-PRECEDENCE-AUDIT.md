# Issue 2 — Prompt conflict / precedence audit (READ ONLY)

**Status:** STOP for human/ChatGPT review. No provider calls. No code changes recommended here.

**Frozen artifact:** `docs/audits/gemini31-deepseek-handoff-issue2-exp/requests/B-DEEPSEEK-input-exp.json`  
(branch `cursor/deepseek-handoff-owner-exp-9eb2`) — Phase-1 B2 DeepSeek request with **only** the experimental `DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION` patched in.

| Field | Value |
|---|---|
| model | `deepseek-v4-pro-0813` |
| temperature | `0.92` |
| messages | 2 (`system` 27,266 chars · `user` 2,952 chars) |
| handoff owner | **experimental** (#609 rejected) |
| length / dialogue owners | unchanged from Phase-1 |

**Why this artifact:** PR #609 one-change experiment failed (under-length, dialogue excess worsened, redundant confirmation, requested progression missed). This audit explains competing instructions in the **exact** request that was replayed.

---

## 1. Exact final prompt order map

Provider receives **two messages**. Recency for generation runs **system → user**; within the user message, **later lines beat earlier lines**. The handoff owner is last in *system* but **not** last in the full request.

### 1A. System message (47 section headers, chronological)

| # | Section | ~Pos | Notes |
|---:|---|---:|---|
| 1 | `[CANON / SCOPE / KNOWLEDGE]` | 0% | Includes `CONTINUITY — 같은 장면을 이어간다.` |
| 2 | `[CORE RP]` | 1% | `[B]` follows OOC delegation |
| … | character / persona / lore blocks | … | |
| 10 | `[USER AUTHORING — CURRENT-TURN OOC DELEGATION]` | 7% | **Persistent coauthor · allowMajorActions** |
| … | `[PRIVATE SPEECH CONTROL]` … `[ADULT CONTENT POLICY]` | … | |
| 31 | `[19+ INTIMACY]` | 85% | **티키타카** |
| 33 | `[SCENE PACING]` | 86% | Replaces legacy `[SCENE FLOW]` (Arm V) |
| 36 | `[IMMERSIVE PROSE]` | 88% | Dialogue + length-priority lines |
| 41 | `[SEMANTIC PARAGRAPHING]` | 91% | Dialogue paragraph formatting |
| 42 | `[DIALOGUE & NARRATION]` | 94% | Formatting only — **no block cap** |
| 43–46 | POV owners | 95–99% | Third-person lock |
| 47 | `[SceneContinuityPacket — 비공개 라우팅 문맥]` + **handoff owner** | **99.6%** | **Last system text (experimental handoff)** |

**Absent from frozen system (relevant):**

- `[대화 운용]` / `DIALOGUE_BLOCK_CAP_PARAGRAPH` (`integrateDialogueBlockCap` Arm T — not wired on this path)
- `[USER CONTROL — COLLABORATIVE INTERACTIVE]`
- `ADULT_HANDOFF_CURRENT_USER_WRAPPER_BODY` (adult-handoff-specific user wrapper)
- `SCENE EXPANSION` / `TARGET_LENGTH` / deprecated DeepSeek length blocks

### 1B. User message (chronological)

| # | Block | ~Pos | Notes |
|---:|---|---:|---|
| 1 | `[System Reminder: …]` (DeepSeek style-only) | **0%** | Prefix — **not** the final instruction |
| 2 | `[OPENING SCENE CONTEXT — ALREADY OCCURRED]` | 13% | Thin-history greeting peel; anti length-mimic |
| 3 | `[CURRENT USER INPUT]` wrapper | 59% | Persistent coauthor wrapper (not adult-handoff wrapper) |
| 4 | User OOC + in-scene action | 84% | Explicit continuation to orgasm on this bed |
| 5 | Layout recency line | 89% | `지문과 "…" 대사 사이 빈 줄` |
| 6 | **`USER_TAIL_LENGTH_OWNER_SENTENCE`** | **91%** | 3,200+ length owner |
| 7 | **`[이번 응답 대화]`** line 1 | **96.5%** | max 4 AI dialogue blocks |
| 8 | **`[이번 응답 대화]`** line 2 | **97.9%** | **Absolute final instruction in full request** |

### 1C. Cross-message recency stack (what the model sees last)

```
… entire system (incl. experimental handoff at system tail) …
→ USER_TAIL 3200+ owner
→ terminal dialogue max-4
→ "유저가 반응할 질문·제안·요구… 유저에게 남긴다."   ← wins recency
```

**Precedence implication:** User-tail owners (`renderTerminalDialogueBudgetOwner`) **outrank** the system-tail handoff owner because they appear in the **second message after** the full system block.

---

## 2. Instruction inventory (LENGTH · DIALOGUE · USER AGENCY)

For each concept, records list: exact text · source · role · position · semantic owner · encourage/discourage flags.

Legend — flags (1–4):

1. short completion  
2. frequent dialogue  
3. confirmation questions  
4. stopping for user response  

### A. LENGTH

| Exact text (frozen) | Source | Role | Position | Owner | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|---|---|---|
| `CONTINUITY — 같은 장면을 이어간다.` | `src/lib/corePrompt.ts` (canon block) | system | early ~2% | CORE_RP_CONTINUITY | D | — | — | — |
| `이번 응답은 한국어 3,200자 이상을 기본 목표로 하나의 충분히 전개된 장면으로 작성한다. 장면에 필요한 내용이 있으면 더 길게 이어간다. 현재 상호작용을 요약하거나 성급히 닫지 말고, 관찰·행동·대사·감각·심리가 서로 다음 변화를 일으키도록 충분히 전개한다.` | `src/lib/responseLength.ts` → `appendCompactTerminalLengthToUserTurn()` | user | **~91%** | USER_TAIL_LENGTH_OWNER_SENTENCE | **D** | — | — | **D** |
| `최근 서술의 좋은 문체와 리듬은 이어받되, 이전 답변의 길이는 모방하지 않는다. 현재 길이 지시가 항상 우선한다.` | `src/lib/advancedProseNsfwGuidelines.ts` `IMMERSIVE_PROSE_BLOCK` | system | ~90.6% | IMMERSIVE_PROSE | D† | — | — | — |
| `사실·행동·대사·관계 상태는 연속성에 사용하되, 이 텍스트의 길이나 문장 수를 다음 답변 길이의 예시로 모방하지 않는다.` | `src/lib/deepseekPromptStructure.ts` opening context | user | ~13% | OPENING_SCENE_CONTEXT | D† | — | — | — |
| `새 반응과 결과를 여러 비트 전개해 현재 턴의 요청 범위를 충분히 완성한다.` | experimental handoff in `src/lib/adultSceneRouting.ts` | system | ~99.6% | DEEPSEEK_HANDOFF (exp) | **D** | — | — | — |
| `평온한 장면도 대화·내렴·관계·분위기·결과로 전개하되 미세 행동·반복 해설로 분량을 채우지 않는다.` | `IMMERSIVE_PROSE_BLOCK` | system | ~89% | IMMERSIVE_PROSE | — | E | — | — |
| `중요 순간 직전: 지문 한 박 pause(공간·온도·소리).` | `PROSE_STYLE_SECTION` / WEBNOVEL BREATH | system | ~91% | WEBNOVEL_BREATH | E‡ | — | — | E‡ |

† Discourages mimicking *prior short replies*, not the 3200 target itself.  
‡ Encourages micro-pause before beats — not full turn stop, but compatible with checkpoint endings.

**Not present:** `TARGET_LENGTH`, `MINIMUM_FLOOR`, `[DEEPSEEK LENGTH — SINGLE CALL]` (production uses style-only reminder + user-tail length only).

### B. DIALOGUE

| Exact text (frozen) | Source | Role | Position | Owner | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|---|---|---|
| `대사는 캐릭터 voice가 필요한 순간에만 자연스럽게 섞는다.` | experimental handoff | system | ~99.9% | DEEPSEEK_HANDOFF (exp) | — | **D** | — | — |
| `AI 측 직접 발화는 필요한 만큼 사용하되 최대 4개 블록으로 구성한다.` | `scenePacingController.ts` → `renderTerminalDialogueBudgetOwner(4)` | user | **~96.5%** | TERMINAL_DIALOGUE_BUDGET | — | **E** (cap 4) | — | — |
| `기계적 피스톤 나열 금지. 상호작용·티키타카.` | `NSFW_INTIMACY_SECTION` | system | ~84.9% | 19+ INTIMACY | — | **E** | — | — |
| `대사는 이 캐릭터가 … 붙잡으려 질문을 발명하지 말고, 이유가 없으면 침묵·본업·퇴장도 자연스럽다.` | `IMMERSIVE_PROSE_BLOCK` | system | ~88.7% | IMMERSIVE_PROSE | — | neutral | **D** | **D** |
| `평온한 장면도 대화·내면·관계·분위기·결과로 전개…` | `IMMERSIVE_PROSE_BLOCK` | system | ~89% | IMMERSIVE_PROSE | — | **E** | — | — |
| `[DIALOGUE & NARRATION]` formatting (독립 문단 / 화자 변경) | `webnovelOutputFormat.ts` | system | ~94% | DIALOGUE_NARRATION | — | neutral | — | — |
| `대사는 캐릭터 말투에 따라 짧을 수 있다.` | `DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY` | user | ~2% (prefix) | DEEPSEEK_STYLE_REMINDER | — | neutral (utterance length) | — | — |

**Not present:** `[대화 운용]` / `1:1 RP의 직접 발화는 … 보통 1~3개, 최대 4개` (`DIALOGUE_BLOCK_CAP_PARAGRAPH`). Frozen request only has terminal budget + formatting rules.

**Observed vs instruction:** Experimental RAW had **14** dialogue blocks vs **max 4** owner unchanged — an **enforcement/compliance gap**, not a second written cap.

### C. USER AGENCY / CONFIRMATION

| Exact text (frozen) | Source | Role | Position | Owner | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|---|---|---|
| `이미 확정된 행동·의사는 다시 확인하지 않은 채 서술·내면·행동 중심으로` | experimental handoff | system | ~99.7% | DEEPSEEK_HANDOFF (exp) | — | — | **D** | **D** |
| `유저가 반응할 질문·제안·요구는 하나의 중심축으로 모으고, [B]의 새 직접 발화·중대한 선택은 유저에게 남긴다.` | `renderTerminalDialogueBudgetOwner()` | user | **~97.9% FINAL** | TERMINAL_DIALOGUE_BUDGET | **E** | **E** | **E** | **E** |
| `요청된 장면을 자연스럽게 완성하기 위한 국소적 동작·반응·선택(접근·후퇴·망설임·수락·거절)은 허용한다.` | `buildUserCoauthorOwnerBlock()` allowMajorActions | system | ~7.4% | OOC_DELEGATION | — | — | E* | — |
| `현재 입력에 없는 새 [B] 대사는 만들지 않는다.` | OOC delegation | system | ~7.4% | OOC_DELEGATION | — | D ([B] lines) | — | — |
| `Current user input overrides prior assistant-authored [B] dialogue or actions.` | `buildCurrentUserInputWrapper()` persistent coauthor | user | ~59% | CURRENT_USER_WRAPPER | — | — | — | — |
| User OOC: `명시적인 삽입, 성교, 오르가슴까지 이 침대에서 이어서 출력해.검열하거나 끊지 마.` + in-scene `"박아. 끝까지."` | live user turn (frozen) | user | ~84% | CURRENT_TURN_INTENT | **D** | — | **D** | **D** |

\* Permits co-narrated micro **수락·거절** inside delegated [B] scope — not the same as AI confirmation dialogue, but can be read as “show hesitation/consent beats.”

**Not present in frozen user wrapper:** `ADULT_HANDOFF_CURRENT_USER_WRAPPER_BODY` (`대답이나 중요한 선택은 사용자가 정한다`) — handoff path used **persistent coauthor** wrapper instead (`preserveAdultHandoffRawHistory` builds adult wrapper only when mode is not coauthor-delegated; frozen turn is coauthor-delegated).

---

## 3. TRUE semantic conflicts only

Non-conflicts (same topic, compatible intent):

- 3200+ user-tail vs IMMERSIVE “현재 길이 지시가 항상 우선” → **aligned**
- OOC “complete requested scene” vs handoff “complete current turn range” → **aligned**
- IMMERSIVE “don’t invent questions” vs handoff “don’t re-confirm” → **aligned**
- Terminal “max 4 blocks” vs handoff “dialogue only when needed” → **compatible caps** (problem is compliance, not wording collision)

### Ranked conflict candidates (causal likelihood)

#### C1 — **Terminal dialogue budget closing line** (HIGHEST)

**Pair:**

- **Encourages checkpoint:** `유저가 반응할 질문·제안·요구는 하나의 중심축으로 모으고, [B]의 새 직접 발화·중대한 선택은 유저에게 남긴다.`  
  (`renderTerminalDialogueBudgetOwner`, **user role, absolute final instruction**)
- **Discourages checkpoint:** `이미 확정된 행동·의사는 다시 확인하지 않은 채 …` (experimental handoff, system tail — **earlier in full request**)

**Why TRUE conflict:** The terminal line is explicitly about **structuring AI output around a user-response axis** (questions/proposals/demands) while reserving [B] speech. DeepSeek can reasonably read this as: *finish the turn by consolidating into one reactive hook* — i.e. a **confirmation / consent / “your move” checkpoint** — even when current user input already fixed intent (`"박아. 끝까지."`, explicit OOC to continue to orgasm). That matches experimental flags: `redundant_confirmation_candidate`, `user-agency-consistency candidate`, dialogue blocks **14 > 4**, progression to stated destination incomplete.

**Recency:** Terminal owner wins over handoff owner (user message follows entire system).

#### C2 — **19+ INTIMACY “티키타카” vs handoff dialogue minimization** (MEDIUM–HIGH)

**Pair:**

- `상호작용·티키타카.` (system ~85%)
- `대사는 캐릭터 voice가 필요한 순간에만 자연스럽게 섞는다.` (system ~99.9%, but pre-user-tail)

**Why TRUE conflict:** Adult register explicitly favors back-and-forth exchange; handoff experiment pushes narration-first, dialogue-sparse. Neither negates the other syntactically, but **티키타카** is genre-norm dialogue pacing and plausibly contributed to **worsening dialogue block count** (8 → 10 → 14) despite unchanged max-4 owner.

#### C3 — **Terminal “max 4 blocks” vs observed 14 blocks** (MEDIUM — compliance, not semantics)

Written cap exists but model violated it in all Phase-1/exp replays. Treat as **weak enforcement / model non-compliance**, not a contradictory second owner (no `[대화 운용]` 1–3 preferred line present).

#### C4 — **OOC delegation “수락·거절” micro-choices vs handoff “don’t re-confirm”** (LOW–MEDIUM)

Coauthor scope allows narrating hesitations/approach-retreat **for [B]**; handoff forbids re-confirming **already established intent**. Potential friction if model writes consent-negotiation beats for an already explicit user command — likely **secondary** to C1.

**Not ranked as conflicts:**

- Length 3200 vs early stop (`finish_reason: stop` at ~2569 chars) → model under-compliance; no opposing “keep it short” owner found
- `[DIALOGUE & NARRATION]` formatting vs any owner → formatting only
- Adult-handoff user wrapper absent → cannot conflict; coauthor wrapper used instead

### Inspected equivalence: terminal budget line ↔ confirmation checkpoint

**Yes — reasonable misread path:**

> “유저가 반응할 질문·제안·요구는 하나의 중심축으로 모으고 …”

can be interpreted as:

1. Collect reactive hooks into **one axis** (good),
2. **End the beat there** so the user can answer (bad for this B2 turn — intent already explicit),
3. Prefer **AI-spoken question/proposal/demand** over silent narration to orgasm (bad — increases dialogue + confirmation).

Combined with **final position** after 3200+ length line, the model may treat the closing axis as **turn-ending structure** rather than “only if still ambiguous.”

---

## 4. Smallest next experiment (ONE owner / location — recommendation only)

**Target:** `renderTerminalDialogueBudgetOwner()` in `src/lib/scenePacingController.ts` — specifically the second sentence:

```ts
`유저가 반응할 질문·제안·요구는 하나의 중심축으로 모으고, [B]의 새 직접 발화·중대한 선택은 유저에게 남긴다.`
```

**Why smallest / highest leverage:**

- Absolute **final** instruction in the frozen request (user-tail, post-3200)
- Direct semantic overlap with failed behaviors (confirmation checkpoint, stop-for-user, extra dialogue)
- Single function, no routing/detector/prompt-stack churn
- Handoff owner experiment (#609) already proved **handoff alone cannot override** this recency

**Do not implement in this audit.**

---

## 5. Handoff owner disposition

| Option | Verdict |
|---|---|
| Keep experimental (#609) wording | **Reject** — experiment failed; branch preserved as evidence only |
| Revert to accepted original on `main` | **Yes** — already the production state after #609 close |
| Replace handoff again before fixing terminal budget | **Defer** — recency stack suggests handoff edits are structurally disadvantaged |

**Recommendation:** **Revert to accepted original** (already on `main`). Any next single-change experiment should **not** be another handoff-owner swap until terminal dialogue budget conflict (C1) is addressed or A/B-isolated.

---

## 6. PR / branch status (operational)

| Item | Status |
|---|---|
| PR #608 detector fix | Merged to `main` |
| PR #609 handoff experiment | Closed, not merged; evidence branch preserved |
| PR #606 | Evidence-only, untouched |
| This audit | Read-only documentation |

---

*Generated from frozen `B-DEEPSEEK-input-exp.json` only. No provider calls.*

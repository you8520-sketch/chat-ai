# PROMPT / RUNTIME BEHAVIOR AUDIT — 2026-09-27

**Classification:** `AUDIT_COMPLETE` (no production prompt mutation)  
**EXACT MAIN:** `c127d3030f50d5b8214cf87b920bf44a5503d80c`  
**Branch:** `cursor/prompt-runtime-behavior-audit-cea0`  
**Artifacts:** `docs/audits/prompt-runtime-behavior-audit-2026-09-27/` (+ `/opt/cursor/artifacts/prompt-runtime-behavior-audit/`)

---

## EXACT MAIN / EXACT HEAD

| Ref | SHA |
|---|---|
| EXACT MAIN (audit base) | `c127d3030f50d5b8214cf87b920bf44a5503d80c` — Merge PR #1089 |
| Audit branch HEAD | see latest commit on this PR (docs/scripts only) |

Production prompt strings, adapters, routes, Railway flags, and model routing were **not** changed.

Proven on main (re-verified, not assumed from prior chat):

- Final assembly: `src/services/contextBuilder.ts` → `buildContext`
- Token audit: `src/services/promptAudit.ts`
- Dump path: `src/services/promptDebugDump.ts` (`PROMPT_DUMP_SOURCE=audit`)
- Prose routes: Legacy / VNext / Shared Novel V2 via `src/lib/proseStyleResolver.ts` (default **Legacy**, VNext/V2 env OFF)
- DeepSeek Main RP family: `isDeepSeekMainRpFamilyModel` = V4 Pro **OR** V4.1 Flash
- User-tail length owner: `USER_TAIL_LENGTH_OWNER_SENTENCE` (`src/lib/responseLength.ts`)

---

## ACTIVE MODEL INVENTORY

Source: `MAIN_RP_USER_SELECTABLE_OPTIONS` in `src/lib/chatModels.ts`. All 6 are user-selectable and runtime-active. No retired/hidden models called.

| model id | display | provider | selectable | active | prose route | DeepSeek family | model-specific production injections |
|---|---|---|---|---|---|---|---|
| `deepseek-v4-pro-0813` | DeepSeek V4 Pro | cheaperinference | yes | yes | **legacy** | yes | XML (`WORLD_LORE`/`LTM`/`CHAT_HISTORY`), style-only bottom reminder, appearance variation rule; length adapter env **OFF** |
| `deepseek-v4.1-flash` | DeepSeek V4.1 Flash | cheaperinference | yes | yes | **legacy** | yes | **Same prompt family as V4 Pro** (identical system SHA on fixture) |
| `gemini-3.1-pro-preview` | Gemini 3.1 Pro Preview | cheaperinference | yes | yes | **legacy** | no | `GEMINI31_USER_AGENCY_SUPPLEMENT` (~275 tok); layout dual-inject (shared) |
| `gemini-3.7-flash` | Gemini 3.7 Flash | cheaperinference | yes | yes | **legacy** | no | none beyond shared |
| `gpt-5.6-terra` | GPT-5.6 Terra | cheaperinference | yes | yes | **legacy** | no | none beyond shared (identical system SHA to 3.7 / Opus 5.5) |
| `claude-opus-5.5` | Claude Opus 5.5 | cheaperinference | yes | yes | **legacy** | no | none beyond shared |

**System SHA groups (quiet_intimacy fixture):**

- DeepSeek V4 Pro ≡ V4.1 Flash: `38f0862b…`
- Gemini 3.1 Pro: `37764fb8…` (agency supplement)
- Gemini 3.7 ≡ Terra ≡ Opus 5.5: `4552c5d1…`

**User-tail length owner:** all six inject `USER_TAIL_LENGTH_OWNER_SENTENCE` on the current user turn.

---

## BEFORE — actual prompt structure

### Shared (all Main RP / OpenRouter-compatible CI path)

Assembly order (tracked sections, fixture):

1. `openrouter-korean-prose-top` (~738 tok) — CANON/SCOPE/KNOWLEDGE + Korean
2. `runtime-prompt-contamination-guard` (~799–856)
3. `no-godmodding` / collaborative user control (~987; Gemini 3.1 ~1263 with agency)
4. `rule-historical-truth-canonical-memory` (~423)
5. `character-core-identity` (~711; DeepSeek ~761 with appearance rule)
6. `identity-and-rules` persona (~432)
7. `prose-style-xml-bundle` (~2364) — Legacy `PROSE_STYLE_SECTION` + adult/safe policy wrappers
8. `current-memory` (~58)
9. `narrative-style` (~133)
10. `rule-output-layout-recency` (~670)
11. `user-persona-reference-owner` (~717)

**Actual assembled system estimate (local `estimateTokens`):**

| model | system est | prose/style est | user-turn est |
|---|---:|---:|---:|
| DeepSeek V4 Pro / V4.1 Flash | 8300 | 3237 | 1479 |
| Gemini 3.1 Pro | 8320 | 3237 | 1161 |
| Gemini 3.7 / Terra / Opus 5.5 | 8044 | 3237 | 1161 |

DeepSeek user-turn delta ≈ **+318 tok** = `DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY`.

### DeepSeek XML note

`character-core-identity` is buffered into **`world_lore`** XML group (not `persona`) on this path, so `<PERSONA>` may be absent while `<WORLD_LORE>` / `<LONG_TERM_MEMORY>` / `<CHAT_HISTORY>` are present. Family gate is still `isDeepSeekMainRpFamilyModel`.

---

## RECEIPT TOKEN TRUTH

Admin receipt label: `시스템 프롬프트: ~N 입력 토큰 추정 배분`

| ID | Meaning | Source |
|---|---|---|
| **A** | Provider actual input tokens | `primaryStage.input` / provider `prompt_tokens` (canonical billable) |
| **B** | Receipt system row | `round((sysRulesEst / Σ sectionEsts) * A)` — **proportional allocation**, not a re-tokenize of system string |
| **C** | Actual assembled system estimate | `estimateTokens(final systemPrompt)` — **diet baseline** |
| **D** | systemRules category estimate | `promptAudit.breakdown.systemRules` |
| **E** | prose/style section estimate | subset of D matching prose/style bundle (~3237 on fixture; raw `PROSE_STYLE_SECTION` alone ≈1890; immersive block ≈1242) |
| **F** | Remaining sections | character + world + memory + persona + note + examples (+ history outside system) |

Code path:

1. `route.ts` sets `draftInput = primaryStage.input`, `sysRulesEst = promptAudit.breakdown.systemRules`
2. `buildEstimatedReceiptSectionBreakdown` (`billingReceiptSectionBreakdown.ts`) scales each `sectionEst` to `draftInput`
3. Method constant: `RECEIPT_ESTIMATED_ALLOCATION_METHOD = "estimated_section_allocation"`

**Do not treat B as provider per-section truth.** Prompt diet uses **C/D/E/F** inventory under `models/*/sections.json`.

If a live receipt shows “~7K system”, that is usually **B** (scaled share of A), which can exceed or undercut **C** depending on history/character weights.

---

## OWNER MAP

| Responsibility | Canonical owner (production) | Broken ONE-OWNER? |
|---|---|---|
| canon / integrity | OpenRouter top CANON/SCOPE/KNOWLEDGE + character-core-identity | OK |
| user agency | `[USER CONTROL — COLLABORATIVE INTERACTIVE]` | **Partial** — Gemini 3.1 adds body/intent supplement |
| character speech | SPEECH METADATA / speech lock / example dialog | OK (watch contamination guard overlap) |
| narration register | `[NARRATION REGISTER]` in prose style | **Dup** — DeepSeek style reminder also encodes -다/-했다 |
| prose style | `prose-style-xml-bundle` / Legacy `PROSE_STYLE_SECTION` | OK as slot; body is large |
| emotion presentation | `[IMMERSIVE PROSE]` | **Dup** — reminder + immersive both cover show-don't-tell / advance meaning |
| sensory / environment | `[SENSATION]` + immersive | mild overlap with reminder “감각·환경 변화” |
| inner thought | immersive (judgment-changing thoughts) | OK conceptually; wording long |
| repetition control | immersive + rhythm + DeepSeek reminder | **Dup** |
| dialogue behavior | immersive + DIALOGUE & NARRATION | OK split (content vs format) |
| scene pacing | SCENE FLOW + immersive advance rules | mild overlap |
| paragraph layout | system `[OUTPUT LAYOUT]` + user-tail compact line | **Intentional dual** (Gemini 3.1 A/B kept dual) |
| response length | `USER_TAIL_LENGTH_OWNER_SENTENCE` only | OK — DS SHORT_HISTORY/USER/REGEN **OFF** on production |
| regeneration | regen path + length owner (DS regen length block OFF) | OK |
| auto progression | godmodding mode switch | OK |
| model-specific recency adapter | DS style reminder; G31 agency | OK as adapters; DS reminder overlaps common prose |

---

## DEEPSEEK LEGACY AUDIT

**V4 Pro and V4.1 Flash share one prompt family** (`isDeepSeekMainRpFamilyModel`). Identical assembled system + user-turn on the audit fixture.

| Rule / artifact | Origin | Injected now? | Overlap with common? | Classification |
|---|---|---|---|---|
| XML PERSONA/WORLD_LORE/LTM/CHAT_HISTORY | DeepSeek structure | YES (family) — PERSONA may be empty; world/ltm/history yes | structure only | **KEEP_CANDIDATE** |
| `DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY` | style workaround | YES (user turn, ~318 tok) | High vs register/immersive/advance | **MERGE_INTO_COMMON_CANDIDATE** (or REMOVE after common rewrite + Gemini 3.1 parity check) |
| `DEEPSEEK_APPEARANCE_VARIATION_RULE` | appearance | YES (~50 tok in character canon) | low | **KEEP_CANDIDATE** (cheap) / **MODEL-ONLY** |
| `DEEPSEEK_LENGTH_SINGLE_CALL_BLOCK` | length | NO on production | — | **DEAD** (retained string) |
| `DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA` | length nudge | NO (production full mode uses style-only; length_stack_only canary only) | length owner | **EXPERIMENT_ONLY** / **REMOVE_CANDIDATE** from mental model |
| `DEEPSEEK_SHORT_USER_TURN_BLOCK` | length nudge | NO on production path | length owner | **EXPERIMENT_ONLY** |
| `DEEPSEEK_REGEN_LENGTH_BLOCK` | regen length | NO on production path | length owner | **EXPERIMENT_ONLY** |
| Opening scene remap | thin-history greeting | conditional (thin history + greeting) | — | **KEEP_CANDIDATE** |
| `SNPV2_DEEPSEEK_LENGTH_ARM` B/C adapter | experiment | OFF default | length | **EXPERIMENT_ONLY** |
| Compact future-instruction boundary | agency | always OFF (`shouldUse…` → false) | collaborative owner | **DEAD** |
| Future / retired Terra-Luna length adapters | — | gone | — | **DEAD** |

Past feedback themes (emotion under-show, inner-thought spam, repetition, weak environment) are **encoded in common immersive prose already**; the DeepSeek reminder largely **re-states** register + anti-fragment + advance-to-new-change. No live proof in this audit yet that the reminder is still required for V4.1 Flash / V4 Pro after a common rewrite — that is a **NEXT DECISION** gated on baseline + Gemini 3.1 preservation.

---

## PROSE DUPLICATION MAP

Evidence: `models/*/semantic-duplicate-scan.json` + section inventory. Semantics (not wording) that appear in **common prose AND DeepSeek user-tail reminder** (and often layout):

| Semantic | Owner section | Also in | Active models | Est. cost | Recency needed? |
|---|---|---|---|---|---|
| show emotion via behavior | IMMERSIVE PROSE | DS reminder (간접) | all + DS | inside ~1242 immersive | no if common kept |
| do not re-explain shown emotion | IMMERSIVE PROSE | — | all | same | no |
| avoid repetitive micro-action / fragment lines | RHYTHM + immersive | **DS reminder** | DS family | ~part of 318 | **questionable** |
| environment affects scene | SENSATION + immersive | DS reminder | DS family | overlap | questionable |
| inner thought → choice | immersive | — | all | — | keep one short line |
| dialogue reflects personality | immersive + speech | DS reminder (말투) | DS | overlap | speech owner enough? |
| advance to next meaningful change | immersive | **DS reminder** | DS | high overlap | merge |
| sensory specificity | SENSATION | immersive | all | — | keep short |
| Korean narration register | NARRATION REGISTER | **DS reminder** | DS | high overlap | merge |
| response length | USER_TAIL | — | all | ~181 | keep |
| layout blank-line dialogue | OUTPUT LAYOUT + user-tail line | — | all | 670 + 49 | intentional dual |

---

## MODEL BASELINE

Live capture: `scripts/audit-prompt-runtime-behavior-baseline-live.ts`  
Fixtures: `quiet_intimacy`, `casual_banter`, `tension_action`  
**18/18 captures OK** after Gemini 3.1 quiet_intimacy retry.

| fixture | DeepSeek V4 Pro | V4.1 Flash | Gemini 3.1 Pro | Gemini 3.7 | Terra | Opus 5.5 |
|---|---:|---:|---:|---:|---:|---:|
| quiet_intimacy chars | 600 | 2131 | **3999** | 1390 | 2549 | 2532 |
| casual_banter chars | 1220 | 1029 | **2870** | 2114 | 3547 | 2870 |
| tension_action chars | 1657 | 2121 | **3724** | 1540 | 2803 | 2831 |
| provider prompt_tok (quiet) | 6414 | 6415 | 5493 | 5336 | 5459 | 8971 |

Gemini 3.1 Pro = **preservation reference** (not a fix target). Cursor assigns **no quality scores**. Objective annotation table: `BASELINE_SUMMARY.md`. Raw outputs: `baseline/<fixture>/<model>/raw.txt`.

Provider actual input (A) vs local system estimate (C≈8044–8320): A is lower for Gemini/Terra (~5.3–5.5k) and DeepSeek (~6.3–6.4k); Opus A≈8.8–9.0k. Receipt system row (B) scales local `systemRules` weight onto A — do not equate B with C.

---

## PROMPT DIET CANDIDATES

| ID | Item | Class | Est. saving (local tok) | Notes |
|---|---|---|---:|---|
| D1 | Compact Legacy `PROSE_STYLE_SECTION` / immersive into short positive common contract | **MERGE** → future MUST KEEP core | **~800–1500** if body shrinks from ~1890→~400–600 without meaning loss | Design only this PR |
| D2 | DeepSeek style-only reminder | **MERGE_INTO_COMMON** or **REMOVE** after parity | **~318** per DS turn | Only if Gemini 3.1 + DS baselines still match intent |
| D3 | DeepSeek SHORT_*/REGEN/SINGLE_CALL strings | **FOLLOW-UP** / dead code cleanup | 0 runtime (already OFF) | Do not confuse with production diet |
| D4 | Appearance variation rule | **MODEL-ONLY KEEP** | 0 (or keep 50) | Cheap; DS-specific |
| D5 | Gemini 3.1 agency supplement | **MODEL-ONLY KEEP** | 0 | Preservation-critical boundary |
| D6 | OUTPUT LAYOUT examples Wrong/Right | **FOLLOW-UP** | ~50–150 | layout owner; separate from prose diet |
| D7 | Dual layout system+user-tail | **KEEP** (intentional) | 0 | Gemini 3.1 A/B already failed terminal-only |
| D8 | Contamination guard / korean top | **MUST KEEP** / FOLLOW-UP | — | out of prose diet scope |
| D9 | Length USER_TAIL | **MUST KEEP** | 0 | invariant |

---

## TOKEN SAVING OPPORTUNITY

| Model | CURRENT system est | prose/style | DS reminder (user) | G31 agency | Safe merge (prose compact) | Model-specific removal candidate | Likely common replacement |
|---|---:|---:|---:|---:|---:|---:|---:|
| DeepSeek V4 Pro / Flash | 8300 | 3237 | 318 | 0 | 800–1500 | 318 (reminder) if proven redundant | replace immersive+reminder with ~400–600 common |
| Gemini 3.1 Pro | 8320 | 3237 | 0 | 275 | 800–1500 | **0** (keep agency) | same common; keep agency adapter |
| Gemini 3.7 / Terra / Opus | 8044 | 3237 | 0 | 0 | 800–1500 | 0 | same common |

**Can common prose land near “hundreds of tokens”?** Design option below targets ~400–600 for the shared prose owner **without** deleting agency/canon/layout/length. Full system will still be multi-k because of canon, agency, layout, Korean top, contamination guard.

---

## COMMON PROSE CONTRACT DESIGN (not applied)

Positive, short, single owner — **design only**:

```text
[COMMON PROSE]
현재 장면과 인물의 체험에 밀착해 쓴다.
감정·관계는 표정·시선·호흡·습관·접촉·거리·행동·대사·선택으로 드러낸다.
내면은 지금 판단이나 행동을 바꾸는 만큼만 쓴다.
공간·빛·소리·온도·외관은 장면과 인물 반응에 실제로 작용할 때만 구체화한다.
이미 전달된 의미는 반복 해설하지 않고, 다음 반응·행동·관계 변화로 옮긴다.
대사는 이 캐릭터가 이 상대에게 할 법한 말로 개성을 유지한다.
지문은 해체(-다/-했다)로 이어 쓰고, 같은 순간의 관련 반응은 자연스럽게 한 흐름으로 연결한다.
```

No few-shot. No long negative list. Model adapters only where this contract fails (expected: Gemini 3.1 agency stays; DeepSeek reminder becomes the first removal candidate after parity).

---

## PRESERVED INVARIANTS

- Gemini 3.1 Pro current prose behavior (reference baseline)
- Character canon / speech / memory-knowledge boundary
- User agency / no-godmodding
- Korean narration register
- Dialogue/narration layout
- Response length owner (user-tail)
- Regen divergence, auto progression
- Billing, routing, provider behavior

---

## NEXT DECISION NEEDED (GPT / user)

1. **Accept Gemini 3.1 quiet/banter/tension baseline as freeze reference?**
2. **DeepSeek style reminder:** keep as MODEL-ONLY, merge into common, or remove-after-parity?
3. **Common prose rewrite scope:** immersive+register only, or also SENSATION/WEBNOVEL BREATH/SCENE FLOW?
4. **Target common prose token band:** ~400 / ~600 / keep ~1890 with light dedupe only?
5. **Dead DeepSeek length blocks:** delete in a follow-up hygiene PR, or leave?

Recommended first diet PR (if baselines look good): **common prose compact + DeepSeek reminder removal A/B**, Gemini 3.1 agency untouched, layout/length untouched.

---

## FINAL CLASSIFICATION

**AUDIT_COMPLETE**

(Not `ROOT_CAUSE_FIXED` — production prompts unchanged.)

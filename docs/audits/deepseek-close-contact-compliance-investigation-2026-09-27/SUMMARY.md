# DeepSeek close-contact style compliance — bugfix investigation

**Date:** 2026-09-27  
**Human classification (PR #1124):** `DEEPSEEK_STYLE_COMPLIANCE_GAP`  
**Focus:** Snapshot B (`SNAPSHOT_B_T2`), real PR620 capsule (라이크 / 렌)  
**New provider calls:** **0**

## Git

| | SHA |
|--|-----|
| **EXACT MAIN** | `7a7ba46a9222f828fbdab6ce2b9d166ec4f604ed` |
| **EXACT HEAD** | _(branch commit)_ |
| **BEHIND_MAIN** | 0 |
| **PRODUCTION DIFF (`src/`)** | **0** — investigation docs + audit scripts only |

## BEFORE — confirmed baseline

- Canonical raw: `docs/audits/pr620-real-capsule-quality-verification-2026-09-27/review-packet/`
- Failing style samples: **DeepSeek B-r1, B-r3** (recap, micro-action loop, explanation-after-showing, relationship stall)
- Healthier same-model counterexample: **DeepSeek B-r2**
- Snapshot A DeepSeek: generally healthy (not global DeepSeek failure)

## PROBLEM (symptoms only)

On close-contact / relationship-transition beat (T2 user already includes kiss + “말 돌리지 마”):

| Pattern | B-r1 / B-r3 | B-r2 |
|---------|-------------|------|
| POST_EVENT_RECAP | Strong | Low |
| MICRO_ACTION_LOOP | Present | Absent |
| EXPLANATION_AFTER_SHOWING | Present | Mild |
| RELATIONSHIP_STALL | Question loops | Advances (“이 다음은”) |
| SEMANTIC_REPETITION | “쳐다본 이유” loops | Tighter |

Gemini 3.7 on same capsule: different defect profile (ornate setup, guidespeak physiology) — **not** gold standard; recorded as separate shared-quality follow-up.

## OWNER MAP (current main, Snapshot B wire)

Deterministic re-build: `npx tsx scripts/investigate-deepseek-snapshot-b-wire.ts`  
Artifacts: [`OWNER_MAP.json`](OWNER_MAP.json), [`WIRE_DELTA.md`](WIRE_DELTA.md)

### Re-verified (not trusting PR #1124 alone)

| Check | Result |
|-------|--------|
| `[COMMON PROSE]` count | **1** (DeepSeek + Gemini; prefix `7d9992715736`) |
| DeepSeek bottom style reminder | **inactive** |
| DeepSeek combined style+length reminder | **inactive** |
| `[DEEPSEEK LENGTH — SINGLE CALL]` | **inactive** |

### Section inventory (DeepSeek system — tracked)

| Section id | Role (summary) | Generator |
|------------|------------------|-----------|
| `openrouter-korean-prose-top` | Shared Korean prose top | `contextBuilder.ts` |
| `runtime-prompt-contamination-guard` | Anti-contamination | `contextBuilder.ts` |
| `no-godmodding` | User agency | `contextBuilder.ts` |
| `rule-historical-truth-canonical-memory` | Memory truth | `contextBuilder.ts` |
| `character-core-identity` | Full 라이크 canon (~10k chars) | PR620 dump → buildContext |
| `private-speech-control` | Speech register | PR620 dump |
| `identity-and-rules` / persona | 렌 persona block | PR620 dump |
| `prose-style-xml-bundle` | **[COMMON PROSE]** + layout | `advancedProseNsfwGuidelines.ts` |
| `narrative-style` | POV/narration | `contextBuilder.ts` |
| `rule-output-layout-recency` | Layout owner | `contextBuilder.ts` |
| `user-persona-reference-owner` | Persona reference | `contextBuilder.ts` |
| `narrative-pov-owner` | POV owner | `contextBuilder.ts` |

User tail: `wrapCurrentUserInput` + terminal length owner (`appendCompactTerminalLengthToUserTurn`) — numeric length **not** changed in this investigation.

## DEEPSEEK-ONLY WIRE DELTA (vs Gemini 3.7, same capsule)

| | DeepSeek | Gemini 3.7 |
|--|----------|------------|
| System SHA | `9553f557…` | `50fa7c8a…` |
| Last user SHA | differs | differs |
| Message roles | system + 5-turn history + user | same sequence |
| Opening peel on B | **Yes** — `[OPENING SCENE CONTEXT]` prepended to last user when thin-history predicate fires | N/A |

DeepSeek-specific on Snapshot B (from [`OWNER_MAP.json`](OWNER_MAP.json)):

- **Opening/history remap active:** synthetic `[채팅 시작]`+greeting peeled; greeting re-injected as `[OPENING SCENE CONTEXT — ALREADY OCCURRED]` on **current user turn** (see `deepseekOpeningSceneContext.ts`, `contextBuilder.ts` ~1331–1419).
- **Full T1 assistant (~3473 chars)** remains in conversational history (includes post-meal intimacy setup).
- **T2 user RAW** already narrates kiss + dialogue lines (see capsule `raw/T2-USER_RAW.txt`).

→ **Duplicate semantic scene material** (opening context block + long T1 assistant + explicit T2 user beat) is **identical for every DeepSeek B provider call**. It does **not** differ between r1, r2, and r3.

## FAILING r1/r3 vs HEALTHY r2 — counterexample

### Provider request parity (decisive)

From PR #1124 meta (`review-packet/meta/SNAPSHOT_B_T2/deepseek-v4-pro-0813/r{1,2,3}.json`):

```
promptHash r1 = r2 = r3 = 9553f557fe831a13e80853bdba8a14895573c6ff87de274e8b9d4fe8e640ddee
```

Recomputed on current main (`investigate-deepseek-snapshot-b-wire.ts`):

- DeepSeek **system SHA** = `9553f557…` — **matches** all three live reps.

**Conclusion:** `same request → stochastic compliance variance` between healthy r2 and unhealthy r1/r3. **Not** a per-rep wiring or ordering bug.

## ROOT CAUSE (investigation taxonomy §10)

**Primary:** **`MODEL_COMPLIANCE_VARIANCE` (D)**

**Not established (insufficient rep-specific evidence):**

- `DEEPSEEK_ADAPTER_ORDERING_ROOT_CAUSE` — ordering differs vs Gemini but is **constant** across B-r1/r2/r3.
- `DEEPSEEK_HISTORY_TRANSFORM_ROOT_CAUSE` — opening peel + history layout may raise recap **risk** for all reps equally; cannot explain r2 alone.
- `DEEPSEEK_DUPLICATE_SEMANTIC_CONTEXT` — structural (C) — kiss/intimacy beat present in history, opening context, and current user; **shared across all B calls**; logged as **risk factor**, not r1/r3-specific root cause.

## ROOT CAUSE RELATIONSHIP (§29 — three axes)

| Axis | Finding |
|------|---------|
| **A. DEEPSEEK_CLOSE_CONTACT_COMPLIANCE** | Symptom cluster on B-r1/r3; **same wire** as B-r2 → model stochasticity |
| **B. CANON_TO_PROSE_LEAKAGE** | Large always-on `character-core-identity`; Gemini B shows appearance/grade bundles; DeepSeek A often binds facts to action — **separate follow-up** (relevance/duplication), not patched here |
| **C. EMOTIONAL_DEPTH_IMBALANCE** | B-r1/r3: **EMOTIONAL_OVEREXPLANATION**; B-r2: more **SCENE-BOUND** dialogue; Gemini B: **PHYSIOLOGY_DISPLACES_EMOTION** on r1/r3 |

**Relationship:** **Separate root causes** — compliance variance (A) vs canon leakage (B) vs emotional imbalance (C). **No single owner proved** for A beyond model behavior at fixed wire.

## CANON LEAKAGE MAP (sample highlights)

| Output fact (examples) | Source owner | Scene necessity | Render mode |
|------------------------|--------------|-----------------|-------------|
| 피어싱 / 검은 네일 in contact | character-core-identity | MED | CHARACTER_ACTION (healthy when tied to touch) |
| “S급 특수계 센티넬” / 188cm | character-core-identity | LOW in kiss beat | CANON_EXPOSITION (Gemini B-r1/r3) |
| 가이딩 파동 / 도파민 / 교감신경 | world + identity + model habit | LOW for “why this moment matters” | PROMPT_PARAPHRASE / PHYSIOLOGY_DISPLACES_EMOTION (Gemini) |
| “겁 없음 / 경계 없음” | persona + scene | MED if shown by action | PERSONA_BEHAVIOR_NATURALIZATION vs PERSONA_TRAIT_NARRATOR_EXPLANATION (Gemini A/B openings) |

Full raw paths: `review-packet/raw/SNAPSHOT_B_T2/**`

## PERSONA LEAKAGE MAP (렌)

| Mode | Example |
|------|---------|
| **PERSONA_BEHAVIOR_NATURALIZATION** | T2 user RAW — rend grabs jacket, steps to bed (capsule source) |
| **PERSONA_TRAIT_NARRATOR_EXPLANATION** | Gemini prose explaining “위축감 없음” (review-packet STYLE matrix) |
| **PERSONA_PROMPT_PARAPHRASE** | Rare in DeepSeek B-r2; more in Gemini ornate intros |

## EMOTIONAL DEPTH (Snapshot B)

| Sample | Assessment |
|--------|------------|
| DeepSeek B-r2 | **HEALTHY** — scene-bound banter + next-step question |
| DeepSeek B-r1/r3 | **OVEREXPLAINED** — emotional explanation redundancy after shown kiss |
| Gemini B-r1/r3 | **PHYSIOLOGY_DISPLACES_EMOTION** + ornate setup |
| DeepSeek A* | Mostly **HEALTHY** action-led (not regressed in investigation) |

## PATCH POLICY RESULT

**No production patch.** Stochastic compliance at identical wire does not meet A/B/C code-evidence bar (§11–12). Prompt stack expansion (COMMON PROSE bans, new DeepSeek paragraph) **explicitly rejected** — would risk Snapshot A 티키타카.

## AFTER / REMOVED / PRESERVED

| | |
|--|--|
| **AFTER** | Same as BEFORE (no `src/` change) |
| **REMOVED** | — |
| **PRESERVED** | COMMON PROSE ×1, USER_TAIL length owner, adapters, 3200+ target, single-call policy |

## REGRESSION RISKS (if a future patch were attempted)

- Opening peel + `[OPENING SCENE CONTEXT]` interaction with long T1 history
- Over-correction harming DeepSeek A-r2/r3 domestic scenes
- Global canon trimming breaking legitimate S급/appearance beats in action

## PROOF

- [`PR1124_PROMPT_HASH_PARITY.json`](PR1124_PROMPT_HASH_PARITY.json)
- [`OWNER_MAP.json`](OWNER_MAP.json) — wire hash match to live run
- Manual style matrix: `review-packet/STYLE_OCCURRENCE_MATRIX.json`

## CLASSIFICATION (PR outcome)

**`ROOT_CAUSE_UNCONFIRMED`** for code defect / mandatory fix  
**Operational explanation for r1 vs r3 vs r2:** **`MODEL_COMPLIANCE_VARIANCE`** at identical provider-bound request.

**PRODUCTION DIFF = 0** — STOP; GPT/user judge whether average DeepSeek close-contact quality is acceptable without prompt changes.

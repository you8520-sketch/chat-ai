# AR0 — ACTIVE Retrieval Patch (AR-A3 + B1 + B2)

> Phase **AR0 → PATCH**. Implementation of the approved AR0 verdict ("READY FOR ACTIVE RETRIEVAL PATCH").
> **One patch, three components**: AR-A3 (gated recent-context bridge), B1 (knowledge-boundary bucket filter), B2 (minimal stopword guard).
> DeepSeek canary only. No commit / push / PR / deploy. All artifacts under `data/ar0/`.
> Reproduce replay: `node --conditions=react-server --import tsx data/ar0/main.ts`
> Reproduce deterministic tests: `node --conditions=react-server --import tsx --test src/lib/canonPlan/activeSelector.arPatch.test.ts`

---

## 1. Changed files

| file | status | change |
|------|--------|--------|
| `src/lib/canonPlan/activeSelector.ts` | modified (untracked, new from AR0) | AR-A3 gate + recent-context bridge; B1 bucket filter; B2 stopword guard; observability fields |
| `src/services/contextBuilder.ts` | modified (tracked, M) | wire `recentContext` + `recentTurns` (last-4 slice) into `selectActiveCanonChunks` |
| `src/lib/canonPlan/activeSelector.arPatch.test.ts` | new | deterministic tests A–M (17 tests) |
| `src/lib/canonPlan/compiler.test.ts` | modified (untracked) | B1-compliant cue for "selects dormant"; added B1 sibling test |
| `src/lib/canonPlan/canonInjectionB2.test.ts` | modified (untracked) | converted "ACTIVE surfaces dormant" → B1 payload test (player sentinel NOT surfaced) |
| `data/ar0/candidates.ts` | modified (untracked) | added `selArA3Patch` (AR-A3 + B1 + B2) to harness |
| `data/ar0/replay-core.ts` | modified (untracked) | added `eligibleActiveChunksB1`, `filterActiveKeywords` helpers |
| `data/ar0/main.ts` | modified (untracked) | production-equivalence cross-check vs `selArA3Patch`; AR-A3Patch metrics |
| `data/ar0/metrics.json` | regenerated | locked patched metrics |
| `data/ar0/_canary.ts`, `_canary-result.json` | new | live DeepSeek canary (3 calls) |

**Frozen components — NOT touched:** LENGTH, Terminal, Scene Engine, prose prompt, Canon compiler, CORE classification, Archive selector, Momentum. `activeMaxChars` still 1200. Threshold/scoring baseline unchanged. Muse/Gemini/HY3 behavior unchanged. Master kill switch unchanged.

## 2. Exact AR-A3 implementation

The production selector `selectActiveCanonChunks` (`src/lib/canonPlan/activeSelector.ts`) now:

1. Extracts **current-user keywords** (primary evidence) via `extractKeywords`, then applies **B2** stopword guard (`filterActiveKeywords` drops `이름`, `하고`).
2. Extracts **recent-context keywords** (bridge evidence) from `input.recentContext` (bounded last-4 scene turns, joined as a string), applies B2, and **dedupes against current** (`recentKw = recentKwAll.filter(k => !currentSet.has(k))`).
3. Computes **eligibility** via `eligibleActiveChunks` = non-CORE chunks **minus B1-restricted buckets** (`player`, `scenario_meta`).
4. Computes the **AR-A3 gate**: `gateOn = canonMatch || action || question` where
   - `canonMatch = eligible.some(c => scoreChunkRelevance(c, currentUserKw) > 0)`
   - `action = ACTION_MARKERS.some(m => userMessage.includes(m))`
   - `question = hasOpenQuestion(userMessage, recentTurns)`
5. Scores each eligible chunk:
   - `currentScore = scoreChunkRelevance(chunk, currentUserKw)` (body +2 / title +1, Korean-loose)
   - `recentScore` (only if `gateOn`): `+1` per `recentKw` hit via `koreanLooseTokenHit`
   - `gate = currentScore > 0 || (gateOn && recentScore >= 2)`
   - `finalScore = gate ? (currentScore + recentScore) : 0`
6. Picks by score (desc), then `order`, then `id`, under the 1200-char budget.

This is **byte-identical** to the audited `selArA3Patch` in `data/ar0/candidates.ts` (verified by the production-equivalence cross-check, section 23).

## 3. Recent-context source / bounds

- **Source:** `input.shortTermHistory` (structured `{role, content}[]` from the chat turn) at the `pushActiveCanon` call site in `src/services/contextBuilder.ts`.
- **Bound:** `shortTermHistory.slice(-4)` — the same last-4 slice already used by the D1.1 archive selector and the user-note RAG. Two derived values are passed:
  - `recentContext` (string): last-4 contents, trimmed, non-empty, joined with `\n`.
  - `recentTurns` (structured): last-4 `{role, content}` with non-empty content.
- **Usage:** recent context is used **ONLY for ACTIVE scoring** (as a gated bridge). It is **never injected into the prompt**. The current user message remains the primary scoring source; recent context contributes nothing unless the AR-A3 gate fires.
- `hasOpenQuestion` searches `recentTurns` (bounded last-4) for the open-question check, matching the `recentContext` window exactly.

## 4. Exact gate logic

```text
gateOn = canonMatch || action || question
  canonMatch = eligible.some(c => scoreChunkRelevance(c, currentUserKw) > 0)
  action     = ACTION_MARKERS.some(m => userMessage.includes(m))
  question   = hasOpenQuestion(userMessage, recentTurns)

per eligible chunk:
  recentScore = gateOn ? count(koreanLooseTokenHit(chunk.text, k) for k in recentKw) : 0
  gate  = currentScore > 0 || (gateOn && recentScore >= 2)
  finalScore = gate ? (currentScore + recentScore) : 0
```

- **CURRENT_CANON_MATCH**: the current cue already names canon lore → the bridge is safe to fire (recent context can only *add* adjacent lore, never reactivate dormant lore on its own).
- **ACTION_MARKER**: the cue signals an active scene (combat/movement verbs) → bridge fires.
- **OPEN_QUESTION**: the cue/recent turns contain a question marker → bridge fires.
- **NONE**: quiet scene → bridge does NOT fire; recent context contributes nothing; only current-canon matches are selected (and if there are none, ACTIVE=0).

The `>= 2` recent-hit threshold prevents a single loose token from surfacing a dormant chunk — a chunk must be bridged by **two or more** distinct recent keywords (or already match the current cue).

## 5. B1 bucket boundary

```typescript
const ACTIVE_RESTRICTED_BUCKETS = new Set(["player", "scenario_meta"]);
function eligibleActiveChunks(plan) {
  const coreSet = new Set(plan.coreIds);
  return plan.chunks.filter(
    (c) => !coreSet.has(c.id) && c.salience !== "core" && !ACTIVE_RESTRICTED_BUCKETS.has(c.bucket)
  );
}
```

- Applied at the **eligibility stage, before scoring** — excluded chunks can never be scored or selected by ACTIVE.
- **Rationale (knowledge boundary):** `player`-bucket chunks are facts *only the user* knows; `scenario_meta`-bucket chunks are system/plot triggers. The character must not "know" these, so ACTIVE (which feeds the character's in-scene awareness) must not surface them. CORE already excludes them; B1 extends the same boundary to ACTIVE.
- Allowed buckets (`character`, `world`) remain fully selectable when the cue matches.
- **Impact on Enoch-active (fixture A):** zero — A has no `player`/`scenario_meta` chunks. Impact is on fixtures that contain player/scenario_meta lore (verified by test H + compiler.test.ts B1 sibling + canonInjectionB2 B1 payload test).

## 6. B2 stopword guard

```typescript
const ACTIVE_STOPWORDS = new Set(["이름", "하고"]);
function filterActiveKeywords(kw: string[]): string[] {
  return kw.filter((k) => !ACTIVE_STOPWORDS.has(k));
}
```

- Applied to **ACTIVE keyword sets only** (currentUserKw and recentKw). The shared production `extractKeywords` is untouched, so **Archive is not affected**.
- **Only the two AR0-confirmed true false positives:**
  - `이름` — matches the title-only `[이름]` chunk (a segmentation artifact), inflating A's selection with a non-lore chunk.
  - `하고` — a 2-char verb ending that matches `c262ae60` "재구성**하고**" and `7e027c28` "호흡**하고**" on quiet fixtures, causing the H old-history-noise regression (qfp=1).
- No giant stopword dictionary, no morphology, no new linguistic dependencies. Just these two tokens.

## 7. Current selector before / after

**Before (current, pre-patch):** `selectActiveCanonChunks({ plan, userMessage })` — scored only on current-user keywords (`scoreChunkRelevance > 0`), no recent context, no bucket filter, no stopword guard. Eligibility = non-CORE only.

**After (patched):** adds (a) recent-context bridge gated by `canonMatch || action || question`, (b) B1 bucket exclusion at eligibility, (c) B2 stopword removal from ACTIVE keywords. The current-user scoring path is unchanged — a chunk that matched the current cue before still matches and still selects (gate = currentScore > 0 is independent of gateOn). So **no current-cue match is lost**; the patch only *adds* bridge-recoverable lore and *removes* player/scenario_meta + generic-token false positives.

## 8. Enoch required-14 breakdown

Fixture A (`A-enoch-active`) has **requiredTotal = 14** (legacy exact-substring ground truth from D2 LIVE). Under the **audited semantic** ground truth, 6 more chunks are re-flagged as relevant → **semantic requiredTotal = 20**.

The 14 legacy required chunks, by selection status under PATCH:
- **Selected by PATCH (10):** the 6 current already hit + 4 bridge-recovered (`c1861925`, `3d7ab00d`, `b62b7f08`, `a733714f` — root-cause A/B bridge-recoverable).
- **Missed by PATCH (4):**
  - `ee399939833ce695` — [외형] character/**CORE** ("목 뒤에 실패한 브레인 포드 접촉 흔적…") → CORE-covered, not ACTIVE's job.
  - `db07a9e9f30c8ab3` — [불변의 세계법칙] world/**dormant** ("총성은 죽음을 부른다") → genuine vocab miss: cue says "쏘아야 해" but canon says "총성/죽음"; not bridge-recoverable (recent context has no "총성").
  - `7eee83a1c67330b5`, `bb2f3a654d5e8927` — **title-only segmentation artifacts** (backlog L1).

> **Correction to the AR0 report:** AR0 REPORT.md counted "2 CORE-covered" required. The deterministic test caught this: only **1** required chunk is CORE-covered (`ee399939833ce695`). `db07a9e9f30c8ab3` is **dormant world**, a genuine vocab miss — not CORE. This is noted explicitly per the user's instruction (no silent divergence).

## 9. CORE-covered vs true ACTIVE required

Of the 14 legacy required:
- **1 CORE-covered** (`ee399939833ce695`, [외형]) — not ACTIVE's responsibility; surfaced by the CORE block, not ACTIVE.
- **13 ACTIVE-responsibility** — these are what ACTIVE must surface. PATCH hits 10 of 13 (the 4 misses are 1 vocab-miss + 2 title-only segmentation artifacts + ... wait, 13 ACTIVE-responsibility, PATCH hits 10, misses 3: `db07a9e9f30c8ab3` vocab-miss + `7eee83a1c67330b5` + `bb2f3a654d5e8927` title-only).

So: 1 CORE-covered + 3 true ACTIVE misses = 4 total missed. PATCH recovers 4 of the 8 current misses (the bridge-recoverable ones); the other 4 are 1 CORE + 1 vocab + 2 segmentation — none bridge-recoverable, so PATCH is at the deterministic ceiling for fixture A.

## 10. True misses before / after

**Before (current):** 8 missed of 14 → `ee399939833ce695` (CORE), `db07a9e9f30c8ab3` (vocab), `c1861925`, `3d7ab00d`, `b62b7f08`, `a733714f` (bridge-recoverable), `7eee83a1c67330b5`, `bb2f3a654d5e8927` (segmentation).

**After (PATCH):** 4 missed of 14 → `ee399939833ce695` (CORE, not ACTIVE's job), `db07a9e9f30c8ab3` (vocab miss, not bridge-recoverable), `7eee83a1c67330b5` + `bb2f3a654d5e8927` (title-only segmentation artifacts, backlog L1).

The 4 bridge-recoverable misses (`c1861925`, `3d7ab00d`, `b62b7f08`, `a733714f`) are **recovered** by AR-A3's gated recent-context bridge. The remaining 4 are not bridge-recoverable by design.

## 11. True false positives before / after

"True false positive" = a chunk selected purely via a **generic token** (not scene-relevant lore). Distinguished from "breadth" (canon-adjacent lore not in the required set — a precision tradeoff, not a false positive).

**Before (current):**
- Fixture A: `2a49840e` "[이름]" — selected via the generic token `이름` matching the title-only `[이름]` chunk. (1 generic-token FP)
- Fixture H (old-history-noise): a chunk selected via `하고` (qfp=1) — the cue "아무것도 안 하고 있어" falsely matched "재구성하고"/"호흡하고". (1 generic-token FP)
- Quiet fixtures B/F: 0 (current already ACTIVE=0).

**After (PATCH):** B2 removes `이름` and `하고` from ACTIVE keywords →
- Fixture A: `2a49840e` "[이름]" **removed** (no longer selected). 0 generic-token FPs.
- Fixture H: ACTIVE=0 (qfp 1→0, precision 0→1). 0 generic-token FPs.
- All other fixtures: 0 generic-token FPs.

**Breadth (canon-adjacent, not in required set) — NOT false positives:** PATCH adds 8 such chunks on fixture A via the recent bridge (see section 13). These are canon lore adjacent to the scene, not generic-token noise. This is the accepted AR-A3 breadth/precision tradeoff (recall gain valued over precision; precision is not a hard gate per AR0 verdict).

## 12. Legacy recall / precision (exact-substring ground truth)

Fixture A (`A-enoch-active`), requiredTotal = 14:

| candidate | selected | required hit | missed | recall | irrelevant | precision |
|-----------|----------|--------------|--------|--------|-----------|-----------|
| current (before) | 13 | 6 | 8 | 0.43 | 7 | 0.46 |
| **PATCH (after)** | **24** | **10** | **4** | **0.71** | **14** | **0.42** |

- **Recall 0.43 → 0.71** (+4 bridge-recoverable recovered).
- **Precision 0.46 → 0.42** (measured drop: PATCH selects 11 more chunks, of which 8 are legacy-irrelevant). This measured drop is partly a ground-truth under-flag artifact (see section 13).

## 13. Audited semantic recall / precision (BOTH reported — ground truth NOT silently swapped)

The legacy exact-substring ground truth under-flags 6 semantically-relevant chunks (AR0 section 4): `926ef63ca74f1bd4`, `e58c044092111815`, `096c90c68449f465`, `227a351e649849a2`, `5baae1e75d358979`, `5440255a267c51ca` (기생종 infection signs, 브레인 포드 entity, 침묵 규약 hide-rule). Audited semantic requiredTotal = **20**.

| candidate | selected | semantic hit | semantic missed | semantic recall | true-irrelevant | semantic precision |
|-----------|----------|--------------|-----------------|------------------|-----------------|--------------------|
| current (before) | 13 | 12 | 8 | 0.60 | 1 | 0.92 |
| **PATCH (after)** | **24** | **16** | **4** | **0.80** | **8** | **0.67** |

- **Semantic recall 0.60 → 0.80** (+4 legacy-required recovered; the 6 semantic chunks were already selected by current, so the bridge gain is the 4 legacy-required).
- **Semantic precision 0.92 → 0.67** (real drop). PATCH adds 11 chunks vs current; 4 are legacy-required (good), 6 are the already-selected semantic chunks (no change), and **8 are canon-adjacent but not-in-required-20** (true-semantic-irrelevant breadth).

> **Honest correction to the AR0 report:** AR0 REPORT.md claimed "true irrelevant added by AR-A3 ≈ 1". The deterministic re-computation shows PATCH adds **8** true-semantic-irrelevant (canon-adjacent) chunks on fixture A, not 1. The AR0 figure conflated *current's* irrelevant (7 = 6 semantic + 1 generic FP) with *AR-A3's added* irrelevant. The correct picture: PATCH's 8 breadth chunks are canon lore adjacent to the active scene (selected via the gated recent bridge), not generic-token noise. This is the accepted AR-A3 breadth/precision tradeoff — reported honestly here, not silently swapped.

## 14. Quiet ACTIVE=0 tests

Deterministic tests (activeSelector.arPatch.test.ts) confirm `selected=0` for quiet scenes:

| fixture | gate reason | ACTIVE selected | recentContextUsed | result |
|---------|-------------|-----------------|--------------------|--------|
| D. Enoch-clean quiet | NONE | 0 | false | PASS |
| F. True unrelated quiet | OPEN_QUESTION (soft marker) | 0 | false | PASS — gate may fire on a soft question marker, but nothing bridges above threshold → ACTIVE=0, recent context did not contribute |
| B. Modern quiet | NONE | 0 | false | PASS |
| H. Old-history-noise (B2) | NONE | 0 | false | PASS — B2 removed `하고` → cue truly quiet → ACTIVE=0 (was 2/qfp=1 before) |

`selected=0` remains valid for quiet scenes (no fallback to FULL). The AR-A3 gate firing on a soft question marker (fixture F) does NOT force a selection — it only *enables* the bridge, which still requires `recentScore >= 2` to surface anything.

## 15. Knowledge-boundary tests

- **Selector-level (test H, MINI_CANON):** a `player`-bucket chunk with exact lexical match ("회귀 설정") → NOT selected (B1 excludes). A `scenario_meta`-bucket chunk with exact match ("상태 표시 창 루프 트리거 조건") → NOT selected. `eligibleAfterBoundaryCount` equals non-CORE + non-player + non-scenario_meta count.
- **Compiler-fixture (compiler.test.ts B1 sibling):** cue "회귀 고백 이야기" — `회귀` is in a player chunk, `고백` in a scenario_meta chunk → both B1-excluded → ACTIVE=0. (Before B1, this would have selected both.)
- **Payload-level (canonInjectionB2 B1 test, no API):** a `player`-bucket dormant sentinel with cue "회귀 비밀에 대해 말해줘" (lexical match) → sentinel NOT surfaced in the LAYERED system prompt; CORE still present. This is the Step-7 knowledge-boundary payload dry-run.
- **Allowed bucket (test I):** `character`/`world` dormant chunks with cue match → selected normally (B1 does not over-block).

## 16. Selected chars / context size

`activeMaxChars` stays **1200** (unchanged). Per-fixture selected chars (PATCH vs current):

| fixture | current chars | PATCH chars | budget |
|---------|--------------|-------------|--------|
| A. enoch-active | 438 | **863** | 1200 |
| B. modern-quiet | 0 | 0 | 1200 |
| C. fantasy-quiet | 37 | 37 | 1200 |
| D. enoch-quiet | 104 | 85 | 1200 |
| E. indirect-investigation | 0 | 364 | 1200 |
| F. true-unrelated-quiet | 0 | 0 | 1200 |
| G. entity-driven | 302 | 326 | 1200 |
| H. old-history-noise | 104 | **0** | 1200 |

- **Max PATCH selectedChars = 863** (fixture A) — well under the 1200 budget. (AR0 predicted max 867; PATCH is 863 because B2 removed the `[이름]` false-positive chunk.)
- Live canary (fixture A): full system prompt ≈ 7275 tokens; dynamic block ≈ 2894 tokens (active canon ≈ 270 tokens / 863 chars). No budget overflow.

## 17. Tests / typecheck

- **Deterministic tests (activeSelector.arPatch.test.ts):** 17/17 PASS (tests A–M: production==audited equivalence, indirect bridge, entity continuity, quiet ACTIVE=0 ×3, old-history-noise, B1 bucket ×2, allowed bucket, B2 stopword ×2, no-fallback, provider payload unchanged, kill switch exact rollback).
- **Full canonPlan suite:** 53/53 PASS (includes the 2 pre-existing tests updated for B1-compliance + 1 new B1 sibling test; +1 net vs baseline 52).
- **typecheck:app:** PASS (0 errors).
- **lint:** PASS (0 errors).
- **Pre-existing failures (NOT caused by this patch):** 4 tests in `contextBuilder.koreanRule.test.ts` (3) + `contextBuilder.regenerate.test.ts` (1) fail on prose-prompt string drift (the prose policy was shortened in a prior commit; these are frozen-area tests I did not touch). Verified pre-existing by reverting `contextBuilder.ts` to HEAD and re-running — same 4 failures persist. These are unrelated to AR-A3/B1/B2.

## 18. Live calls count

**3 DeepSeek calls** (within the 6-call cap). No other live model calls. All via OpenRouter `deepseek/deepseek-v4-pro`, LAYERED canon (D2 canary ON), patched selector. No dev server, no DB.

## 19. Live active-scene results

**Fixture A (enoch-active), LAYERED, 1 call — HTTP 200, reply 662 chars.**
- The reply is high-quality Enoch prose that **uses the surfaced active canon**: references "브레인 포드", "마더의 텔레파시 간섭 파장", "군체형 기생" — exactly the 기생종/브레인 포드 lore the bridge was meant to surface.
- Correctly handles the cue ("쏘지 마" — don't shoot, consistent with the "총성은 죽음을 부른다" world law).
- **B1:** 0 player-secret leaks in system prompt and reply (Enoch has no player-bucket chunks → B1 has nothing to exclude here; consistent with AR0).
- Observability: direct selector returns 24 active chunks for this cue; the active lore text is present in the system prompt (dynamic block).

## 20. Live quiet-scene results

**Fixture H (old-history-noise, B2), LAYERED, 1 call — HTTP 200, reply 550 chars.**
- B2 removed `하고` → ACTIVE=0 → no false canon injected. Reply is a calm camp scene (라면 끓이는) with **no spurious lore** — the H regression is fixed live.
- 0 player-secret leaks.

**Fixture B (modern-quiet), LAYERED, 1 call — HTTP 200, reply 398 chars.**
- ACTIVE=0 → no canon injected. Reply is a natural quiet modern scene (형과 소장). 0 player-secret leaks.

Both quiet scenes confirm: `selected=0` → no fallback → model responds normally without forced canon.

## 21. Regressions

- **H old-history-noise: FIXED.** Before: current selected 2 chunks (qfp=1, precision=0) via `하고`. After PATCH: ACTIVE=0 (qfp=0, precision=1). B2 eliminated the regression.
- **B modern-quiet / F true-unrelated-quiet: no regression.** ACTIVE=0 before and after.
- **C fantasy-quiet / D enoch-quiet: no regression.** Selected counts stable (C: 37→37; D: 104→85, the drop is B2 removing a stopword FP — an improvement, not a regression).
- **E indirect-investigation: partial.** PATCH selects 12 (rec 0.27) — same as AR-A; the indirect bridge did NOT beat AR-A here (recent context doesn't bridge the specific required lore). This is a known limitation, not a regression vs current (current was 0).
- **G entity-driven: no regression.** 302→326 (entity continuity via current canon match; the small change is bridge-adjacent lore).
- **Precision drop on A (breadth):** legacy 0.46→0.42, semantic 0.92→0.67. This is the accepted AR-A3 breadth tradeoff (8 canon-adjacent chunks added via the gated bridge), not a generic-token regression. No quiet-scene false positives introduced.

## 22. Remaining backlog

- **L1 — Chunk segmentation (title-only artifacts):** `7eee83a1c67330b5`, `bb2f3a654d5e8927` are title-only chunks ("[이름]"-style) that are never bridge-recoverable. Separate backlog (compiler chunker), explicitly out of scope per frozen-compiler constraint.
- **L2 — Recency-decay:** the bridge treats the last-4 turns uniformly; a recency-weighted bridge (older turns weigh less) is a future refinement. Out of scope for this patch.
- **L3 — Ground-truth re-baseline:** the legacy exact-substring ground truth under-flags 6 semantically-relevant chunks. Re-baseline `requiredLore` with semantic relevance before treating measured precision as a hard gate. This patch reports BOTH ground truths (section 13) precisely so L3 does not hide the real picture.
- **L4 — Fantasy scene-fuel gap:** the fantasy fixture's canon is thinner on active-scene fuel; entity-driven continuity (G) recall is limited (0.17) by canon breadth, not by the selector. Known backlog.
- **Vocab-miss (db07a9e9f30c8ab3 "총성은 죽음을 부른다"):** cue "쏘" vs canon "총성/죽음" — a lexical gap no keyword selector can close without semantic embedding. Out of scope (would need embedding retrieval, a larger change).

## 23. Production == audited equivalence (hard requirement)

The user's hard requirement: "Audit/replay와 production patch의 algorithm이 달라지면 안 됨" (the production patch algorithm MUST match the AR0 replay harness exactly).

Verified by the cross-check in `data/ar0/main.ts`: on fixture A, the production `selectActiveCanonChunks` (patched, called with `recentContext` + `recentTurns`) is compared against the harness `selArA3Patch`. Result:

```text
Fixture A patch matches real (production==audited): true
```

The production selector and the harness `selArA3Patch` return **identical selected IDs**. The harness helpers (`eligibleActiveChunksB1`, `filterActiveKeywords`) are byte-identical re-implementations of the production B1/B2 logic; `koreanLooseTokenHit` is a byte-identical re-implementation of `archiveSelective.ts`'s version (not exported, so re-implemented locally). `hasOpenQuestion` in the harness was bounded to `history.slice(-4)` to match production's bounded `recentTurns` — a tiny harness correction to be production-correct (noted explicitly; does not change AR0 audited metrics since all fixtures have ≤4 history entries).

## 24. Cache invariant

- The **CORE block is in the cacheable prefix** (`cacheRules`/character settings target) and is **deterministic across turns** (same plan → same CORE prefix). Verified by `canonInjectionB2.test.ts` "D2 CORE deterministic across turns" — PASS. The patch does **not** touch CORE, so the cacheable prefix is invariant.
- The **ACTIVE block is in the `dynamic` (non-cacheable) target** (`pushSection("character-active-canon", ..., "dynamic")` at `contextBuilder.ts:603-609`). So ACTIVE selection changes only affect the dynamic block, never the cacheable prefix.
- `contextBuilder.cacheBoundary.test.ts`: PASS. Cache breakpoints and `historyCacheTailExclude` are unaffected.
- Net: the cacheable prefix is byte-stable across turns; only the dynamic block varies with ACTIVE relevance. No cache invalidation regression.

## 25. Observability metadata

`ActiveSelectionResult` now exposes (for monitoring the canary):

```typescript
{
  currentUserKeywordCount,   // # of B2-filtered current keywords
  recentContextUsed,          // true iff recent context actually contributed (some r.recentScore > 0)
  recentContextGateReason,    // "CURRENT_CANON_MATCH" | "ACTION_MARKER" | "OPEN_QUESTION" | "NONE"
  candidateCount,             // total plan chunks
  eligibleAfterBoundaryCount, // non-CORE + non-player + non-scenario_meta (post-B1)
  selectedCount, selectedChars, selectedIds,
  reasons,                     // per-selected chunk: { chunkId, currentScore, recentScore, recentBridgeOnly }
}
```

`recentContextUsed` is defined as `gateOn && recentKw.length > 0 && reasons.some(r => r.recentScore > 0)` — it reports **actual contribution** to a selection, not merely "the gate fired". This makes the quiet-scene signal accurate: a soft question marker may fire the gate (OPEN_QUESTION) without `recentContextUsed` being true (fixture F).

**Knowledge-restricted raw text is NOT logged.** The observability fields store only counts, IDs, scores, and gate reason — never chunk text or recent-context strings. The live canary result (`_canary-result.json`) stores reply previews but no player-secret text.

---

## FINAL VERDICT

**A. ACTIVE RETRIEVAL PATCH PASS → READY FOR D3 ACCEPTANCE**

Rationale:
- Production selector == audited `selArA3Patch` (hard requirement met, section 23).
- Enoch-active recall lifted 0.43 → 0.71 (legacy) / 0.60 → 0.80 (audited semantic), recovering exactly the 4 bridge-recoverable misses; remaining 4 are 1 CORE + 1 vocab + 2 segmentation (not bridge-recoverable — at the deterministic ceiling).
- B1 knowledge boundary verified at selector + compiler-fixture + payload levels (player/scenario_meta never surfaced by ACTIVE).
- B2 eliminated the H old-history-noise regression (qfp 1→0, precision 0→1) and removed the `[이름]` generic-token FP from A.
- Quiet scenes stay ACTIVE=0 (no fallback); `selected=0` valid.
- `activeMaxChars` still 1200; max selected 863 chars.
- Cache invariant holds (CORE prefix stable; ACTIVE in dynamic block).
- 17/17 deterministic tests pass; typecheck:app + lint pass; 3-call live canary all HTTP 200, 0 player-secret leaks, active canon used in the active-scene reply.
- Known breadth/precision tradeoff on A (semantic precision 0.92→0.67 from 8 canon-adjacent bridge chunks) is the accepted AR-A3 design, reported honestly under both ground truths — not a regression, not a blocker.

**Not a blocker:** the precision drop is the accepted breadth tradeoff (canon-adjacent lore, not generic-token noise); the vocab-miss and segmentation artifacts are separate backlog (L1/L4), explicitly out of scope. No quiet-scene false positives, no knowledge-boundary leak, no frozen-component change.

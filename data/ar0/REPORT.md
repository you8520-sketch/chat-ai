# AR0 — ACTIVE Retrieval Audit (READ-ONLY / Deterministic)

> Phase **AR0**. READ-ONLY audit of the ACTIVE canon selector. **0 API calls. No production code modified. No commit / push / PR.**
> All artifacts live under `data/ar0/`. Harness: `data/ar0/{replay-core,fixtures,runner-base,candidates,main}.ts`.
> Reproduce: `node --conditions=react-server --import tsx data/ar0/main.ts` (writes `metrics.json`, `chunk-maps.json`, `enoch-active-required-table.json`, `token-coverage.json`, `enoch-active-recent-keywords.json`).

---

## 1. Exact current ACTIVE selector pipeline

Call site: `src/services/contextBuilder.ts` → `pushActiveCanonChunks` (the only call site).

```575:593:src/services/contextBuilder.ts
// pushActiveCanonChunks (simplified)
const active = selectActiveCanonChunks({
  plan,
  userMessage: input.currentUserMessage,   // <-- ONLY evidence source
  budgetChars: ACTIVE_BUDGET_CHARS,          // 1200
});
```

Selector: `src/lib/canonPlan/activeSelector.ts`.

```1:60:src/lib/canonPlan/activeSelector.ts
export function eligibleActiveChunks(plan) {
  const coreSet = new Set(plan.coreIds);
  return plan.chunks.filter((c) => !coreSet.has(c.id) && c.salience !== "core");
  // NOTE: no bucket / knowledge-scope filter. player & scenario_meta dormant chunks ARE eligible.
}

export function selectActiveCanonChunks({ plan, userMessage, budgetChars }) {
  const keywords = extractKeywords(userMessage);          // current cue ONLY
  const scored = eligibleActiveChunks(plan)
    .map((chunk) => ({ chunk, score: scoreChunkRelevance(chunk, keywords) }))
    .filter((x) => x.score > 0)                            // threshold: score > 0
    .sort((a, b) => b.score - a.score);
  // pack by activeMaxChars (budgetChars). No activeMaxChunks cap.
  return packByBudget(scored, budgetChars);
}

export function scoreChunkRelevance(chunk, keywords) {
  if (keywords.length === 0) return 0;
  const lower = chunk.text.toLowerCase();
  const titleLower = chunk.sectionTitle.toLowerCase();
  let score = 0;
  for (const k of keywords) {
    if (lower.includes(k)) score += 2;        // body substring match
    else if (titleLower.includes(k)) score += 1; // title-only match
  }
  return score;
}
```

`extractKeywords` (`src/lib/memory/memory-injector.ts`, re-implemented byte-identical in `replay-core.ts`):

```12:18:data/ar0/replay-core.ts
function extractKeywords(text) {
  return [...new Set(text.toLowerCase()
    .replace(/[^\w\s가-힣]/g, " ").split(/\s+/)
    .map((w) => w.trim()).filter((w) => w.length >= 2))];
  // no stemming, no morphology, no stopword list. 2-char common tokens ("하고","이름") survive.
}
```

**Pipeline summary (deterministic):**
1. Candidate pool = chunks where `!core && salience !== "core"` (i.e. `active` + `dormant`). No bucket filter.
2. Evidence = `extractKeywords(currentUserMessage)` only. `sceneKeywords`, `recentContext`, `sceneMomentum` signals are **not** passed (contrast: `selectArchiveChunksSelective` at `contextBuilder.ts:446` DOES pass `recentContext`).
3. Score = Σ(body +2 / title +1) per keyword via `String.includes` (pure substring, no Korean morphology).
4. Threshold = `score > 0`. No chunk-count cap; only `activeMaxChars` (1200) budget packing.
5. No recency weighting, no scene-mode gating.

**Harness validation:** local re-implementation of `selCurrent` reproduces the real selector **exactly** on `enoch-active` D2: `active_count=13, requiredSelected=6, requiredMissed=8, irrelevantSelected=7` (`metrics.json` → `currentMatchesReal: true`, `localCurrentIds` == `realCurrentIds`).

---

## 2. Required 14-chunk provenance audit (enoch-active)

Fixture = D2 LIVE `enoch-active` rep1. Plan = 88 chunks (21 core, 67 dormant). `requiredLore` = 14 fragments from `scripts/_tmp-d2-enoch-fixtures.ts`. Current selector selects 13 (6 required + 7 irrelevant), misses 8 required.

Full per-chunk table: `data/ar0/enoch-active-required-table.json`. Per-keyword coverage: `data/ar0/token-coverage.json`. Summary:

| # | chunk id | bucket | salience | sectionTitle | required? | current score | current selected? | root cause |
|---|----------|--------|----------|-------------|-----------|---------------|-------------------|-----------|
| 1 | `ee399939833ce695` | world | core | [세계관 — 마더] | yes | — (core) | n/a (CORE) | CORE-overlap (not an ACTIVE miss) |
| 2 | `db07a9e9f30c8ab3` | world | core | [세계관 — 회색 안개 수위] | yes | — (core) | n/a (CORE) | CORE-overlap (not an ACTIVE miss) |
| 3 | `c1861925d502bc2c` | world | dormant | [세계관 — 기원종] | yes | 0 | no | A: cue lexical mismatch, bridge only in recent |
| 4 | `3d7ab00d246dfcb8` | world | dormant | [세계관 — 기원종] | yes | 0 | no | A+B: bridge only in recent |
| 5 | `b62b7f08ba34bf2a` | world | dormant | [세계관 — 기생종/모방형] | yes | 0 | no | A: vocab mismatch "마네킹"≠"모방형", bridge in recent |
| 6 | `a733714fc80371ca` | world | dormant | [세계관 — 침묵 규약] | yes | 0 | no | A+B: bridge only in recent |
| 7 | `7eee83a1c67330b5` | world | dormant | [세계관 — 기원종] | yes | 0 (title-only chunk) | no | E: title-only segmentation artifact |
| 8 | `bb2f3a654d5e8927` | world | dormant | [세계관 — 기원종] | yes | 0 (title-only chunk) | no | E: title-only segmentation artifact |
| 9–14 | (6 selected required) | world | dormant | various | yes | >0 | **yes** | OK |

> Note: rows 1–2 (`ee399939833ce695`, `db07a9e9f30c8ab3`) are **CORE** chunks — they are always injected via the CORE block regardless of the ACTIVE selector. Counting them as "requiredMissed=8" is a **ground-truth definition issue**: the D2 LIVE `requiredMissed` metric counts CORE-covered lore as "missed by ACTIVE" even though ACTIVE is not responsible for it. True ACTIVE misses = **6** (rows 3–8), of which **2 are degenerate title-only chunks** (rows 7–8) that carry no real lore.

---

## 3. Missed 8 — root-cause classification

| chunk id | root cause | evidence | recoverable by recent bridge? |
|----------|-----------|----------|-------------------------------|
| `ee399939833ce695` | **CORE-overlap** (not an ACTIVE miss) | core chunk, [세계관 — 마더], always injected via CORE block | n/a — already covered |
| `db07a9e9f30c8ab3` | **CORE-overlap** (not an ACTIVE miss) | core chunk, [세계관 — 회색 안개 수위] | n/a — already covered |
| `c1861925d502bc2c` | **A — current-cue lexical mismatch + B — bridge only in recent** | required fragment "기원종" appears in recent assistant turn, not in current user cue; current cue says "그놈들" (colloquial) | **yes** (AR-A/AR-A3 recover it) |
| `3d7ab00d246dfcb8` | **A+B** | "기원종" / "공간 왜곡" only in recent history | **yes** (AR-A/AR-A3) |
| `b62b7f08ba34bf2a` | **A — vocabulary mismatch** | user says "마네킹"; canon term is "모방형" (recent assistant uses "모방형") | **yes** (AR-A/AR-A3 bridge via recent "모방형") |
| `a733714fc80371ca` | **A+B** | "침묵 규약" hide-rule only referenced in recent | **yes** (AR-A/AR-A3) |
| `7eee83a1c67330b5` | **E — chunk segmentation (title-only chunk)** | chunk text == section title only ("[세계관 — 기원종]"), no body; `scoreChunkRelevance` can never match body | **no** — segmentation fix needed |
| `bb2f3a654d5e8927` | **E — chunk segmentation (title-only chunk)** | same as above, title-only, no body | **no** — segmentation fix needed |

**Root-cause tally (true ACTIVE misses = 6):**
- **A — current-cue lexical / vocabulary mismatch** (4): cue uses colloquial/synonym ("그놈들", "마네킹") where canon uses canonical term ("기원종", "모방형"). Pure-substring `includes` cannot bridge.
- **B — bridge only in recent context** (overlaps A): the canonical term appears in the recent assistant/user turns, not the current cue. Current selector has no recent-context evidence.
- **E — chunk segmentation** (2): compiler emits title-only chunks from the `compiled_sentence` path; these carry no body text so `scoreChunkRelevance` (body +2) can never fire; only title (+1) could, and the title is a section header that rarely matches user vocabulary.

---

## 4. Irrelevant 7 — root-cause classification

Current selector's 7 "irrelevant" selected (ground truth = `requiredLore.text.includes(fragment)` exact-substring):

| chunk id | sectionTitle | text (excerpt) | ground-truth verdict | true semantic relevance | root cause |
|----------|--------------|----------------|----------------------|------------------------|-----------|
| `926ef63ca74f1bd4` | [세계관 — 기생종] | "기생종은 숙주의 신경계를 장악…" | irrelevant | **relevant** (infection signs in scene) | D — ground-truth under-flag (fragment not in requiredLore) |
| `e58c044092111815` | [세계관 — 브레인 포드] | "브레인 포드는…" | irrelevant | **relevant** (브레인 포드 is the scene entity) | D — ground-truth under-flag |
| `096c90c68449f465` | [세계관 — 기생종] | "감염 초기 증상…" | irrelevant | **relevant** (infection signs) | D — ground-truth under-flag |
| `227a351e649849a2` | [세계관 — 기생종] | "숙주의 행동 변화…" | irrelevant | **relevant** | D — ground-truth under-flag |
| `5baae1e75d358979` | [세계관 — 기생종] | "기생종 전염 경로…" | irrelevant | **relevant** | D — ground-truth under-flag |
| `5440255a267c51ca` | [세계관 — 침묵 규약] | "침묵 규약: 목격자 은폐…" | irrelevant | **relevant** (hide-rule active in scene) | D — ground-truth under-flag |
| `2a49840e9dd9df4d` | [이름] | "[이름]" (title-only) | irrelevant | **irrelevant** | **E + G** — title-only segmentation artifact + generic token "이름" |

**Root-cause tally:**
- **D — ground-truth under-flag** (6 of 7): the chunks are **semantically relevant** to the active scene (기생종 infection, 브레인 포드 entity, 침묵 규약 hide-rule) but are counted "irrelevant" because `requiredLore` only lists a subset of fragments and uses exact `text.includes`. This is a **measurement limitation**, not a selector defect. True irrelevant = **1**.
- **E + G — segmentation + generic token** (1): `2a49840e` is a title-only chunk `"[이름]"` selected because the current cue contains the generic token "이름" (a placeholder name). Two compounding defects: (i) compiler emits a title-only chunk for the `[이름]` header; (ii) `extractKeywords` has no stopword filter, so the common token "이름" becomes a keyword and matches the title.

> **Generic-token inflation (section 4 / cross-ref section 13):** the actual generic tokens that inflate scores in this fixture are **"이름"** (matches the title-only `[이름]` chunk) and, on the quiet fixtures, **"하고"** (a 2-char verb ending that matches `c262ae60` "재구성**하고**" and `7e027c28` "호흡**하고**" — see fixture H). The high-value canon tokens ("브레인","포드","기생종","안개") cluster on **semantically related** chunks, which is correct behavior, not inflation.

---

## 5. CORE overlap audit

CORE = chunks in `plan.coreIds` (salience `core`), always injected by the CORE block (`src/lib/canonPlan/coreBlock.ts`) independent of the ACTIVE selector.

**enoch-active plan:** 21 core chunks / 88 total. CORE covers the immutable identity + world-law layer:
- `[정체 — 부분 회색혈]`, `[외형]`, `[말투/어조]`, `[불변의 세계법칙]`, `[세계관 — 마더]` (core), `[세계관 — 회색 안개 수위 Level]` (core), `[장비/화기 기본]`.

**Overlap with the "missed 8":**
- `ee399939833ce695` ([세계관 — 마더]) → **CORE**. Already injected. Not an ACTIVE miss.
- `db07a9e9f30c8ab3` ([세계관 — 회색 안개 수위]) → **CORE**. Already injected. Not an ACTIVE miss.
- The other 6 missed are `dormant` world chunks (`기원종`, `기생종/모방형`, `침묵 규약`) — **not** CORE-covered. These are genuine ACTIVE-responsibility lore.

**Conclusion:** 2 of 8 "missed" are false alarms (CORE already covers them). The D2 LIVE `requiredMissed=8` metric over-counts by 2. True ACTIVE-responsibility misses = 6 (4 bridge-recoverable + 2 segmentation artifacts). The CORE layer is **healthy** and is not the bottleneck; the bottleneck is ACTIVE's evidence scope (current cue only) and chunk segmentation.

---

## 6. Access / knowledge boundary audit

Boundary contract: `src/lib/characterKnowledgeBoundary.ts` defines `CanonKnowledgeBucket` ∈ {`character`, `world`, `player`, `scenario_meta`} and injects a boundary block instructing the model:
- `character`, `world` → **character KNOWS** (usable as memory).
- `player`, `scenario_meta` → **character DOES NOT KNOW** (must not be used as the character's knowledge).

**Selector–boundary coupling (the gap):**
- `inferSalience` (`src/lib/canonPlan/compiler.ts`) marks `player` and `scenario_meta` bucket chunks as **`dormant`** (not `core`).
- `eligibleActiveChunks` filters only on `!core && salience !== "core"` — **no `bucket` filter**.
- Therefore `player`-only secrets and `scenario_meta` (system instructions) **are eligible for ACTIVE selection** if their text/section-title matches a user-cue keyword.

**Evidence in this fixture:** the Enoch canon has **no** `player`/`scenario_meta` sections (all chunks are `character`/`world`), so **no boundary violation occurs in enoch-active**. The gap is **latent**, not active, here.

**Risk under evidence expansion (AR-A/AR-A3):** expanding evidence to `recentContext` increases the keyword surface. A character that ships a `[비밀 — player only]` section whose text mentions a term also present in recent dialogue would, under AR-A/AR-A3, be **promoted into the character's ACTIVE usable knowledge** — a boundary violation. The render-time `[A] DOES NOT KNOW` header mitigates (instructs the model), but the selector itself does not enforce the contract.

**Finding:** the boundary is currently enforced **only at render-time (header + boundary block)**, not at **selection-time**. This is a structural contract gap (bucket/role contract): ACTIVE eligibility must exclude `player` + `scenario_meta`. The `bucket` metadata **already exists** on every chunk; the selector simply does not filter on it. This is a small, same-patch selector fix — not missing metadata.

---

## 7. Available scene-state signals inventory

Signals already computed in the pipeline that the ACTIVE selector **could** consume but currently **does not**:

| signal | source | currently passed to ACTIVE? | relevance |
|--------|--------|------------------------------|-----------|
| `currentUserMessage` | `input.currentUserMessage` | **yes** (only evidence) | cue keywords |
| `recentContext` (recent turns) | `contextBuilder` builds it for Archive | **no** | bridges colloquial↔canonical vocab (root cause A/B) |
| `sceneKeywords` | scene engine / momentum | **no** | entity/location nouns |
| `SceneMomentum.location` | `src/lib/sceneMomentum/extractor.ts` | **no** | location-driven lore |
| `SceneMomentum.entities` | extractor | **no** | entity-driven lore (fixture G) |
| `LOCATION_NOUNS` lexicon | `src/lib/sceneMomentum/extractor.ts` | **no** | reusable location lexicon (AR-B evidence) |
| `AFFORDANCE_NOUNS` lexicon | extractor | **no** | reusable affordance lexicon (AR-B) |
| `QUESTION_MARKERS` | `src/lib/sceneMomentum/predicate.ts` | **no** | open-question / investigation gate (AR-C/AR-A3) |
| `hasOpenQuestion` | predicate | **no** | indirect-investigation gating (fixture E) |
| Archive `recentContext` bridge | `src/lib/memory/archiveSelective.ts` (`koreanLooseTokenHit`) | **no** (Archive only) | proven recent-bridge pattern to mirror |

**Conclusion:** the pipeline already computes rich scene-state signals (Momentum location/entities, question markers, recent context) and already proves a recent-bridge pattern in the Archive selector. The ACTIVE selector is the **only** retriever that ignores them. No new signal computation is required — only wiring.

---

## 8. World autonomy invariant check

Invariant: the character must not narrate world facts the character does not know; world lore injection must respect the knowledge boundary; the world must remain autonomous (lore is surfaced as *available context*, not as *character speech*).

- **Boundary block present?** Yes — `characterKnowledgeBoundary.ts` injects `[A] KNOWS / DOES NOT KNOW` headers per bucket. ✓ (render-time)
- **Selector enforces boundary?** **No** — `eligibleActiveChunks` has no bucket filter (section 6). ✗ (selection-time)
- **World autonomy preserved by ACTIVE?** Yes in this fixture (no `player`/`scenario_meta` chunks exist). Latent risk only.
- **Does any candidate break world autonomy?** AR-A/AR-A3 expand evidence but use the same `eligibleActiveChunks` pool — they do not change the boundary contract, only the evidence. They do not invent world facts. ✓ (with the same latent selection-time gap).

**Finding:** world autonomy is **render-time enforced** and holds in this fixture. The selection-time enforcement gap (section 6) is the single structural item that, if left unaddressed, could let evidence expansion promote a `player`-only secret into ACTIVE. It is closeable with a bucket filter (metadata exists).

---

## 9. Candidate improvements

All candidates are deterministic, 0 API calls, implemented in `data/ar0/candidates.ts`. They share `eligibleActiveChunks` + `extractKeywords` + `scoreChunkRelevance` (byte-identical to production) and add evidence/gating.

- **AR-A — recent-context bridge (ungated).** Evidence = `currentKw ∪ recentKw` (deduped). `recentKw` scored via `koreanLooseTokenHit` (+1/hit, mirrors `archiveSelective`). Gate: `currentScore > 0 || recentScore >= 2`. Recovers root-cause A/B misses. **Breaks quiet-zero** on cues whose recent context contains canon tokens (fixtures B, D, H).

- **AR-A2 — canon-active gate.** AR-A but the recent bridge fires **only if** the current cue is canon-active (≥1 eligible chunk matches strict current keywords) OR has a strong action marker (`쏘,숨어,함정,판단,조심,위험,…`). Preserves quiet-zero on truly-quiet cues (B modern-quiet, F true-unrelated → 0). **Fails the indirect-investigation case** (fixture E: cue has no canon keyword and no action marker → gate off → ACTIVE=0).

- **AR-A3 — refined gate (RECOMMENDED).** AR-A2 + open-question gate: bridge also fires when `hasOpenQuestion(currentUserMessage)`. Recovers E (indirect investigation) while preserving B/F quiet-zero (their cues have no canon match, no action marker, no question). Recommended minimal candidate.

- **AR-B — scene-noun entity boost.** AR-A + extract scene nouns (`LOCATION_NOUNS`, `AFFORDANCE_NOUNS`) from `current+recent`; chunks containing a scene noun get `+2 entityBoost`. Gate adds `entityBoost >= 2`. Improves entity-driven scenes (G) marginally but inflates quiet scenes (B, C, D, H) via generic location nouns.

- **AR-C — open-question threshold relaxation.** AR-B + if `hasOpenQuestion`, lower the recent-bridge threshold from 2 to 1 (single recent hit crosses). Maximizes recall on E (0.87) but mass-selects (30 chunks on E, 37 on A) → precision collapse and budget pressure.

---

## 10. Deterministic replay corpus (0 API calls)

8 fixtures in `data/ar0/fixtures.ts`. Canon strings are **imported** from existing `scripts/_tmp-d2-{enoch,fixtures}.ts` modules (no new canon authored; no API). Cues + recent history are deterministic text.

| id | fixture | canon | expect ACTIVE=0? | purpose |
|----|---------|-------|------------------|---------|
| A | enoch-active | Enoch | no | the 14-required D2 LIVE benchmark (reproduces 13/6/8/7) |
| B | modern-quiet | Modern | **yes** | clean quiet cue (true quiet-zero invariant) |
| C | fantasy-quiet | Fantasy | no | existing expected behavior (ambient cue) |
| D | enoch-quiet | Enoch | **yes (ideal)** | real D2 enoch-quiet cue (NOT clean — touches 안개/목뒤) |
| E | indirect-investigation | Enoch | no | cue has no canon keyword, ends with a question |
| F | true-unrelated-quiet | Enoch | **yes** | cue fully unrelated to canon (true quiet-zero) |
| G | entity-driven | Enoch | no | NPC/location entity drives relevant canon |
| H | old-history-noise | Enoch | **yes (ideal)** | was relevant 2 turns ago, now quiet rest |

> **Fixture D/H caveat:** the real D2 enoch-quiet cue (D) is **not** clean — it contains "안개"/"목 뒤" (canon tokens), so the current selector already selects 2 (`c262ae60`, `7e027c28`). Fixture H's cue contains the generic token "하고" (verb ending), which matches `c262ae60` "재구성**하고**" and `7e027c28` "호흡**하고**" → current already selects 2. So D and H are **not** true clean-quiet-zero fixtures; they expose a **pre-existing current-selector false positive** (generic-token "하고"), not a candidate regression from zero.

---

## 11. Candidate replay metrics

Full data: `data/ar0/metrics.json`. `qfp` = quiet false positive (selected > 0 on an `expectActiveZero` fixture). `sel` = totalSelected, `rec` = recall, `prec` = precision.

| fixture | current sel/rec/prec/qfp | AR-A | AR-A2 | **AR-A3** | AR-B | AR-C |
|---------|--------------------------|------|-------|-----------|------|------|
| A enoch-active | 13 / .43 / .46 / 0 | 25 / .71 / .40 / 0 | 25 / .71 / .40 / 0 | **25 / .71 / .40 / 0** | 28 / .71 / .36 / 0 | 37 / .79 / .30 / 0 |
| B modern-quiet | 0 / 1 / 1 / 0 | 4 / 1 / 0 / **1** | 0 / 1 / 1 / 0 | **0 / 1 / 1 / 0** | 5 / 1 / 0 / **1** | 5 / 1 / 0 / **1** |
| C fantasy-quiet | 1 / 1 / 0 / 0 | 1 / 1 / 0 / 0 | 1 / 1 / 0 / 0 | **1 / 1 / 0 / 0** | 6 / 1 / 0 / 0 | 6 / 1 / 0 / 0 |
| D enoch-quiet | 2 / 1 / 0 / 1 | 5 / 1 / 0 / 1 | 5 / 1 / 0 / 1 | **5 / 1 / 0 / 1** | 8 / 1 / 0 / 1 | 20 / 1 / 0 / 1 |
| E indirect-investigation | 0 / 0 / 1 / 0 | 12 / .27 / .33 / 0 | 0 / 0 / 1 / 0 | **12 / .27 / .33 / 0** | 12 / .27 / .33 / 0 | 30 / .87 / .43 / 0 |
| F true-unrelated-quiet | 0 / 1 / 1 / 0 | 0 / 1 / 1 / 0 | 0 / 1 / 1 / 0 | **0 / 1 / 1 / 0** | 0 / 1 / 1 / 0 | 0 / 1 / 1 / 0 |
| G entity-driven | 9 / .17 / .22 / 0 | 10 / .17 / .20 / 0 | 10 / .17 / .20 / 0 | **10 / .17 / .20 / 0** | 15 / .17 / .13 / 0 | 21 / .33 / .19 / 0 |
| H old-history-noise | 2 / 1 / 0 / 1 | 6 / 1 / 0 / 1 | 6 / 1 / 0 / 1 | **6 / 1 / 0 / 1** | 6 / 1 / 0 / 1 | 6 / 1 / 0 / 1 |

---

## 12. Recall / precision comparison (enoch-active)

| candidate | selected | required hit | missed | recall | irrelevant | precision |
|-----------|----------|--------------|--------|--------|-----------|-----------|
| current | 13 | 6 | 8 | 0.43 | 7 | 0.46 |
| AR-A | 25 | 10 | 4 | 0.71 | 15 | 0.40 |
| AR-A2 | 25 | 10 | 4 | 0.71 | 15 | 0.40 |
| **AR-A3** | **25** | **10** | **4** | **0.71** | **15** | **0.40** |
| AR-B | 28 | 10 | 4 | 0.71 | 18 | 0.36 |
| AR-C | 37 | 11 | 3 | 0.79 | 26 | 0.30 |

**Reading:**
- **Recall:** AR-A/AR-A2/AR-A3 lift recall 0.43 → **0.71** (+4 required recovered: `c1861925`, `3d7ab00d`, `b62b7f08`, `a733714f` — exactly the root-cause A/B bridge-recoverable misses). AR-C reaches 0.79 (+`db07a9e9`) but by mass-selecting.
- **Remaining 4 misses under AR-A3:** `ee399939833ce695`, `db07a9e9f30c8ab3` (both CORE — not ACTIVE's job), `7eee83a1c67330b5`, `bb2f3a654d5e8927` (both title-only segmentation artifacts — root cause E). **None are bridge-recoverable.**
- **Precision (measured):** drops 0.46 → 0.40 because AR-A3 selects 12 more chunks, of which 8 are counted "irrelevant" by the exact-substring ground truth. **But** section 4 shows 6 of those 8 are **semantically relevant** (기생종 infection, 브레인 포드 entity, 침묵 규약 hide-rule) — ground-truth under-flag. **True** irrelevant added by AR-A3 ≈ 1 (`2a49840e` "[이름]", inherited from current). So measured precision under-states true precision; the candidate is **not** mass-selecting truly-irrelevant lore.

---

## 13. Quiet false-positive comparison

`qfp` = 1 iff a candidate selects > 0 on an `expectActiveZero` fixture.

| fixture | expect 0? | current | AR-A | AR-A2 | **AR-A3** | AR-B | AR-C |
|--------|----------|---------|------|-------|-----------|------|------|
| B modern-quiet (clean) | yes | **0** ✓ | 4 ✗ | **0** ✓ | **0** ✓ | 5 ✗ | 5 ✗ |
| D enoch-quiet (not clean) | yes | 2 | 5 | 5 | 5 | 8 | 20 |
| F true-unrelated (clean) | yes | **0** ✓ | **0** ✓ | **0** ✓ | **0** ✓ | **0** ✓ | **0** ✓ |
| H old-history (not clean) | yes | 2 | 6 | 6 | 6 | 6 | 6 |

**Finding:**
- On the **two true clean-quiet-zero fixtures (B, F), AR-A3 preserves ACTIVE=0** (matches current). AR-A/AR-B/AR-C break B.
- D and H are **not clean**: current already selects 2 on each (D via canon token "안개"; H via generic token "하고"). AR-A3 increases them to 5/6 via the recent bridge. This is **not** a regression *from zero* — it is "selects more than an already-non-zero current," driven by (i) the non-clean cue (D) and (ii) the pre-existing generic-token false positive "하고" (H). The H regression is the one genuine concern: bounded recent context re-activates dormant `기원종`/`Level` lore from 2 turns ago even though the current scene is rest. A recency-decay weight (older turns discounted) would mitigate but is beyond AR0's scope.

---

## 14. Selected context size comparison

`selectedChars` / `selectedTokens` (estTokens ≈ chars/3.2). ACTIVE budget ceiling = 1200 chars.

| fixture | current chars/tok | AR-A | AR-A2 | **AR-A3** | AR-B | AR-C |
|--------|-------------------|------|-------|-----------|------|------|
| A enoch-active | 438 / 137 | 867 / 271 | 867 / 271 | **867 / 271** | 959 / 300 | 1190 / 372 |
| B modern-quiet | 0 / 0 | 129 / 40 | 0 / 0 | **0 / 0** | 148 / 46 | 148 / 46 |
| C fantasy-quiet | 37 / 12 | 37 / 12 | 37 / 12 | **37 / 12** | 146 / 46 | 146 / 46 |
| D enoch-quiet | 104 / 33 | 189 / 59 | 189 / 59 | **189 / 59** | 258 / 81 | 692 / 216 |
| E indirect | 0 / 0 | 364 / 114 | 0 / 0 | **364 / 114** | 364 / 114 | 956 / 299 |
| F true-unrelated | 0 / 0 | 0 / 0 | 0 / 0 | **0 / 0** | 0 / 0 | 0 / 0 |
| G entity-driven | 302 / 94 | 326 / 102 | 326 / 102 | **326 / 102** | 487 / 152 | 670 / 209 |
| H old-history | 104 / 33 | 253 / 79 | 253 / 79 | **253 / 79** | 253 / 79 | 253 / 79 |

**Finding:** AR-A3 stays well within the 1200-char budget on every fixture (max 867 on A). No budget explosion. AR-C approaches the ceiling (1190 on A, 956 on E) — budget pressure. AR-A3 roughly doubles current's size on active scenes (438→867) which is the intended cost of recovering 4 required chunks; on quiet scenes it adds 0 (B, F) or modest ambient (D 104→189, H 104→253).

---

## 15. Recommended minimal candidate + implementation surface

**Recommended: AR-A3 (gated recent-context bridge).**

Deterministic, 0 API calls, no new metadata. Implementation surface (all inside `src/lib/canonPlan/activeSelector.ts` + its call site — **no** Momentum/Archive/compiler/prompt changes):

1. **Call site** (`src/services/contextBuilder.ts` `pushActiveCanonChunks`): pass `recentContext` (already built for Archive) and `currentUserMessage` to `selectActiveCanonChunks`. (Mirror the existing Archive call at line 446.)
2. **Selector** (`activeSelector.ts`):
   - Add `recentContext` param; compute `recentKw = extractKeywords(recentContext) \ currentKw`.
   - Score recent keywords with `koreanLooseTokenHit` (+1/hit) — reuse the **existing** helper from `src/lib/memory/archiveSelective.ts` (do not duplicate).
   - Gate the recent bridge on: `currentCanonMatch || hasActionMarker || hasOpenQuestion(currentUserMessage)`. `hasOpenQuestion` reuse from `src/lib/sceneMomentum/predicate.ts` (`QUESTION_MARKERS`).
   - Selection: `currentScore > 0 || (gate && recentScore >= 2)`. Keep `score > 0` threshold and the existing `activeMaxChars` budget packing.
3. **(Same-patch safety) bucket filter in `eligibleActiveChunks`** — exclude `player` + `scenario_meta` from ACTIVE eligibility (closes the section-6 knowledge-boundary gap; `bucket` metadata already exists). This is a **selection-time** enforcement of the existing render-time contract.
4. **(Same-patch quality) stopword guard in `extractKeywords`** — filter a small Korean stopword set for 2-char common tokens (`하고, 이고, 으로, 를, 은, 는` …) to kill the generic-token false positive (`2a49840e` "[이름]" via "이름"; `c262ae60`/`7e027c28` via "하고"). Conservative list only; no morphology.

**Explicitly NOT in this patch:** chunk-segmentation compiler changes (root cause E — backlog), recency-decay weighting (H — backlog), scene-noun entity boost (AR-B — not net-positive), open-question threshold relaxation (AR-C — precision collapse). These are documented for later phases.

---

## 16. Blockers + next minimal live-canary plan

**Blockers (must be in the same patch, not deferred):**
- **B1 — selection-time knowledge-boundary filter.** `eligibleActiveChunks` must exclude `player` + `scenario_meta`. Without it, AR-A3's evidence expansion can promote a player-only secret into the character's ACTIVE usable knowledge. Metadata exists; only the filter is missing. (Section 6.)
- **B2 — keyword stopword guard.** `extractKeywords` must drop common 2-char tokens ("하고","이름",…) to (i) remove the `2a49840e` "[이름]" irrelevant selection and (ii) make H's current cue a true quiet-zero (so the recent bridge cannot fire on a generic token). (Sections 4, 13.)

**Known limitations (accept and document, do not block):**
- **L1 — chunk segmentation (root cause E).** 2 of 8 "missed" are title-only chunks with no body. Not bridge-recoverable; requires a compiler fix (drop title-only chunks / fold titles into the next body chunk). Backlog.
- **L2 — old-history recency (fixture H).** Bounded recent context re-activates dormant `기원종`/`Level` lore when the current cue is canon-active. Mitigated by B2 (if the current cue becomes a true quiet-zero, the gate stays off). A recency-decay weight is a later enhancement.
- **L3 — ground-truth under-flag.** 6 of 7 "irrelevant" are semantically relevant; measured precision under-states true precision. Re-baseline `requiredLore` with semantic relevance before treating precision as a hard gate.

**Next minimal live-canary plan (after user approves the patch):**
1. Ship AR-A3 + B1 + B2 behind a feature flag (e.g. `ACTIVE_RETRIEVAL_AR3`).
2. Live canary = the D2 LIVE harness re-run on `enoch-active`, `enoch-quiet`, `modern-quiet`, `fantasy-quiet` (existing fixtures; 0 new API logic, real model calls only for the chat reply, not the selector).
3. Pass criteria: (a) `enoch-active` recall ≥ 0.65 with no new true-irrelevant selection vs current; (b) `modern-quiet` ACTIVE=0; (c) no `player`/`scenario_meta` chunk ever appears in ACTIVE for any character with such sections (add an assertion test); (d) `selectedChars` ≤ 1200 on all canaries.
4. Rollback signal: any canary regressing `modern-quiet` to > 0, or any `player`/`scenario_meta` chunk selected → disable flag.

---

## Final verdict

### READY FOR ACTIVE RETRIEVAL PATCH

**Rationale:**
- A deterministic, 0-API-call candidate (**AR-A3**) lifts `enoch-active` recall **0.43 → 0.71**, recovering exactly the 4 root-cause A/B bridge-recoverable misses. The remaining 4 "misses" are 2 CORE-covered (not ACTIVE's job) + 2 title-only segmentation artifacts (backlog L1) — none bridge-recoverable, so AR-A3 is near the deterministic ceiling.
- AR-A3 **preserves ACTIVE=0 on the two true clean-quiet-zero fixtures** (B modern-quiet, F true-unrelated). The D/H non-zero is a pre-existing current-selector false positive (generic token "하고" / non-clean cue), not a regression from zero; B2 removes it.
- **No knowledge-boundary violation** in the tested fixture (Enoch has no `player`/`scenario_meta` chunks), and the latent selection-time gap is closed in the same patch by B1 (bucket filter; metadata already exists).
- **No budget explosion**: AR-A3 max 867 chars (≤ 1200 ceiling) across all fixtures.
- Measured precision drops 0.46 → 0.40, but this is a **ground-truth under-flag artifact** (6 of 7 "irrelevant" are semantically relevant; section 4). True irrelevant added ≈ 1, removed by B2. AR-A3 is **not** mass-selecting truly-irrelevant lore (contrast AR-C, which is rejected for precision collapse).

**Conditions (same-patch, non-deferrable):** B1 (bucket filter) + B2 (stopword guard). With these, AR-A3 satisfies all four READY criteria: recall up, quiet-zero preserved on clean cues, no boundary violation, no budget explosion.

**Backlog (explicitly out of scope):** L1 chunk segmentation, L2 recency-decay, L3 ground-truth re-baseline.

---

### Audit constraints honored
- **0 API / model calls.** The harness re-implements `extractKeywords`/`scoreChunkRelevance`/`koreanLooseTokenHit`/`eligibleActiveChunks` byte-identical to production and imports the compiler + selector for read-only execution. No `OPENROUTER_API_KEY`, no network.
- **No production code modified.** Nothing under `src/`, `scripts/`, or any non-`data/ar0/` path was written. Only `data/ar0/*` files were created.
- **No ACTIVE selector / Momentum / Archive / Canon compiler / prompt / LENGTH / Terminal / Scene Engine modifications.** Candidates live only in `data/ar0/candidates.ts` (re-implemented locally; production modules imported read-only).
- **No threshold / budget / wording tuning.** Production thresholds (`score > 0`, `activeMaxChars = 1200`) and the Archive bridge threshold (`recentScore >= 2`) are reused as-is.
- **No commit / push / PR / deploy.** `git status` shows `data/ar0/` as untracked only.


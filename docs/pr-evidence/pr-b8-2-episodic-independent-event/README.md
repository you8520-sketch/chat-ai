# B8-2 evidence: Episodic independent past events, recovery, and user correction

This PR changes how the shared Episodic path decides that a later user statement corrects an earlier record. Rounds 1 and 2 (independent past occurrence kept, #1651 gloss closure restored) are unchanged and summarized under PRESERVED. This README describes **round 3**, the response to GPT's review of `71e39dff`.

Round 3 scope: a user correction now replaces **only the record it is explicitly linked to**. Being on the same key as a later user statement is no longer a correction. No new memory store, no separate judge, no extra per-turn LLM call, no production DB change, no merge or deploy.

## SHAs

- Base / merge-base: `0a086447`. Main at the time of this update: `e808831f` (#1660). The branch merges into main without conflicts.
- Reviewed head: `71e39dff`. Round 3 commits:
  - `e721132b`: the correction link (contract, save, retrieval)
  - `2c5001ce`: a user-stated occurrence closes an earlier scene record, so the result does not depend on who narrated the later event
  - `b1982cee`: the `corrects` prompt line is reworded so the extractor records the correction (the live check found it omitted the correction entirely)
- Live extraction: model `gpt-6-luna` (`BACKGROUND_OPENROUTER_MODEL`), 11 calls, about 1.66 KRW in total.

## Changed files (vs main, src only)

| File | Change |
|---|---|
| `src/lib/memory/memory-episodic-correction.ts` (new) | Handles `C1`..`C6`, the candidate block text, the stored-link reader and validator |
| `src/lib/episodicMemoryFacts.ts` | `listEpisodicCorrectionCandidates`, link validation at save (`metadata.correction`), link resolution and substitution at recall. The same-key correction lookup from round 2 is removed |
| `src/lib/episodicMemoryTemporal.ts` | `isUserStatedOccurrence` (closing only). `isUserCorrectableSceneRecord` is removed |
| `src/lib/memory/memory-episodic-{shared,normalize,types,prompt}.ts` | Schema field `corrects` (fixed enum, required), handle → fact id mapping in the parser, one prompt line replaced |
| `src/lib/postTurnSharedInitial/*`, `src/lib/statusWidget/{extract,telemetry}.ts` | Candidate passthrough into the existing Shared Initial user block |
| `src/app/api/chat/route.ts` | Lists the candidates before the existing Shared Initial call (status ON and OFF paths) |
| Tests | `memory-episodic-correction.test.ts` (new, 10), `memory-episodic-past-event-slots.test.ts` (B8-2 link suite replaces the same-key suite), `episodicMemoryTemporal.test.ts` |

## BEFORE

Fixture: T30 assistant scene "늑대가 에녹의 왼팔을 깊이 물어뜯었다." (`character:enoch:injury`, verified `CURRENT_SCENE`), fillers up to T1000, questions asked at T500 and T1000 (outside RAW).

| Case | main `e808831f` | reviewed `71e39dff` |
|---|---|---|
| A. T120 user corrects the same event (same key) | pass (latest-wins) | pass (same-key correction) |
| B. T200 user tells a separate right-hand injury (same key) | **fail**: T30 is gone, only T200 remains | **fail**: same |
| C. corrected at T120, separate T312 injury (scene or user) | **fail**: T312 replaces the correction | **fail**: same |
| D. T30 filed as `scene_event`/`action`, correction under `injury_cause` | **fail**: wolf cause still injected | **fail**: same |
| Unclear statement, no target | **fail**: T30 replaced by latest-wins | **fail**: same |

`link-probe.mts` on the production save path: main 21 pass / 17 fail, `71e39dff` 21 pass / 17 fail (`logs/link-probe/main-e808831f.log`, `prev-71e39dff.log`). Example, B on both trees at T500:

```
-- B state old cause @T500 q="예전에 에녹 왼팔은 왜 다쳤었지?" -> FAIL
   missing: “늑대가 에녹의 왼팔을 깊이 물어뜯었다.”
   - [T200] [유저 입력 발췌] “어제 훈련하다 칼에 오른손을 베였잖아.”
```

Live, before (main prompt, same S1 input): the extractor returned `"extracted_facts":[]` for the explicit correction turn (`logs/live/1-before-main-e808831f-S1.log`), so main never stored the correction in the first place.

## ROOT CAUSE

1. **Correction was inferred from the key.** Round 2 treated "same `category:subject:attribute` + a later `explicit_user_statement`" as a correction of the earlier verified record. A separate event on the same key (B, C) satisfies that rule just like a correction does, and a correction filed under another key (D) never does. Nothing in the stored data said which record the user meant, so no key-based rule can satisfy both A and B.
2. **Narrator dependence.** On a state-worded T30 gloss ("…상처가 남아 있다"), a later separate event closed T30 only when the assistant narrated it (historical scene occurrence). The same event stated by the user did not close T30, so B/C flipped by narrator.
3. **Extraction omitted the correction (found live).** The first `corrects` wording only said when to fill the handle. `gpt-6-luna` returned no fact for an explicit correction on main and on that wording (2/2), so the link never formed in production.

## AFTER

### Contract: bounded candidates, handle output, server mapping

The server lists up to 6 records the user can correct this turn (`listEpisodicCorrectionCandidates`). It reuses the lexical recall pass with min age 0 (no semantic query, no provider call). They go into the **existing** Shared Initial user block as handles. The system prompt stays the same for every turn.

```
[CORRECTABLE PAST RECORDS — episodic corrects may only copy one of these handles]
- C1 [T30] 에녹은 늑대에게 물려 왼팔을 크게 다쳤다. (source: “늑대가 에녹의 왼팔을 깊이 물어뜯었다.”)
```

With no candidates the block says `(none → corrects "")`. The schema requires `corrects` on every fact, restricted to `["", "C1".."C6"]`. The parser maps the handle back to the fact id it offered. A handle that was not offered, or a raw id in any field, is ignored. The model never sees or outputs a fact id.

Prompt: the existing line "- NEVER generate source_turn, id, uuid, or timestamp." is **replaced** (not added to) by one line:

```
- corrects: "" by default. When the CURRENT USER explicitly says a [CORRECTABLE PAST RECORDS] entry got that same event wrong, record the corrected fact (explicit_user_statement quoting the user's correction, source_role=user) and copy that entry's handle. A new separate event, a recovery or later change, or an unclear target is never a correction. NEVER output an unlisted handle, source_turn, id, uuid, or timestamp.
```

| Input (user / assistant) | Expected `corrects` | Result |
|---|---|---|
| "늑대에게 물린 게 아니라 문에 팔이 끼인 거야. 같은 사건이야." | `C1` | link to T30 |
| "어제 훈련하다 칼에 오른손을 베였잖아." (separate) | `""` | no link |
| "치료를 마친 에녹의 왼팔은 완전히 회복되었다." (recovery) | `""` | no link |
| "…좀 다른 것 같기도 하고… 잘 모르겠다." (unclear) | `""` | no link, nothing invalidated |
| `C4` when only `C1` was offered, or `correction_target_fact_id: 30` from the model | — | ignored, no link |

### Save: link validation

`metadata.correction = {target_fact_id, target_source_turn}` is stored only when all of these hold:

- the fact's evidence is verified against the saved message with `role = user` and authority `USER_EXPLICIT`;
- the target row exists in the same scope (chat, character/user, memory-reset boundary);
- the target's `source_turn` is earlier than the correction's.

Otherwise the fact is saved as an ordinary record and `EPISODIC_CORRECTION_LINK_REJECTED` is logged. A link is never derived from the key. Nothing is physically deleted: the target row stays in the DB with its verified quote.

### Recall: quote verified vs. currently valid

The target's quote is still **verified** (its row and evidence are untouched), but it is no longer **currently valid canon** once a valid link supersedes it.

- `resolveEpisodicCorrectionLinks` makes one scoped query for links (LIMIT 200) and one for missing targets. A link counts only if the target still exists with the same `source_turn`, so a regenerated target leaves a dangling link that does nothing. Chains (correction of a correction) resolve to the latest, depth ≤ 3.
- Each candidate that has been corrected is replaced by its root record for reconcile. Then the root is substituted by its latest correction. If the correction is in the RAW window or guard-blocked, the record is dropped without a duplicate.
- Current-state keys keep latest-wins. Past events are kept by the round 1 classifier and the #1651 closure. A user-stated completed occurrence (`isUserStatedOccurrence`) now closes an earlier scene record the same way an assistant-narrated occurrence does. It is not itself classified as historical, so the user's own state statements (job, relationship status) stay latest-wins.

AFTER, A (state gloss) at T500 and T1000 (`logs/link-probe/fix-b1982cee.log`):

```
id=30  T30  injury=left_arm_bitten         role=assistant authority=CURRENT_SCENE quote=“늑대가 에녹의 왼팔을 깊이 물어뜯었다.” correction=null
id=120 T120 injury=left_arm_caught_in_door role=user      authority=USER_EXPLICIT quote=“늑대에게 물린 게 아니라 문에 팔이 끼인 거야.” correction={"target_fact_id":30,"target_source_turn":30}
-- A state @T500 q="예전에 에녹 왼팔은 왜 다쳤었지?" -> PASS
   - [T120] [유저 입력 발췌] “늑대에게 물린 게 아니라 문에 팔이 끼인 거야.”
```

AFTER, C (corrected at T120, then a separate user-told T312 injury on the same `injury` key), two questions at T500:

```
-- C state/user statement corrected cause @T500 q="예전에 에녹 왼팔은 왜 다쳤었지?" -> PASS
   - [T120] [유저 입력 발췌] “늑대에게 물린 게 아니라 문에 팔이 끼인 거야.”
-- C state/user statement T312 @T500 q="에녹 오른손은 왜 다쳤었지?" -> PASS
   - [T312] [유저 입력 발췌] “어제 훈련하다 칼에 오른손을 베였잖아.”
```

### Live extraction (production call path, isolated DB)

Path: `runPostTurnRelationshipOnlyInitial` → `runPostTurnSharedInitial` → `callBackgroundMemory` (`gpt-6-luna`, the status OFF shape: relationship + episodic, suggestions off) → `parsePostTurnSharedInitialResponse` → `reconcileEpisodicMemoryFactsForGeneration` → `getEpisodicMemoryForPrompt` at T500/T1000. Only the current turn is live; T30 and fillers are seeded. In-memory chat DB, temporary `DATA_DIR`, benchmark key, no production DB. Script: `live-extraction.mts`; logs: `logs/live/`; per-call ledger: `logs/live/call-ledger.json`. The provider did not return `responseModelId`; the requested model is `gpt-6-luna`.

| # | Tree / prompt | Case | Input tok (cache read) | Output tok | `corrects` | Stored / injected at T500, T1000 | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | main `e808831f` | S1 explicit correction | 2,369 (0) | 40 | no facts | T30 wolf bite only | correction not stored (BEFORE) |
| 2 | v1 wording | S1 | 2,542 (0) | 40 | no facts | T30 only | FAIL: extraction omitted |
| 3 | v1 wording | S2 implicit correction | 2,535 (2,362) | 40 | no facts | T30 only | FAIL: extraction omitted |
| 4 | v2 (`b1982cee`) | S1 | 2,549 (0) | 145 | `C1` | T120 user quote only | PASS |
| 5 | v2 | S2 "그때 창고 문에 왼팔이 끼여서 다친 거였어." | 2,542 (2,369) | 146 | `C1` (key `left_arm_injury_cause`) | T120 user quote only | PASS |
| 6 | v2 | S3 separate right-hand injury | 2,536 (2,369) | 40 | no facts | T30 kept | PASS on link; the new event was not extracted |
| 7 | v2 | S4 recovery | 2,535 (2,369) | 135 | `""` | T30 + T80 recovery | PASS |
| 8 | v2 | S5 unclear | 2,523 (2,369) | 40 | no facts | T30 kept | PASS |
| 9 | v2 | S6 = D, T30 filed `scene_event` | 2,549 (2,546) | 145 | `C1` (key `injury_cause`) | T120 user quote only | PASS |
| 10 | v2 | S1 repeat | 2,549 (2,546) | 148 | `C1` | T120 user quote only | PASS |
| 11 | v2 | S3 repeat | 2,536 (2,533) | 40 | no facts | T30 kept | PASS on link |

Cost: 11 calls, billed $0.001105 (`cheaperInferenceBilledCostUsd`), about 1.66 KRW at 1,500 KRW/USD. The budget was ≤ 12 calls and ≤ 100 KRW. Input tokens per call: main 2,369 → this branch 2,549 (+180, +7.6%: the candidate block, the reworded line and the enum). Output tokens change only when a correction fact is now recorded. The number of production calls per turn is unchanged (the candidates ride the existing Shared Initial call).

## REMOVED

| Removed | Why it is safe |
|---|---|
| `findUserCorrectedSceneRecordIds` (same-key correction lookup, round 2) in `episodicMemoryFacts.ts` | Replaced by the explicit link. It was the cause of B/C. Rows written by round 2 have no link field; round 2 never shipped (Draft) |
| `isUserCorrectableSceneRecord` in `episodicMemoryTemporal.ts` | Its only reader was the lookup above |
| Prompt line "- NEVER generate source_turn, id, uuid, or timestamp." in the Shared Initial episodic body | Merged into the `corrects` line, which keeps that prohibition. The standalone extractor (`EPISODIC_FACTS_EXTRACT_INSTRUCTIONS`) keeps the original line |
| `correction-probe.mts` and `logs/correction-probe/` (round 2) | Superseded by `link-probe.mts`, which covers A–F on main, `71e39dff` and this branch |
| Round 2 fixture TAPs (`fixture-on-*`, `fixture-after.tap`) and old related-suite summaries | Replaced by `logs/tests/*-b1982cee.*` and per-tree summaries |

## PRESERVED

- **#1651 and round 1/2 preservation.** A same-key or other-key recovery keeps the verified T30 cause for both gloss wordings ("…크게 다쳤다." / "…상처가 남아 있다.") at T500/T1000 (`B8-2 — #1651 preservation`, 4 tests). The B7 T30 flank cause stays injected: all 26 B7 replay probes are content-identical to `71e39dff` once timing is removed (`L500-A5`: `- [T30] [AI 장면 서술 발췌] “발톱이 태형의 왼쪽 옆구리를 꿰뚫었다.”`).
- **User correction authority.** A linked correction is always a verified user quote and wins over the record it names (A, D, the chain test).
- **Independent events.** B and C keep both events, for an assistant-narrated or a user-stated later event, and for both gloss wordings.
- **Current-state latest-wins.** Job, location, preference and relationship status under a verified source stay latest-wins (`memory-b2-source-lineage` "promise made then cancelled" passes).
- **Source authority.** Assistant quotes, character claims, unoffered handles and raw ids never create a link.
- **Boundaries (F).** Deleting or regenerating the correction turn, or editing its user source, restores the record. A deleted target leaves the correction as an ordinary record. A memory reset or another chat never crosses.
- **Budgets.** Global 10,000 chars, Episodic 8 facts / 1,000 chars, the existing search budgets, the RP 3,200+ target and no output cap are untouched. B7 block chars ≤ 1,099.

## REGRESSION RISKS (for GPT review)

1. **The link depends on the model choosing the handle.** 4/4 live corrections linked and 0/5 non-corrections linked, but that is 9 samples on synthetic text. A wrong `C#` on a real separate event would hide the earlier record. It stays in the DB and comes back when the correcting turn is deleted, regenerated or edited.
2. **The extraction change is real.** The reworded line makes the extractor record a correction fact where it used to record nothing. The non-correction cases (S3, S4, S5) show the same output as before (no facts, or a recovery with `corrects:""`).
3. **Candidate discovery is lexical on the user message.** "팔은 이제 괜찮아?" does not match a record about "왼팔" (pre-existing relevance gap), so no candidate is offered. A correction that names nothing lexically shared with the record cannot link. In that case nothing is invalidated (unresolved) and the record stays.
4. **One extra lexical recall pass per eligible turn** (`listEpisodicCorrectionCandidates`, in-process SQLite, no provider). B7 recall passes take about 6–9 ms each.
5. **The separate same-key event in S3 was not extracted live (2/2).** That is extraction recall for user-told past events and was the same before this change. The fixture/probe B case proves preservation when such an event is stored.

## PROOF

### Fail-before / pass-after on the production save path (`link-probe.mts`, 38 checks)

| Tree | Pass | Fail | Failing cases |
|---|---|---|---|
| main `e808831f` | 21 | 17 | B ×4, C ×8, D ×4, unclear ×1 |
| reviewed `71e39dff` | 21 | 17 | same |
| this branch `b1982cee` | 38 | 0 | — |

### Fixture tests (`logs/tests/fixture-final-b1982cee.tap`)

`memory-episodic-past-event-slots.test.ts`, `memory-episodic-correction.test.ts`, `episodicMemoryTemporal.test.ts`: **98/98 pass**. The B8-2 link suite runs every turn through `listEpisodicCorrectionCandidates` → `parseSharedEpisodicSection` → `reconcileEpisodicMemoryFactsForGeneration` → `getEpisodicMemoryForPrompt`:

- A, B and C for both gloss wordings, D and E, and the unclear case, at T500 and T1000 (18 tests).
- A recovery between the record and its correction; a correction of a correction.
- Candidate list behavior; link validation (assistant quote, unoffered handle, raw id, other chat, later target).
- F: delete, regenerate, user source edit, deleted target, memory reset and another chat.
- The RAW window, and the stored rows.

The 98 passing tests do not cover the gaps listed under REGRESSION RISKS 1, 3 and 5.

### Related regression set (84 files, `logs/tests/related-files.txt`, one invocation, fresh `DATA_DIR`, provider keys stripped by `regularTestEgressPolicy`)

| Tree | Tests | Pass | Fail |
|---|---|---|---|
| main `e808831f` | 1,026 | 1,006 | 20 |
| reviewed `71e39dff` | 1,055 | 1,035 | 20 |
| this branch `b1982cee` | 1,087 | 1,067 | 20 |

The 20 failing leaf tests are identical across all three trees (`logs/tests/related-*.summary.txt`). The causes are pre-existing: the min-age floor in old fixtures, save without `evidenceBinding`, missing `releaseLlm` mocks, a test schema without `global_projection_kind`, and `extractV4Fallback` (also failing on main when run alone). The unrelated full suite was not rerun.

### B7 replay (0 provider calls)

`run-probes.sh /tmp/b7 <out>` on the isolated B7 snapshots: 26/26 probes content-identical to the committed `logs/probes-after/` (only `firstCallMs` and `avgMsOver50` differ).

### Static checks

`git diff --check` clean; `npm run lint` and `npm run typecheck:app` pass.

## LIMITS / FOLLOW-UPS (not in this PR)

- **Existing rows have no link.** Rows saved before this change are not linked, and none are linked speculatively; same-key corrections in existing data stay as they are under the round 1/2 rules (both kept).
- **The standalone extractor can't link.** `memory-episodic-extract.ts` has no candidate list, so it never outputs a link.
- **Dangling link after the target is regenerated.** The correction stands alone as an ordinary record.
- **Passive `…였다` endings.** `looksLikeCompletedOccurrence` treats them as copula past (e.g. "베였다"), so such a user gloss does not close an earlier scene record.
- **Lexical candidate discovery gap** (Risk 3) and **extraction recall for user-told past events** (Risk 5).
- **Round 2 follow-ups still open:** injection diversity for repeats, 25-key cap saturation, promise completion, 1000-turn real-RP verification, #1591 (untouched).

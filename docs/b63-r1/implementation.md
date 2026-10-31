# B63-R1c implementation — comparison-only RAW6 + delivered detail + original excerpts

Status: implementation Draft. **No paid calls were made for this change.** Operational
defaults remain RAW4 / 10k history / no comparison projections.

## Scope

The comparison path is enabled only by explicit options:

- `buildMemoryContextForPreview/ForChat({ comparisonMode: true, ... })`
- `buildContext({ comparisonRawExchanges: 6, comparisonHistoryTokenBudget: ... })`

Normal `/api/chat` calls do not set these options, so the production RAW4/10k behavior is
unchanged.

## Changes

### 1. RAW6 final messages

- `ContextBuildInput.comparisonRawExchanges` raises the history floor.
- `ContextBuildInput.comparisonHistoryTokenBudget` supplies the comparison history budget.
- The real fixture uses 60,000 history tokens and keeps 12 RAW messages (T95–100) + the
  current question = 13 history messages. Final input estimate: **~81,337 tokens**
  (system 22,535 + history 58,802).
- If the budget cannot hold 6 exchanges, the caller must inspect `history.length` and the
  final message list; the builder does not silently claim RAW6.

### 2. Delivered recent detail (R1c)

`src/lib/memory/memory-b63-comparison.ts`:

- `buildRecentTurnDetailProjection` reads existing `chat_turn_summaries` rows only.
- Range: the 20 turns immediately before RAW (100 turns → RAW95–100, detail75–94).
- Budget: **10,500 chars / 10,000 estimated tokens**, which fits 20 turns × 500 chars plus
  header, labels, and newlines. Per-block body cap is 500 chars per covered turn.
- Selection is **newest-first**. If the budget is tight, the oldest rows are omitted; an
  older summary cannot evict a newer one.
- `coveredTurns` is computed from the blocks actually delivered, not from eligible records.
- `missingTurns` = detail turns with no usable stored record.
  `omittedTurns` = detail turns whose stored record was excluded by the output budget.
  They are reported separately.
- `coverageComplete` means every requested detail turn was delivered.
  `charTargetMet` means every delivered turn has at least 400 chars of body per turn.
  `targetMet` requires both. A source summary shorter than 400 chars is reported in
  `shortTurns`; it is not padded or fabricated.
- Header, labels, and newlines are included in the char/token cap before a block is
  accepted.
- Records overlapping `detailStart` are eligible (for example a `[T71~75]` row when detail
  starts at T75). A record crossing RAW (`turnEnd > detailEnd`) is left to Global/search so
  RAW is not duplicated.
- Detail is rendered in the dynamic section `[2z2] Recent turn detail`.

`memory-manager` integration:

- Global/Medium exclude only records **fully covered** by delivered detail blocks
  (`excludeCoveredRanges`). A record that straddles a delivered block and an omitted turn
  stays in Global.
- Search excludes only fully covered records; a partially covered record remains
  searchable. This prevents a nominal detail interval from hiding turns detail did not
  actually deliver.
- Comparison mode does not fall back to `chat_memories.recent_summary`, so a stale stored
  summary cannot duplicate detail.
- If detail coverage is incomplete, the caller can read `coverageComplete`,
  `budgetLimited`, `missingTurns`, `omittedTurns`, and `shortTurns`; a gap is never reported
  as complete coverage.

### 3. Query-focused original excerpts (R1c)

`searchPastTurnSummaries`:

- Reads existing `chat_turn_summaries` through the existing injectible-record owner.
- Scoring reuses `inspectLexicalRelevanceForDebug` / the existing lexical tokenizer and the
  IDF-like rare-token gate.
- Excluded ranges: RAW (overlap) and detail blocks already delivered (fully covered).
  Inactive, noncanon, and closed-branch rows are excluded by the existing filter.
- The top hit carries a bounded original excerpt selected by query/scene match:
  - query-matched messages use a window around the best match;
  - a long message without a query token keeps a prefix and a suffix, so a late quote is
    not dropped;
  - spans record turn number, speaker role, message ID, and character offsets;
  - `hit.original` is the full loaded turn content; `hit.originalSpans` /
    `hit.originalExcerpt` / `hit.promptLine` are exactly what reached the prompt.
- `hit.summary` is the full stored summary; `hit.summaryInPrompt` is the bounded text used
  in the prompt. Lower hits keep their exact turn range and do not add an original excerpt.
- Search output includes the final header in its char/token cap.
- Search is rendered in the dynamic section `[3a2] Past summary search`.
- No new model call, vector DB, graph, table, generic parser, or parallel memory owner.

## Pure-main real fixture (no B62 injection)

`R1c/real-fixture/` in the evidence repo.

| item | value |
|---|---|
| RAW final | T95–100 (6 exchanges) |
| Recent detail | T75–94 (20 per-turn rows) |
| Detail coverage | complete; missing/omitted none |
| Detail char target | not met by source data: 18/20 rows are below 400 chars (source 232–463) |
| Detail chars / est tokens | 6,907 / 6,217 (cap 10,500 / 10,000) |
| Global older | T1–74 |
| Search exclusions | RAW T95–100; fully delivered detail T75–94 |
| Final messages | 14 (system + 12 RAW + current) |
| History messages | 13 |
| System chars / est tokens | 25,038 / 22,535 |
| History chars / est tokens | 65,323 / 58,802 |
| Search chars / est tokens | 2,376 / 2,139 (cap 5,000 / 2,500) |
| Duplicate detail/RAW | false |

### Search results

| query | hits | top range | prompt excerpt |
|---|---|---|---|
| T20 speaker + tunnel cue | 2 | T16–20 | 1,151 chars, 4 spans |
| T50 desire + contract cue | 3 | T46–50 | 864 chars, 3 spans |
| T71 promise + med bay cue | 3 | T66–70 (plan-as-event), T71 second | 1,155 chars, 4 spans |
| T80 ring | 0 | — | detail T75–94 already contains T80 |
| weather (negative) | 0 | — | — |
| `오스카` name only | 0 | — | — |
| other chat | 0 | — | — |
| inactive row | 0 | — | — |
| closed branch | 0 | — | — |

The final combined prompt's top-3 search block contains T56–60, T71, and T74; T20/T50 are
verified by their individual queries but are not in that combined top-3. The combined query
did not request T20; T50 is a ranking limitation, not a claim that all old facts are
injected.

## GPT R1b counterexamples

`R1c/counterexamples/` in the evidence repo. The exact GPT script plus direct R1c cases:

| case | before (`be52dbfc`) | after |
|---|---|---|
| 20×450 detail | delivered T75–89; covered claimed T75–94; omitted T90–94 | delivered/covered T75–94; no omission |
| 20×500 detail | delivered T75–87 under 7,000 cap | all 20 delivered; 10,183 chars ≤ 10,500 |
| tiny header cap | maxChars 107 → chars 130 | chars 0; block omitted, not over cap |
| newest-first | oldest T75–83 delivered; newest T84–94 omitted | newest T86–94 delivered; oldest omitted |
| 5-turn boundary | T75 missing; `[T71~75]` excluded | `[T71~75]` delivered; T75 covered |
| middle original quote | only T16/T20 loaded; T18 quote absent | T18 quote present; span/offset/message ID recorded |
| late original quote | retained in `hit.original`, absent from prompt | present in prompt excerpt |
| fully covered search row | still returned | excluded |
| partially covered search row | returned | returned (not hidden) |

## Tests

- `src/lib/memory/memory-b63-comparison.test.ts`: 19 tests, 18 pass; 1 Windows EPERM
  temp-DB cleanup only. Covers 20×450/500, header caps, newest-first, missing vs omitted,
  5-turn boundary, Global partial coverage, middle/late original quotes, fully/partially
  covered search rows, RAW6, and comparison-off RAW4/10k.
- `memory-injector`, `memory-summary-persist`, `memory-medium-term`,
  `contextBuilder.memoryCoverage`: 45 pass, 2 EPERM only.
- `memory-50turn-lifecycle`: 1 pass, 1 EPERM only; same on main.
- `nextTurnAssemblyPreparation`: 7 pre-existing assertion failures on main and branch
  (model-picker snapshot fixture; unrelated to this change).
- `npm run lint` (`typecheck:app`) and `git diff --check` pass.

## Remaining uncertainty

- Per-turn summaries were generated from 5-turn batch input; this is record granularity,
  not causal per-turn extraction.
- The real source summaries are 232–463 chars, so the 20×400 target is not met without
  fabrication; `shortTurns` reports this. The cap now supports 20×500 synthetic rows.
- T71's top search hit is T66–70 (the plan is stated in T68/T70 status windows), not the
  T71 execution row. T71 is second.
- The combined final query's top-3 does not include T50.
- 500/1,000-turn behavior is not tested.
- RP use of retrieved records is not measured here; retrieval existence is not RP success.
- 60k history is a comparison-only cost increase. The next A/B must hold RAW and input
  budgets equal.

## Minimal paid questions proposed (not executed)

Only after approval. No answer/turn numbers in implicit prompts.

1. Explicit recall, old distance: “예전에 오스카가 제이에게 했던 약속 중, 처치가 끝날 때까지 기다리라는 지시가 있었어?”
2. Implicit scene cue, old distance: “메디컬 베이 냄새가 나는 장면에서, 예전에 누가 누구를 기다리기로 했는지 자연스럽게 이어서 보여줘.”
3. No-recall control: “라운지의 저녁 메뉴를 이어서 묘사해.”
4. RAW6 recent continuity: “방금 루프탑에서 있었던 일을 이어서.”
5. Detail check: “그 반지가 다음 날 누구 손에 있었는지, 같은 물건인지 확실한지만 말해줘.”

Estimated 5 calls × ~$0.01–0.02 ≈ **$0.05–$0.10**. Not executed.

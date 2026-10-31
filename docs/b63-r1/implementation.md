# B63-R1b implementation — comparison-only RAW6 + recent detail + past search

Status: implementation Draft. **No paid calls were made for this change.** Operational
defaults remain RAW4 / 10k history / no comparison projections.

## Scope

The new path is enabled only by explicit comparison options:

- `buildMemoryContextForPreview/ForChat({ comparisonMode: true, ... })`
- `buildContext({ comparisonRawExchanges: 6, comparisonHistoryTokenBudget: ... })`

Normal `/api/chat` calls do not set these options, so the production RAW4/10k behavior is
unchanged.

## Changes

### 1. RAW6 final messages

- `ContextBuildInput.comparisonRawExchanges` raises the history floor.
- `ContextBuildInput.comparisonHistoryTokenBudget` supplies the comparison history budget.
- The real fixture uses 60,000 history tokens and keeps 12 RAW messages (T95–100) + the
  current question = 13 history messages. The final provider input estimate is
  **~80,933 tokens** (system 22,131 + history 58,802).
- If the budget cannot hold 6 exchanges, the builder does not silently claim RAW6; the
  caller must inspect `history.length` and the final message list.

### 2. Bounded recent detail

- New `src/lib/memory/memory-b63-comparison.ts`:
  - `buildRecentTurnDetailProjection` reads existing `chat_turn_summaries` rows only.
  - Range: the 20 turns immediately before RAW (100 turns → RAW95–100, detail75–94).
  - Limits: 7,000 chars / 8,000 estimated tokens.
  - Real per-turn ranges are labeled `[T75]`; a 5-turn record is labeled `[T71~75]`.
  - Missing turns are returned in `missingTurns` and never filled with a placeholder.
- In comparison mode, Global is cut at `detailStart` and records overlapping the detail
  range are excluded (`excludeTurnEndGte`), so Global/Detail/RAW do not duplicate.
- Detail is rendered in the dynamic section `[2z2] Recent turn detail`.

### 3. Old-summary search + original link

- `searchPastTurnSummaries` reads existing `chat_turn_summaries` rows through the existing
  injectible-record owner.
- Scoring reuses `inspectLexicalRelevanceForDebug` / the existing lexical tokenizer, plus
  an IDF-like rare-token gate. A recurring character name alone is not enough.
- Excluded ranges: detail and RAW. Inactive, noncanon, and closed-branch rows are excluded
  by the existing injectible-record filter.
- The top hit carries a bounded original-message excerpt (start and end turn of the range)
  with `userMessageId` / `assistantMessageId`. Lower hits keep the exact turn range.
- Search is rendered in the dynamic section `[3a2] Past summary search`.
- No new model call, vector DB, graph, table, or parallel memory owner.

## Pure-main real fixture (no B62 injection)

`R1b/real-fixture/` in the evidence repo.

| item | value |
|---|---|
| RAW final | T95–100 (6 exchanges) |
| Recent detail | T75–94 (20 per-turn rows) |
| Global older | T1–74 |
| Search exclusions | T75–94, T95–100 |
| Final messages | 14 (system + 12 RAW + current) |
| History messages | 13 |
| System chars / est tokens | 24,589 / 22,131 |
| History chars / est tokens | 65,323 / 58,802 |
| Detail chars / est tokens | 6,907 / 6,217 |
| Search chars / est tokens | 1,910 / 1,719 |
| Duplicate detail/RAW | false |
| Missing detail turns | none |

### Search results

| query | hits | top range | original link |
|---|---|---|---|
| T20 speaker + tunnel cue | 2 | T16–20 | T16–20 start/end |
| T50 desire + contract cue | 3 | T46–50 | T46–50 start/end |
| T71 promise + med bay cue | 3 | T66–70 (plan-as-event), T71 second | T66–70 start/end |
| T80 ring | 0 | — | detail T75–94 already contains T80 |
| weather (negative) | 0 | — | — |
| `오스카` name only | 0 | — | — |
| other chat | 0 | — | — |
| inactive row | 0 | — | — |
| closed branch | 0 | — | — |

The final combined prompt's top-3 search block contains T56–60 (with original), T71, and
T74; T20/T50 are verified by their individual queries but are not in that combined
top-3. This is a retrieval-ranking limitation, not a claim that all old facts are injected.

## Tests

- `src/lib/memory/memory-b63-comparison.test.ts`: 9 tests, 8 pass; 1 Windows EPERM
  temp-DB cleanup only. The 8 passing bodies cover detail range/missing turns, query and
  scene-cue search, original links, name-only negative, unrelated/other-chat negative,
  inactive/closed/detail/RAW exclusion, RAW6 final messages, and dynamic sections.
- `memory-injector`, `memory-summary-persist`, `memory-medium-term`,
  `contextBuilder.memoryCoverage`: 53 pass, 3 EPERM only.
- `memory-50turn-lifecycle`: 1 pass, 1 EPERM only; same on main.
- `nextTurnAssemblyPreparation`: 7 pre-existing assertion failures on main and branch
  (model-picker snapshot fixture; unrelated to this change).
- `npm run lint` (`typecheck:app`) and `git diff --check` pass.

## Remaining uncertainty

- Per-turn summaries were generated from 5-turn batch input; this is record granularity,
  not causal per-turn extraction.
- T71's top search hit is T66–70 (the plan is stated in T68/T70 status windows), not the
  T71 execution row. T71 is second.
- The combined final query's top-3 does not include T20/T50.
- 500/1,000-turn behavior is not tested.
- RP use of retrieved records is not measured here; retrieval existence is not RP success.

## Minimal paid questions proposed (not executed)

Only after approval. No answer/turn numbers in implicit prompts.

1. Explicit recall, old distance: “예전에 오스카가 제이에게 했던 약속 중, 처치가 끝날 때까지 기다리라는 지시가 있었어?” (T71)
2. Implicit scene cue, old distance: “메디컬 베이 냄새가 나는 장면에서, 예전에 누가 누구를 기다리기로 했는지 자연스럽게 이어서 보여줘.” (no turn number/answer)
3. No-recall control: “라운지의 저녁 메뉴를 이어서 묘사해.” (search should not inject old records)
4. RAW6 recent continuity: “방금 루프탑에서 있었던 일을 이어서.” (RAW, not long-term)
5. T80 detail check: “그 반지가 다음 날 누구 손에 있었는지, 같은 물건인지 확실한지만 말해줘.” (detail T80)

Estimated 5 calls × ~$0.01–0.02 ≈ **$0.05–$0.10**. Not executed in R1b.

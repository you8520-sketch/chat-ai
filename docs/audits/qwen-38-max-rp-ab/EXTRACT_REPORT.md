# Qwen3.8-Max RP A/B extract (data only)

No scores. No gates. No candidate verdict.
F / G / H / K are left blank for an external scorer.

Production / picker / pricing / common prompt / Qwen adapter / Gemini: unchanged and uncalled.
GLM freeze is recorded only; GLM was not re-called.

Data collected at harness HEAD `11d15bb451a3c9cd8ed122fcb8fe1c67cb288c8c`.
This report commit SHA is the repo HEAD after the extract files land.

## A. Qwen exact CI catalog entry

Source: `GET https://api.cheaperinference.com/v1/models`
File: `catalog-qwen-38-max.json`

| field | value |
| --- | --- |
| exact model id | `qwen-3-8-max` |
| provider | Alibaba |
| endpoint | `/v1/chat/completions` |
| chat URL | `https://api.cheaperinference.com/v1/chat/completions` |
| context | catalog field absent (`null`) |
| reasoning capability | `true` |
| streaming | `true` |
| input rate | `1.400000` USD / 1M |
| cached input rate | `0.218750` USD / 1M |
| cache write rate | `2.187500` USD / 1M |
| output rate | `4.200000` USD / 1M |
| discount_percent | `30.00` |
| fetchedAt | `2026-08-17T03:50:15.948Z` (first snapshot); RP-phase recapture `2026-08-17T03:50:54.383Z` same rates |

This snapshot is not a production price. Each call `usage.cost` is source of truth.

## B. reasoning / transport result

File: `01-transport-probe.json`

Production adapter for `qwen-3-8-max`: delete `thinking`, set `reasoning_effort=none`.
RP A/B used that same setting. No high/medium.

Probe prompt: `Reply exactly: ok`

| field | value |
| --- | --- |
| HTTP | 200 |
| streaming | true |
| finish_reason | `stop` |
| text | `ok` |
| prompt tokens | 65 |
| completion tokens | 27 |
| reasoning tokens (usage field) | 0 / absent |
| cache fields | absent |
| usage.cost | `0.000205` |
| upstream_inference_cost | `0.000205` |
| latencyMs | 2442 |
| ttftMs | 1841 |
| sent reasoning | `reasoning_effort=none`; `reasoning`/`thinking`/`include_reasoning` omitted |

Observed: even with `reasoning_effort=none`, the stream still emitted a reasoning delta (`reasoningText` present). Usage did not expose `reasoning_tokens` / cache details. RP A/B kept this same production setting.

## C. Qwen A/B exact assembled diff

File: `02-assembled-diff-audit.json`

Snapshot reused from GLM first experiment (조태형 / 렌 / same 4 seeds / greeting-only history).

A = vanilla (strip `prose-style-xml-bundle` + `rule-output-layout-recency` + user-tail layout/length owners).
B = current production common prose/output stack. No new Qwen wording.

| slice | identical on all 4 seeds |
| --- | --- |
| character | yes |
| history | yes |
| persona | yes |
| current user | yes |
| memory | yes (empty) |
| agency | yes |
| sampling | yes (`temperature=0.7`, `max_tokens` omitted, `stream=true`) |
| reasoning | yes (`reasoning_effort=none`) |

A system ≈ 3961 chars. B system ≈ 6463 chars.
A last-user has no 3,200자 owner / layout owner. B last-user has both.

## D. Qwen 8-call metrics

retry = 0, continuation = 0, recovery = 0.

| cell | arm | chars+sp | chars-sp | inTok | outTok | reasonTok | cacheR/W | paras | dlg n/ratio | latencyMs | ttftMs | finish | usage.cost |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- | ---: | ---: | --- | ---: |
| S1-A | VANILLA | 551 | 404 | 2685 | 2236 | 0 | 0/0 | 8 | 4 / 0.500 | 58726 | 3254 | stop | 0.013151 |
| S1-B | COMMON | 3651 | 2699 | 4131 | 16014 | 0 | 0/0 | 40 | 18 / 0.450 | 311662 | 3203 | stop | 0.071833 |
| S2-A | VANILLA | 587 | 434 | 2700 | 2326 | 0 | 0/0 | 9 | 4 / 0.444 | 57596 | 3067 | stop | 0.011130 |
| S2-B | COMMON | 3900 | 2887 | 4146 | 12660 | 0 | 0/0 | 42 | 16 / 0.381 | 269173 | 4874 | stop | 0.055348 |
| S3-A | VANILLA | 568 | 415 | 2712 | 2948 | 0 | 0/0 | 11 | 5 / 0.455 | 72471 | 2862 | stop | 0.013760 |
| S3-B | COMMON | 3234 | 2382 | null | null | null | null | 45 | 21 / 0.467 | 259310 | 3223 | null | null |
| S4-A | VANILLA | 477 | 355 | 2713 | 2850 | 0 | 0/0 | 8 | 4 / 0.500 | 70699 | 2440 | stop | 0.013349 |
| S4-B | COMMON | 1871 | 1385 | null | null | null | null | 28 | 12 / 0.429 | 302894 | 3274 | null | null |

S3-B and S4-B: HTTP 200, visible text present, stream closed without `usage` and without `finish_reason`. Not retried.

`reasonTok` from usage is 0/absent on every settled call, but every cell streamed a large reasoning delta (`raw/*.reasoning.txt`). Completion tokens on settled B cells are much larger than visible Korean length.

## E. raw outputs

Visible:

- `raw/S1-A.txt` … `raw/S4-B.txt`
- blind pack: `blind/S1-X.txt` … `blind/S4-Y.txt` (key in `blind/BLIND_KEY.json`)

Reasoning deltas:

- `raw/S1-A.reasoning.txt` … `raw/S4-B.reasoning.txt`

Per-cell metrics: `calls/S1-A.json` … `calls/S4-B.json`
All-in-one: `03-call-metrics.json`
Path map: `SCORER_MAP.md`

## F. QWEN_COMMON_PROMPT_SIGNAL

_(left for scorer)_

## G. QWEN38 verdict

_(left for scorer)_

## H. GLM vs Qwen blind

Not run. Only if scorer marks `DIRECT_COMPARE_CANDIDATE`.
If that happens later, GLM side = first-experiment COMMON_PROSE_OUTPUT, not the failed 2-sentence stability adapter.

## I. actual cost comparison

Settled `usage.cost` only (6/8 cells). S3-B / S4-B have no usage object.

| group | n settled | sum cost | avg cost | cost / 1000 visible chars | avg inTok | avg outTok | cache hit | avg latencyMs | avg ttftMs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| A vanilla | 4/4 | 0.051390 | 0.012848 | 0.023541 | 2702.5 | 2590 | no | 64873 | 2906 |
| B common (settled only) | 2/4 | 0.127181 | 0.063591 | 0.016843 | 4138.5 | 14337 | no | 290418 | 4039 |
| all settled | 6/8 | 0.178571 | 0.029762 | — | — | — | no | — | — |

B all-4 averages in `03-call-metrics.json` mix in the two missing-usage zeros; use the settled-only row above for cost.

Catalog-estimated USD vs settled `usage.cost` differed on every settled call:

| cell | usage.cost | catalog estimate | delta |
| --- | ---: | ---: | ---: |
| S1-A | 0.013151 | 0.013150 | ~0 |
| S1-B | 0.071833 | 0.073042 | catalog higher |
| S2-A | 0.011130 | 0.013549 | catalog higher |
| S2-B | 0.055348 | 0.058976 | catalog higher |
| S3-A | 0.013760 | 0.016178 | catalog higher |
| S4-A | 0.013349 | 0.015768 | catalog higher |

## J. latency comparison

| group | avg latencyMs | avg ttftMs |
| --- | ---: | ---: |
| A | 64873 | 2906 |
| B (all 4, text arrived) | 285760 | 3644 |

B cells ran ~4–5 minutes each. A cells ~58–72 seconds.

## K. 최종 후보

_(left for scorer: NONE / GLM / QWEN)_

## L. HEAD SHA

Harness at extract time: `11d15bb451a3c9cd8ed122fcb8fe1c67cb288c8c`
See git HEAD of this commit for the committed extract tree.

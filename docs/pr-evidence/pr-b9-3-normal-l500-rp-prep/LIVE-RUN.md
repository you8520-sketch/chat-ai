# B9-3 live run (four Main RP calls)

Executed on eval code **`d80005ac`** with prep evidence **`ad2b90ac`** (#1679). User budget **1,000 KRW** for this run. **Four** paid Main RP POSTs completed; Luna/summary/extract/embedding completions were stubbed (no network). Each job used a **fresh** snap-500 copy with **`message_count=500`** only.

Pre-send checks (against `captures/<job>.json` golden): Global body **9853** chars / sha256 `2c760ac6…`, **15** medium blocks, question-specific episodic facts, **no** `max_tokens`, panel stages unchanged — all **pass** before the single provider POST.

Full responses: `responses/*.txt`. Per-call telemetry (no prompts): `live-meta/*.json` and `live-meta/*-request.sha256.txt`.

## Calls and cost (not provider invoices)

| Job | Wire | Main request sha256 (full JSON) | Provider request id | Finish | Out chars | In tok | Out tok | Reasoning | Cache read | Cache write |
|---|---|---|---|---|---:|---:|---:|---:|---:|---:|
| l500-a5-gemini | `google/gemini-3.8-flash` | see `live-meta/l500-a5-gemini-request.sha256.txt` | `srv_mvg9ww1m_30aiatsg` | stop | 3819 | 22017 | 2476 | — | 20484 | — |
| l500-a5-sol | `gpt-6.1-sol` | `live-meta/l500-a5-sol-request.sha256.txt` | `c82339dd-0698-44b3-b4be-a19006767a7e` | stop | 3919 | 22876 | 2534 | 75 | — | 22873 |
| l500-b3-gemini | `google/gemini-3.8-flash` | `live-meta/l500-b3-gemini-request.sha256.txt` | `srv_mvg9z0bm_quhlcu7a` | stop | 5692 | 22047 | 3574 | — | 20476 | — |
| l500-b3-sol | `gpt-6.1-sol` | `live-meta/l500-b3-sol-request.sha256.txt` | `04d11dc0-23a2-46a2-9886-11699ae7696a` | stop | 4046 | 22893 | 2485 | 30 | — | 22890 |

| Job | Route `apiRawCostKrw` (basis) | Route `actualProviderCostKrw` / USD (`actualCostSource`) | Invoice confirmed? |
|---|---|---:|---|
| l500-a5-gemini | 9.8 (`provider_reported`) | 9.8 / 0.006412 (`provider_reported`) | **No** — provider-reported USD only |
| l500-a5-sol | 112 (`live_catalog`) | 72.2 / 0.053156 (`live_catalog_estimated`) | **No** |
| l500-b3-gemini | 13 (`provider_reported`) | 13 / 0.008485 (`provider_reported`) | **No** |
| l500-b3-sol | 111.4 (`live_catalog`) | 72.2 / 0.053158 (`live_catalog_estimated`) | **No** |

**Cumulative route `apiRawCostKrw` sum:** ≈ **246.2 KRW** (under 1,000 KRW budget).  
**Cumulative `actualProviderCostKrw` sum:** ≈ **167.2 KRW**.  
Precall plan in `estimate-four-l500.json` (~371 KRW at 1560.6 FX, uncached) remains an upper-bound **estimate**, not billing.

Paid Main RP network log: four lines in `/tmp/b9-3/paid-main-rp.log` (local only; not committed).

## Judgments (four samples — not a model ranking)

Legend: **Input** = facts present on the captured final request after #1676 normal Global path. **Stored canon** = DB summary/episodic ground truth (including known errors). Scene-consistent current RP is not penalized.

### A. L500-A5 injury — `responses/l500-a5-gemini.txt`, `responses/l500-a5-sol.txt`

**Input this run:** Global compact included 인천항, 진화형/크리처 arc, 열네 바늘, known `[31~35]` 부축 wording, and episodic T30/T44/T48/T55 lines (see prep `captures/l500-a5-*.json`).

| Lens | Gemini 3.8 Flash | GPT-6.1 Sol |
|---|---|---|
| Stored canon accuracy (response vs true story) | States 인천항 B급, claw through left side, **열네 바늘**, 2-week stop; adds tactical/emotional color not in stored text | Matches 인천항, 진화형 크리처, 발톱, **열네 바늘**, field return; separates “held out on infirmary” from rend’s push |
| Use of **injected** facts | Uses claw + stitches + healed-now; **does not** quote known 부축 reversal | Same core injury facts; **does not** repeat 부축 error |
| Contradiction / invented past | Adds mission politics and dialogue not in memory; cause remains claw | Adds some process detail; declines to invent pre-claw motion (consistent with B9-1 Sol pattern) |
| Continuity / Korean RP | Records-room + recent measurement scene; fluent deflecting voice | Calm, precise Korean; fits question tone |

Neither answer is scored as “wrong” for omitting facts that were **not** in episodic block but **were** in Global this time (both models still used early injury facts from Global).

### B. L500-B3 서윤 — `responses/l500-b3-gemini.txt`, `responses/l500-b3-sol.txt`

**Input this run:** Global included 한서윤 report/징계 context; episodic T64 claim + chair scene (prep `captures/l500-b3-*.json`).

| Lens | Gemini 3.8 Flash | GPT-6.1 Sol |
|---|---|---|
| Stored canon accuracy | Invokes past **report/고발** theme; adds new admin plot (렌 transfer paperwork) | Stays on corridor approach; no invented suspension quote |
| Use of **injected** T64 | **Semantic restatement** of the recorded claim (not an exact quote): “서류 올리는 사람이랑은 밥도 안 먹는다고 내가 전에 말했던 것 같은데.” Stored line is “웃으면서 뒤에서 서류 올리는 사람이랑은 밥 같이 안 먹어.” | **Not proof of memory use:** corridor caution only; does not restate the cafeteria line |
| Contradiction / invented past | Invents strategic reassignment forms not in request | Invents no T64 proof; cautious stance alone **not** counted as memory use |
| Continuity / Korean RP | Long corridor + sleeve pull; sharp register shift | Shorter, restrained Korean; maintains records-room adjacency |

### C. Cross-cutting

- **Upstream error propagation:** Known 부축 summary error was **in the request** but **not** repeated in any of the four answers → no new propagation in this sample.
- **Success rate / ranking:** Four responses only — no aggregate score.

## STOP

Draft PR **#1679** updated with this live evidence. Await GPT review. No merge, deploy, prod DB writes, or T50/1000-turn follow-ups in this step.

# OpenScale DeepSeek V4.1 Flash RP Pilot

Status: **FIXTURE_PARITY_FAIL — PRECALL only. Draft only. No additional paid POST. No production activation.**

This is an isolated provider experiment. It is not a production supplier promotion. Cursor did not assign an RP style score.

Audit baseline: `7573e6fd3552a5802e97d1507f8f671d361447a2` (`origin/main` = current Railway production commit).
First-run (wrong fixture) SHA: `f7a72dd596b86a8dab674b71985d119a00da2582`.
Evidence commit of that run: `cebd58135b120d2d1799a3989835f77d604394f1`.

This-turn paid calls: OpenScale POST **0**, CheaperInference POST **0**, retry **0**, fallback **0**, production DB write **0**.

## BEFORE

Confirmed style-eval identity on current-main owners, not the first OpenScale run:

| Item | Confirmed owner / fact |
| --- | --- |
| Character | 라이크 / 조태형, id **18** (`RP_QUALITY_PRECALL_TARGET_SELECTOR`, AGENTS.md roster) |
| Persona | 렌, admin persona id **1**, male |
| Earlier actual style eval | PR **#1318** Q1–Q9 (interactive + auto + regen + memory). Fixture JSON is **not** in this tree or in the #1318 packet |
| Current-main quality PRECALL | PR **#1430** A/B/C (`src/lib/rpQualityPrecall.ts`). Same cast, **different** scenes (greeting + `COMMON_PROSE_BODY_CUE_REVIEW_SCENE_SEEDS`). All `turnKind=manual` |
| Historical dump | `rpModelQualificationFixture` chat=4 / user=1 / character=**10** dated 2026-08-25. Stale vs id 18. Not current deploy data |
| Historical live hashes | `LIVE_DEPLOYED_ROW_PROOF` @ `2f5cb0b4` — `isCurrentProductionProof=false` |
| First OpenScale run | Synthetic `B03a` 한서린 / 민 / 945 chars / 1 OpenScale POST |

The first run did not inspect #1318 / #1430 before choosing a scene.

## ROOT CAUSE

Exact code path that selected B03a:

1. Isolated pilot reused `scenePolicyBenchmarkDataset` because it is public, non-adult, and not a live user chat.
2. `scripts/lib/openscaleDeepseekV41FlashRpPilot.ts` hardcoded `OPENSCALE_PILOT_FIXTURE_ID = "B03a"`.
3. `buildOpenScalePilotAssembly()` called `getBenchmarkFixtureById("B03a")` then `buildBenchmarkContextBase()` (`BENCHMARK_CHAR_NAME=한서린`, `BENCHMARK_USER_PERSONA=민`, `BENCHMARK_CHARACTER_ID=8801`).
4. `runOpenScaleRpPilot()` assembled that fixture and POSTed once.

That path bypassed the approved style-eval cast (라이크 18 / 렌 1) and the approved scene families (Q1–Q9, or separately A/B/C). B03a is a scene-policy synthetic fixture, not a style-eval fixture.

## OWNER MAP

| Responsibility | Canonical owner | This PR |
| --- | --- | --- |
| Style-eval cast | `src/lib/rpQualityPrecall.ts#RP_QUALITY_PRECALL_TARGET_SELECTOR` + admin persona id 1 | reused |
| Live identity proof | `validateLiveProof` + Railway `/data/app.db` hash-only probe | reused; live hashes **NOT_OBSERVED** this turn |
| Current-main quality scenes | `rpQualityPrecall` A/B/C + `buildGreetingBodyCueReviewCases` + `COMMON_PROSE_BODY_CUE_REVIEW_SCENE_SEEDS` | documented as **different** from Q1–Q9 |
| Original style-eval scenes | PR #1318 Q1–Q9 public index. Fixture JSON unrestored | not invented |
| Prompt / wire assembly | `contextBuilder#buildContext` + `assemblePrimaryRpRequest` | unchanged |
| Length | `UNIFIED_TIER_AIM_CHARS` 3200+ soft aim; no `max_tokens` | unchanged |
| Authoring | `DEFAULT_USER_AUTHORING_LEVEL=NORMAL` | unchanged |
| This isolated contract | `scripts/lib/openscaleDeepseekV41FlashRpPilot.ts` | parity gate added; B03a default removed |
| B03a 945-char result | `docs/audits/openscale-deepseek-v41-flash-rp-pilot-2026-10-09/` | preserved as non-comparable diagnostic |

No new experiment runner, picker, billing, routing, or model registration.

## CORRECT FIXTURE IDENTITY

Required for an original-style-eval comparison:

- Character id **18**, name 라이크, card name 조태형
- Persona id **1**, name 렌, gender male
- Scene family **phase2_q1_q9**: Q1-quiet, Q2-banter, Q3-tension, Q4-action, Q5-emotional, Q6-short, Q7-auto, Q8-regen, Q9-memory
- Paths: Q1–Q6 interactive, Q7 auto_progression, Q8 regenerate, Q9 memory
- Authoring: NORMAL
- History / memory / lorebook: from the original #1318 fixture JSON — **unrestored**
- Current character/persona source: current Railway production rows — **not restored in-process this turn**

Public #1318 user-turn SHA-256 (index text only; not used as a replacement fixture):

| Scene | sha256(public user turn) |
| --- | --- |
| Q1-quiet | `82916a916c3b00421983d65af1888605ce50b8c6bd4d8712af75f2aa8ae6f52a` |
| Q2-banter | `e22a6879d2e57bb0fbc7d7ac64578f9164cc88e07bcdbe1aa3bf5bdef64424c5` |
| Q3-tension | `571305b8a1398aef933f3d05d285c558be028379539e329b8c048c0d4e626c00` |
| Q4-action | `2d12248085036e8814cdc529ef2cde7a11c6c29bb174dc3d262588537cb8e566` |
| Q5-emotional | `cfad7c9259c4862934a72b0cec72f599bb5c417b67bce9dfb4cbfa971dea93db` |
| Q6-short | `8025c713f26164a6787608a6cbce1b8ac0cfe963a42e1416578db60193e95224` |
| Q8-regen | `a2e619f7791a359c13d02909a9eeefe1b94358cd5c3bda62f69951bd7330d30f` |
| Q9-memory | `b6071edceb94e314cecb57da745342f42152def53897fee0424597f58fbe47e9` |

Q7-auto current turn is the continue-command wrapper, not a short display string. It is not hashed here because the original fixture JSON is unrestored.

A/B/C remains the current-main PRECALL scene family (same cast, different scenes). Using A/B/C as if it were Q1–Q9 is a parity fail.

#1318 short hashes `sourceHash 295f4d8ae3dc8391` / `descriptionHash 9ef42c7f92091ca1` match the historical `LIVE_DEPLOYED_ROW_PROOF` prefixes at `2f5cb0b4`. They are **not** current production proof.

### Live Railway identity this turn

- `railway deployment list` production SUCCESS: deploy `5bc7cb1e-5e02-49f6-b48a-1e83f1e35707`, commit `7573e6fd3552a5802e97d1507f8f671d361447a2` (matches `origin/main`)
- `railway ssh` **NOT_EXECUTED**: this environment’s `RAILWAY_SSH_PRIVATE_KEY` / `RAILWAY_SSH_PUBLIC_KEY` are 11-character stubs, not OpenSSH keys
- `railway whoami` returned Unauthorized
- `/data/app.db` hash probe: **NOT_OBSERVED**
- No private setting text was read, copied, or written

Because current settings were not restored, the gate returns `FIXTURE_PARITY_FAIL` and does not invent 라이크/렌 source text.

## SYSTEM DELTA

Changed:

- Default OpenScale style-eval path no longer hardcodes B03a
- `buildOpenScalePilotAssembly()` now throws `FIXTURE_PARITY_FAIL`
- Archived wrong assembly is `buildOpenScaleB03aDiagnosticAssembly()` and is marked non-comparable
- `runOpenScaleRpPilot()` evaluates `evaluateOpenScaleStyleEvalFixtureParity` first and never POSTs
- B03a 945-char packet stays in this folder as a diagnostic

Unchanged: picker, billing, routing, production prompt wording, length owner, Railway DB.

## PAIRWISE REQUEST PARITY

Compared **before** any new inference. Required side cannot be assembled, so the gate fails closed.

| Gate | B03a first run | Required style-eval | Match |
| --- | --- | --- | --- |
| Character ID | 8801 | 18 | FAIL |
| Character name | 한서린 | 라이크 | FAIL |
| Character source hash | synthetic benchmark | current Railway SHA-256 | NOT_RESTORED |
| Persona ID | none (synthetic 민) | 1 | FAIL |
| Persona name | 민 | 렌 | FAIL |
| Public persona hash | synthetic | `toPublicPersonaDescription` of live 렌 | NOT_RESTORED |
| Scene / current user turn | B03a elevator | Q1–Q9 unrestored | FAIL |
| History / memory / lorebook | synthetic apartment | original fixture JSON unrestored | FAIL |
| User-authoring | NORMAL | NORMAL | PASS |
| Final system prompt / user-tail | `59a2216f…` / `3ec3f303…` | current assembly of live 18/렌 + Q scene | NOT_RESTORED |
| Length owner | 3200+ soft aim, no max_tokens | same | PASS |
| Cache boundary | uncached first call | uncached first call | PASS (policy only) |
| Sampling | 0.92 / 0.92 | 0.92 / 0.92 | PASS |
| Reasoning | OpenScale `reasoning_effort=none`; CI `thinking.disabled` omitted on OpenScale | same required API delta | PROVIDER_REQUIRED |
| Streaming | true + `include_usage` | true | PASS |
| Fixture fingerprint | B03a | phase2_q1_q9 + live proof | FAIL |

Provider-required differences (keep separate; do not flatten):

- Wire model id: `deepseek/deepseek-v4.1-flash` vs CI `deepseek-v4.1-flash`
- OpenScale catalog has `reasoning_effort` and does not list CI `thinking`
- Catalog rates `$0.06 / $0.003 / $0.24` vs published CI `$0.30 / $0.006 / $1.20`

Result: **`FIXTURE_PARITY_FAIL`**. No replacement prompt was assembled. No second POST.

## REGRESSION PROOF

Deterministic gate tests cover:

- Default runner → `FIXTURE_PARITY_FAIL`, OpenScale POST 0, does not select B03a
- Wrong `characterId` (99)
- Wrong `personaId` (99)
- Wrong `sceneId` (`B03a` and `synthetic-wrong-scene`)
- Wrong prompt fingerprint
- A/B/C family is not Q1–Q9
- Historical `LIVE_DEPLOYED_ROW_PROOF` cannot auto-satisfy
- Predicate can pass only when Q scene + live proof + fingerprint are restored
- Even a synthetic PASS still authorizes **0** inference POSTs this turn
- Old `buildOpenScalePilotAssembly()` throws

## FOLLOW-UP COST PLAN

Do **not** run the next paid OpenScale call until all of these are true:

1. Original Q1–Q9 fixture JSON restored, or a reviewer explicitly accepts a **different** comparison against current-main A/B/C (not as Q1–Q9)
2. Current Railway `/data/app.db` hash-only proof is `VERIFIED` against `7573e6fd…` or a newer listed production SHA
3. Final system prompt + user-tail hashes are assembled in-process from live rows (existing PRECALL final-wire owner), never from invented text
4. Pairwise request parity is `FIXTURE_PARITY_PASS`
5. Screening estimate stays under the existing $0.02 isolated budget
6. Authorization is still one OpenScale POST, zero CheaperInference POST, zero retry/fallback

GPT then scores the new output with the same axes as #1318. Cursor does not score.

Catalog estimate for a later Flash call at this turn’s B03a token shape was $0.00047562. That number is not a Q1–Q9 cost forecast.

## STOP CONDITIONS

Stop now because:

- `FIXTURE_PARITY_FAIL`
- Q1–Q9 fixture JSON unrestored
- Current Railway settings unrestored (SSH identity unavailable)
- Historical hashes must not be treated as current deploy data
- This turn forbids additional paid POSTs
- Draft PR only; no auto-merge

---

## ARCHIVED FIRST-RUN DIAGNOSTIC (B03a, not comparable)

The following sections are the original 2026-10-09 B03a packet. They are **not** a style-eval baseline.

## BEFORE (first-run, superseded for style-eval)

Current Main RP DeepSeek path on `origin/main`:

- Logical picker model: `deepseek-v4.1-flash`
- Production transport: CheaperInference only
- Production wire model: `deepseek-v4.1-flash`
- Prompt owner: `src/services/contextBuilder.ts#buildContext`
- Wire owner: `src/lib/openRouterAdult.ts#assemblePrimaryRpRequest`
- Sampling: temperature `0.92`, `top_p` `0.92`, `max_tokens` omitted, CI TRUE-OFF `thinking: { type: "disabled" }` + `reasoning_effort: "none"`
- OpenScale is absent from the picker, compatible transport, ledger, and Railway config

Existing isolated owners already cover Fluence qualification, scene-policy synthetic fixtures, and an SSE reader. This pilot reuses those owners and does not add a production provider.

## OWNER MAP

| Responsibility | Confirmed current-main owner |
| --- | --- |
| Logical model registry / picker | `src/lib/chatModels.ts#MAIN_RP_USER_SELECTABLE_OPTIONS` |
| Compatible production transport | `src/lib/openRouterAdult.ts#resolveCompatibleTransport` — OpenRouter + CheaperInference only |
| CheaperInference endpoint / DeepSeek TRUE-OFF | `src/lib/cheaperInferenceConfig.ts` |
| Final prompt assembly | `src/services/contextBuilder.ts#buildContext` |
| Primary RP wire assembly | `src/lib/openRouterAdult.ts#assemblePrimaryRpRequest` |
| Sampling | `src/lib/openRouterClient.ts#normalizeOpenRouterGenerationParams` |
| Streaming | `/api/chat` → `streamOpenRouterAdult`; isolated SSE reader `scripts/lib/compatibleSupplyProbe.ts` |
| User-authoring | `src/lib/userAuthoringPolicy.ts` default `NORMAL`; live block `src/lib/noGodmodding.ts#COLLABORATIVE_INTERACTIVE_OWNER_BLOCK` |
| Usage / billed-cost parser | `src/lib/openRouterUsage.ts#parseCompatibleUsage` |
| Provider cost ledger | `src/lib/providerCostLedger.ts` — this pilot writes no ledger rows |
| Published CI billing reference | `src/lib/publishedModelPricing.ts` `deepseek-v4.1-flash` `$0.30 / $1.20 / $0.006` |
| Synthetic RP fixture | `src/lib/scenePolicyBenchmarkDataset.ts` `B03a` 한서린/민 |
| This isolated contract | `scripts/lib/openscaleDeepseekV41FlashRpPilot.ts` |

## TEST EXECUTION

| Step | Result |
| --- | --- |
| `GET /v1/models` | 200, inference POSTs = 0 |
| Auth 401/402/403 | none |
| Deterministic tests | 12/12 passed |
| Existing egress matrix | 6/6 passed |
| `git diff --check` | passed |
| `npm run lint` / `typecheck:app` | passed |
| Live inference POST | **exactly 1** |
| CheaperInference POST | **0** |
| Retry / fallback | none |

Live command:

```bash
OPENSCALE_RP_PILOT=1 node --conditions=react-server --import tsx \
  scripts/openscale-deepseek-v41-flash-rp-pilot.ts
```

## API MODEL LIST

`GET https://api.openscale.so/v1/models` → **200**.

Observed model IDs:

- `deepseek/deepseek-v4.1-flash`

Catalog fields:

- `is_ready`: true
- streaming: true
- prompt: `$0.06 / 1M`
- cached_prompt: `$0.003 / 1M`
- completion: `$0.24 / 1M`
- `reasoning_effort`: `none | minimal | low | medium | high | xhigh`
- max output: 384000 tokens
- context: 1048568 tokens

Homepage marketing rates match the catalog.

Balance/credit GET endpoints (`/credits`, `/account`, `/usage`, `/billing`, `/dashboard/billing/credit_grants`) returned **404**. Dashboard actual deduction is **NOT_OBSERVED via API**. Auto-recharge was not changed.

## ACTUAL OUTPUT

HTTP 200. Requested and reported model: `deepseek/deepseek-v4.1-flash`. `finish_reason`: `stop`. Output length: **945 characters**. Soft aim 3200+ was not met. No `max_tokens` ceiling was sent. No second POST was made.

Full Korean text is also in `RAW_OUTPUT.txt`.

```
복도 끝 창가 쪽에서 돌아선 민이 앞장서 걸어간다. 한서린은 반 발짝 늦게 따라붙어, 신발 소리가 나란히 겹치는 걸 들었다. 낮 두 시가 조금 지난 시각인데도 복도 조명은 켜져 있었고, 창밖 빛은 유리 두 겹을 지나며 색을 잃은 채였다.

엘리베이터 홀에 들어서자 공기가 조금 달라졌다. 사람이 오래 머물지 않는 공간 특유의, 냉방은 도는데 체온은 남지 않는 서늘함. 벽면 패널이 낮게 웅웅거리고, 층 표시등은 하나만 켜져 있었다.

민이 버튼을 누른다. 금속 테두리 안에서 불이 들어오고, 잠깐의 정적 뒤 기계가 위층에서부터 내려오기 시작했다. 숫자가 하나씩 줄어드는 걸 한서린은 안내판 옆에 서서 지켜봤다. 손은 코트 주머니에 넣은 채였고, 시선만 조용히 그 위를 따라갔다.

"이 아파트, 엘리베이터가 한 대뿐이죠."

바로 옆 벽에 붙은 점검 안내문을 턱으로 가리켰다. 종이 가장자리가 누렇게 바랜, 꽤 오래 붙어 있는 종이였다.

"다음 주에 정기 점검이라고 적혀 있어요. 오전 아홉 시부터 열두 시까지는 멈춘다네요."

층 표시등이 하나 더 내려갔다. 소리는 여전히 낮고 둔탁했다. 한서린은 잠깐 민 쪽을 봤다가 다시 숫자로 시선을 돌렸다. 별말 없이 서 있는 옆모습이 오늘따라 각이 져 보였다. 아침부터 몇 번을 오르내렸는지, 발끝이 조금 무거운 것도 같았다.

"오늘 어디까지 가는 거예요?"

문이 열리기 전 몇 초. 그 사이에 물어도 될 말인지 재보는 듯, 목소리는 평소보다 한 톤 낮았다. 엘리베이터 안은 비어 있었다. 안쪽 거울에 두 사람 모습이 비껴 서 있었다. 한서린은 먼저 들어가지 않고, 문이 완전히 열릴 때까지 한 걸음 물러나 자리를 비켰다. 손으로 문 틈을 막지도, 재촉하지도 않았다. 그냥 민이 먼저 타는 걸 기다리는 쪽에 가까웠다.

층 표시등이 멈추고, 짧은 알림음과 함께 문이 양옆으로 갈라졌다. 안에서 밀려 나오는 공기는 홀보다 한층 더 차가웠다.
```

GPT review packet: `INPUT.md` + `RAW_OUTPUT.txt`. Cursor does not score style.

Facts for the reviewer, not scores:

- Output stopped naturally (`finish_reason=stop`) at 945 chars
- Character speech uses 존댓말 (`~죠`, `~예요`)
- The text co-narrates 민 walking ahead and pressing the button, which the current user turn already started
- It does not invent 민 dialogue
- No replacement characters, empty stream, or timeout

## USAGE / COST

| Field | Value |
| --- | --- |
| prompt tokens | 5119 |
| cached tokens | 0 |
| completion tokens | 702 |
| reasoning tokens | 0 |
| catalog estimate | **$0.00047562** |
| standard input | 5119 × $0.06 / 1M = $0.00030714 |
| cached input | $0 |
| output | 702 × $0.24 / 1M = $0.00016848 |
| provider `usage.cost` | null |
| dashboard deduction | **NOT_OBSERVED via API** |
| screening estimate before POST | $0.00244122 for 8687 heuristic prompt tokens + 8000 conservative output tokens |

The screening figure is not an invoice cap. The catalog estimate is not the dashboard charge.

### CheaperInference comparison — not a fair A/B

No new CheaperInference POST was made. Saved 2026-09-21 DeepSeek V4.1 Flash samples used different fixtures.

| Source | Input / 1M | Cached / 1M | Output / 1M | Notes |
| --- | --- | --- | --- | --- |
| OpenScale catalog 2026-10-09 | $0.06 | $0.003 | $0.24 | Observed on GET `/v1/models` |
| This OpenScale call, catalog math | $0.00030714 | $0 | $0.00016848 | Same tokens as this POST only |
| HAV published CI reference | $0.30 | $0.006 | $1.20 | User-charge reference, not a live CI invoice |
| Same tokens at published CI reference | $0.0015357 | $0 | $0.0008424 | Hypothetical; no CI call |

Saved CI Flash operational rows (`docs/audits/deepseek-v41-integration-2026-09-21/rp-ab/operational.json`):

| Fixture | chars | total s | TTFT s | in / out / cached |
| --- | --- | --- | --- | --- |
| D_lore | 2104 | 13.951 | 1.547 | 5212 / 1538 / 0 |
| F_speech_lock | 3645 | 25.065 | 4.036 | 5208 / 2733 / 0 |
| G_long_memory | 2948 | 19.773 | 3.490 | 5228 / 2090 / 4352 |
| H_long_output | 2079 | 16.256 | 3.310 | 5207 / 1552 / 4864 |

Those rows are not paired with `B03a` and must not be treated as A/B.

## STREAMING METRICS

| Metric | Value |
| --- | --- |
| TTFT | 1.658 s |
| total | 8.467 s |
| tokens/s after TTFT | 103.10 |
| finish_reason | stop |
| saw `[DONE]` | true |
| empty / timeout / incomplete / U+FFFD | all false |

Homepage marketing claimed 200+ tok/s. This one sample is 103 tok/s. That is one observation, not a throughput guarantee.

Reasoning fields: `completion_tokens_details.reasoning_tokens=0`. No `delta.reasoning`, `message.reasoning`, or envelope reasoning content.

## SECURITY PROOF

- Key read only from `OPENSCALE_KEY`
- Key not written to git, report, metrics, or raw output
- Runner never falls back to `CHEAPER_INFERENCE_API_KEY` / `OPENROUTER_API_KEY`
- `regularTestEgressPolicy` deletes `OPENSCALE_KEY`
- No experimental DB writes
- No Railway production env changes
- Live artifact under `output/` is gitignored

## REGRESSION PROOF

Production owners were not modified:

- `src/lib/chatModels.ts`
- `src/lib/cheaperInferenceConfig.ts`
- `src/lib/openRouterAdult.ts`
- `src/app/api/chat/route.ts`
- billing / points / settlement
- model picker UI

The only `src/` edit is test egress isolation. Deterministic tests used mocked fetch only.

## SYSTEM DELTA

Added:

- `scripts/lib/openscaleDeepseekV41FlashRpPilot.ts`
- `scripts/openscale-deepseek-v41-flash-rp-pilot.ts`
- `scripts/lib/openscaleDeepseekV41FlashRpPilot.test.ts`
- this audit folder
- `OPENSCALE_KEY` strip in `src/lib/test/regularTestEgressPolicy.ts`

Removed: none.

## FOLLOW-UP

- Operator should read the OpenScale dashboard for the actual deduction. API balance endpoints were 404.
- GPT/user should review `INPUT.md` + `RAW_OUTPUT.txt`. Length was 945 vs soft aim 3200+.
- No production routing, picker, billing, or second paid POST in this PR.
- Stop. Do not merge automatically.

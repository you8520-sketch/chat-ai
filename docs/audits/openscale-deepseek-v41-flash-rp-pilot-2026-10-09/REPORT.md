# OpenScale DeepSeek V4.1 Flash RP Pilot

Status: **LIVE_COMPLETED — 1 inference POST. Draft only. No production activation.**

This is an isolated provider experiment. It is not a production supplier promotion. Cursor did not assign an RP style score.

Audit baseline: `7573e6fd3552a5802e97d1507f8f671d361447a2` (`origin/main`).
Live runner SHA: `f7a72dd596b86a8dab674b71985d119a00da2582`.

## BEFORE

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

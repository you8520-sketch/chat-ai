# B9-3 source map

| Stage | Owner / path | B9-3 note |
|---|---|---|
| Healthy Global checkpoint | `src/lib/memory/memory-summary-persist.ts` (#1676) | Isolated DB keeps 9853-char compact when `message_count=500` |
| Prompt assembly | `src/services/contextBuilder.ts` (and live section owners) | Captured via production `POST /api/chat` |
| Main RP wire | `src/app/api/chat/route.ts` | Fetch stub — no provider POST |
| Memory panel | `GET /api/chat/memory` | Opened between before/after panel stages |
| Token estimate | `src/lib/tokenEstimate.ts` | Precall input estimate |
| Output planning aim | `src/lib/responseLengthConstants.ts` `UNIFIED_TIER_AIM_CHARS` | 3200 chars → 2880 output tokens in estimate |
| Catalog rates | `src/lib/publishedModelPricing.ts` | Gemini 3.8 / GPT-6.1 Sol billingReference |
| Prior context | `docs/pr-evidence/pr-b9-1-real-rp-recall-recheck/` | Broken L500 path vs this normal path |
| Preserve manifest | `preserved-snap-500-manifest.sha256.txt` | Same snap-500 as B9-2 |

Evidence JSON in this folder replaces committing `main-request.json` (contains full private prompt).

# Monthly RP Memory Quality — Phase 3B

Status: **PATH A EXECUTED. PARTIAL COMPLETION. CURRENT_PRODUCTION_PARITY UNPROVEN. FIXTURE_ONLY. Cursor did not score quality. Draft PR only. Do not merge. Do not re-run.**

Execution host: **Cursor VM**, not the Railway production container.
EXACT origin/main at execute: `f8bf8c823f86364388fc0261b3a6d36a34777551`
Railway production SUCCESS metadata (enchanting-ambition / production deploy `6983458003`): `f8bf8c82`. That SHA is GitHub deploy metadata, not an observed process runtime SHA on this VM.

Tracking: #1486. USER_APPROVED_PAID_EVALUATION for Path A only: max 8 Main RP generation POSTs. Luna 0. 50-turn generation 0. B-lite / B-full not run. Production DB write 0.

## BEFORE

Phase 1 proved isolated store → retrieve → inject at 6-turn (A, umbrella) and 50-turn (B, rooftop smoke). Phase 2B/2C archived one Luna 5-turn summary (rooftop / lighter / station promise; no 우산). Phase 3A (PR #1511, merged as `f8bf8c82`) planned Path A as seeded memory + one Main RP reply per model × horizon, and required `assemblePrimaryRpRequest` as final-wire. Reply quality was `NOT_PROVEN`.

## EXECUTION PATH

1. Reconfirmed `origin/main` = `f8bf8c823f86364388fc0261b3a6d36a34777551`. Railway deploy `6983458003` SUCCESS for that SHA (GitHub metadata).
2. Local `data/app.db` has characters 1–9 only. Character 18 / admin 렌 unread. Identity: **FIXTURE_ONLY**.
3. Auth GET `/models` on Cheaper Inference and OpenRouter succeeded. GET is not a generation POST.
4. Fixed eight case IDs + SHA-256 before any generation POST (`case-plan.json`).
5. Per case: isolated `:memory:` SQLite seed → live `getEpisodicMemoryForPrompt` → seeded `formatMemoryBlock` (SEEDED_NOT_LUNA) → `buildContext` → `assemblePrimaryRpRequest` → **one** `fetch` POST. `allowOpenRouterUnderLengthRecovery=false`, `skipAssistantPrefill=true`. Did not use `streamOpenRouterAdultToClient` (leak-regen / under-length recovery can add POSTs).
6. Global hard cap 8 generation POSTs. One POST per case. No retry of a case that reached the provider.
7. After recording: deleted `scripts/monthly-rp-memory-quality-phase3b-execute.ts`. `rerunAuthorized: false`. `paidEvaluationApproved: false`.

Manual seed vs live retrieve: facts were inserted by the experiment into isolated SQLite, then retrieved by the live owner `getEpisodicMemoryForPrompt`. That is **not** production chat persist/retrieve. Current Memory text is seeded, not a Luna seal.

## OWNER MAP

| Responsibility | Live owner |
| --- | --- |
| Main RP picker | `MAIN_RP_MODEL_IDS` |
| Episodic retrieve | `getEpisodicMemoryForPrompt` |
| Current Memory | `formatMemoryBlock` (seeded here) |
| Prompt assembly | `buildContext` |
| Final-wire | `assemblePrimaryRpRequest` |
| Stream / one POST | experiment `fetch` to CI or OpenRouter chat/completions |
| Usage parse | `parseCompatibleUsage` |
| Provenance | `memoryEvidenceProvenance.ts` |

Unchanged: 10,000 LTM cap, RAW4, 5-turn seal, relationship ledger, character/chat isolation, operating prompts, model prices.

## IDENTITY / PARITY

- `identitySource`: `FIXTURE_NOT_PRODUCTION_SHEET`
- `characterSheetRead`: false
- `productionPersonaRead`: false
- `executionHost`: `CURSOR_VM`
- `observedRuntimeSha`: null
- `productionRuntimeParity` / `productionIdentityParity` / `homepageParity`: **UNPROVEN**
- `canClaimCurrentLiveProvider`: true for the six HTTP 200 replies (actual provider text)
- `canClaimCurrentProductionParity`: false

Do not treat these replies as production-site 라이크 18 / 렌 style scores.

## COMPARISON

| 모델 | T6 실제 응답 | T50 실제 응답 | provider POST | 토큰 in/out | 원가 | 오류 |
| --- | --- | --- | --- | --- | --- | --- |
| deepseek-v4.1-flash | [1208자](responses/phase3b_t6_deepseek-v4.1-flash.txt) `18896fa8-18c9-4b7c-9122-ea61d8807da2` finish=stop | [2356자](responses/phase3b_t50_deepseek-v4.1-flash.txt) `72417f0c-f0c1-4932-a757-18b17f07783a` finish=stop | 1+1 | 4183/913 · 4188/1760 | UNREPORTED | none |
| gemini-3.8-flash | empty — OpenRouter HTTP 401 `User not found.` wire `google/gemini-3.8-flash` | empty — OpenRouter HTTP 401 `User not found.` wire `google/gemini-3.8-flash` | 1+1 | — | UNREPORTED | 401 both |
| gpt-6.1-sol | [4631자](responses/phase3b_t6_gpt-6.1-sol.txt) `chatcmpl-EXUIo4t2osmhwCN8hQ8qdiYymoi90` finish=stop | [4021자](responses/phase3b_t50_gpt-6.1-sol.txt) `chatcmpl-EXUJmW9m7tEJRHrSCP0mVmw2iEHIs` finish=stop | 1+1 | 3753/2788 · 3760/2532 | UNREPORTED | none |
| claude-opus-5.5 | [3164자](responses/phase3b_t6_claude-opus-5.5.txt) `msg_011Cftt5v3kA3xcnaFy5LkpA` finish=stop | [2238자](responses/phase3b_t50_claude-opus-5.5.txt) `msg_011Cftt9hjSMf7YgTaozCaJW` finish=stop | 1+1 | 6265/3802 · 6273/3000 | UNREPORTED | none |

Final-wire JSON (assembled request body, no API keys): `final-wire/{caseId}.json`.
Case IDs / SHA: `case-plan.json`. Compact rows: `comparison.json`. Full packet: `evidence.json`.

T6 fact: `라이크와 렌이 비 오는 골목에서 우산을 같이 썼다.` Query: `그때 우산 같이 썼던 거 기억나?`
T50 fact: `라이크와 렌이 옥상에서 처음으로 담배를 나눠 피웠다.` Query: `옥상에서 담배 피웠던 첫날 기억해?`

## FAILURES / PARTIAL

Gemini both horizons reached OpenRouter chat/completions and returned 401 `User not found.` Routing matched live picker (`openrouter` / `google/gemini-3.8-flash`). Auth GET `/models` had succeeded. No retry. Those two POSTs count toward the 8-call cap.

Provider stream usage on the six CI successes reported tokens but omitted `billed_cost_usd` / `cost`. **Actual billed USD is UNREPORTED.** Catalog rates were not substituted.

## PROOF

- Isolated retrieve selected the seeded T1 fact at currentTurn 7 and 51 (live `getEpisodicMemoryForPrompt` logs).
- Injected block and seeded `[1~5턴]` Current Memory are in each final-wire system prompt.
- `assemblePrimaryRpRequest` request SHA is recorded per case.
- Six model responses saved verbatim. Two Gemini bodies empty.
- Provider POST total **8**. Luna POST **0**. Production DB write **0** (local `episodic_memory_facts` count remained 0; character 18 absent).

## SYSTEM DELTA

Added archival docs, provenance constant, and a no-rerun test. Did not change operating prompts, memory owners, 10k cap, RAW4, 5-turn seal, relationship ledger, model prices, or provider config. Paid execute script removed.

## TOTALS

- Provider generation POST: **8 / 8**
- Successful HTTP 200 with text: **6**
- Failed after reaching provider: **2** (Gemini 401)
- Luna: **0**
- Production DB write: **0**
- Tokens (successful only): input **28422** / output **14795**
- Billed USD: **UNREPORTED**

## FOLLOW-UP (do not run here)

- OpenRouter Gemini 401 on this Cursor VM (`User not found`) — new approval if a retry is wanted
- CI stream billed-cost field still absent on these Main RP SSE chunks
- B-lite only with a question grounded in the Phase 2C Luna summary
- B-full / 50 chat generations only with a new approval
- CURRENT_PRODUCTION_PARITY only after observed Railway process SHA + production character/persona read

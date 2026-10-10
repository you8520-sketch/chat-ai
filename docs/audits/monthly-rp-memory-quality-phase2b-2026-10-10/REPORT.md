# Monthly RP Memory Quality — Phase 2B

Status: **CURRENT_CODE_DETERMINISTIC 5-turn summary request + validator-gap packet. No provider POST. No production DB write. No production prompt change. Cursor did not score Luna quality.**

EXACT MAIN SHA at branch start: `2b8b768604e53fceb927b54fc6d98573a7e1d83c` (`origin/main` after Phase 2A #1496 `ecdc3912` and #1499). Phase 2A is not re-implemented.

Tracking: #1486. GPT handoff: issue comment 6097257753.

## BEFORE

Production seals playable RP in 5-turn batches (`MEMORY_POLICY_ID=summary5_raw4`). `summarizeTurnBatch` calls `callBackgroundMemory` (default `gpt-6-luna`) up to 3 times, then `validateSummaryNarrative` + `isRollingSummaryGroundedInDialogue`. A passing text is stored on `chat_turn_summaries` and rebuilt into `chat_memories.recent_summary` (Global Current Memory). The next main RP turn injects that lorebook as contextBuilder `[3] Current Memory`.

Phase 1 H only checked that the live prompt still contains time/actor/choice rules. It labeled summary quality `NOT_PROVEN`. Phase 2A added provenance labels and CI inclusion. Neither produced a source-to-summary packet for GPT to judge event/time/actor/relation/emotion retention.

## PROBLEM

GPT cannot review whether a production 5-turn Luna summary keeps:

- event time and order
- who did what to whom
- user-choice consequence
- relation / emotion change
- explicit 공수 direction
- character claim vs confirmed fact
- promise and item owner
- compressed-scene facts

Existing persist gates do not measure those facts. Paid Luna evaluation is not approved in this phase.

## ROOT CAUSE

**Gap is at generation + gate scope, not persist/inject rewrite.**

`validateSummaryNarrative` (`src/lib/memory/memory-summary-integrity.ts`) rejects empty / OOC-placeholder / fallback / instruction-echo / below `ROLLING_SUMMARY_MIN_CHARS` (80). It does not require calendar tokens, actor direction, promise, or item owner.

`isRollingSummaryGroundedInDialogue` blocks instruction echo, unattributed invented shared-history, global-amnesia inflation, and a narrow set of uncertain assistant claims rewritten as certain. Omitted facts and mood-only compression still return `true`.

`summarizeTurnBatch` retries that pair up to 3 times. A fact-dropping candidate that is long enough and not an echo is accepted on attempt 1.

Persist (`persistValidatedSummaryBatch` → `formatMemoryBlock` → `recent_summary`) and inject (`contextBuilder` `[3] Current Memory`) copy the accepted text. They do not restore dropped facts.

This is reproduced with canned summaries on the live seam. It is **not** a Luna sample. Cursor assigns no quality score.

## OWNER MAP

| Responsibility | Canonical owner |
| --- | --- |
| 5-turn seal prompt | `buildRollingSummarySystemPrompt` / `ROLLING_SUMMARY_SYSTEM_PROMPT` in `src/lib/memory/memory-rolling-summary.ts` |
| Final LLM request | `summarizeTurnBatch`: system = prompt + `ROLLING_SUMMARY_EPISTEMIC_POLICY`; user = formatted 5-turn dialogue + source-turn coverage |
| Dialogue format | `formatBatchDialogue` / `__formatBatchDialogueForTests` |
| Summary model | `callBackgroundMemory` → `BACKGROUND_OPENROUTER_MODEL` (`resolveBackgroundPrimaryModelId(BACKGROUND_MEMORY_MODEL)`, default `gpt-6-luna`) |
| Provider / bill | `callGeminiOnce` → Cheaper Inference when `isCheaperInferenceModel`; requestKind `background-memory-extract` then `background-memory-extract-retry`; `max_tokens` null; ledger `auxProviderProvenance` `ROLLING_SUMMARY` |
| Retry | `summarizeTurnBatch` `for (attempt < 3)`. Empty return preserves prior data |
| Narrative gate | `validateSummaryNarrative` |
| Grounding gate | `isRollingSummaryGroundedInDialogue` |
| Persist | `persistValidatedSummaryBatch` → `chat_turn_summaries` + `chat_memories.recent_summary` |
| Lorebook wrap | `formatMemoryBlock` → `[1~5턴] ${summary}` |
| Inject | `contextBuilder` section `current-memory` / `[3] Current Memory` |
| Seal trigger | Next `POST /api/chat` catch-up / barrier after canon freeze. Duplicate seal: active row at `turnStart` returns without a second LLM call |
| Isolation | `chat_id` (+ epoch / reset). Context assembly does not mix another chat's `longTermMemory` |
| Evidence label | `MONTHLY_RP_MEMORY_QUALITY_PHASE2B_EVIDENCE` in `memoryEvidenceProvenance.ts` |

## AFTER

Added a deterministic packet on the existing seam (`__setSummarizeTurnBatchCallerForTests`, `__formatBatchDialogueForTests`, live validators, `formatMemoryBlock`, `buildContext`):

- Fictional 라이크 18 / 렌 5-turn source
- Captured live final system/user request
- Canned **lossy** and **retaining** summaries labeled `CURRENT_CODE_DETERMINISTIC`
- Must-keep facts with source turns
- Proof that the lossy text passes both live gates
- Proof that persist/inject wrapping does not rewrite the accepted text
- Paid preflight (1 case × max 3 attempts) with no POST

No new scorer, prompt sentence, memory owner, or scheduler.

## REMOVED

Nothing from production runtime.

## PRESERVED

Phase 1 retrieve owner and C-neg calendar fix. Phase 2A provenance + research CI. `WATCH` not flipped. `ROLLING_SUMMARY_SYSTEM_PROMPT` unchanged. LTM 10,000. Monthly HISTORICAL_ONLY call cap. Fail-closed empty summary (no overwrite). Duplicate-seal short-circuit. `chat_id` isolation.

Provider POST 0 this PR. Production DB write 0.

## REGRESSION RISKS

Adding one test file to episodic / research CI lengthens those jobs. Provenance constant is additive. Production summary text and prompt are unchanged, so live Luna output is not altered.

## PROOF

See `src/lib/memory/monthlyRpMemoryQualityPhase2b.test.ts`. Cursor did not score quality.

## SYSTEM DELTA

Evidence-only: one provenance constant, one deterministic packet, same CI node runner as Phase 1. No second summary stack.

## Final request assembly (live code)

System (exact concatenation in `summarizeTurnBatch`):

```
${buildRollingSummarySystemPrompt(5)}

${ROLLING_SUMMARY_EPISTEMIC_POLICY}
```

That is `ROLLING_SUMMARY_SYSTEM_PROMPT` plus the epistemic block. No second prompt owner.

User (same function):

```
[1~5턴 원본 대화]
${formatBatchDialogue(entries, "라이크")}

[요약 대상 RP source 턴]
[1턴] [2턴] [3턴] [4턴] [5턴]
위 source 턴의 앞·중간·뒤를 모두 검토한다. …
캐릭터: 라이크
[캐릭터 식별정보 — …]   # fixture block only in this packet
[유저 페르소나 — …]     # fixture block only in this packet

[5턴 히스토리 요약] 최대 600자. OOC·UI·SNS mock·RP 중단 연출은 제외하고 RP 사건만 요약:
```

Opening prelude is empty when `batchStart !== 1` is false but no opening assistant is supplied in this fixture.

## Source 5-turn fixture (fictional)

| Turn | Time / place | User (렌) | 라이크 | Must-keep |
| --- | --- | --- | --- | --- |
| 1 | 저녁 일곱 시, 옥상 | 황동 라이터를 건넴. 지난달 첫 만남이라고 함 | 라이터를 주머니에 넣음. "어릴 때부터 알았어" (주장) | time, gift/owner, claim vs fact |
| 2 | 여덟 시, 계단 | 떠나지 않고 남음 | 화가 가라앉고 미안하다고 함 | user choice → emotion |
| 3 | 같은 계단 (반복 장면) | 라이크가 먼저 안길 때까지 따름 | 라이크가 먼저 안고 렌이 따름. 받은 라이터로 담배 | 공수, item still 라이크, compress silence |
| 4 | 약속 | 역에서 보자고 받음 | 내일 아침 여섯 시 역에서 기다리겠다고 약속 | promise |
| 5 | 다음날 아침 여섯 시 십 분, 역 | 조금 늦게 도착 | 이미 기다림. 라이터는 여전히 주머니 | promise kept, owner, time order |

## Test summaries — CURRENT_CODE_DETERMINISTIC

**Lossy (not Luna).** Passes `validateSummaryNarrative` and `isRollingSummaryGroundedInDialogue`. Drops time stamps, 라이터 소유, 어릴 적 주장 vs 지난달 사실, 공수, 6시 역 약속:

> 라이크와 렌이 옥상에서 만나 이야기를 나눈 뒤 계단으로 내려와 서로 가까워지고 화해함. 분위기가 가라앉은 채 다음에도 만나기로 하고 헤어짐. 둘은 한동안 말없이 앉아 있었음.

**Retaining control (not Luna).** Same gates pass and all must-keep tokens remain. Provided so GPT can compare, not as a model score.

## Omissions / distortions / inventions

| Kind | Lossy canned text | Notes |
| --- | --- | --- |
| Omission | 일곱 시 / 여덟 시 / 여섯 시 십 분 | time_order |
| Omission | 황동 라이터, 주머니 소유 | item_owner, actor_gift |
| Omission | 어릴 때부터 주장 vs 지난달 확정 | claim_vs_fact |
| Omission | 라이크가 먼저 안음 | role_direction |
| Omission | 아침 여섯 시 역 약속·이행 | promise |
| Distortion | "다음에도 만나기로" | vague; drops 6시 역 |
| Invention | none in the lossy text | grounding also does not require every source name to appear |

An invented proper name is **not** generally blocked by the live grounding function unless it is promoted into unattributed shared-history. That is part of the gate-scope evidence, not a Luna finding.

## Store / inject drift

At the persist/inject layer: **none**. `formatMemoryBlock(1, 5, text)` prefixes `[1~5턴] ` and `buildContext({ longTermMemory })` injects that string inside `[3] Current Memory`. Another chat's lorebook does not appear. Fact loss that already happened in the accepted summary is copied through.

## Paid preflight (do not call)

| Item | Live owner / value |
| --- | --- |
| Model | `gpt-6-luna` (`BACKGROUND_OPENROUTER_MODEL`; env `BACKGROUND_MEMORY_MODEL` migrates empty/legacy DeepSeek to this id) |
| Provider | Cheaper Inference (`callGeminiOnce` when `isCheaperInferenceModel`) |
| Request kinds | attempt 1 `background-memory-extract`; attempts 2–3 `background-memory-extract-retry` |
| Max attempts / case | 3 |
| Cases this packet | 1 fictional 5-turn batch |
| Planned POST this PR | 0 |
| Approval | `paidEvaluationApproved: false` — ask separately |
| Snapshot rates | `resolveOpenRouterModelRates("gpt-6-luna")` fallback $0.07 / $0.35 per 1M in/out (live catalog wins if present) |
| Output cap | `max_tokens` null on this requestKind. Resolver default 3072 is unused. Accepted clamp 600 chars |
| Hard USD cap | `UNBOUNDED_WITHOUT_REQUEST_MAX_TOKENS` if a later execute ignores the 600-char clamp |
| Expected calls if approved | 1 success = 1 POST; reject path ≤ 3 POST |
| Token / USD | computed in the Phase 2B test from the captured live request; Korean estimate `ceil(chars * 0.9)` |

Do not start paid Luna from this PR.

## Integration candidates (do not merge in 2B)

| Duplicate / overlap | Classification |
| --- | --- |
| Phase 1 H prompt-string contract vs this request-assembly packet | Same prompt owner. Keep both: H = wording still present; 2B = final request + gate gap |
| 50-turn Luna prepare cost manifest vs this 5-turn preflight | Different scripts. Reuse `resolveOpenRouterModelRates` later if a paid 5-turn eval is approved. Do not fold monthly 5-turn into the 50-turn harbor owner |
| `validateSummaryNarrative` used in summarize + persist | Already one owner |

## FOLLOW-UP (not this PR)

- Real Luna 5-turn eval after separate paid approval (`CURRENT_LIVE_PROVIDER` only with live SHA + paid output)
- Per-model 6/50 paid recall
- 10K / 12K / 15K LTM
- Semantic vs lexical
- GPT scoring of monthly live output
- Research Draft PR after real ACCEPTED
- Admin push notifications
- SQL `LIKE %달%` candidate-lane leftover from Phase 1

## STOP

Existing gates are enough to prove they do **not** measure fact retention. Packet + CI hook is the Phase 2B deliverable. No prompt edit. No new scorer. No paid POST. No merge.

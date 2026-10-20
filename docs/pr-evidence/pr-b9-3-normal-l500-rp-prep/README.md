# B9-3 evidence: normal Global L500 real-RP recheck (prep only)

This package prepares a **four-call** paid Main RP rerun after **#1676** so Global memory in a **healthy** L500 state is verified on the wire before anyone spends again. **No paid provider calls were made in B9-3.** No product code, merge, deploy, or production DB writes.

Artifacts: per-job `captures/*.json` (panel stages + memory injection audit, no full prompts), `model-diffs.json`, `estimate-four-l500.json`, and replay scripts under `scripts/` (`.txt` suffix — run locally with admin env; secrets not in repo).

## Baseline vs B9-1

| Item | B9-1 run | B9-3 prep |
|---|---|---|
| Evaluated commit | `d341c13d` | `d80005ac` (`origin/main` tip; includes **#1676** `ed65df6` and B9-1/B9-2 docs **#1674**) |
| L500 DB `message_count` | Left at **0** in reconstruction → count repair broke Global compact | Set to **500** on isolated copy (normal chat) → checkpoint **preserved** |
| L500 `[현재기억]` on wire | ~9,853-char compact **missing**; trim from `[336~340]` + omission prefix | Full **9,853**-char compact; **no** `…(오래된 기억 일부 생략)` |
| Sol L500-A5 request size | **34,509** bytes (broken path) | **39,472** bytes (matches B9-2 restored normal capture) |
| Scope | 6 calls (T50-C2 + L500 A5/B3 × 2 models) | **4 calls** — L500-A5 + L500-B3 only × Gemini/Sol |

### Memory / prompt / routing delta since B9-1 (`d341c13d` → `d80005ac`)

- **Memory (material):** #1676 — `reconcileSummarizedTurnCountFromTable` keeps a healthy `global_compact` checkpoint via `isHealthyDurableGlobalCompactCheckpoint` (`src/lib/memory/memory-summary-persist.ts`; tests in `memory-global-checkpoint-lifecycle.test.ts`).
- **Not Global injection semantics:** `src/app/api/chat/route.ts` changes from #1670 (scoped wire capture / auxiliary pricing observability).
- **Prompt assembly owners:** unchanged from B9-1 path (`contextBuilder` / section owners on this commit).
- **Models:** same picker ids — `gemini-3.8-flash` → `google/gemini-3.8-flash`, `gpt-6.1-sol` → `gpt-6.1-sol`.

## Isolated data (read-only preserve)

- Preserve root: B9-2 snap-500 tree (manifest in `preserved-snap-500-manifest.sha256.txt`, same as B9-2). **Original preserve is not modified.**
- Per capture: copy preserve → `/tmp/b9-3/data-<job>/`, then only `UPDATE chat_memories SET message_count = 500 WHERE chat_id = 1`.
- Summaries, episodic rows, known `[31~35]` 부축 wording, and global compact text were **not** edited or re-extracted.

Questions and personas match B9-1 L500:

- **L500-A5:** `옆구리 다친 건 이제 다 나은 거지? 그때 왜 다쳤었지?`
- **L500-B3:** `(복도 끝에서 한서윤이 서류를 안고 다가오는 걸 보고 태형의 소매를 잡아끈다) 저 사람 또 왔어.`

## Capture method (zero external completion)

Production assembly: `NODE_ENV=production`, `PLAYWRIGHT_PROD_SERVER=1`, `GET /api/chat/memory` (panel) then `POST /api/chat` with global `fetch` stub blocking OpenRouter, cheaperinference, embeddings, and Luna. **Main RP body** saved locally as `main-request.json` (not committed). `chatMemoryWrites` = **0** on all four runs.

## Input validation (final request, fact-based)

Global compact body (all four jobs): **sha256** `2c760ac67ea054247b02bba67ce1864b76f6037b28420e15940ee9a8ac325317`, **len** 9853, checkpoint **healthy**, fingerprint **matches**, kind **global_compact**, covered through **T495**. Medium: **15** blocks `T421–425` … `T491–495` (4670 chars total). Episodic block uses header **`[EPISODIC MEMORY - RETRIEVED FACTS]`** (not legacy `[에피소드]` labels).

| Job | Omit prefix | A5 / B3 fact checks (boolean — not char-count proxy) |
|---|---|---|
| l500-a5-gemini | false | 인천+진화형 narrative, 열네 바늘, known 부축 line present; episodic T30/T44/T48/T55 |
| l500-a5-sol | false | same |
| l500-b3-gemini | false | Global 한서윤 report/징계; episodic T64 claim + 의자/웃음 scene cues |
| l500-b3-sol | false | same |

**Panel + compact stability:** before panel, after panel, and after chat route — `recentLen=9853`, same sha12, no omission in stored/panel text (`captures/*.json` → `stages`).

Detail tables: `captures/<job>.json` → `memoryInjection.facts` and episodic turn lists.

## Gemini vs Sol (same question)

From `model-diffs.json`:

- **System joined text:** sha256 **equal** within A5 pair and within B3 pair (memory blocks identical).
- **Request bytes differ** only by model-specific tail (output instruction / wire wrapper): A5 gemini 39654 vs sol 39472; B3 gemini 39708 vs sol 39526.
- **Wire params:** Gemini — `provider.only google-ai-studio`, `reasoning.effort low`, `reasoning.exclude true`. Sol — `temperature 0.7`, `reasoning.effort low`, `reasoning_effort low`. Neither body sets `max_tokens`.

## Planned paid execution (after GPT approval — not run here)

1. Reuse the same preserve copy + `message_count=500` prep and B9-1 admin/session path.
2. **Exactly four** Main RP POSTs (no T50, no 1000-turn eval, no summary/extract/embedding replay):
   - L500-A5 × `gemini-3.8-flash`
   - L500-A5 × `gpt-6.1-sol`
   - L500-B3 × `gemini-3.8-flash`
   - L500-B3 × `gpt-6.1-sol`
3. One completion each; stub Luna/auxiliary as in B9-1 if the route still schedules them.
4. Save responses under `responses/` in a follow-up evidence commit (same layout as B9-1).

**STOP:** do not execute paid calls until GPT review and explicit spend approval.

## Cost estimate (four captures, conservative)

Source file: `estimate-four-l500.json`. Label: **`precall_estimate_not_provider_invoice`** — not provider-reported billing.

| Input tokens | `ceil(len(main-request.json) × 0.9)` per `src/lib/tokenEstimate.ts` `estimateTokensFromCharCount` (same convention as B9-1 precall). |
| Output tokens | Planning scenario **`aim_3200`**: `UNIFIED_TIER_AIM_CHARS` = 3200 → `ceil(3200×0.9)` = **2880** tokens (`src/lib/responseLengthConstants.ts`, `rpQualityPrecall` aim scenario). **Not** the B9-1 12k sensitivity assumption and **not** an output cap (`max_tokens` omitted on wire). |
| Rates | Uncached **billingReference** USD/M from `src/lib/publishedModelPricing.ts`: Gemini 3.8 Flash **0.375 / 1.875**; GPT-6.1 Sol **2 / 10**. |
| FX | **1560.6** KRW/USD planning upper bound (1530×1.02, as B9-1 precall). Live runs may use ~1360 API FX; Gemini may return provider-reported USD; Sol route may show `live_catalog_estimated` — those are **post-call** figures, not this table. |
| Cache | **No** cache-read/write discount applied. |

**Totals (four calls):** ≈ **0.237 USD**, ≈ **371 KRW** at 1560.6 FX (see per-row breakdown in JSON).

After approval, compare provider usage fields to this estimate; do not treat the estimate as invoice.

## How to reproduce captures (maintainers)

1. Ensure B9 preserve snap-500 available locally (see B9-2 manifest).
2. Admin env file outside repo (B9-1 pattern).
3. Run `scripts/run-captures.sh.txt` from repo root on commit `d80005ac` (or later only if memory owners unchanged).
4. Run `scripts/analyze-captures.py.txt` on output dir to refresh slim audits.

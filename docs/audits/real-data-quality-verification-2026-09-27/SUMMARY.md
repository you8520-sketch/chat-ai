# Real production data — Main RP style quality verification (2026-09-27)

Audit-only. **Production diff = 0** for runtime flags, prompts, length owners, retry/continuation/recovery.

## Git baseline

| Field | Value |
| --- | --- |
| User cited main | `a8c343fc4b9f3bb1180d628707aa87218e77433b` |
| **origin/main at run** | `5a10dc13259044a278ebbf5fbbc8f6044515cfcb` |
| **HEAD (harness branch)** | recorded in PR / `git-baseline.json` artifact |
| BEHIND_MAIN | 0 (branch cut from latest `origin/main`) |

## STOP — provider testing not executed

Per §18 STOP conditions, the benchmark **did not call** DeepSeek V4 Pro or Gemini 3.7 Flash.

| Check | Result |
| --- | --- |
| Railway production SQLite mounted read-only | **No** — `SOURCE_DB_PATH` unset; local `data/app.db` is dev seed |
| Character 18 = 라이크 | **Not present** in local DB |
| Chat 707 | **Not present** in local DB |
| Admin persona 렌 for chat 707 | **Not verifiable** without production DB |
| Railway CLI / GraphQL with pod `RAILWAY_TOKEN` | **Unauthorized** (cannot `railway run` / SSH to `/data/app.db`) |
| Production admin forensics (`chat-turn-forensics`) | **403** — requires admin session + debug token on production |

**Stop reason code:** `CHARACTER_18_NOT_FOUND` (local fallback DB)

**Remediation for a follow-up run (operator, not code):**

```bash
# Read-only production copy (never commit)
export SOURCE_DB_PATH=/path/to/mounted/production-app.db
export LABEL=real-data-quality
export REPS=3
npx tsx scripts/real-data-quality-benchmark.ts
```

Optional: pin snapshot turn — `BENCHMARK_ASSISTANT_MESSAGE_ID=<assistant msg id>`.

Artifacts on success: `/opt/cursor/artifacts/real-data-quality/`.

## PRODUCTION DIFF

```
0
```

Added: `scripts/real-data-quality-benchmark.ts` (audit harness only) + this report.

## Real data proof (attempted)

| Field | Status |
| --- | --- |
| Character | 라이크 id=18 — **not verified** (missing row) |
| Chat | 707 — **not verified** |
| Persona | 렌 (admin-owned) — **not verified** |
| Historical fingerprints `5628f2f16b6c4227` / `15b13fdaeb805526` | Not re-resolved (no production rows) |
| Resolution path | `SOURCE_DB_PATH` → read-only SQLite → `getDb()` + regeneration boundary snapshot |

## Owner map (static, current main)

| Concern | Owner |
| --- | --- |
| Shared prose | `COMMON_PROSE_BLOCK` — `src/lib/advancedProseNsfwGuidelines.ts` |
| Character speech / setting | Character rows + `loadCharacterChunksForPromptReadOnly` |
| Narration register / layout | `COMMON_PROSE` + `contextBuilder` / `narrativeRules` |
| Scene pacing (default interactive) | `legacy_v1` via `buildSceneDirective` |
| User agency | `currentTurnUserAuthoringDelegation` + chat coauthor column |
| Memory / lore | `buildMemoryContextForPreview`, keyword lorebook loaders |
| DeepSeek adapter | `assemblePrimaryRpRequest` + `deepseekPromptStructure` bottom reminder + `[DEEPSEEK LENGTH — SINGLE CALL]` on wire |
| Gemini 3.7 adapter | Same shared prose; model-specific params in `openRouterAdult` / CheaperInference |
| Length / continuation | `TURN_LENGTH_SUPPLEMENT_API_ENABLED=false`, `MAX_MAIN_RP_PROVIDER_CALLS_PER_TURN=1` |

**DeepSeek duplicate-style audit (static):** bottom style reminder remains separate from `COMMON_PROSE`; length stack is single-call block, not a second prose owner. No dormant SNPV2 length arm enabled in production flags.

## CALL COUNT PROOF

| Model | Planned n | Actual calls |
| --- | ---: | ---: |
| DeepSeek V4 Pro (`deepseek-v4-pro-0813`) | 3 | **0** (STOP) |
| Gemini 3.7 Flash (`gemini-3.7-flash`) | 3 | **0** (STOP) |
| **Total** | 6 | **0** |

## CLASSIFICATION

**`ROOT_CAUSE_UNCONFIRMED`**

Style quality under real 라이크 / chat 707 / persona 렌 conditions cannot be judged until a read-only production DB copy is mounted and the harness completes provider calls.

No winner. No Cursor quality score. Human review of raw outputs remains pending.

## SAFE OPTIONAL / SEPARATE FOLLOW-UP

1. Mount production `app.db` read-only on the Cloud Agent environment (`SOURCE_DB_PATH`) and re-run this harness only.
2. If DeepSeek compliance gap is reproduced with evidence, bounded DeepSeek-only fix after GPT/user review — **not in this PR**.

# PR620 real capsule — prompt/runtime behavior quality verification

**Date:** 2026-09-27  
**Task:** PROMPT/RUNTIME BEHAVIOR QUALITY VERIFICATION (historical capsule; no production DB)  
**Prior attempt:** PR #1121 closed (no Railway/production DB). **Not reopened.**

## Git baseline

| Field | SHA |
|--------|-----|
| **EXACT MAIN (`origin/main`)** | `7a7ba46a9222f828fbdab6ce2b9d166ec4f604ed` |
| **EXACT HEAD (benchmark run)** | `7a7ba46a9222f828fbdab6ce2b9d166ec4f604ed` |
| **BEHIND_MAIN** | `0` |
| **PRODUCTION DIFF (`src/`)** | **0** — audit harness + docs only |

## Historical proof (not scored)

- **PR #255:** character 18 × persona 61 (렌), live `/api/chat`, retry/continuation/recovery = 0; Gemini 3.1 historical visible avg ≈4496 chars — existence of a real production benchmark only.
- **PR #620 HEAD:** `b92100326e56d726eb9040f9cf1b01c7bc11db4e` — canonical imported production capsule (README: 라이크 / persona 렌). Local remap `characterId=10`, `personaId=1` is documented; identity proven by content hashes, not DB ids.

## Real capsule provenance

| Item | Value |
|------|--------|
| Source PR | #620 |
| Capsule root | `docs/audits/real-production-mid-chat-style-handoff-benchmark/` |
| Capsule tree hash | `251ae04247be8ac62c66e8af3b58c0797c94e4938cb3a7a5dec92893da7ab03e` |
| Character name | **라이크** (`fixtures/user-turns-t1-t2-t3.json`) |
| Persona name | **렌** (same fixture) |
| T3 | **Out of scope** (not run) |

Required archived inputs used: `fixtures/user-turns-t1-t2-t3.json`, `raw/OPENING_ASSISTANT_VISIBLE.txt`, `raw/T1-USER_RAW.txt`, `raw/T1-ASSISTANT_PERSISTED_VISIBLE.txt`, `raw/T2-USER_RAW.txt`, `requests/T1-prompt_dump.txt`, `requests/T2-prompt_dump.txt`, token breakdowns, `T1/T2-GEMINI-input.json`, provider meta under `meta/`.

Full field-level map: run artifact `REAL_CAPSULE_SOURCE_MAP.json` (also written under `/opt/cursor/artifacts/pr620-real-capsule-quality/`).

**Reconstruction path:** frozen PR620 source → **current main** `buildContext` → **current main** `assemblePrimaryRpRequest` → live CheaperInference (not replay of PR620 provider JSON).

**Harness:** `scripts/pr620-real-capsule-quality-benchmark.ts`

```bash
LABEL=pr620-real-capsule-quality REPS=3 npx tsx scripts/pr620-real-capsule-quality-benchmark.ts
```

Requires `CHEAPER_INFERENCE_BENCHMARK_API_KEY` (or project benchmark credential helper). Confirms `MAX_MAIN_RP_PROVIDER_CALLS_PER_TURN=1`, `TURN_LENGTH_SUPPLEMENT_API_ENABLED=false`.

## Two independent snapshots

| Snapshot | Frozen history | Current user RAW |
|----------|----------------|------------------|
| **A (T1)** | Opening assistant visible only | `T1-USER_RAW.txt` |
| **B (T2)** | Opening + T1 user + **frozen** `T1-ASSISTANT_PERSISTED_VISIBLE` | `T2-USER_RAW.txt` |

Same archived preceding context for both; no sequential chat (T1 model output does not feed T2).

Shared history SHA (both snapshots’ prefix): `70821ec04f9a9895a4aa26f3e56a715afebec54ca90eda21dcae506d97f261b7` (snapshot A); snapshot B extends with T1 assistant hash `5c1c48a6551b4bfa0bb3bb24fe14e35a8c7aa34cc5a87f60ba9b74310a05c5a0`.

## Models (current main)

| Role | Outbound id |
|------|-------------|
| DeepSeek V4 Pro | `deepseek-v4-pro-0813` |
| Gemini 3.7 Flash | `gemini-3.7-flash` |

## Call matrix

| Snapshot | DeepSeek n=3 | Gemini 3.7 n=3 |
|----------|--------------|----------------|
| A | ✓ | ✓ |
| B | ✓ | ✓ |

**Total primary RP provider calls:** 12/12, each sample **providerCallCount = 1**, **finish_reason = stop**, no retry/continuation/recovery.

## Current owner map (pre-call wire)

**Intended shared style owner:** `[COMMON PROSE]` block (`advancedProseNsfwGuidelines.ts`).

Per snapshot (A and B), both models:

- **COMMON PROSE count:** 1 (matching `commonProseShaPrefix`: `7d9992715736`)
- **DeepSeek bottom style reminder** (substring probe on system+last user): **0**
- **DeepSeek length single-call block** (`[DEEPSEEK LENGTH — SINGLE CALL]`): **0**
- Tracked system sections include: `openrouter-korean-prose-top`, contamination guard, `no-godmodding`, canonical memory rule, `character-core-identity`, `private-speech-control`, `identity-and-rules`, `prose-style-xml-bundle`, `narrative-style`, `rule-output-layout-recency`, persona/POV owners.

**Expected cross-model wire difference:** `crossModelSystemShaMatch` and `crossModelLastUserShaMatch` are **false** (DeepSeek opening remap / adapter-specific user tail vs Gemini message layout). This is adapter divergence, not source parity failure — same capsule fingerprints per model on each snapshot.

**Inactive on wire (this audit):** legacy bottom DeepSeek-only style owner, combined style+length bottom reminder, SNPV2 length experiment toggles — not injected in counted wire for these calls.

Artifact: `CURRENT_OWNER_MAP.json`, `input-parity.json`.

## Source parity gate

- `REAL_CAPSULE_SOURCE_MAP.json` — every reconstructed field lists `sourceFile`, `sourceSection`, `hash`, `chars`.
- No `proseDietFixtures`, no 백하율 fixture, no synthetic persona/history authoring.
- LTM: empty (matches archived T1 token breakdown: new disposable chat).
- `nsfwMode`: from `meta/T1.json` archived route.
- `genres: ["판타지/SF", "로맨스"]` — runtime listing helper passed into `buildContext` (not re-extracted from prompt dump); character canon content is fully sourced from PR620 dump.

## Raw output index

Artifact root: `/opt/cursor/artifacts/pr620-real-capsule-quality/`

### Snapshot A — T1

| Model | Rep | Visible chars | Prompt tok | Completion tok | Latency ms |
|-------|-----|---------------|------------|----------------|------------|
| deepseek-v4-pro-0813 | 1 | 2752 | 13342 | 2144 | 44716 |
| deepseek-v4-pro-0813 | 2 | **1219** | — | — | — |
| deepseek-v4-pro-0813 | 3 | 1823 | — | — | — |
| gemini-3.7-flash | 1 | 2710 | — | — | — |
| gemini-3.7-flash | 2 | 3420 | — | — | — |
| gemini-3.7-flash | 3 | 2591 | — | — | — |

Files: `raw/SNAPSHOT_A_T1/{deepseek-v4-pro-0813,gemini-3.7-flash}/r{1,2,3}.txt`

### Snapshot B — T2

| Model | Rep | Visible chars |
|-------|-----|---------------|
| deepseek-v4-pro-0813 | 1 | 2645 |
| deepseek-v4-pro-0813 | 2 | 2567 |
| deepseek-v4-pro-0813 | 3 | 3309 |
| gemini-3.7-flash | 1 | 2850 |
| gemini-3.7-flash | 2 | 3222 |
| gemini-3.7-flash | 3 | 2806 |

Files: `raw/SNAPSHOT_B_T2/{deepseek-v4-pro-0813,gemini-3.7-flash}/r{1,2,3}.txt`

Full per-sample metadata (tokens, prompt hash, occurrences): `raw-output-index.json`, `meta/*.json`.

**Length:** observation only; product target 3200+ unchanged; no length-based winner.

## Occurrence matrix (heuristic annotations only — not scores)

Script uses regex/heuristic detectors; false positives/negatives expected. Human/GPT review of raw text is authoritative.

### DeepSeek focus (historical concerns)

| Tag | Snapshot A (3 reps) | Snapshot B (3 reps) | Gemini 3.7 B (contrast) |
|-----|---------------------|---------------------|-------------------------|
| INNER_MONOLOGUE_OVERUSE | 1/3 | **3/3** | 3/3 (pattern hits; not DeepSeek-only) |
| MICRO_ACTION_LOOP | 0/3 | **3/3** | 0/3 |
| EXPLANATION_AFTER_SHOWING | 0/3 | **2/3** | 1/3 |
| SEMANTIC_REPETITION | (not auto-detected) | manual review | manual review |

**Evidence for weak behavior-through-action / scene progression (DeepSeek B):** reps 2–3 flag `MICRO_ACTION_LOOP` and `EXPLANATION_AFTER_SHOWING` excerpts (see `OCCURRENCE_MATRIX.json` / per-row `occurrences` in `raw-output-index.json`).

**Evidence against blanket “COMMON PROSE failure”:** Gemini 3.7 on same snapshot B lacks micro-action loop hits; both models share `commonProseCount: 1` and same capsule input SHAs for history/current user.

Full matrix: `/opt/cursor/artifacts/pr620-real-capsule-quality/OCCURRENCE_MATRIX.json`

## Final classification (Cursor — one label)

**`MODEL_VARIANCE_TOO_HIGH`**

**Rationale:** On snapshot **A**, DeepSeek visible length spans **1219–2752** (same frozen prompt hash per rep) while Gemini spans **2591–3420**. That spread blocks confident attribution of style gaps to a single owner without human raw review. Snapshot B DeepSeek shows repeated heuristic flags (inner monologue, micro-action loop) **not** mirrored on Gemini for micro-action loop — suggest **separate follow-up** under `DEEPSEEK_STYLE_COMPLIANCE_GAP` after human review, not a production patch in this PR.

**Not chosen:** `SHARED_COMMON_PROSE_GAP` (Gemini does not share worst DeepSeek B micro-action pattern); `BOTH_STYLE_HEALTHY` (stochastic + heuristic flags); `ROOT_CAUSE_UNCONFIRMED` (some owner/wire inventory is confirmed).

## STOP / scope

- **PRODUCTION DIFF = 0** — no prompt/runtime fixes in this change set.
- **T3 not executed.**
- If reproducible DeepSeek gap is confirmed in human review: record raw paths, owner map above, Gemini contrast — fix in **separate follow-up PR**.

## Safe optional separate follow-up

1. Human/GPT pass on all 12 raw files + wire dumps under `wire/`.
2. If DeepSeek B issues reproduce: inspect DeepSeek adapter-only tail (opening remap, length nudges in user block) vs shared COMMON PROSE.
3. Re-run with fixed seed / temperature audit only if product policy allows (currently unchanged).

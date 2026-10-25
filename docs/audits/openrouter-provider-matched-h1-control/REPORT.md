# Issue 2 — OpenRouter provider-matched H1 control

Evidence-only audit. **No production code changes.** **Do not merge #620–#626.** **H1 not rerun.**

## Purpose

Isolate the DeepSeek style-only reminder effect on **the same provider** (OpenRouter pinned `deepseek/deepseek-v4-pro-0813`):

| Arm | Style reminder | Provider | Source |
|-----|----------------|----------|--------|
| **A_OPENROUTER** | ON | OpenRouter 0813 | This audit (one call) |
| **H1_OPENROUTER** | OFF | OpenRouter 0813 | Frozen #626 |
| A #625 | ON | CheaperInference | Frozen #625 (provider confound) |

Prior H1 (#626) was **INCONCLUSIVE_PROVIDER_CONFOUND** (A→CI, H1→OpenRouter). This control removes that confound.

## Matched diff gate — PASS

`OPENROUTER_MATCHED_CONTROL_ONLY_DELTA_IS_REMINDER=true`

Compared `A_OPENROUTER_BACKUP_REQUEST` (from `adaptOpenRouterDeepSeekBackupBody(A-before-adapt)`) vs frozen #626 `OPENROUTER_BACKUP-input.json`:

| Check | Result |
|-------|--------|
| Model `deepseek/deepseek-v4-pro-0813` | ✓ |
| temperature / top_p / stream / reasoning | ✓ identical |
| Message count & role order | ✓ |
| Messages 0–4 byte-identical | ✓ |
| System byte-identical | ✓ |
| T1/T2 exemplars byte-identical | ✓ |
| **Only delta** | A has `DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY` (+279 chars); H1 lacks it |

SHAs:

- Canonical A request: `d155d08328ba7903846799feb6a05f3d239631b4593d72a607d60d6f0ecf26d2`
- A OpenRouter backup request: `0eb5ad147fadc36defda7b58e846b5b765e01fecda7ba402bbb2ee428b3b75a4`
- H1 OpenRouter backup request (frozen #626): `d32e7085ccab8d00227fa25a5ee9e40e8e09b699f61e29cd88c9b98d2af8f70b`

## Provider call — one only

| Field | Value |
|-------|-------|
| TOTAL_PROVIDER_CALLS | 1 |
| DELIVERED_PROVIDER | openrouter |
| CI_ATTEMPTED | false |
| HTTP | 200 |
| finish_reason | stop |
| A_OPENROUTER_RAW_SHA | `209403b705fb3a56d88a44b8a451734ea75a2fb9d46e664d6de2ca3347f3b0f9` |
| elapsed_ms | ~43657 |

Usage: 19546 prompt / 1924 completion tokens; reasoning_tokens=0.

## Objective metrics comparison

| Arm | VISIBLE_CHARS | PARA | DIALOGUE | DIALOGUE/1k | DIALOGUE_RATIO | MEDIAN_NARR | MEDIAN_DIAL |
|-----|---------------|------|----------|-------------|----------------|-------------|-------------|
| T1 Gemini | 3473 | 22 | 5 | 1.440 | 0.227 | 183 | 85 |
| T2 Gemini | 3173 | 24 | 5 | 1.576 | 0.208 | 154 | 51 |
| **T3 Gemini GOLD** | **2651** | **23** | **5** | **1.886** | **0.217** | **136.5** | **29** |
| A #625 CI | 2863 | 17 | 5 | 1.746 | 0.294 | **232** | 15 |
| **A OpenRouter (reminder ON)** | **2380** | **21** | **10** | **4.202** | **0.476** | **207** | **19** |
| **H1 OpenRouter (reminder OFF)** | **3812** | **34** | **14** | **3.673** | **0.412** | **177** | **26.5** |

Length ratios vs Gemini GOLD (2651):

- A OpenRouter: **0.898** (closest DeepSeek arm)
- A #625 CI: 1.080
- H1 OpenRouter: **1.438**

## Dialogue attribution & T2 replay

| Arm | SOURCE_USER_QUOTED_DIALOGUE | T2_REPLAY_CANDIDATE | Replay topics |
|-----|----------------------------|---------------------|---------------|
| A OpenRouter | 0 | true | FIRST_KISS only |
| H1 OpenRouter | 1 | true | WHY_LOOKING, FOOD_HUNGER, FIRST_KISS |

Mechanical T2 replay topics: why-looking, food/hunger, first-kiss interpretation.

## Audit addendum (from #626, unchanged)

- `USER_AGENCY_OWNER_ACTUALLY_ACTIVE=true` — system wire contains `[USER AUTHORING — CURRENT-TURN OOC DELEGATION]` including `현재 입력에 없는 새 [B] 대사는 만들지 않는다.`
- `OWNER_SCANNER_FALSE_NEGATIVE=true` — prior ab-diff-gate scanner missed this block
- `CONTACT_ACTOR_EXTRACTION_BUG=true` — do not fix in this PR

## Observations for Human/ChatGPT decision (no agent verdict)

On **matched OpenRouter 0813**:

1. **Reminder ON (A OpenRouter)** produces **shorter** output (2380) closer to Gemini GOLD than **reminder OFF (H1, 3812)** — opposite direction from narration-median-only reading.
2. **Reminder OFF (H1)** retains better **median narration paragraph** (177 vs 207) but worse overall length and dialogue density.
3. **Both OpenRouter arms** exceed Gemini dialogue density (~1.9/1k); A OpenRouter is highest (4.202/1k).
4. **T2 replay** appears on both OpenRouter arms; H1 is broader (3 topics) vs A OpenRouter (1 topic).
5. **A #625 CI** (reminder ON, different provider) had 5 dialogue blocks and median narration 232 — provider path matters independently of reminder.

Decision framework (Human/ChatGPT):

- **CASE 1**: A-OpenRouter substantially closer to Gemini than H1-OpenRouter → length yes; dialogue/replay mixed
- **CASE 2**: A-OpenRouter same dialogue/replay behavior as H1 → partial (both replay; H1 worse)
- **CASE 3**: H1 clearly better overall → not supported on length/dialogue/replay

## Artifacts

```
docs/audits/openrouter-provider-matched-h1-control/
├── REPORT.md
├── meta/FINAL_REPORT.json
├── meta/openrouter-matched-diff-gate.json
├── meta/comparison-objective-metrics.json
├── requests/A-OPENROUTER_BACKUP-input.json
├── responses/A-OPENROUTER-RAW.txt
├── responses/A-OPENROUTER-PERSISTED-EQUIVALENT.txt
└── source-frozen/   (copies from #625/#626; frozen RAW not mutated)
```

## STOP

Evidence frozen. Awaiting Human/ChatGPT RAW review. **Do not merge H1 (#626). Do not create H2.**

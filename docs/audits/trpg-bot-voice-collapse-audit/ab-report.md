# TRPG Bot Voice Collapse — Frozen A/B Report

**Models:** GPT-5.6 Luna vs DeepSeek V4 Pro (0813)  
**Fixtures:** 12 (권태현 6 + 강이현 6)  
**Calls:** 24 (12 × 2 models × 1 run)  
**Transport:** production `adaptTrpgBotChatBody` + `temperature: 0.85` + `max_tokens: 2048`

## Headline metrics

| Metric | Luna | DeepSeek |
|--------|------|----------|
| Exact `"영웅 놀이"` hits | 0 | 0 |
| Near-distinctive hits | 0 | 1 (F04: `업고 가`) |
| Cross-character collision | 0 | 0 |
| Semantic template (hero+joke family) | 0 | 0 |
| TRPG contract pass | **1/12** | **12/12** |
| Parse pass (`<<<ACTION_TYPE>>>` / `<<<INTENT>>>`) | **1/12** | **12/12** |
| Voice separation score (1–5) | 5.0 | 5.0 |
| Context responsiveness | 1.00* | 0.92 |
| Median latency | 9133 ms | 11620 ms |

\*Luna context score inflated by single parseable sample; most outputs used non-canonical metadata blocks.

## Key findings

### 1. Production symptom not reproduced in frozen fixtures
Neither model emitted `"영웅 놀이"` or the full hero-play joke template under isolated frozen prompts without production memory/GM feedback. This suggests production collapse may involve **session-long feedback** (GM narration echo, memory re-injection) in addition to model behavior.

### 2. Luna TRPG contract failure (P0 adoption blocker)
Luna frequently emits metadata as `[행동 유형: …]`, `ACTION_TYPE: …`, or Korean labels instead of canonical `<<<ACTION_TYPE>>>` / `<<<INTENT>>>`. **11/12 Luna samples failed parse/contract.** DeepSeek complied on all 12.

This alone disqualifies Luna for Bot routing regardless of prose quality.

### 3. Luna example-dialog echo (card-driven repetition)
Luna repeated 권태현 `exampleDialog` verbatim across multiple fixtures:
- F01, F04, F05: `"죽으면 내가 대신 사과할 일은 없어"`
- F04, F05: greeting echo `"…또 먼저 나설 생각이야?"`

This is **input echo from character card**, not cross-character template collapse, but it explains catchphrase repetition without blacklist.

### 4. DeepSeek semantic-family line (single instance)
F04 DeepSeek: `"뛰어야 할 때 못 뛰면, 내가 업고 가긴 싫어."` — matches production semantic family (`업고 가` / inconvenience joke) once, not cross-character.

### 5. Voice separation
Blinded pairwise scoring: both models 5.0/5.0 — no identical quoted catchphrase collisions between 권태현/강이현 pairs in this run.

## Decision matrix

```
LUNA_MODEL_SPECIFIC_COLLAPSE: false (hero-play not reproduced in frozen run)
PROMPT_OR_CONTEXT_ARCHITECTURE_PROBLEM: true (exampleDialog echo + INTENT-only continuity gap)
MODEL_SWITCH_RECOMMENDED: true
RECOMMENDED_BOT_MODEL: deepseek-v4-pro-0813
MINIMAL_PROMPT_OR_ARCHITECTURE_CHANGE_REQUIRED: true
```

**Rationale for model switch despite no hero-play in A/B:**
1. Production voice collapse reports correlate with Luna Bot rollout (PR #700).
2. Frozen A/B shows Luna **cannot reliably emit TRPG metadata contract** (11/12 fail).
3. Luna **echoes character-card exampleDialog** across fixtures → card-driven catchphrase repetition.
4. DeepSeek passes contract on all fixtures with comparable voice separation.

**Rationale for architecture follow-up (P1, separate PR):**
- Hero-play template not reproduced without production DB → possible GM/memory feedback loop (Case B).
- Bot lacks past spoken-line fingerprint (Case D) → single lexical-novelty owner candidate after model switch.

## Artifacts

- `fixtures.json` — frozen prompts (sanitized cards)
- `ab-results.json` — raw outputs + SHA256 prompt hashes
- `phase1-report.md` — static provenance audit

Raw prompts are hashed only; full prompt text not committed beyond fixture cards.

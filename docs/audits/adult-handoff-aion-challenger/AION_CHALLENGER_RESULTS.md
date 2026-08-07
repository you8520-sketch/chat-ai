# Aion Challenger — Adult Handoff Bundle Fidelity

```text
comparison_unit = PRODUCTION_CONFIG_BUNDLE_COMPARISON
model = aion-labs.aion-2-0
branch = cursor/adult-scene-handoff-final-smoke-6a91
PR = #265
prior_fidelity = Muse vs DeepSeek Stage1 (artifacts reused; 0 re-calls)
NEW_API_CALLS = 3
retry / continuation / recovery / fallback = 0
Aion Length V2 = NOT_RUN
two-chunk = NOT_RUN
recovery continuation = NOT_RUN
reasoning experiment = NOT_RUN
audit_prompt_tuning = NONE
```

Past production note: commit `b9e7ef7` (`feat: enable Aion adult scene handoff`) had selected Aion as adult handoff primary (`ADULT_SCENE_AION_PRIMARY_ENABLED=true`, `ADULT_MODEL_ID=aion-labs.aion-2-0`). This add-on re-tests **single-call adult handoff fidelity only** against that historical production bundle path (CheaperInference + current `assemblePrimaryRpRequest` / handoff prompt / SceneContinuityPacket). No new Aion-specific prompt tuning.

Shared with prior Stage1 cells: same Opus / Terra / Gemini source anchors, RAW history, adult entry user turn, character/persona fixtures, continuity packet inputs, consent mode, token budget target (3200). Provider-technical differences only (Aion adapters: no DeepSeek XML/style extras; `temperature=0.7`; CheaperInference).

Private capture: `/opt/cursor/artifacts/adult-handoff-aion-challenger/` (full raw not published here).

---

## Existing winners (prior audit)

| Source | Existing winner | Formal human PASS anchor |
|---|---|---|
| Opus | Muse Spark 1.2 | YES |
| Terra | DeepSeek V4 Pro | YES |
| Gemini | Muse Spark 1.2 | NO |

Question per source: does Aion continue the prior source model’s prose (문체·호흡·호칭·캐릭터성·장면) more naturally than that winner?

---

## Opus: Muse vs Aion

| Metric | Muse (winner) | Aion |
|---|---:|---:|
| visible chars | 2065 | 2908 |
| latency_s | 12.07 | 50.03 |
| cost_usd | 0.0138 | NOT_REPORTED (CI usage.cost null) |

**Verdict: Muse wins (not near-tie).**

- Source Style Continuity / SAME_AUTHOR_ILLUSION: Muse stays closer to Opus Arm E’s cool restraint. Aion keeps curse/seal motifs and Caspen voice beats, but shifts register toward warmer romantic climax faster than the Opus anchor.
- MODEL_SWITCH_NOTICEABILITY: Muse lower (better). Aion denser emotional escalation is more noticeable as a model switch.
- Rhythm / Voice: both acceptable 반말; Aion length nearer the anchor.
- Scene Continuity: both keep underground Caspen frame; Aion retains more curse-body beats.
- User Agency: no severe new-user decision theft; mild consent-seeking on both.
- `COMMON_HANDOFF_SUBJECT_OBJECT_INVERSION_RISK`: **OBSERVED on Aion** (“렌의 팔은 그의 허리를…”) and also on prior Muse cell. Common fixture risk; not used alone to elect a primary.

Excerpt (Aion open, truncated):

```text
허리가 감싸지는 순간, 카스펜의 몸이 돌처럼 굳었다. 십칠 년 동안 그의 살갗에 닿은 것은…
"있어도 되는 건지, 내가 묻고 싶은 쪽이다."
```

---

## Terra: DeepSeek vs Aion

| Metric | DeepSeek (winner) | Aion |
|---|---:|---:|
| visible chars | 3685 | 1903 |
| latency_s | 87.91 | 34.08 |
| cost_usd | NOT_REPORTED | NOT_REPORTED |

**Verdict: DeepSeek wins (decisive, not near-tie).**

- Source Style Continuity: DeepSeek preserves Terra action-thriller props (손전등, 안개/회색 막, 부상자, map beat) and 요-speech lock. Aion drops fog/flashlight continuity, halves length, and jumps early into intimate closure.
- MODEL_SWITCH_NOTICEABILITY / SAME_AUTHOR_ILLUSION: DeepSeek clearly superior; Aion shortfall harms scene progression (quality demerit — not an automatic <3000 char DQ, but progression is damaged).
- Character Voice: Aion mixes short 반말 (“응”) with 해요 — weaker Terra speech lock.
- User Agency: no severe multi-step user godmod; character-led kiss is abrupt vs Terra’s grounded pace.
- Inversion risk: opening reads as waist-wrap on Enok (common risk); later lines also flip actor/target. Not clean.

Excerpt (Aion open, truncated):

```text
허리를 감싼 손길에 에녹의 움직임이 멈췄다. …
"…응."
```

---

## Gemini: Muse vs Aion

| Metric | Muse (winner) | Aion |
|---|---:|---:|
| visible chars | 3032 | 3001 |
| latency_s | 19.84 | 50.29 |
| cost_usd | 0.0276 | NOT_REPORTED |

**Verdict: Muse wins.** Gemini is **not** a formal human PASS anchor — this cell alone cannot elect Aion.

- Muse better preserves lobby atmosphere, 조태형 naming, choker/sensory Guiding cues.
- Aion keeps playful senior tone in places but explicitly inverts contact (“렌의 손은 태형의 허리를…”) and sheds several Gemini-specific anchors.
- Switch noticeability higher for Aion than Muse.

---

## Aion aggregates

| Metric | Value |
|---|---|
| Source wins vs existing winner | **0 / 3** |
| MODEL_SWITCH_NOTICEABILITY mean (0–4, ↓ better) | **2.33** (Opus 1.8 · Terra 3.0 · Gemini 2.2) |
| SAME_AUTHOR_ILLUSION mean (1–5) | **3.10** (Opus 3.7 · Terra 2.4 · Gemini 3.2) |
| visible chars | Opus 2908 · Terra 1903 · Gemini 3001 (mean **2604**) |
| latency_s | Opus 50.03 · Terra 34.08 · Gemini 50.29 (mean **44.80**) |
| cost_usd | **NOT_REPORTED** on all 3 CI responses (`usage.cost` null) |

Dimension scores used above are add-on human quality scores against the sealed prior winners (not a new blind X/Y packet). Prior Muse/DeepSeek blind scores are unchanged.

---

## Selection rule application

```text
Aion wins Opus + Terra                         = NO
Aion wins 2/3 + remaining near-tie
  + lower switch noticeability overall
  + no severe agency/continuity regression   = NO
Gemini-only win path                           = N/A (Aion did not win Gemini)
```

```text
AION_ADULT_HANDOFF_BUNDLE_WIN = NO
AION_ADULT_PRIMARY_CANDIDATE = NO
→ KEEP_CURRENT_ADULT_MODEL
→ deepseek-v4-pro
```

---

## Final adult model recommendation

```text
KEEP_CURRENT_ADULT_MODEL
deepseek-v4-pro
```

Do **not** treat this as automatic main merge / general-user enable / Railway global enable / pricing change. DeepSeek-primary implementation on PR #265 remains temporary until an explicit final lock + merge approval.

```text
AION_CHALLENGER_STATUS = COMPLETE
ADULT_SCENE_HANDOFF_READY = PENDING_FINAL_MODEL_LOCK
MAIN_MERGED = false
GENERAL_USERS_ENABLED = false
ADULT_SCENE_AION_PRIMARY_ENABLED = false
```

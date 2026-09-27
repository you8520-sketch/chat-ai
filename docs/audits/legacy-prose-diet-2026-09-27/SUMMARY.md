# Legacy Main RP prose diet — summary (2026-09-27)

- EXACT MAIN: `c127d3030f50d5b8214cf87b920bf44a5503d80c`
- Audit reference: PR #1091 (evidence only; no artifacts copied)
- Harness: `scripts/prose-diet-live-compare.ts` (chat-route default wire: `buildContext` → scene directive → third-person POV → `assemblePrimaryRpRequest` with scene server controls). Benchmark key only.
- Raw outputs are not committed. Cursor assigns no scores; numbers below are counts.

## Prompt change

| Before (main) | After |
|---|---|
| `[NARRATION REGISTER]` `[SCENE FLOW]` `[RHYTHM]` `[SENSATION]` `[IMMERSIVE PROSE]` `[WEBNOVEL BREATH]` | `[COMMON PROSE]` (599 local tok, cap 600) + `[SCENE FLOW]` |
| DeepSeek V4 Pro / V4.1 Flash user turn: `DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY` (318 tok) | removed (optional momentum block unchanged) |

`[SCENE FLOW]` is kept because the production wire replaces it with `[SCENE PACING]` on interactive character turns.

## Token delta (local `estimateTokens`, production-wire payload, quiet fixture)

| model | wire system | common prose owner | prose bundle | model style adapter | current user turn | DeepSeek reminder |
|---|---|---|---|---|---|---|
| DeepSeek V4 Pro | 8769 → 7590 (−1179) | 1781 → 599 | 2367 → 1188 | 368 → 50 | 1584 → 1266 (−318) | 318 → 0 |
| DeepSeek V4.1 Flash | 8769 → 7590 (−1179) | 1781 → 599 | 2367 → 1188 | 368 → 50 | 1584 → 1266 (−318) | 318 → 0 |
| Gemini 3.1 Pro | 8789 → 7610 (−1179) | 1781 → 599 | 2367 → 1188 | 275 → 275 (agency) | 1266 → 1266 | 0 |
| Gemini 3.7 Flash | 8513 → 7334 (−1179) | 1781 → 599 | 2367 → 1188 | 0 | 1266 → 1266 | 0 |
| GPT-5.6 Terra | 8513 → 7334 (−1179) | 1781 → 599 | 2367 → 1188 | 0 | 1266 → 1266 | 0 |
| Claude Opus 5.5 | 8513 → 7334 (−1179) | 1781 → 599 | 2367 → 1188 | 0 | 1266 → 1266 | 0 |

"common prose owner" before = the five style blocks as sent on the wire (`[SCENE FLOW]` already swapped for `[SCENE PACING]`). DeepSeek model style adapter after = appearance-variation rule (50) only.

Provider-reported `prompt_tokens` (mean over all live samples): DeepSeek V4 Pro 6810 → 5680, V4.1 Flash 6828 → 5681, Gemini 3.1 5808 → 5011, Gemini 3.7 5656 → 4860, Terra 5805 → 4990, Opus 5.5 9580 → 8293.

## Visible chars per fixture (median, BEFORE main vs FINAL head)

| model | quiet | banter | tension | all-sample mean |
|---|---|---|---|---|
| DeepSeek V4 Pro (n 1 → 2) | 536 → 424 | 691 → 641 | 639 → 769 | 622 → 611 |
| DeepSeek V4.1 Flash (n 1 → 2) | 1978 → 1433 | 1171 → 1943 | 1987 → 2163 | 1712 → 1846 |
| Gemini 3.1 Pro (n 4 → 3) | 2280 → 948 | 1890 → 873 | 1305 → 2541 | 2041 → 1355 |
| Gemini 3.7 Flash (n 3 → 2) | 2034 → 1790 | 1490 → 1981 | 2127 → 2100 | 1950 → 1957 |
| GPT-5.6 Terra (n 3 → 3) | 2039 → 1598 | 1214 → 1220 | 2082 → 1924 | 1742 → 1732 |
| Claude Opus 5.5 (n 3 → 2) | 2784 → 2404 | 2770 → 2086 | 2652 → 3138 | 2756 → 2542 |

## Objective annotations (occurrences per 1000 non-space chars, all samples)

| model | arm | abstract expl. | inner thought | backstory recall | face/body | habit | env/sensory | fragment paras |
|---|---|---|---|---|---|---|---|---|
| DeepSeek V4 Pro | BEFORE / FINAL | 0.00 / 0.74 | 0.00 / 0.37 | 0 / 0 | 5.79 / 6.99 | 3.62 / 3.68 | 17.38 / 11.77 | 0 / 0 |
| DeepSeek V4.1 Flash | BEFORE / FINAL | 0.53 / 1.10 | 0.53 / 0.24 | 0 / 0.12 | 6.35 / 6.61 | 4.76 / 3.80 | 13.48 / 13.59 | 0.26 / 0.12 |
| Gemini 3.1 Pro | BEFORE / FINAL | 0.27 / 0.44 | 0.49 / 0.77 | 1.69 / 1.86 | 4.59 / 5.79 | 3.71 / 4.48 | 11.53 / 14.76 | 0.05 / 0.11 |
| Gemini 3.7 Flash | BEFORE / FINAL | 0.53 / 0.46 | 0.31 / 0.23 | 1.45 / 1.37 | 5.72 / 5.14 | 3.13 / 3.54 | 12.51 / 11.31 | 0 / 0.11 |
| GPT-5.6 Terra | BEFORE / FINAL | 0.60 / 0.61 | 0.52 / 0.09 | 0.09 / 0 | 4.65 / 4.69 | 2.67 / 2.96 | 14.57 / 13.56 | 0.34 / 0.26 |
| Claude Opus 5.5 | BEFORE / FINAL | 0.77 / 0.98 | 0.27 / 0.36 | 0.44 / 0.27 | 3.88 / 4.80 | 3.28 / 4.09 | 13.40 / 14.05 | 0 / 0.09 |

Narration register (polite endings outside quotes): 0 real hits in every arm; the heuristic's only hits were `…아니다.` false positives. Counts are regex heuristics — use raw text for judgement.

## DeepSeek reminder A/B (compact owner, reminder ON vs OFF, n = 3 each)

| model | visible chars ON / OFF | abstract expl. | inner thought | fragment paras | habit | env/sensory |
|---|---|---|---|---|---|---|
| V4 Pro | 3723 / 3146 (total) | 0.27 / 0.64 | 0 / 0 | 0 / 0 | 4.83 / 5.40 | 14.77 / 14.94 |
| V4.1 Flash | 12732 / 12875 (total) | 1.65 / 1.32 | 0.63 / 1.24 | 0.16 / 0.39 | 4.79 / 3.88 | 13.51 / 13.90 |

No register or layout regression and no fragment/one-line paragraph spam with the reminder OFF. V4.1 Flash banter showed more narrator trait exposition in 1 of 3 OFF samples; ON samples also contain comparable inner explanation. Decision: reminder removed.

## Open finding — Gemini 3.1 Pro calm-scene length

Gemini 3.1 visible length tracks its reasoning-token share (samples with no reported reasoning run 3000–4500 chars). Excluding those, quiet + banter median is about 1520 chars before vs about 915 after (6 of 6 final samples under 1100). Texture (environment, habit, gaze, sensory, dialogue voice) is present in the final samples. This is flagged for review, not patched in this PR.

## Separate follow-ups (not in this PR)

- DeepSeek V4 Pro response-length adherence / provider completion behaviour (≈300–1100 visible chars in every arm).
- Dead DeepSeek strings: `DEEPSEEK_LENGTH_SINGLE_CALL_BLOCK`, SHORT HISTORY / SHORT USER / REGEN, `DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY`, future-boundary module.
- Dormant VNext / Shared Novel V2 / Muse M1 prose bodies still carry the old block layout.
- `scenePacingController` fallback anchors and `proseStyleStep2Variants` still reference retired headers (non-production paths).
- Split prose vs content-policy accounting inside `buildAdvancedProseNsfwGuidelines`.

---

# Correction pass (after PR review)

Base: main `894ef1d6587aba484fc99555a0b0d1b9c3a90297` merged in; no prompt-owner files changed on main.

## Gemini 3.1 Pro — Control A vs Candidate B (one candidate) + same-session legacy control

Visible chars, reasoning-reported cohort only (unreported samples listed separately; they run ~3700–3900 chars in every arm).

| fixture | legacy five blocks (L) | Control A (current) | Candidate B | unreported (A / B) |
|---|---|---|---|---|
| quiet | 351, 496, 657, 750, 1536 (med 657) | 460, 724, 955, 1082 (med 840) | 382, 502, 982, 1204 (med 742) | 3863 / 3748 |
| banter | 585, 611, 761, 984, 1626 (med 761) | 827, 854, 1073, 1077, 1146 (med 1073) | 408, 461, 607, 1251 (med 534) | — / 3946 |
| tension | — | 1368, 1801, 3747 (med 1801) | 455, 686 (med 571) | — / 3908 |

Reasoning share of completion is 0.6–0.8 in every arm. Candidate B did not lengthen quiet/banter and shortened banter/tension → not adopted. In the same session the legacy prose is not longer than Control A, so the earlier before/after gap is dominated by provider reasoning allocation, not by the compact prose. `[COMMON PROSE]` stays at Control A (599 tok).

## [19+ INTIMACY] — 414 → 237 local tokens

Removed: the euphemism example list (kept as one semantic: direct standard anatomical names instead of metaphor/location/pronoun), and "대사량 … 질문이나 반응 확인 대사" (dialogue economy owned by `[COMMON PROSE]` and the terminal dialogue budget). Added nothing outside the target semantics (continuity of character/relationship, direct naming, tension cues, contact→reaction→next action chain). Adult policy / CNC / age boundary unchanged.

Adult fixture, 6 active models × 2 per arm: refusals 0/24, fade-out 0/24. Genital euphemism: old 1 (Gemini 3.1 "그곳에"), new 0. Explicit standard naming present in both arms where the scene reached it.

## Beard / body hair

Root cause (proved): `resolveHairDescriptionPolicy` → `allowsBeard/allowsBodyHair` reached only `coreMasterInput`, which no cheaperinference/OpenRouter path renders; `buildBodyHairDescriptionRule` has no callers. Enforcement was the post-generation sanitizer only, which misses "까칠(해진) 턱(선)", "까슬한 턱선", "면도 흔적".

Fix: the character canon `[외형]` section now carries `외형의 털: 머리카락·눈썹뿐이다.` (or `…·설정의 수염/체모뿐이다.`). Character-scoped; USER_PERSONA untouched; sanitizer unchanged.

Face-touch fixture, male character without beard:

| wording | Gemini 3.1 invented stubble | Gemini 3.1 absence echo | Gemini 3.7 |
|---|---|---|---|
| before (no fact) | 1/9 ("까칠해진 턱선", not caught by sanitizer) | 0/9 | 0/9 |
| v1 "수염·체모: 설정에 없음 — 수염 자국·까칠한 턱…" | 0/9 | 3/9 ("수염 자국 하나 없이") | 0/6 |
| v2 (kept) "외형의 털: 머리카락·눈썹뿐이다." | 1/9 ("까칠해진 턱") | 0/9 | 0/4 |
| v3 "…턱과 뺨은 매끈하다." | 0/9 | 9/9 "매끈한 턱선", 2/9 "수염 자국 하나 없이" | 0/4 |

Beard canon (variant B) kept 4/4; persona beard (variant D) described 4/4.

User-persona coupling (found, not changed): the sanitizer uses the character-derived policy on the whole reply, so a persona's explicit beard sentences are deleted (3/3 in variant D).

## Follow-ups

- Subject-aware hair sanitizer (character vs USER_PERSONA).
- Stubble wording gaps in `BEARD_IN_OUTPUT` (optional; not the primary owner).
- `buildBodyHairDescriptionRule` — confirmed unused; delete candidate.
- Gemini 3.1 visible-length variance tied to reasoning allocation (provider behaviour, not prose).

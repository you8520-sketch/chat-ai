# Source Anchors (identified, not consumed)

The audit planned to reuse existing human-approved / production-quality raw RP outputs as style anchors. No new source-model calls (Opus / Terra / Gemini = 0). Because the prompt parity gate failed and live calls were not run, these anchors were **identified but not consumed**.

All anchors are fictional, explicitly-adult, consensual adult-route fixtures.

## Source O — Opus 5 (Claude Opus 5)

| Field | Value |
|---|---|
| File | `/opt/cursor/artifacts/opus-instruction-boundary/live/s5_relationship_hand/arm-E/run1/turn2-provider-raw.txt` |
| Model | `claude-opus-5` |
| Visible chars | 2858 |
| finish_reason | stop |
| Scenario | `s5_relationship_hand` (relationship / hand-holding; emotion + psychology) |
| Human-approved | YES — `docs/audits/OPUS_AUDIT_57_59_FINAL_FREEZE.md`: `ARM_E_ACCEPTED_AS_OPUS_TERMINAL_CANDIDATE`, `FINAL_HUMAN_REVIEW_PASS`, `OPUS_PRODUCTION_READY`. Arm D/F explicitly rejected. |

Excerpt:
> "알겠다." 카스펜이 그 두 글자를 소리 내어 되뇌었다. 발음이 어색했다. 십칠 년 동안 그가 들어온 대답은 비명, 애언, 침묵, 혹은 등을 보이며 멀어지는 발소리뿐이었다…

Alternate (longer, same scenario, Audit 59 Stage 2 Arm E): `/opt/cursor/artifacts/opus-agency-safe-length-recovery/live/s5_relationship_hand/arm-E/run1/turn2-provider-raw.txt` — 3241 chars, stop.

## Source T — GPT-5.6 Terra

| Field | Value |
|---|---|
| File | `/opt/cursor/artifacts/final-production-model-smoke/live/terra_action/run1/turn1-provider-raw.txt` |
| Model | `gpt-5.6-terra` (resolved `openai/gpt-5.6-terra`) |
| Visible chars | 3751 |
| finish_reason | stop |
| Scenario | `terra_action` (action / environment / spatial causality) |
| Human-approved | YES — `docs/audits/final-production-model-smoke/STATUS.md`: `TERRA_PROSE_PASS / STYLE_PASS / OUTPUT_PASS / ACTION_PASS`, `FINAL_HUMAN_REVIEW_PASS`, `TERRA_PRODUCTION_READY`, `MERGE_APPROVED_BY_HUMAN_REVIEW`. |

Excerpt:
> 비명은 한 번 길게 찢겼다가, 무언가에 짓눌린 듯 갑자기 끊겼다. 이어진 금속 마찰음은 폐허 너머를 긁으며 이동했다. 녹슨 철판이 바닥을 끌리는 소리와는 달랐다…

Alternate (richer continuation, same smoke): `.../terra_action/run1/turn2-provider-raw.txt` — 4936 chars, stop.

## Source G — Gemini 3.1 Pro

| Field | Value |
|---|---|
| File | `/opt/cursor/artifacts/gemini31-opus5-minimal-screen/gemini31/relationship/run1/turn2-provider-raw.txt` |
| Model | `gemini-3.1-pro-preview` |
| Visible chars | 4254 |
| finish_reason | stop |
| Scenario | Audit 55 production common-prompt (collaborative owner + terminal length owner), relationship |
| Human-approved | No formal PASS verdict in repo (`RUNTIME_RESULTS.json`: `human_review: NOT_RUN`; `AVAILABILITY.json` only records model availability). Best technical match for the ~4000-char / rich-narration / bundled-dialogue criteria. |

Excerpt:
> 태형의 입술이 아주 미세하게 벌어졌다. 허공에 맴돌던 그의 옅은 미소가 그대로 굳어진 것은 순식간의 일이었다. 방금 자신이 잘못 들은 건가 싶어…

Alternate (action scenario): `.../gemini31/action/run1/turn2-provider-raw.txt` — 4327 chars, stop.

All Gemini 3.1 cells in this audit are `finish=stop` (relationship T1 4659, T2 4254; action T1 4743, T2 4327).

## Note on Gemini anchor

Unlike Opus and Terra, the Gemini 3.1 Audit 55 outputs do not have a corresponding human PASS / PRODUCTION_READY document in this workspace. If a human-approved Gemini anchor is required for a future re-run, a prior human-reviewed Gemini output should be substituted or Audit 55 should receive a formal review pass first. This does not affect the current audit outcome, which stopped at the prompt parity gate before any anchor was consumed.

## Adult transition fixture

The planned common adult-route entry user turn (byte-identical across A/B and sources) was prepared:

```text
*그의 손이 내 허리를 감싸 안는다. 눈이 마주치고 거리가 사라진다.*

“이대로 있어도 돼?”

*곁에서 숨소리가 가까워진다. 더 가까이 닿아도 좋다는 허락이 눈빛에 묻어 있다.*
```

Consensual, explicitly-adult, fictional characters, `intimate_transition` / `explicit` scene intent. This turn was used only inside the parity check (c18 nsfw fixture); no generation was performed.

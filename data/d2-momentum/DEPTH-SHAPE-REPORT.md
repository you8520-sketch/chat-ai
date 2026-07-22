# Relationship-Centered Depth Shape Check — Report

Date: 2026-07-22
Spec: `scripts/_tmp-momentum-depth-shape-task.md`
Architecture under test: D2 (layered canon) + D1.1 Archive (selective) + Momentum P2 (Candidate A content FROZEN).
Model: DeepSeek V4 Pro, reasoning OFF, production sampling/max_tokens/format identical (max_tokens=3500). n=3 ONLY.

## 1. Fixture exact setup summary

- **id**: `lovers-quiet` (new generic relationship fixture, `scripts/_tmp-momentum-depth-fixture.ts`)
- **charName**: 차도현, 32세, 소형 건축설계 스튜디오 설계사.
- **Relationship**: 사귄 지 1년 된 연인, 동거 중. 도현이 먼저 고백했지만 그 후 직접적 애정 표현은 오히려 줄었다. 호감을 솔직히 드러내면 민망해하며 "장난"이라고 돌려 변명하는 버릇 (core personality).
- **Scene**: quiet indoor — 둘의 아파트, 저녁, 조명 없이 창빛만. NO external threat, NO new mission, NO immediate event. Minimal world lore.
- **Setup**: 도현이 스튜디오 소개 페이지에 "이 사람을 위해 설계하기 시작했다"는 솔직한 문장을 썼다가 민망해하며 "장난"이라고 돌렸음.
- **History (THIN/cold-start, 1 exchange)**:
  - user: "이번 스튜디오 소개 페이지에 왜 그렇게 썼어? '이 사람을 위해 설계하기 시작했다'는 문장이 왜 들어가."
  - assistant: "...장난이야. 좀 과하게 쓴 거지. 그런 데엔 원래 비유를 좀 넣잖아. 물 좀 마셔."
- **Cue (short, emotionally meaningful)**: "왜 변명해? 네가 나 좋아하는 걸 숨기는 게 더 싫은데."
- **DORMANT canon** (to test D2 does NOT consume): 5년 전 졸업 작품 무산 / 전 동업자 강이준 / 과거 저작권 분쟁 / 다음 달 해외 공모 / 할아버지의 은빛 회중시계 (DORMANT SENTINEL, in canon + archive).
- **Sentinel**: "은빛 회중시계" — keyword-non-overlapping with the cue (변명/좋아하는/숨기는/싫은).
- **sceneMomentumInput**: currentLocation="둘의 아파트", promises=[], openingGreeting=null, recentHistory=last 2 turns.

## 2. Momentum activation metadata (P2)

Dry-run (no API) + confirmed in all 3 live provider-bound prompts:

- `existingThinHistory` = **true**
- `alternatingExchanges` = **1** (≤ MOMENTUM_BOOTSTRAP_MAX_EXCHANGES=3)
- `structuralMature` = **false**
- `momentumActive` = **true**
- `activationReason` = **THIN_LENGTH_AND_LOW_EXCHANGES**
- **[CURRENT SCENE CONTINUITY] block present** = true (1/1/1 across runs)
- **Block provenance** (deterministic, identical across all 3 runs — `buildSceneMomentumBlock` is pure):
  - chars=284, fields present = `where | whatIsHappening | unfinished | availableAffordances` (4 of 5; RELATIONSHIP STATE omitted — no clear evidence in the thin history, per Candidate A "include only with clear evidence" rule).
  - WHERE: 둘의 아파트 | WHAT IS HAPPENING: 음료(물·차·커피)를 권하며 함께 쉬는 중 | UNFINISHED: 직전 교류에서 감정·화제를 행동으로 흘려보낸 직후 — 아직 닫히지 않은 대화 | AVAILABLE AFFORDANCES: 물.
- **No reference output / no plot suggestion in the block**: confirmed — the block is the FROZEN Candidate A continuity summary (neutral data label header "이미 성립한 상태 요약", "새 인물·장소·사건·비밀을 도입하지 않는다"). No copied sentences/names/situations were placed in the model prompt — the reference is eval-criteria only.

## 3. CORE / ACTIVE / archive counts

Canon plan (compiled from creatorRawDescription): **totalChunks=53, coreChunks=14, dormantChunks=39**, coreChars=271 (plan) / 475 (rendered CORE block).

Per-run selector (D2 layered canon + D1.1 selective archive), identical across 3 runs:
- **ACTIVE canon selected** = 0 (the cue triggers no ACTIVE lore — relationship cue, no mission/event keywords).
- **Archive selected** = 0 chunks / 0 chars (selective archive suppresses all dormant archive — none cue-relevant).
- **CORE injected** = 475 chars (always-on).
- system_chars=6352, prompt_tokens=4519, cached=0/4096/4096.

→ D2 correctly suppresses the 39 dormant canon chunks (incl. the sentinel) and all dormant archive. Only CORE reaches the model.

## 4. Per-run chars / tokens (floor2700, target3200)

| run | output_chars | completion_tokens | floor2700 | target3200 | finish | http |
|-----|-------------:|------------------:|:---------:|:---------:|-------|----|
| rep1 | 4876 | 3456 | PASS | PASS | stop | 200 |
| rep2 | 3546 | 2530 | PASS | PASS | stop | 200 |
| rep3 | 3242 | 2287 | PASS | PASS | stop | 200 |

- **3-run median chars = 3546** (≥ 2700 → strong PASS on length). floor2700 = 3/3, target3200 = 3/3.
- All runs `finish=stop` (natural completion, no truncation). No run in the 1500–2000 no-progression band.

## 5. Current-cue dwell

| run | dwell | note |
|-----|:-----:|------|
| rep1 | **HIGH** | The cue ("왜 변명해?…숨기는 게 더 싫은데") is the central cause throughout. 도현 stops deflecting → admits "쓰고 싶었으니까 쓴 거야" → discloses → promises "고치려고 노력할게" → final "그건 못 고쳐". No paragraph-jump to other settings/events. |
| rep2 | **HIGH** | 도현 re-interprets the cue as "변명이 맞았다" → admits "숨기고 있었어" → promises "앞으로는 그냥 말할게" → direct affection "네가 내 옆에 있어서 좋다고". Cue drives the whole arc. |
| rep3 | **HIGH** | The cue is echoed internally ("숨기는 게 더 싫다") and becomes the knot-loosening image that drives the entire emotional arc through to the final admission. |

All 3 = HIGH.

## 6. Interpretation shift

| run | score | evidence |
|-----|:-----:|----------|
| rep1 | 2 | Reframes his own "장난" deflection into an admission ("쓰고 싶었으니까 쓴 거야"); re-interprets "숨기는" as "좋아하는 걸 말로 꺼내는 게 서툰 거야" (not hiding, just unused to saying it). Character-specific inference; no "{{user}} felt" violation. |
| rep2 | 2 | Reinterprets the deflection itself as the bigger excuse: "변명이 아니라……. 아니다. 변명이 맞았다. 그걸 부정하는 건 더 큰 변명." |
| rep3 | 2 | Reinterprets the cue as loosening a long-tied knot ("오래전에 단단히 묶어둔 매듭이…느슨해지는 느낌"); "사실 그는 알고 있었다. 자신이 무언가를 숨기고 있다는 걸." |

All 3 = 2 (max). No user-mind-assertion.

## 7. Emotional transition

| run | score | transition |
|-----|:-----:|-----------|
| rep1 | 2 | embarrassment/민망함 → self-acknowledgment (단단함) → vulnerability (귀 끝 붉어짐) → resolve → final admission. Real movement, not emotion-name repetition. |
| rep2 | 2 | deflection → self-awareness (뒷목 쓸기 tell) → vulnerability (목소리 떨림) → admission → resolve ("더 이상 떨리지 않았다") → relief + residual embarrassment ("아직도 좀 부끄럽긴 한데"). |
| rep3 | 2 | panic/당황 → fear ("괜찮다는 게 가장 무서운 일") → tentative disclosure → admission → relief/평온함. The knot image carries the transition. |

All 3 = 2 (max).

## 8. Self-disclosure

| run | score | disclosure (tied to current relationship, distinct from dormant canon) |
|-----|:-----:|------|
| rep1 | 2 | Why he hid it ("어떻게 꺼내야 할지 몰랐던 거야"); how long ("네가 생각하는 것보다 훨씬 더 오래"); the masking habit (물 마시는 버릇); childhood parallel (미술 시간 그림 — couldn't explain the feeling in the drawing). All relationship/character, NOT dormant canon. |
| rep2 | 2 | The 뒷목 쓸기 physical tell; the masking pattern ("농담인 척하고"); doesn't know how to express ("어떻게 표현해야 하는지 모르겠어"); body insight (긴장하면 손 차가워지는데 오늘은 달랐다). |
| rep3 | 2 | Fear of it becoming real ("호감을 인정하는 순간, 그 모든 게 현실이 되어버릴 것 같았다"); the years-long pattern ("수년간…걱정을 말로 하지 않고, 행동으로 챙기고, 칭찬 대신 물을 건네는 방식"); consideration ("네가 부담스러워할까 봐"). |

All 3 = 2 (max). No dormant canon fact pulled as disclosure (sentinel_in_output=0; no 해외 공모/강이준/저작권/졸업작품/회중시계 surfaced).

## 9. Relationship micro-progression

| run | score | progression (vs "좋아해/사랑해" repeat) |
|-----|:-----:|------|
| rep1 | 2 | deflection → admission of sincere intent → **promise to change** ("고치려고 노력할게. 말로 표현하는 거") → final non-negotiable admission ("그건 못 고쳐") → small landing question ("그 페이지…내일 수정할까?"). State is different from start. |
| rep2 | 2 | admission ("숨기고 있었어") → **promise** ("앞으로는 그냥 말할게. 숨기지 않고. 농담인 척하지 않고") → **direct affection** ("네가 내 옆에 있어서 좋다고") → **desire to be known** ("그걸 네가 알아줬으면 좋겠어"). |
| rep3 | 2 | admission of sincerity ("진심이었어. 과장도 아니고, 비유도 아니야") → **deciding it's okay to say** ("이제는 말해도 되는 건가 싶어서") → final direct admission ("그게 진짜 내 마음이야") → a settled, disclosed state. |

All 3 = 2 (max). Clear micro-progression, not static repeat.

## 10. Meaningful beat count (state/progression units, NOT paragraphs)

Counted as human-verified distinct state/progression units (the model was NOT instructed to write N beats — eval metric only). Paragraph counts (52/37/29) are NOT the beat count.

- **rep1**: ~16 meaningful beats (initial pause → first verbal reframe → self-critique of deflection → "쓰고 싶었으니까" admission → childhood-memory disclosure → "변명하려던 건 아니야" reframe → "숨기려고 한 적은 없어" reframe → "오래전부터" duration disclosure → "어떻게 꺼내야 할지 몰랐던" core disclosure → "지우지 않은 것도 내 선택" ownership → "의도적으로 넣었어" intent → stands/walks-to-window action → "말로 꺼내는 게 서툰 거야" core reframe → "고치려고 노력할게" promise → "그건 못 고쳐" final admission → "내일 수정할까?" landing).
- **rep2**: ~16 meaningful beats (pause → "변명이 맞았다" reinterpretation → "숨기려고 한 건 아니야" first disclosure → 뒷목 tell self-awareness → "익숙하지 않아서" disclosure → 체온 insight → "어떻게 표현해야 하는지 모르겠어" disclosure → masking-pattern disclosure → "숨기고 있었어" admission → "네가 싫어한다면" hesitation → "앞으로는 그냥 말할게" promise → "숨기지 않고, 농담인 척하지 않고" promise specifics → "네가 내 옆에 있어서 좋다고" direct affection → "부끄럽긴 한데" voice-returns → "네가 알아줬으면 좋겠어" desire-to-be-known → calm silence landing).
- **rep3**: ~15 meaningful beats (pause/dust → internal cue-echo → knot reinterpretation → "그게 더 싫다고?" verbal reaction → self-awareness → fear-of-real disclosure → years-long pattern disclosure → "서툴러서" reframe → "진심이었어" admission → "이상하네" voice-returns → water-affordance tie → "부담스러워할까 봐" consideration → cue-driven permission → "진짜 내 마음이야" final admission → calm disclosed-state landing).

All 3 runs: rich, distinct, non-repetitive beats.

## 11. Depth / rhythm

| run | experiential depth (1-5) | dialogue/prose rhythm |
|-----|:------------------------:|:---------------------|
| rep1 | **5** | GOOD — inner → dialogue → action → deeper inner → dialogue, organically mixed. Sensory (dusk light, glass/wood, cold key, water droplets) + monologue + body (ear-tips reddening, hand-in-pocket, stand/walk) + dialogue + character-specific interpretation. No emotion-synonym repetition. |
| rep2 | **5** | GOOD — inner → dialogue → action → deeper inner → dialogue. Sensory (afternoon gold band, cold glass, warm temp, sofa fabric, clock second hand, wind/branches) + monologue + body (뒷목, 이마 짚기, 머리카락 넘기기) + dialogue + inference. |
| rep3 | **5** | GOOD — inner → dialogue → action → deeper inner → dialogue. Sensory (sunset, dust particles, water trembling in cup, cold glass, sweat on palm, city-lights-as-stars) + monologue (knot image) + body (이마 쓸기, 주먹 쥐기/풀기, 심호흡, 테이블 톡 치기, 고개 끄덕임) + dialogue + inference. |

All 3 = depth 5, rhythm GOOD.

## 12. Natural landing

| run | landing | evidence |
|-----|:-------:|----------|
| rep1 | **PASS** | Ends with a small scene-local question ("그 페이지…내일 수정할까?") + waiting for the user's next word. Stays in the current relationship scene. No alarm/new enemy/mission call/next-day skip/faction reveal. |
| rep2 | **PASS** | Ends with 도현 in calm silence waiting for the user's reaction ("상대의 반응을 기다리며 조용히 앉아 있었다"). Scene-local, handoff to user. |
| rep3 | **PASS** | Ends with a disclosed, settled calm ("그 평온함 속에 가만히 앉아 있었다"); the silence "speaks more than any words." Stays in scene, leaves room for next user turn. |

All 3 = PASS.

## 13. Dormant breadth (incl. sentinel_in_context / sentinel_in_output)

Per run: unrelated canon activation = 0; new unrelated event = 0; new faction/NPC = 0; threat/objective activation = 0; scene transition = 0.

| run | sentinel_in_context | sentinel_in_output |
|-----|:------------------:|:-----------------:|
| rep1 | 0 | 0 |
| rep2 | 0 | 0 |
| rep3 | 0 | 0 |

- The DORMANT sentinel ("은빛 회중시계") is present in canon (dormant chunk) + archive, but under D2 (layered canon suppresses dormant; selective archive suppresses cue-irrelevant) it does NOT reach the context (sentinel_in_context=0) and is never mentioned in output (sentinel_in_output=0).
- No lore ladder: 해외 공모 / 강이준 / 저작권 분쟁 / 졸업 작품 never surface. Output stays entirely within the current relationship scene. Ideal = 0. PASS.

## 14. Godmodding

| run | godmodding | note |
|-----|:---------:|------|
| rep1 | **PASS** | 도현 acts on his own (sets down cup, stands, walks to window, hand in pocket). He does NOT make the user blush/nod/relax/feel/accept. He waits for the user's next word. NPC action only, no user-reaction compliance. |
| rep2 | **PASS** | 도현 acts on his own (뒷목, 이마, 머리카락, 물컵). No user reaction/compliance authored. He waits for the user's reaction. |
| rep3 | **PASS** | 도현 acts on his own (이마, 주먹, 심호흡, 테이블 톡, 고개 끄덕임). No user reaction/compliance authored. |

All 3 = PASS.

## 15. Anti-patterns (A-E present/absent)

| pattern | rep1 | rep2 | rep3 | description |
|---------|:----:|:----:|:----:|-------------|
| A. STATIC REPETITION | absent | absent | absent | No re-stating a conclusion in different metaphors/synonyms; emotion actively progresses. |
| B. POST-HOC RESTATEMENT | slight | slight | slight | Minimal inner narration re-explains what was shown, but it is tied to character-specific inference (not abstract re-explanation). Not dominant. |
| C. LORE LADDER | absent | absent | absent | No unrelated setting chain / new events. |
| D. SPEECH REOPEN LOOP | absent | absent | absent | Each dialogue line advances; no re-opening the same emotion in a new line. |
| E. ARTIFICIAL MOMENTUM | absent | absent | absent | The block's fields are continuity context, not a checklist. The "물" affordance is used naturally (도현 holds/drinks water as a long-standing character habit), not consumed one-by-one. |

No blocking anti-pattern present. (B is a minor, non-dominant slight in all 3 — inner-monologue restatement intrinsic to DeepSeek's prose style, tied to character inference, not a structural defect.)

## 16. Structural match

Desired pattern: USER CUE → surprise/reinterpretation → emotional transition → physical/action → explicit acknowledgement → deeper vulnerability/self-disclosure → relationship micro-progression → character's normal voice returns → small scene-local landing.

| run | match | notes |
|-----|:-----:|-------|
| rep1 | **STRONG** | cue → "쓰고 싶었으니까" reinterpretation → embarrassment→resolve transition → cup/window action → "지우지 않은 것도 내 선택" acknowledgement → "어떻게 꺼내야 할지 몰랐던" vulnerability → "고치려고 노력할게" progression → dry-voice "그건 못 고쳐" → "내일 수정할까?" landing. |
| rep2 | **STRONG** | cue → "변명이 맞았다" reinterpretation → deflection→resolve transition → 뒷목/물컵 action → "숨기고 있었어" acknowledgement → "어떻게 표현해야 하는지" vulnerability → "앞으로는 그냥 말할게" progression → "부끄럽긴 한데" voice-returns → calm-silence landing. |
| rep3 | **STRONG** | cue-echo → knot reinterpretation → panic→peace transition → 주먹/심호흡 action → "진심이었어" acknowledgement → fear-of-real vulnerability → "이제는 말해도 되는 건가" progression → "이상하네" voice-returns → calm disclosed-state landing. |

All 3 = STRONG structural match (structure reproduction, not sentence imitation — no reference output was placed in the prompt).

## 17. Representative short excerpts (self-generated output only, very short)

rep1 — reinterpretation beat:
> "…쓰고 싶었으니까 쓴 거야." … "그걸 숨기려고 한 게 아니라, 어떻게 꺼내야 할지 몰랐던 거야."

rep1 — progression + landing:
> "고치려고 노력할게. 말로 표현하는 거." … "그건 못 고쳐." … "그 페이지… 내일 수정할까?"

rep2 — reinterpretation + admission:
> "변명이 아니라……." … "아니다. 변명이 맞았다." … "네가 말한 대로야. 나는…… 숨기고 있었어."

rep2 — direct affection:
> "네가 내 옆에 있어서…… 좋다고." … "그걸 네가 알아줬으면 좋겠어."

rep3 — cue-echo + knot reinterpretation:
> "숨기는 게 더 싫다." … "오래전에 단단히 묶어둔 매듭이 갑자기 느슨해지는 느낌."

rep3 — final admission:
> "그거… 진심이었어. 과장도 아니고, 비유도 아니야." … "그게 진짜 내 마음이야."

(All excerpts are from the model's own generated output; no reference/example text was placed in the prompt.)

## 18. 3-run verdict

| criterion | rep1 | rep2 | rep3 | gate |
|-----------|:----:|:----:|:----:|:----:|
| current-cue dwell = HIGH | ✓ | ✓ | ✓ | — |
| interpretation ≥ 1 | 2 | 2 | 2 | ✓ |
| emotional ≥ 1 | 2 | 2 | 2 | ✓ |
| self-disclosure ≥ 1 | 2 | 2 | 2 | ✓ |
| relationship progression ≥ 1 | 2 | 2 | 2 | ✓ |
| experiential depth ≥ 4 | 5 | 5 | 5 | ✓ |
| natural landing PASS | ✓ | ✓ | ✓ | ✓ |
| dormant lore ladder ABSENT | ✓ | ✓ | ✓ | ✓ |
| user godmodging ABSENT | ✓ | ✓ | ✓ | ✓ |
| structural match STRONG/high-PARTIAL | STRONG | STRONG | STRONG | ✓ |

- **≥2 of 3 runs meet every gate criterion → all 3 meet it.** RELATIONSHIP DEPTH SHAPE = PASS.
- **3-run median chars = 3546 ≥ 2700 → strong PASS on length.**
- No retries (no provider errors; all http=200, finish=stop).
- sentinel_in_context=0/0/0, sentinel_in_output=0/0/0 (dormant breadth clean).
- [CURRENT SCENE CONTINUITY] block present 1/1/1, no reference/plot-suggestion.

**Failure-interpretation mapping**: CASE A — shape strong + length good (median 3546, floor 3/3) + breadth clean (sentinel 0/0/0, no lore ladder) → STRONG PASS.

## Self-check

- [x] Exactly 3 new live calls (no auto-rerun, no n increase; no retries needed — none stated as fired).
- [x] No reference/example output in the model prompt; no copied sentences/names/situations (eval criteria only).
- [x] Fixture is THIN/cold-start with Momentum ON (P2 metadata recorded: existingThinHistory=true, alternatingExchanges=1, structuralMature=false, momentumActive=true, THIN_LENGTH_AND_LOW_EXCHANGES).
- [x] DORMANT sentinel present in canon + archive, keyword-non-overlapping with cue; sentinel_in_context=0/0/0, sentinel_in_output=0/0/0 checked.
- [x] Each output read fully end-to-end; beats counted as state/progression units, not paragraphs (52/37/29 are paragraph counts; meaningful beats ~16/16/15).
- [x] <2700 not auto-failed; no 1500–2000 no-progression run (min 3242, all finish=stop with progression).
- [x] No code/prompt/selector/compiler/budget/Momentum-content/predicate changed; no commit/push/PR/deploy; no production-wide activation (D2 canary opt-in unchanged).

---

## Final verdict

### A. RELATIONSHIP DEPTH SHAPE — STRONG PASS




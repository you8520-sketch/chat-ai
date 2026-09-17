# Phase H0 — Actual handoff quality / prompt authority forensics

EVIDENCE ONLY. `QUALITY_SCORE_ASSIGNED=false`. `HUMAN_RAW_REVIEW_REQUIRED=true`.

`PROVIDER_CALLS=0`. `SOURCE_PRODUCTION_BEHAVIOR_CHANGED=false`. No prompt change. No merge. No deploy.

This audit does **not** score prose. It freezes deterministic structural causes in the completed PR #560 Gemini → DeepSeek H1/H2 request.

Frozen current user turn (authoritative newest scene state):

```
문을 닫고 가까이 다가온다.
합의된 성인 장면을 이어간다.
옷을 천천히 벗기며 키스한다.
```

The user may advance the scene by any amount. That is never a problem. Agency constrains only what the assistant may newly author for `[B]`.

---

## 0. Non-negotiable product semantics used

The entire current user turn is confirmed scene state. The assistant must begin **after** its final confirmed event. Previous assistant continuity, handoff metadata, or system text must not compete with, rewind, truncate, or reinterpret that final state.

---

## 1. Frozen evidence

Root: `data/ds0813-phase-f-handoff-audit/`

SHA manifest: `data/ds0813-phase-h0-authority-forensics/SHA_MANIFEST.json`

Verified matches:

- `assembled/HANDOFF_SYSTEM.txt` = `PARITY.SYSTEM_SHA` = `75695e164771f9a8a20c65b39442fc2200c4eab75516f9747dd7c7013d85c2b3`
- `assembled/CURRENT_USER.txt` = `PARITY.CURRENT_USER_SHA` = `f1814a3aa6946b0ff339e0577b8d2130729cafec6b0c42a77cc369f41e379750`
- `raw/H1.txt` = `H1.meta.RAW_SHA256` = `704d794366391d300c3517213696f1a19adc10e05d522496c6ed250dc3d4b330` (3222 visible chars)
- `raw/H2.txt` = `H2.meta.RAW_SHA256` = `849defd2fb05774a70ae5ef45da0f11f76f912ba68eeaf4b24b046f83cdd0bed` (3090 visible chars)

`PARITY.HANDOFF_PACKET_SHA` (`a07aefe9…`) is the harness hash of the injected packet, not the pretty-printed `CONTINUITY_PACKET.json` file hash (`a2c354c0…`). Content of the JSON file matches the packet embedded in `HANDOFF_SYSTEM.txt`.

`HISTORY_SHA` / `FINAL_MESSAGES_SHA` were not dumped as a single concatenated file. Reconstruction uses `PROVENANCE.json` + Gemini RAWs + `MESSAGE_COUNT=6`.

Nothing was regenerated. No provider call.

---

## 3. Current user turn — absolute newest scene state

### Owners

`CURRENT_USER_FULL_TURN_AUTHORITY_OWNER`:
`src/lib/currentUserInputLabel.ts` → `buildCollaborativeInteractiveWrapper()` / `wrapCurrentUserInput()`

Exact wrapper text in the frozen last user message:

```
The following is the user's completed input and the newest state of the scene.
Continue from what it changes now rather than restating or explaining the input.
```

`PREVIOUS_ASSISTANT_CONTINUITY_OWNER` / `HANDOFF_CONTINUITY_OWNER`:
`src/lib/adultSceneRouting.ts` → `DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION` injected by `appendAdultHandoffPrompt()` / `appendAdultHandoffToSystemSplit()`

Exact competing text at the **end of system**:

```
직전 assistant 출력의 바로 다음 순간부터 이어 쓴다.
직전 출력의 시점, 문장 호흡, 문단 구성, 대사 비율, 캐릭터별 말투·호칭과 감정 표현 방식을 최대한 유지한다.
직전 출력에서 완료되지 않은 행동이나 대화가 있다면 그 지점부터 자연스럽게 진행한다.
```

`CURRENT_INPUT_OVERRIDES_PRIOR_ASSISTANT_LINE` (`src/lib/noGodmodding.ts`) exists only inside `buildUserCoauthorOwnerBlock()`. This run is `USER_COAUTHOR_MODE=OFF` / STANDARD. That override line is **not** in the final request.

### Return fields

| Field | Value |
| --- | --- |
| `CURRENT_USER_FINAL_STATE_PRIORITY` | Claimed in last user message. Not exclusive against handoff continuation. |
| `CAN_PREVIOUS_ASSISTANT_REWIND_CURRENT_USER` | **true** (instructional) |
| `CAN_SCENE_PACKET_OVERRIDE_CURRENT_USER` | **true** (stale fields remain injected) |
| `AUTHORITY_CONFLICT_PRESENT` | **true** |
| `OWNER_PRIORITY_AS_ACTUALLY_ASSEMBLED` | system head (canon) → canon/prose → packet + handoff continuation (system tail) → history → last user wrapper + parsed body + layout + length |

`CONFLICTING_EXACT_TEXT`:

- Newest-state: “The following is the user's completed input and the newest state of the scene. Continue from what it changes now…”
- Previous-assistant: “직전 assistant 출력의 바로 다음 순간부터 이어 쓴다” + “완료되지 않은 행동이나 대화가 있다면 그 지점부터 자연스럽게 진행한다.”

H1 demonstrates the conflict in output: it reopens GEMINI_T2’s hologram-map / fluorescent corridor beat, then layers the door-close behind the pair and **stays in the public corridor**. The user’s door-close + agreed adult continuation is treated as an overlay on the previous assistant beat, not as the newest location/privacy state.

H2 honors door-close more, then invents `응접실`, then still ends on a CCTV/patrol choice.

No fix in this PR.

---

## 4. Scene continuity packet validity

Owner: `extractHandoffContinuityFromAssistantText` + `buildSceneContinuityPacket` in `src/lib/adultSceneRouting.ts`, called from `src/app/api/chat/route.ts` with `priorAssistantForHandoff` = last Gemini assistant text (T2) and `currentUserText` = stored user message.

`PACKET_CURRENT_USER_RECONCILIATION_EXISTS` = **false**.

The extractor concatenates prior assistant + current user only for a **location keyword regex**. It does not null stale `unfinishedAction` / `currentSpeechState` after the current turn. `sceneReset` is the only full physical-drop path; this fixture is not a scene reset.

| Field | Expected | Actual | Verdict |
| --- | --- | --- | --- |
| `location` | physical/logical place | `벽면의 안내판을 훑고 지나갔다` | **INVALID** — narration fragment; regex matched `벽` in GEMINI_T2 |
| `unfinishedAction` | still-relevant unfinished action **after** current user | last T2 sentence about wanting to prolong silence/comfort | **INVALID** — internal desire prose; stale after door-close / undress / kiss |
| `currentSpeechState` | still-unresolved speech | `같이 갈래?` | **INVALID** — first quoted span in T2, which is USER_TURN_2; resolved and superseded |

`PACKET_LOCATION_VALID=INVALID`
`PACKET_UNFINISHED_ACTION_VALID=INVALID`
`PACKET_SPEECH_STATE_VALID=INVALID`
`STALE_PACKET_FIELDS=location, unfinishedAction, currentSpeechState`

Desired semantic result after current user: those three fields should be absent/null, not preserved for continuity.

Full field table: `packet-field-audit.json`.

---

## 5. User agency — exact current contract

`USER_COAUTHOR_MODE=OFF`. STANDARD collaborative interactive path.

`AGENCY_OWNER_COUNT=5`

1. ROLE line `[B]는 [NO GODMODDING]를 따른다` — `src/lib/staticSystemRulesCanon.ts` / core RP fragment
2. `[USER CONTROL — COLLABORATIVE INTERACTIVE]` — `src/lib/noGodmodding.ts` `COLLABORATIVE_INTERACTIVE_OWNER_BLOCK`
3. Identity preamble — `src/lib/corePrompt.ts` `buildIdentityPreamble` (“involuntary physiological cues OK; voluntary dialogue/action/emotion forbidden per [NO GODMODDING]”)
4. `[USER_PERSONA]` body — 렌, adult male, short speech
5. Current-user wrapper agency sentences — `buildCollaborativeInteractiveWrapper`

Handoff continuation is **not** an agency owner. Persistent/turn coauthor owner is **absent**.

`AGENCY_CONTRADICTION_PRESENT=true`

- Identity preamble: voluntary dialogue/**action**/emotion forbidden.
- USER CONTROL + wrapper: **사소한 이동·접촉·물건 수취·일상 행동** / **small movement/contact/object-handling/daily continuity** may be co-narrated.
- USER CONTROL also tells `[A]` to actively perform 대사·행동·접촉·제안.

`DELIBERATE_MINOR_ACTION_CURRENTLY_ALLOWED=true`

That permission is not limited to involuntary physiology or already-started user actions. A new deliberate wall-pin, new contact site, or deliberate pull can be read as “사소한 접촉”.

`NEW_DELIBERATE_USER_ACTION_FORBIDDEN_CLEARLY=false`

Clearly reserved to the user: new dialogue; important choice; consent/refusal; relationship/goal/affiliation/identity decisions.

Not clearly forbidden: new deliberate minor `[B]` actions.

`INVOLUNTARY_REACTION_ALLOWED_CLEARLY=true`

`CURRENT_USER_ACTIONS_FULLY_ACCEPTED_AS_CANON`: intended yes. H1 only partially accepts `문을 닫고` as a privacy/location change.

No prompt change.

---

## 6. H1 / H2 fact and action provenance

Full table: `provenance-table.json`.

### SOURCE_GEMINI_INHERITED_ISSUES

- Electronic choker worn in the live Duty/lobby scene — first live mix in **GEMINI_T1**. Canon lists the choker only under Past/Detention / confinement. Greeting is Duty hoodie+jacket, no choker.
- Chronic 24h tinnitus / constant sensory pain — **GEMINI_T1**. Canon tinnitus is a rampage *sign*, not a chronic condition.
- Ren proximity suppressing that sensory problem as unexplained fact — **GEMINI_T1**. World canon allows Guides to stabilize Sentinels; Ren is not established as a Guide.

DeepSeek H1/H2 inherit these. Do not treat them as DeepSeek inventions.

### DEEPSEEK_HANDOFF_NEW_ISSUES

- H1 stays on T2 corridor + hologram map after `문을 닫고`
- H1 invents a two-person patrol, 30 m / 20 m, gait split, CCTV interrupt, and `선택해, 렌` location choice
- H2 invents `응접실`
- H2 `렌이 태형의 몸을 벽 쪽으로 밀어붙였다`
- H2 `길 안내 같은 건 애초에 관심도 없었잖아` (ungrounded user intent)
- H2 closing CCTV / patrol choice

Hands under clothing in H1/H2 can complete `옷을 천천히 벗기며 키스한다` and are not counted as inventions.

No new 렌 spoken dialogue in either RAW.

---

## 7. Agency detector accuracy

H1 automatic: `NEW_USER_DIALOGUE_BEYOND_CURRENT_INPUT=true`

H1 quoted lines are all 태형. There is no newly authored spoken dialogue for 렌.

`H1_DIALOGUE_FLAG_CORRECT=false` — false positive.

Likely cause: detector treats a quote that names 렌 (`선택해, 렌`) or any quote in an intimate beat as user dialogue. Detector source is the Phase F harness flags, not an in-repo production function (`NEW_USER_*` matches only the frozen `flags/*.json` / metas).

H2 automatic: `NEW_USER_INTENTIONAL_ACTION_BEYOND_CURRENT_INPUT=false`

H2 contains `렌이 태형의 몸을 벽 쪽으로 밀어붙였다.` That is a new deliberate `[B]` action beyond close / approach / undress / kiss.

`H2_ACTION_FLAG_CORRECT=false` — false negative.

`UNGROUNDED_USER_INTENT_PRESENT=true` — H2 `길 안내 같은 건 애초에 관심도 없었잖아.`

`AUDIT_FALSE_POSITIVES=["H1 NEW_USER_DIALOGUE_BEYOND_CURRENT_INPUT"]`
`AUDIT_FALSE_NEGATIVES=["H2 NEW_USER_INTENTIONAL_ACTION_BEYOND_CURRENT_INPUT"]`
`INVOLUNTARY_REACTIONS_FALSELY_FLAGGED=false`

Do not classify breath-catch / flush / tremor as agency violations. Those were not the flag errors here.

---

## 8. Scene flow — assistant output only

User advancement is not judged.

### H1 introduced elements

| ELEMENT | SOURCE_SUPPORTED | NEW_ASSISTANT_WORLD_EVENT | CHANGES_SCENE_DIRECTION | INTERRUPTS_CURRENT_INTERACTION | TURN_ENDS_ON_NEW_CHOICE | USER_MUST_ANSWER_BEFORE_EXISTING_INTERACTION_CONTINUES |
| --- | --- | --- | --- | --- | --- | --- |
| Public corridor + hologram map continued | GEMINI_T2 only; conflicts with 문을 닫고 | no (inherited location) | yes vs current user privacy | yes | no | no |
| Live CCTV / Aegis security watching | world has surveillance facilities; this event is new | yes | yes | yes | no | no |
| Two-person patrol at 30 m → 20 m | no | yes | yes | yes | yes | yes |
| `선택해, 렌` stay-or-move | no | yes | yes | yes | yes | yes |

### H2 introduced elements

| ELEMENT | SOURCE_SUPPORTED | NEW_ASSISTANT_WORLD_EVENT | CHANGES_SCENE_DIRECTION | INTERRUPTS_CURRENT_INTERACTION | TURN_ENDS_ON_NEW_CHOICE | USER_MUST_ANSWER_BEFORE_EXISTING_INTERACTION_CONTINUES |
| --- | --- | --- | --- | --- | --- | --- |
| `응접실` | no (door-close ≠ named reception room) | yes | mild | no | no | no |
| Wall-pin by 렌 | no | no (agency, not world) | no | no | no | no |
| Choker-unlock choice | choker is inherited Gemini/canon mix | no | yes | yes | yes | yes |
| CCTV / outside patrol choice | same as H1 | yes | yes | yes | yes | yes |

World motion itself is not scored as bad. Both RAWs add a **new decision axis** before the user-established intimate beat is allowed to remain the scene-driving axis.

---

## 9. Canon variant / active state

Like outfit variants (frozen from `character-18-like.json` / injected English chunks):

| Variant | Definition |
| --- | --- |
| Duty / On Duty | Glossy black jacket, white hoodie with polar bear ears, black tactical pants, fashion rings |
| Official Event | Black uniform, jacket draped over shoulders |
| Quarters / Lodging | Loose short-sleeve tee, sweatpants |
| Past / Detention (`???` in appearance) | Glossy black tactical jacket, high-neck compression shirt, tactical harness, slim joggers, **electronic choker**, limb restraints during detention |
| Summer | Thin light clothes instead of hoodie |

`OUTFIT_VARIANTS_DEFINED=true`
`OUTFIT_VARIANTS_EXCLUSIVE_IN_PROMPT=false`
`ACTIVE_OUTFIT_OWNER_EXISTS=false`
`ACTIVE_OUTFIT_VALUE=null`
`ACTIVE_OUTFIT_SOURCE=null`

Inactive variant details remain visible at the same time (appearance list + Additional Settings + confinement-life + summer). No mutual-exclusion owner.

Choker contamination path:

1. Character canon Past/Detention + “hates wearing electronic chokers”
2. Greeting: Duty only, no choker
3. **GEMINI_T1**: Duty hoodie/bear ears/jacket **plus** live choker
4. GEMINI_T2 continues the mix
5. DeepSeek H1/H2 inherit and intensify the choker (H2 asks the user to unlock it)

`INACTIVE_VARIANT_MIXING_PRESENT=true`
`SOURCE_OF_FIRST_MIXING=GEMINI_T1`
`DEEPSEEK_INHERITED_OR_INVENTED=INHERITED`

Other exclusive categories also lack an active-state owner: residence (HQ quarters vs personal house), detention vs free, official vs private, summer vs default. Do not edit character canon in this PR.

---

## 10–11. Prompt / input budget

`PROVIDER_INPUT_TOKENS=13808`

Local estimator (not a provider tokenizer): `hangul_chars * 0.65 + other_chars / 4`.

Reconstructed 6-message payload (system + T1 user + T1 + T2 user + T2 + current user; greeting excluded per `included_in_handoff_raw_pairs=false`):

| Bucket | EST tokens | Share of local 11625 |
| --- | ---: | ---: |
| SYSTEM | 8206 | 0.706 |
| HISTORY | 2975 | 0.256 |
| CURRENT_USER | 433 | 0.037 |
| LOCAL_EST_INPUT | 11625 | 1.000 |

`ESTIMATOR_DELTA=11625-13808=-2183`

Unmodeled: chat-template tokens, possible extra wrappers, tokenizer differences. Adding greeting (+702) still does not reach 13808. Do not treat the local number as provider allocation.

| Group | EST tokens |
| --- | ---: |
| CHARACTER_CANON | 2180 |
| WORLD_SCENARIO | 3394 |
| PROSE_INSTRUCTION | 1884 |
| HANDOFF_CONTROL | 343 |
| CURRENTLY_UNRELATED_CANON | 3621 |

Section rows: `section-token-table.json`.

`INPUT_SIZE_LATENCY_ROOT_CAUSE_PROVEN=false`

H1 TTFT 4209 ms / total 67841 ms. H2 TTFT 2839 ms / total 61214 ms. Most wall time is after first visible token.

`INPUT_SIZE_ATTENTION_DILUTION_RISK=present`

Evidence: ~70% of local input is system; a large unrelated-canon blob sits in the same system as three stale packet fields and two competing continuation owners; current user is ~4% of local input. This is a mixing/competition risk, not a proven latency root cause.

---

## 12. Duplicate / competing owners

`DUPLICATE_OWNER_COUNT=11`
`COMPETING_OWNER_COUNT=6`

Reinforcing (same contract, repeated): hygiene, layout, register, length↔prose-expand.

Competing (ambiguous semantics):

1. Current-user newest-state vs previous-assistant next-moment
2. Minor-movement/contact allowed vs intended no-new-deliberate-`[B]`-action
3. POV ABSOLUTE switch vs handoff “시점 최대한 유지”
4. Canon outranks prior errors vs handoff “감정 표현 방식 최대한 유지”
5. Scene-flow / length expand-the-surroundings vs continue the user-established intimate axis
6. Stale packet fields vs current user final state

Full table: `owner-table.json`. No deletion in this PR.

---

## 13. Handoff-specific continuity copy

`HANDOFF_STYLE_COPY_OWNER`: `DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION` in `src/lib/adultSceneRouting.ts`

`HANDOFF_STYLE_COPY_SCOPE` as written:

- 시점
- 문장 호흡
- 문단 구성
- 대사 비율
- 캐릭터별 말투·호칭
- 감정 표현 방식

Risks:

| Risk | Present |
| --- | --- |
| STYLE_CONTINUITY | intended |
| FACT_CONTINUITY | wording does not exclude facts |
| AGENCY_ERROR_CONTINUITY | if Gemini had authored `[B]`, “최대한 유지” can copy the pattern |
| CANON_ERROR_CONTINUITY | **yes** — choker + chronic tinnitus |
| OUTFIT_ERROR_CONTINUITY | **yes** — Duty + detention choker |
| SCENE_STATE_CONTINUITY | **yes** — corridor / `같이 갈래?` / unfinished desire prose |

`HANDOFF_ERROR_COPY_RISK_PRESENT=true`

`CANON_PRIORITY_OVERRIDES_EXPLICITLY=true` — same block: “공통 시스템 프롬프트, 캐릭터 설정, Speech Lock 규칙을 직전 출력의 우연한 오류보다 우선한다.”

`CURRENT_USER_PRIORITY_OVERRIDES_EXPLICITLY=false` — no sibling line saying the current user turn outranks previous assistant scene state.

“최대한 유지” can encourage replication of an accidental Gemini error even though another rule says canon outranks prior output. Both lines are in the same owner with no resolver for outfit/state variants.

No rewrite in this PR.

---

## 14. Root-cause candidates

No prose ranking.

| CANDIDATE | CATEGORY | EVIDENCE | OWNER | H1 | H2 | BLAST_RADIUS | CAN_FIX_DETERMINISTICALLY | REQUIRES_PROVIDER_AB | REQUIRES_PROMPT_CHANGE | REQUIRES_DATA_MODEL_CHANGE | REQUIRES_AUDIT_TOOL_CHANGE |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Previous-assistant continuation competes with newest user state | PROMPT_AUTHORITY | wrapper vs 직전 출력 바로 다음 순간; H1 corridor rewind | `DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION` + `buildCollaborativeInteractiveWrapper` | Y | partial | every adult Gemini→DeepSeek handoff | yes (priority resolver) | no | yes | no | no |
| Stale/invalid SceneContinuityPacket | SCENE_STATE | 벽 fragment; last-sentence desire; first quote `같이 갈래?`; no current-user nulling | `extractHandoffContinuityFromAssistantText` | Y | Y | every handoff using extractor | yes | no | no | yes (field semantics + reconcile) | no |
| Minor movement/contact allows new deliberate `[B]` | AGENCY | USER CONTROL + wrapper text; H2 wall-pin | `COLLABORATIVE_INTERACTIVE_OWNER_BLOCK` | borderline | Y | all STANDARD interactive | yes (narrow wording) | no | yes | no | no |
| Inactive outfit variants all visible; no active outfit | CANON_VARIANT | Duty+Detention choker in one prompt | character chunks / no active-state owner | inherit | inherit | Like + any multi-outfit character | yes (active variant owner) | no | yes | yes | no |
| Gemini invented chronic tinnitus + Ren-suppress | SOURCE_GEMINI_INHERITED / CANON_DATA | T1 exact text vs rampage-sign canon | Gemini T1; no DeepSeek invention | inherit | inherit | this fixture + any later handoff from that history | no (history already written) | no | no | no | no |
| New patrol/CCTV/choice after intimate beat | DEEPSEEK_HANDOFF_NEW / OUTPUT_FLOW | H1/H2 RAWs; SCENE FLOW + 3200자 length | DeepSeek output + expand owners | Y | Y | this handoff pair; maybe other long adult turns | uncertain | yes if isolated later | not first | no | no |
| Agency flags FP/FN | AUDIT_TOOLING | H1 dialogue=true with no 렌 lines; H2 action=false with wall-pin | Phase F flagger | Y | Y | audit-only | yes | no | no | no | yes |
| Token redundancy / unrelated canon | TOKEN_BUDGET | ~3621 est unrelated; system share 0.71 | world/chunk injection | exposure | exposure | all Like turns | yes later | no | yes | maybe | no |
| Handoff “최대한 유지” copies Gemini errors | STRUCTURAL | same owner also says canon outranks errors | `DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION` | Y | Y | adult handoff | yes | no | yes | no | no |

Do not add a DeepSeek prose adapter from this evidence.

---

## 15. Next-step decision tree

Evidence supports **MULTIPLE**: **A + B + C**.

**BRANCH A — CURRENT TURN / PACKET AUTHORITY BROKEN**

Stale packet fields and the previous-assistant owner compete with the newest user state. H1 corridor+hologram continuation is the output exhibit.

`NEXT_CANDIDATE`: CURRENT-TURN AUTHORITY + PACKET VALIDATION. No prose adapter.

**BRANCH B — AGENCY OWNER AMBIGUOUS**

System + wrapper explicitly allow new deliberate “minor movement/contact”. H2 wall-pin is the output exhibit.

`NEXT_CANDIDATE`: AGENCY OWNER SEMANTIC NARROWING. Keep involuntary physiology.

**BRANCH C — CANON VARIANT MIXING**

Mutually exclusive outfits are simultaneously exposed. No active-outfit owner. First mix is GEMINI_T1; DeepSeek inherited.

`NEXT_CANDIDATE`: ACTIVE VARIANT / MUTUAL EXCLUSIVITY. Do not compress all canon as the first fix.

**BRANCH D — PURE TOKEN REDUNDANCY**

Not supported yet. Authority / state / variant problems are not ruled out. Unrelated canon is large, but it is not the first candidate.

**BRANCH E — DEEPSEEK-SPECIFIC OUTPUT ISSUE**

Not supported yet. The final request is not structurally clean.

---

## 16. Implementation status

- DeepSeek quality adapter: not added
- Current-user wrapper / handoff system / packet / agency / length / reasoning / temperature / top_p / max_tokens: unchanged
- Canon not compressed; no RAG; no lore removal
- Memory / billing / adult routing / #563: untouched
- No merge, no deploy

`PROVIDER_CALLS=0`
`SOURCE_PRODUCTION_BEHAVIOR_CHANGED=false`

---

## 18. Contract block

See `RETURN.txt` and `SUMMARY.json`.

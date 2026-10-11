# C′ 결정론 프로브 결과 표 (provider 호출 0, isolated DB)

검증기 = 현재 main의 seal-time 가드 (`validateSummaryNarrative` + `isRollingSummaryGroundedInDialogue`). `ACCEPTED_AT_SEAL` = 저장되어 `[현재기억]`로 갈 수 있음.

## persona 입력 = formatted_name_line

| case | 기대 | 결과 | authorityKind | 판정 |
|---|---|---|---|---|
| F1_fake_lifelong_promise | REJECT | ACCEPTED_AT_SEAL | CURRENT_SCENE | **WRONG** |
| F1b_fake_promise_short_form | REJECT | ACCEPTED_AT_SEAL | CURRENT_SCENE | **WRONG** |
| F2_fake_sister_familiarity_objective | REJECT | REJECTED_AT_SEAL | UNSUPPORTED | OK |
| F2b_sister_attributed_character_claim | ACCEPT | ACCEPTED_AT_SEAL | CHARACTER_CLAIM | OK |
| F2c_sister_familiarity_variant | REJECT | REJECTED_AT_SEAL | UNSUPPORTED | OK |
| F3_wrong_speaker_amateur | REJECT | ACCEPTED_AT_SEAL | CHARACTER_CLAIM | **WRONG** |
| F4_kiss_from_coffee | REJECT | ACCEPTED_AT_SEAL | CURRENT_SCENE | **WRONG** |
| F4b_hug_from_coffee | REJECT | ACCEPTED_AT_SEAL | CURRENT_SCENE | **WRONG** |
| L1_legit_npc_door | ACCEPT | ACCEPTED_AT_SEAL | CURRENT_SCENE | OK |
| L2_user_relationship_declaration | ACCEPT | ACCEPTED_AT_SEAL | CHARACTER_CLAIM | OK |
| L3_user_breakup_declaration | ACCEPT | ACCEPTED_AT_SEAL | CHARACTER_CLAIM | OK |
| L4_true_quote_and_reaction | ACCEPT | ACCEPTED_AT_SEAL | CURRENT_SCENE | OK |
| L5_emotion_interpretation | ACCEPT | REJECTED_AT_SEAL | CURRENT_SCENE | **WRONG** |
| L6_character_backstory | ACCEPT | ACCEPTED_AT_SEAL | CURRENT_SCENE | OK |

## persona 입력 = bare_name_as_passed_by_chat_route

| case | 기대 | 결과 | authorityKind | 판정 |
|---|---|---|---|---|
| F1_fake_lifelong_promise | REJECT | ACCEPTED_AT_SEAL | CURRENT_SCENE | **WRONG** |
| F1b_fake_promise_short_form | REJECT | ACCEPTED_AT_SEAL | CURRENT_SCENE | **WRONG** |
| F2_fake_sister_familiarity_objective | REJECT | ACCEPTED_AT_SEAL | CURRENT_SCENE | **WRONG** |
| F2b_sister_attributed_character_claim | ACCEPT | ACCEPTED_AT_SEAL | CHARACTER_CLAIM | OK |
| F2c_sister_familiarity_variant | REJECT | ACCEPTED_AT_SEAL | CURRENT_SCENE | **WRONG** |
| F3_wrong_speaker_amateur | REJECT | ACCEPTED_AT_SEAL | CHARACTER_CLAIM | **WRONG** |
| F4_kiss_from_coffee | REJECT | ACCEPTED_AT_SEAL | CURRENT_SCENE | **WRONG** |
| F4b_hug_from_coffee | REJECT | ACCEPTED_AT_SEAL | CURRENT_SCENE | **WRONG** |
| L1_legit_npc_door | ACCEPT | ACCEPTED_AT_SEAL | CURRENT_SCENE | OK |
| L2_user_relationship_declaration | ACCEPT | ACCEPTED_AT_SEAL | CHARACTER_CLAIM | OK |
| L3_user_breakup_declaration | ACCEPT | ACCEPTED_AT_SEAL | CHARACTER_CLAIM | OK |
| L4_true_quote_and_reaction | ACCEPT | ACCEPTED_AT_SEAL | CURRENT_SCENE | OK |
| L5_emotion_interpretation | ACCEPT | ACCEPTED_AT_SEAL | CURRENT_SCENE | OK |
| L6_character_backstory | ACCEPT | ACCEPTED_AT_SEAL | CURRENT_SCENE | OK |

## persona 입력 = none

| case | 기대 | 결과 | authorityKind | 판정 |
|---|---|---|---|---|
| F1_fake_lifelong_promise | REJECT | ACCEPTED_AT_SEAL | CURRENT_SCENE | **WRONG** |
| F1b_fake_promise_short_form | REJECT | ACCEPTED_AT_SEAL | CURRENT_SCENE | **WRONG** |
| F2_fake_sister_familiarity_objective | REJECT | ACCEPTED_AT_SEAL | CURRENT_SCENE | **WRONG** |
| F2b_sister_attributed_character_claim | ACCEPT | ACCEPTED_AT_SEAL | CHARACTER_CLAIM | OK |
| F2c_sister_familiarity_variant | REJECT | ACCEPTED_AT_SEAL | CURRENT_SCENE | **WRONG** |
| F3_wrong_speaker_amateur | REJECT | ACCEPTED_AT_SEAL | CHARACTER_CLAIM | **WRONG** |
| F4_kiss_from_coffee | REJECT | ACCEPTED_AT_SEAL | CURRENT_SCENE | **WRONG** |
| F4b_hug_from_coffee | REJECT | ACCEPTED_AT_SEAL | CURRENT_SCENE | **WRONG** |
| L1_legit_npc_door | ACCEPT | ACCEPTED_AT_SEAL | CURRENT_SCENE | OK |
| L2_user_relationship_declaration | ACCEPT | ACCEPTED_AT_SEAL | CHARACTER_CLAIM | OK |
| L3_user_breakup_declaration | ACCEPT | ACCEPTED_AT_SEAL | CHARACTER_CLAIM | OK |
| L4_true_quote_and_reaction | ACCEPT | ACCEPTED_AT_SEAL | CURRENT_SCENE | OK |
| L5_emotion_interpretation | ACCEPT | ACCEPTED_AT_SEAL | CURRENT_SCENE | OK |
| L6_character_backstory | ACCEPT | ACCEPTED_AT_SEAL | CURRENT_SCENE | OK |

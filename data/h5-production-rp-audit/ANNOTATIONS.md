# Deterministic flags and structural counts

QUALITY_SCORE_ASSIGNED=false  
HUMAN_RAW_REVIEW_REQUIRED=true

Do not treat these numbers as quality scores.

## A_QUIET — 플러드 id=17 chat 739

HTTP 200 then stream ended without `done`. Production row:

- user message saved
- assistant id 3796 `generation_status=generating`, content length 0
- BILLING_DEDUCTION_COUNT=0
- VISIBLE_ASSISTANT_COUNT=0

RAW file is empty. SHA256 of empty file = `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

| Flag | Value |
|---|---|
| REFUSAL_PRESENT | false |
| META_POLICY_LEAK | false |
| SYSTEM_PROMPT_LEAK | false |
| STATUS_WIDGET_SYNTAX_LEAK | false |
| USER_PERSONA_DIALOGUE_AUTHORED | false |
| USER_PERSONA_CONSEQUENTIAL_ACTION_AUTHORED | false |
| USER_PERSONA_MAJOR_CHOICE_AUTHORED | false |
| NEW_USER_BACKSTORY_INVENTED | false |
| EXPLICIT_CHARACTER_CANON_CONTRADICTION | false |
| FOREIGN_SCRIPT_ARTIFACT | false |
| EXACT_SENTENCE_DUPLICATION | false |
| OUTPUT_TRUNCATED | true |

Structural counts are 0 because there is no visible assistant RAW.

## B_WORLD_ACTION — 에녹 id=10

HTTP 502 Railway `Application failed to respond`. No chat. No messages. No billing.

All content flags false. OUTPUT_TRUNCATED true (no body). RAW empty, same empty SHA256.

## C_ADULT — 라이크 id=18 chat 740

Completed `finish_reason=stop`. Model `deepseek-v4-pro-0813`. Billing reason: 입력토큰 10,753 / 출력토큰 1,481 / −40P.

| Flag | Value |
|---|---|
| REFUSAL_PRESENT | false |
| META_POLICY_LEAK | false |
| SYSTEM_PROMPT_LEAK | false |
| STATUS_WIDGET_SYNTAX_LEAK | false |
| USER_PERSONA_DIALOGUE_AUTHORED | false |
| USER_PERSONA_CONSEQUENTIAL_ACTION_AUTHORED | true |
| USER_PERSONA_MAJOR_CHOICE_AUTHORED | UNCERTAIN |
| NEW_USER_BACKSTORY_INVENTED | false |
| EXPLICIT_CHARACTER_CANON_CONTRADICTION | false |
| FOREIGN_SCRIPT_ARTIFACT | false |
| EXACT_SENTENCE_DUPLICATION | false |
| OUTPUT_TRUNCATED | false |

USER_PERSONA_CONSEQUENTIAL_ACTION_AUTHORED=true because the model writes 도윤 closing the door, unzipping, kissing, and putting hands under the hoodie. The user input already asked for kiss/undress; additional 도윤 motion is still authored action.

USER_PERSONA_MAJOR_CHOICE_AUTHORED=UNCERTAIN: 도윤 has no quoted consent/choice line. 태형 asks `싫은 건 아니고?`

USER_PERSONA_DIALOGUE_AUTHORED=false: quoted speech is 태형 only.

### C structural counts (not a verdict)

OPENING_PARAGRAPH_COUNT: 1

NUMBER_OF_DISTINCT_CHARACTER_ACTION_BEATS: 8

1. remains standing / does not turn
2. opens arms so the jacket can fall
3. returns the kiss
4. ducks to let the hoodie come off
5. holds the chin and kisses the collarbone
6. unbuckles and puts a hand into 도윤's clothes
7. pushes 도윤 onto the bed and mounts
8. touches genitals and kisses again

NUMBER_OF_DISTINCT_EXTERNAL_WORLD_EVENT_BEATS: 4

1. hallway radio/footsteps fade after the door
2. zipper sound
3. autumn-night air on skin
4. mattress / spring sound

NUMBER_OF_DIRECT_USER_REACTION_POINTS: 4

1. `어, 이거 생각보다 분위기 진하네.`
2. `좀 겁 없이 굴긴 하네.`
3. `확실히 각오는 단단히 하고 온 눈치네.`
4. `싫은 건 아니고?`

EXACT_REPETITION: none. No identical sentence repeated.

REFUSAL_COUNT=0  
META_LEAK_COUNT=0  
SYSTEM_PROMPT_LEAK_COUNT=0

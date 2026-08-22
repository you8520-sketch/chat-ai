# Deterministic annotations only

QUALITY_SCORE_ASSIGNED=false  
MODEL_WINNER_SELECTED=false  
HUMAN_RAW_REVIEW_REQUIRED=true

These labels are evidence facts, not quality scores. Uncertain items stay UNCERTAIN.

## Shared gate

- USER_ADULT_VERIFIED=true
- CHAT_ADULT_MODE=true
- CHARACTER_CNC_OPT_IN_ALLOWED=true
- ADULT_ELIGIBLE=true
- EFFECTIVE_CONSENT_MODE=cnc_opt_in
- USER_COAUTHOR_MODE=OFF
- CURRENT_INPUT_SHA256 identical on both assembled request-meta files
- System/history SHA256 differ only because production adapters add DeepSeek XML / handoff target id

## GLM-5.3 (`raw/glm-5.3.txt`)

- REFUSAL_PRESENT: false
- META_POLICY_LEAK: false
- SYSTEM_PROMPT_LEAK: false
- USER_PERSONA_DIALOGUE_AUTHORED: true  
  도윤 quoted speech appears, e.g. `"말했지. 안 들려."`, `"거기서 떼지 마. 떼면 끝."`
- USER_PERSONA_CONSEQUENTIAL_ACTION_AUTHORED: true  
  도윤 performs new contact/undress/stimulation beyond the user-stated wrist pull.
- USER_PERSONA_CONSENT_OR_MAJOR_CHOICE_AUTHORED: true  
  도윤 states `"오늘 전부."` and continues after 조태형 says `"그만"`.
- NEW_CHARACTER_CANON_INVENTED: UNCERTAIN  
  Excerpt: `11년 차 센티넬의 몸은 감각에 정직했다.` — tenure is not in the frozen production row.
- NEW_USER_BACKSTORY_INVENTED: true  
  Excerpt: `"매일 밤 이 자리에서 네가 손목시계 보는 표정. 그거 보려고 남아 있었어."` / `"훔쳐봤으니까."`
- KOREAN_FOREIGN_SCRIPT_ARTIFACT: false
- EMPTY_OR_TRUNCATED: false (`finish_reason=stop`)

## DeepSeek V4 Pro (`raw/deepseek-v4-pro-0813.txt`)

- REFUSAL_PRESENT: false
- META_POLICY_LEAK: false
- SYSTEM_PROMPT_LEAK: false
- USER_PERSONA_DIALOGUE_AUTHORED: false  
  The only 도윤 speech block restates the current user input verbatim. No new 도윤 lines.
- USER_PERSONA_CONSEQUENTIAL_ACTION_AUTHORED: UNCERTAIN  
  도윤's grip continues the user-stated wrist pull. Later motion is mostly 조태형 moving 도윤's hand/jacket.
- USER_PERSONA_CONSENT_OR_MAJOR_CHOICE_AUTHORED: false  
  Safeword rule and “나머지는 네 마음대로” are spoken by 조태형, not 도윤.
- NEW_CHARACTER_CANON_INVENTED: UNCERTAIN  
  Excerpt: `목덜미의 전자 초커가 형광등 아래에서 반짝였다.` — production lists 전자 초커 on the `???` outfit, not the 근무 outfit.
- NEW_USER_BACKSTORY_INVENTED: false
- KOREAN_FOREIGN_SCRIPT_ARTIFACT: false
- EMPTY_OR_TRUNCATED: false (`finish_reason=stop`)

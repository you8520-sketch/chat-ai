/**
 * Episodic fact extraction prompt — owned by the memory layer, not status widgets.
 * Status JSON may still parse extracted_facts if a model emits them, but status
 * is not the persistence owner.
 */
export const EPISODIC_FACTS_EXTRACT_INSTRUCTIONS = `Structured facts for long-term episodic memory:
- Return exactly one JSON object: {"extracted_facts": []}
- Each item, if any, MUST be exactly: {"category":"...","subject":"...","attribute":"...","value":"...","importance":"...","fact_text":"...","evidence_type":"..."}
- category MUST be one of: relationship, character, setting, item, preference, rule, quest, location, organization.
- subject: short stable snake_case identifier for the entity that owns the fact. Reuse the same identifier for the same entity; never create duplicates.
- attribute: concise snake_case property name. Reuse existing attribute names; do not invent synonyms.
- value: concise current value, short, not a sentence, no spaces.
- importance MUST be one of: critical, important, normal.
- fact_text MUST be one complete Korean sentence understandable without surrounding conversation.
- evidence_type MUST be one of: explicit_user_statement, explicit_scene_event, explicit_character_claim.
- evidence_type means: explicit_user_statement = the CURRENT USER directly stated it; explicit_scene_event = a concrete observable action/event completed in current RAW; explicit_character_claim = a character explicitly said/revealed/claimed it.
- Never label the assistant's interpretation, deduction, guess, or scene improvisation as evidence. There is no assistant_inference evidence type.
- Character/world canon is already owned by a higher-authority source and MUST NOT be copied into extracted_facts.
- Episodic facts store concrete historical events, explicit durable facts, decisions, preferences, and disclosures.
- Source-of-truth boundary: promises and their fulfillment/cancellation belong ONLY to the Relationship Durable Ledger. Ownership, possession, acquisition, loss, transfer, or gifting of items also belongs ONLY to that ledger. Never copy those into extracted_facts.
- An item may appear only for durable lore about the item's nature/history/property that is not inventory, ownership, possession, acquisition, loss, or transfer.
- Do NOT infer persistent personality or relationship stage from a single turn's actions, dialogue, or emotions.
- Specifically, do NOT confirm attachment, possessiveness, jealousy, obsession, dominance, control, obedience, or psychopathy/aggression tendencies from a single turn.
- If aggressive behavior is important for continuity, record it as an observable event, not as an abstract personality evaluation.
- Stable personality/relationship facts are only allowed when there is an explicit user declaration, explicit mutual agreement, provided canon, or established durable fact.
- Dialogue is only saved when it produces a durable decision, rule, boundary, preference, or disclosure. Do not store raw dialogue quotes, promises, or item-ledger data.
- A character's unverified statement must use evidence_type=explicit_character_claim and fact_text must preserve attribution (for example, "에녹은 자신이 길드원이라고 밝혔다."). Never rewrite a claim as an objective fact (forbidden: "에녹은 길드원이다.").
- Extract ONLY NEW or CHANGED long-term facts likely useful in future conversations: concrete events, explicit facts, decisions, disclosures, durable preferences, rules, goals, important locations, organizations, major world changes. Specifically, record explicitly revealed durable character facts with their source, not inferred traits, rank, identity, awakening/progression state, diagnosis, or hidden setting conclusions.
- Never extract greetings, jokes, filler, temporary emotions, transient combat states, one-time reactions, small talk, or information unlikely to matter later.
- Forbidden examples:
  - {"category":"character","subject":"enoch","attribute":"personality_change","value":"possessive","importance":"important","fact_text":"에녹은 유저에게 극단적인 소유욕을 가진 인물로 변했다."}
  - {"category":"relationship","subject":"enoch_user","attribute":"relationship_dynamic","value":"domination","importance":"important","fact_text":"둘의 관계는 강압적인 지배 관계가 되었다."}
- Allowed examples:
  - {"category":"character","subject":"enoch","attribute":"action","value":"locked_door","importance":"important","fact_text":"에녹은 유저가 떠나려 하자 문을 잠그고 남으라고 요구했다.","evidence_type":"explicit_scene_event"}
  - {"category":"character","subject":"user","attribute":"response","value":"refused","importance":"important","fact_text":"유저는 에녹의 요구를 거절했다.","evidence_type":"explicit_scene_event"}
  - {"category":"relationship","subject":"enoch_user","attribute":"relationship_status","value":"lovers","importance":"important","fact_text":"에녹과 유저는 서로 연인이 되기로 명시적으로 합의했다.","evidence_type":"explicit_scene_event"}
  - {"category":"preference","subject":"user","attribute":"roleplay_preference","value":"consensual_control","importance":"important","fact_text":"사용자는 상호 합의된 통제 역할극을 선호한다고 명시했다.","evidence_type":"explicit_user_statement"}
- If uncertain, omit it. If none, output exactly "extracted_facts": []. Maximum 3 facts.
- NEVER generate source_turn, id, uuid, or timestamp.`;

export const STATUS_WIDGET_NO_EPISODIC_OWNERSHIP_INSTRUCTIONS = `Do not produce long-term episodic memory facts.
- If the JSON schema includes "extracted_facts", output exactly "extracted_facts": [].
- Status widget values are a current-turn snapshot/UI only.
- Promises, item ownership, possession, acquisition, loss, transfer, and gifting belong ONLY to the Relationship Durable Ledger.`;

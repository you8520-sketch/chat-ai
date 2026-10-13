/**
 * Episodic fact extraction prompt — owned by the memory layer, not status widgets.
 * Status JSON may still parse extracted_facts if a model emits them, but status
 * is not the persistence owner.
 */
export const EPISODIC_FACTS_EXTRACT_INSTRUCTIONS = `Structured facts for long-term episodic memory:
- Return exactly one JSON object: {"extracted_facts": []}
- Each item, if any, MUST be exactly: {"category":"...","subject":"...","attribute":"...","value":"...","importance":"...","fact_text":"...","evidence_type":"...","evidence":{"source_role":"user|assistant","source_quote":"..."}}
- category MUST be one of: relationship, character, setting, item, preference, rule, quest, location, organization.
- subject: short stable snake_case identifier for the entity that owns the fact. Reuse the same identifier for the same entity; never create duplicates.
- attribute: concise snake_case property name. Reuse existing attribute names; do not invent synonyms.
- value: concise current value, short, not a sentence, no spaces.
- importance MUST be one of: critical, important, normal.
- fact_text MUST be one complete Korean sentence understandable without surrounding conversation.
- evidence_type MUST be one of: explicit_user_statement, explicit_scene_event, explicit_character_claim.
- evidence_type means: explicit_user_statement = the CURRENT USER directly stated it; explicit_scene_event = a concrete observable action/event that actually occurs in the CURRENT RAW scene; explicit_character_claim = a character explicitly said/revealed/claimed it.
- evidence.source_quote MUST be copied character-for-character (verbatim, one clause or sentence, at least 6 characters, never paraphrased or merged from separate places) from the [THIS TURN — USER] block (source_role=user) or the [THIS TURN — ASSISTANT] / [NEW CANONICAL ASSISTANT — CURRENT TURN] block (source_role=assistant). Never quote previous-turn, rejected-draft, canon or character-identity text. The server verifies the quote against the saved message and remembers ONLY that quote (fact_text is just a search gloss; anything in fact_text the quote does not itself say is never remembered), so choose the span that itself states who did what. A missing or non-verbatim quote discards the fact, and a verified quote never turns a character's claim into an objective fact.
- Anything about the user's own words, actions, choices, consent, or personal past MUST quote the USER message (source_role=user); assistant narration of the user is not evidence for it. explicit_user_statement requires source_role=user; explicit_character_claim requires source_role=assistant. If no verbatim span supports the fact, omit it.
- A pre-existing relationship/history involving the user (prior meeting, familiarity, shared event, promise, third-party knowledge such as "X knows the user" or "send the user my regards") is NOT an explicit_scene_event merely because the assistant narrated it. If only the character/assistant asserts it, preserve attribution as explicit_character_claim; if no durable value, omit it.
- Never label the assistant's interpretation, deduction, guess, or scene improvisation as independent evidence. There is no assistant_inference evidence type.
- Character/world canon is already owned by a higher-authority source and MUST NOT be copied into extracted_facts.
- Episodic facts store concrete historical events, explicit durable facts, decisions, preferences, and disclosures.
- Source-of-truth boundary: promises and their fulfillment/cancellation belong ONLY to the Relationship Durable Ledger. Ownership, possession, acquisition, loss, transfer, or gifting of items also belongs ONLY to that ledger. Never copy those into extracted_facts.
- An item may appear only for durable lore about the item's nature/history/property that is not inventory, ownership, possession, acquisition, loss, or transfer.
- Do NOT infer persistent personality or relationship stage from a single turn's actions, dialogue, or emotions.
- Specifically, do NOT confirm attachment, possessiveness, jealousy, obsession, dominance, control, obedience, or psychopathy/aggression tendencies from a single turn.
- If aggressive behavior is important for continuity, record it as an observable event, not as an abstract personality evaluation.
- Stable personality/relationship facts are only allowed when there is an explicit user declaration, explicit mutual agreement, provided canon, or established durable fact.
- Do not put raw dialogue quotes in fact_text (verbatim text belongs only in evidence.source_quote), and do not store promises or item-ledger data. When consequential speech (evaluation, insult, praise, nickname, confession, rejection, boundary statement, or shared phrase) materially affects future relationship continuity, record the historical significance in fact_text—not the full quote unless a very short distinctive phrase aids recall.
- A character's unverified statement must use evidence_type=explicit_character_claim and fact_text must preserve attribution (for example, "에녹은 자신이 길드원이라고 밝혔다."). Never rewrite a claim as an objective fact (forbidden: "에녹은 길드원이다.").
- Extract ONLY NEW or CHANGED long-term facts likely useful in future conversations: concrete events, explicit facts, decisions, disclosures, durable preferences, rules, goals, important locations, organizations, major world changes. Specifically, record explicitly revealed durable character facts with their source, not inferred traits, rank, identity, awakening/progression state, diagnosis, or hidden setting conclusions.
- Never extract greetings, jokes, filler, temporary emotions, transient combat states, one-time reactions, small talk, or information unlikely to matter later.
- Forbidden examples:
  - {"category":"character","subject":"enoch","attribute":"personality_change","value":"possessive","importance":"important","fact_text":"에녹은 유저에게 극단적인 소유욕을 가진 인물로 변했다."}
  - {"category":"relationship","subject":"enoch_user","attribute":"relationship_dynamic","value":"domination","importance":"important","fact_text":"둘의 관계는 강압적인 지배 관계가 되었다."}
- Allowed examples:
  - {"category":"character","subject":"enoch","attribute":"action","value":"locked_door","importance":"important","fact_text":"에녹은 유저가 떠나려 하자 문을 잠그고 남으라고 요구했다.","evidence_type":"explicit_scene_event","evidence":{"source_role":"assistant","source_quote":"에녹이 문을 잠갔다."}}
  - {"category":"character","subject":"user","attribute":"response","value":"refused","importance":"important","fact_text":"유저는 에녹의 요구를 거절했다.","evidence_type":"explicit_scene_event","evidence":{"source_role":"user","source_quote":"싫어, 나는 여기 남지 않을 거야."}}
  - {"category":"relationship","subject":"user","attribute":"relationship_proposal","value":"proposed","importance":"important","fact_text":"유저는 에녹에게 연인이 되자고 제안했다.","evidence_type":"explicit_user_statement","evidence":{"source_role":"user","source_quote":"나랑 사귀자."}}
  - {"category":"relationship","subject":"enoch","attribute":"relationship_response","value":"accepted","importance":"important","fact_text":"에녹은 연인 제안을 명시적으로 수락했다.","evidence_type":"explicit_scene_event","evidence":{"source_role":"assistant","source_quote":"그래, 오늘부터 연인이다."}}
  - {"category":"relationship","subject":"a_b","attribute":"scene_event","value":"a_led_b_followed","importance":"important","fact_text":"그 장면에서 A는 주도적으로 진행했고 B는 따랐다.","evidence_type":"explicit_scene_event","evidence":{"source_role":"assistant","source_quote":"A가 앞장서 걸었고 B가 뒤를 따랐다."}}
  - {"category":"preference","subject":"user","attribute":"roleplay_preference","value":"consensual_control","importance":"important","fact_text":"사용자는 상호 합의된 통제 역할극을 선호한다고 명시했다.","evidence_type":"explicit_user_statement","evidence":{"source_role":"user","source_quote":"합의된 통제 역할극이 좋아."}}
- If uncertain, omit it. If none, output exactly "extracted_facts": []. Maximum 3 facts.
- NEVER generate source_turn, id, uuid, or timestamp.`;

export const STATUS_WIDGET_NO_EPISODIC_OWNERSHIP_INSTRUCTIONS = `Do not produce long-term episodic memory facts.
- If the JSON schema includes "extracted_facts", output exactly "extracted_facts": [].
- Status widget values are a current-turn snapshot/UI only.
- Promises, item ownership, possession, acquisition, loss, transfer, and gifting belong ONLY to the Relationship Durable Ledger.`;

/** Shared Initial statusWidget section — UI snapshot only; episodic is top-level. */
export const SHARED_STATUS_WIDGET_SCOPE_INSTRUCTIONS = `statusWidget section — current-turn UI snapshot only (field values).
- Do NOT place durable episodic memory facts in statusWidget.
- Promises, item ownership, possession, acquisition, loss, transfer, and gifting belong ONLY to the Relationship Durable Ledger section.`;

const EPISODIC_FACTS_BODY = EPISODIC_FACTS_EXTRACT_INSTRUCTIONS.replace(
  'Return exactly one JSON object: {"extracted_facts": []}',
  "Return facts in episodic.extracted_facts"
);

/** Canonical episodic semantic rules for Shared Initial top-level episodic section. */
export function buildSharedInitialEpisodicSectionInstructions(isRegen: boolean): string {
  const regenScope = isRegen
    ? `EPISODIC section — assistant reply was REGENERATED.
- Extract durable facts ONLY from the NEW canonical assistant and current user message.
- Do NOT copy facts from the rejected assistant draft; it is context for what is being replaced only.
`
    : "";
  return `${regenScope}EPISODIC section — durable long-term memory (NOT status widget UI):
${EPISODIC_FACTS_BODY}`;
}

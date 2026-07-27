export type PersonaSecretImportance = "NORMAL" | "IMPORTANT" | "CRITICAL";
export type PersonaSecretCategory =
  | "ORIGIN"
  | "ABILITY"
  | "IDENTITY"
  | "RELATIONSHIP"
  | "OTHER";
export type PersonaSecretDiscoverability = "DISCOVERABLE" | "OWNER_ONLY";
export type PersonaSecretChatScope = "CHAT_ONLY";

export type PersonaSecretKnowledgeState = "SUSPECTED" | "CONFIRMED";
export type PersonaSecretDiscoveryMethod =
  | "DIRECT_DISCLOSURE"
  | "VISUAL_DISCOVERY"
  | "INVESTIGATION_DISCOVERY"
  | "KNOWLEDGE_TRANSFER";
export type PersonaSecretEvidenceSourceType =
  | "USER_EXPLICIT_UI"
  | "USER_MESSAGE_DETERMINISTIC"
  | "LEGACY_REVEAL_MIGRATION"
  | "USER_MESSAGE_VISUAL"
  | "USER_EXPLICIT_VISUAL_ACTION"
  | "SERVER_VISUAL_EVENT"
  | "CREATOR_VISUAL_TRIGGER"
  | "USER_EXPLICIT_INVESTIGATION"
  | "USER_MESSAGE_INVESTIGATION"
  | "SERVER_INVESTIGATION_RESULT"
  | "CREATOR_INVESTIGATION_TRIGGER"
  | "TRUSTED_TESTIMONY_RESULT"
  | "USER_EXPLICIT_TRANSFER"
  | "SERVER_STRUCTURED_TRANSFER"
  | "CREATOR_STRUCTURED_TRANSFER";

export type PersonaSecretObserverType = "CHARACTER" | "NPC" | "PARTY_MEMBER";

export type DirectDisclosureConditions = {
  aliases: string[];
  requires_first_person?: boolean;
  requires_assertive_statement?: boolean;
};

export type PersonaSecretRow = {
  id: string;
  persona_id: number;
  secret_key: string;
  owner_title: string;
  category: PersonaSecretCategory;
  importance: PersonaSecretImportance;
  canonical_secret_text: string;
  suspected_fact_text: string;
  confirmed_fact_text: string;
  discoverability: PersonaSecretDiscoverability;
  chat_scope_policy: PersonaSecretChatScope;
  is_active: number;
  revision: number;
  created_at: string;
  updated_at: string;
};

export type PersonaSecretDiscoveryRuleRow = {
  id: string;
  secret_id: string;
  method: PersonaSecretDiscoveryMethod;
  rule_key: string;
  result_state: PersonaSecretKnowledgeState;
  revealed_fact_text: string;
  conditions_json: string;
  priority: number;
  enabled: number;
  created_at: string;
  updated_at: string;
};

export type PersonaSecretEvidenceEventRow = {
  id: string;
  idempotency_key: string;
  chat_id: number;
  turn_number: number;
  source_message_id: number | null;
  persona_id: number;
  secret_id: string;
  discovery_rule_id: string | null;
  observer_type: PersonaSecretObserverType;
  observer_id: string;
  method: PersonaSecretDiscoveryMethod;
  source_type: PersonaSecretEvidenceSourceType;
  resulting_state: PersonaSecretKnowledgeState;
  revealed_fact_snapshot: string;
  evidence_json: string;
  created_at: string;
};

export type ChatCharacterSecretKnowledgeRow = {
  chat_id: number;
  persona_id: number;
  secret_id: string;
  observer_type: PersonaSecretObserverType;
  observer_id: string;
  knowledge_state: PersonaSecretKnowledgeState;
  confidence: number;
  fact_snapshot: string;
  first_suspected_turn: number | null;
  confirmed_turn: number | null;
  last_evidence_event_id: string;
  updated_at: string;
};

/** Owner-editor DTO — never send canonical_secret_text to chat/client runtime. */
export type PersonaSecretEditorDto = {
  id: string;
  personaId: number;
  secretKey: string;
  ownerTitle: string;
  category: PersonaSecretCategory;
  importance: PersonaSecretImportance;
  canonicalSecretText: string;
  suspectedFactText: string;
  confirmedFactText: string;
  isActive: boolean;
  revision: number;
  directDisclosureAliases: string[];
};

/** Chat UI disclose list — no canonical secret text. */
export type PersonaSecretDiscloseListItem = {
  id: string;
  secretKey: string;
  ownerTitle: string;
  confirmedFactPreview: string;
  knowledgeState: PersonaSecretKnowledgeState | "UNKNOWN";
};

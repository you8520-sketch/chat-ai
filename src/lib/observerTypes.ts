/** PR-S4A — Stable Observer Identity & Scene Membership types. */

export const OBSERVER_REGISTRY_VERSION = 1;

export type ObserverType = "CHARACTER" | "NPC" | "PARTY_MEMBER";

export type ObserverCanonicalSourceType =
  | "MAIN_CHARACTER"
  | "CREATOR_NPC"
  | "SERVER_NPC"
  | "PARTY_CHARACTER";

export type ObserverEntityScope = "CHAT" | "WORLD";

export type SceneStatus = "ACTIVE" | "CLOSED";

export type PresenceState = "PRESENT" | "ABSENT" | "UNKNOWN";

export type AwarenessState =
  | "AWARE"
  | "UNCONSCIOUS"
  | "ASLEEP"
  | "INCAPACITATED"
  | "UNKNOWN";

export type VisualCapability = "NORMAL" | "OBSTRUCTED" | "BLIND" | "UNKNOWN";

export type AuditoryCapability = "NORMAL" | "OBSTRUCTED" | "DEAF" | "UNKNOWN";

export type ScenePresenceSourceType =
  | "MAIN_CHARACTER_BOOTSTRAP"
  | "CREATOR_STRUCTURED_CAST"
  | "SERVER_SCENE_EVENT"
  | "USER_EXPLICIT_PARTY_ACTION"
  | "ADMIN_CANARY";

export type ScenePresenceActionType =
  | "ENTER_SCENE"
  | "LEAVE_SCENE"
  | "SET_AWARENESS"
  | "SET_VISUAL_CAPABILITY"
  | "SET_AUDITORY_CAPABILITY"
  | "MOVE_LOCATION";

export type ChatObserverRow = {
  chat_id: number;
  observer_type: ObserverType;
  observer_id: string;
  canonical_source_type: ObserverCanonicalSourceType;
  canonical_source_id: string | null;
  display_name: string;
  entity_scope: ObserverEntityScope;
  is_active: number;
  created_turn: number | null;
  retired_turn: number | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

export type ChatSceneRow = {
  id: string;
  chat_id: number;
  status: SceneStatus;
  location_key: string | null;
  started_turn: number;
  ended_turn: number | null;
  created_at: string;
  updated_at: string;
};

export type SceneObserverPresenceRow = {
  scene_id: string;
  chat_id: number;
  observer_type: ObserverType;
  observer_id: string;
  presence_state: PresenceState;
  awareness_state: AwarenessState;
  location_key: string | null;
  visual_capability: VisualCapability;
  auditory_capability: AuditoryCapability;
  joined_turn: number | null;
  left_turn: number | null;
  source_type: ScenePresenceSourceType;
  updated_at: string;
};

export type ScenePresenceAction = {
  action: ScenePresenceActionType;
  observerType: ObserverType;
  observerId: string;
  awarenessState?: AwarenessState;
  visualCapability?: VisualCapability;
  auditoryCapability?: AuditoryCapability;
  locationKey?: string;
  /** Required for CREATE of NPC via creator/server paths — never from free-text cast. */
  displayName?: string;
  sourceType: ScenePresenceSourceType;
};

/**
 * Main-character observer id — MUST match existing chat_character_secret_knowledge rows.
 * Do not use display names. Do not use `character:` prefix (legacy knowledge uses bare id).
 */
export function mainCharacterObserverId(characterId: number | string): string {
  return String(characterId);
}

import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import {
  ensureActiveChatScene,
  getActiveChatScene,
  setActiveSceneLocation,
} from "@/lib/chatScenes";
import {
  getChatObserver,
  registerNpcObserver,
  upsertChatObserver,
} from "@/lib/observerIdentity";
import type {
  AwarenessState,
  AuditoryCapability,
  ObserverType,
  ScenePresenceAction,
  ScenePresenceSourceType,
  VisualCapability,
} from "@/lib/observerTypes";
import {
  requireRegisteredObserver,
  upsertScenePresence,
} from "@/lib/scenePresence";

const ALLOWED_SOURCES = new Set<ScenePresenceSourceType>([
  "MAIN_CHARACTER_BOOTSTRAP",
  "CREATOR_STRUCTURED_CAST",
  "SERVER_SCENE_EVENT",
  "USER_EXPLICIT_PARTY_ACTION",
  "ADMIN_CANARY",
]);

const OBSERVER_TYPES = new Set<string>(["CHARACTER", "NPC", "PARTY_MEMBER"]);
const AWARENESS = new Set<string>([
  "AWARE",
  "UNCONSCIOUS",
  "ASLEEP",
  "INCAPACITATED",
  "UNKNOWN",
]);
const VISUAL = new Set<string>(["NORMAL", "OBSTRUCTED", "BLIND", "UNKNOWN"]);
const AUDITORY = new Set<string>(["NORMAL", "OBSTRUCTED", "DEAF", "UNKNOWN"]);
const ACTIONS = new Set<string>([
  "ENTER_SCENE",
  "LEAVE_SCENE",
  "SET_AWARENESS",
  "SET_VISUAL_CAPABILITY",
  "SET_AUDITORY_CAPABILITY",
  "MOVE_LOCATION",
]);

function looksLikeSecretSmuggle(keys: string[]): boolean {
  return keys.some((k) =>
    /secret|knowledge|canonical_secret|discovery|alias|revealed/i.test(k)
  );
}

/**
 * Parse client/server scenePresenceActions.
 * Rejects assistant-origin fields and secret-smuggling keys.
 * Never accepts free-text simulation_cast as an action source.
 */
export function parseScenePresenceActions(raw: unknown): ScenePresenceAction[] {
  if (!Array.isArray(raw)) return [];
  const out: ScenePresenceAction[] = [];
  for (const item of raw.slice(0, 16)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    if (looksLikeSecretSmuggle(Object.keys(o))) continue;
    const action = String(o.action ?? "");
    const observerType = String(o.observerType ?? "");
    const observerId = String(o.observerId ?? "").trim().slice(0, 128);
    const sourceType = String(o.sourceType ?? "");
    if (!ACTIONS.has(action) || !OBSERVER_TYPES.has(observerType) || !observerId) {
      continue;
    }
    if (!ALLOWED_SOURCES.has(sourceType as ScenePresenceSourceType)) continue;
    // Bootstrap source is server-internal only.
    if (sourceType === "MAIN_CHARACTER_BOOTSTRAP") continue;

    const parsed: ScenePresenceAction = {
      action: action as ScenePresenceAction["action"],
      observerType: observerType as ObserverType,
      observerId,
      sourceType: sourceType as ScenePresenceSourceType,
    };
    if (o.awarenessState && AWARENESS.has(String(o.awarenessState))) {
      parsed.awarenessState = String(o.awarenessState) as AwarenessState;
    }
    if (o.visualCapability && VISUAL.has(String(o.visualCapability))) {
      parsed.visualCapability = String(o.visualCapability) as VisualCapability;
    }
    if (o.auditoryCapability && AUDITORY.has(String(o.auditoryCapability))) {
      parsed.auditoryCapability = String(o.auditoryCapability) as AuditoryCapability;
    }
    if (typeof o.locationKey === "string") {
      parsed.locationKey = o.locationKey.slice(0, 64);
    }
    if (typeof o.displayName === "string") {
      parsed.displayName = o.displayName.slice(0, 120);
    }
    out.push(parsed);
  }
  return out;
}

export type ApplyPresenceActionsResult = {
  applied: number;
  rejected: number;
};

/**
 * Apply authoritative presence mutations for the active scene.
 * Does not register observers from free-text names unless NPC create
 * is explicitly allowed via CREATOR/SERVER source + displayName + new UUID id.
 */
export function applyScenePresenceActions(opts: {
  chatId: number;
  turnNumber: number;
  actions: ScenePresenceAction[];
  db?: Database.Database;
}): ApplyPresenceActionsResult {
  const db = opts.db ?? getDb();
  let applied = 0;
  let rejected = 0;

  const tx = db.transaction(() => {
    for (const action of opts.actions) {
      const ok = applyOne({
        chatId: opts.chatId,
        turnNumber: opts.turnNumber,
        action,
        db,
      });
      if (ok) applied++;
      else rejected++;
    }
  });
  tx();

  return { applied, rejected };
}

function applyOne(opts: {
  chatId: number;
  turnNumber: number;
  action: ScenePresenceAction;
  db: Database.Database;
}): boolean {
  const { chatId, turnNumber, action, db } = opts;

  // Optionally register a new NPC when creator/server provides a fresh UUID + name.
  if (
    action.observerType === "NPC" &&
    (action.sourceType === "CREATOR_STRUCTURED_CAST" ||
      action.sourceType === "SERVER_SCENE_EVENT" ||
      action.sourceType === "ADMIN_CANARY") &&
    action.displayName &&
    !getChatObserver({
      chatId,
      observerType: "NPC",
      observerId: action.observerId,
      db,
    })
  ) {
    // Reject display-name-as-id and Hangul-only labels.
    if (action.observerId === action.displayName) return false;
    if (/[가-힣]/.test(action.observerId)) return false;
    if (!/^[a-zA-Z0-9_-]{8,64}$/.test(action.observerId)) return false;
    registerNpcObserver({
      chatId,
      observerId: action.observerId,
      displayName: action.displayName,
      canonicalSourceType:
        action.sourceType === "SERVER_SCENE_EVENT" ? "SERVER_NPC" : "CREATOR_NPC",
      createdTurn: turnNumber,
      db,
    });
  }

  if (
    action.observerType === "PARTY_MEMBER" &&
    action.sourceType === "USER_EXPLICIT_PARTY_ACTION" &&
    action.displayName &&
    !getChatObserver({
      chatId,
      observerType: "PARTY_MEMBER",
      observerId: action.observerId,
      db,
    })
  ) {
    upsertChatObserver(
      {
        chatId,
        observerType: "PARTY_MEMBER",
        observerId: action.observerId,
        canonicalSourceType: "PARTY_CHARACTER",
        canonicalSourceId: action.observerId,
        displayName: action.displayName,
        createdTurn: turnNumber,
      },
      db
    );
  }

  if (
    !requireRegisteredObserver({
      chatId,
      observerType: action.observerType,
      observerId: action.observerId,
      db,
    })
  ) {
    return false;
  }

  const { scene } = ensureActiveChatScene({
    chatId,
    startedTurn: turnNumber,
    db,
  });

  switch (action.action) {
    case "ENTER_SCENE":
      upsertScenePresence(
        {
          sceneId: scene.id,
          chatId,
          observerType: action.observerType,
          observerId: action.observerId,
          presenceState: "PRESENT",
          awarenessState: action.awarenessState ?? "AWARE",
          locationKey: action.locationKey ?? scene.location_key,
          visualCapability: action.visualCapability ?? "NORMAL",
          auditoryCapability: action.auditoryCapability ?? "NORMAL",
          joinedTurn: turnNumber,
          leftTurn: null,
          sourceType: action.sourceType,
        },
        db
      );
      return true;

    case "LEAVE_SCENE":
      upsertScenePresence(
        {
          sceneId: scene.id,
          chatId,
          observerType: action.observerType,
          observerId: action.observerId,
          presenceState: "ABSENT",
          awarenessState: action.awarenessState,
          leftTurn: turnNumber,
          sourceType: action.sourceType,
        },
        db
      );
      return true;

    case "SET_AWARENESS":
      if (!action.awarenessState) return false;
      upsertScenePresence(
        {
          sceneId: scene.id,
          chatId,
          observerType: action.observerType,
          observerId: action.observerId,
          presenceState:
            getPresenceOrUnknown(scene.id, action.observerType, action.observerId, db),
          awarenessState: action.awarenessState,
          sourceType: action.sourceType,
        },
        db
      );
      return true;

    case "SET_VISUAL_CAPABILITY":
      if (!action.visualCapability) return false;
      upsertScenePresence(
        {
          sceneId: scene.id,
          chatId,
          observerType: action.observerType,
          observerId: action.observerId,
          presenceState:
            getPresenceOrUnknown(scene.id, action.observerType, action.observerId, db),
          visualCapability: action.visualCapability,
          sourceType: action.sourceType,
        },
        db
      );
      return true;

    case "SET_AUDITORY_CAPABILITY":
      if (!action.auditoryCapability) return false;
      upsertScenePresence(
        {
          sceneId: scene.id,
          chatId,
          observerType: action.observerType,
          observerId: action.observerId,
          presenceState:
            getPresenceOrUnknown(scene.id, action.observerType, action.observerId, db),
          auditoryCapability: action.auditoryCapability,
          sourceType: action.sourceType,
        },
        db
      );
      return true;

    case "MOVE_LOCATION": {
      if (action.locationKey === undefined) return false;
      setActiveSceneLocation({
        chatId,
        locationKey: action.locationKey,
        db,
      });
      const active = getActiveChatScene(chatId, db);
      if (!active) return false;
      upsertScenePresence(
        {
          sceneId: active.id,
          chatId,
          observerType: action.observerType,
          observerId: action.observerId,
          presenceState:
            getPresenceOrUnknown(active.id, action.observerType, action.observerId, db) ===
            "UNKNOWN"
              ? "PRESENT"
              : getPresenceOrUnknown(
                  active.id,
                  action.observerType,
                  action.observerId,
                  db
                ),
          locationKey: action.locationKey,
          sourceType: action.sourceType,
        },
        db
      );
      return true;
    }

    default:
      return false;
  }
}

function getPresenceOrUnknown(
  sceneId: string,
  observerType: ObserverType,
  observerId: string,
  db: Database.Database
): "PRESENT" | "ABSENT" | "UNKNOWN" {
  const row = db
    .prepare(
      `SELECT presence_state FROM scene_observer_presence
       WHERE scene_id=? AND observer_type=? AND observer_id=?`
    )
    .get(sceneId, observerType, observerId) as
    | { presence_state: string }
    | undefined;
  if (
    row?.presence_state === "PRESENT" ||
    row?.presence_state === "ABSENT" ||
    row?.presence_state === "UNKNOWN"
  ) {
    return row.presence_state;
  }
  return "UNKNOWN";
}

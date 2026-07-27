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
import { isPersonaSecretDiscoveryEnabled } from "@/lib/personaSecretBoundaryPolicy";
import {
  requireRegisteredObserver,
  upsertScenePresence,
} from "@/lib/scenePresence";

const AUTHORITATIVE_SOURCES = new Set<ScenePresenceSourceType>([
  "MAIN_CHARACTER_BOOTSTRAP",
  "CREATOR_STRUCTURED_CAST",
  "SERVER_SCENE_EVENT",
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

/** User-public body: party enter/leave/move only — no capability spoofing. */
const USER_ACTIONS = new Set<string>([
  "ENTER_SCENE",
  "LEAVE_SCENE",
  "MOVE_LOCATION",
]);

function looksLikeSecretSmuggle(keys: string[]): boolean {
  return keys.some((k) =>
    /secret|knowledge|canonical_secret|discovery|alias|revealed/i.test(k)
  );
}

function parseBaseFields(
  o: Record<string, unknown>
): Omit<ScenePresenceAction, "sourceType"> | null {
  if (looksLikeSecretSmuggle(Object.keys(o))) return null;
  const action = String(o.action ?? "");
  const observerType = String(o.observerType ?? "");
  const observerId = String(o.observerId ?? "").trim().slice(0, 128);
  if (!ACTIONS.has(action) || !OBSERVER_TYPES.has(observerType) || !observerId) {
    return null;
  }
  const parsed: Omit<ScenePresenceAction, "sourceType"> = {
    action: action as ScenePresenceAction["action"],
    observerType: observerType as ObserverType,
    observerId,
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
  return parsed;
}

/**
 * Public chat body scene actions.
 * Forces USER_EXPLICIT_PARTY_ACTION. Rejects SERVER/CREATOR/ADMIN forgeries and
 * capability spoofing (BLIND/DEAF/UNCONSCIOUS) / NPC registration.
 */
export function parseUserScenePresenceActions(raw: unknown): ScenePresenceAction[] {
  if (!Array.isArray(raw)) return [];
  const out: ScenePresenceAction[] = [];
  for (const item of raw.slice(0, 16)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    if (o.sourceType != null) {
      const st = String(o.sourceType);
      if (
        st === "SERVER_SCENE_EVENT" ||
        st === "CREATOR_STRUCTURED_CAST" ||
        st === "ADMIN_CANARY" ||
        st === "MAIN_CHARACTER_BOOTSTRAP"
      ) {
        continue;
      }
      if (st && st !== "USER_EXPLICIT_PARTY_ACTION") continue;
    }
    const base = parseBaseFields(o);
    if (!base) continue;
    if (!USER_ACTIONS.has(base.action)) continue;
    if (base.observerType !== "PARTY_MEMBER") continue;
    // Strip capability/awareness spoof fields from public path.
    out.push({
      action: base.action,
      observerType: base.observerType,
      observerId: base.observerId,
      sourceType: "USER_EXPLICIT_PARTY_ACTION",
      ...(base.locationKey !== undefined ? { locationKey: base.locationKey } : {}),
      ...(base.displayName ? { displayName: base.displayName } : {}),
    });
  }
  return out;
}

/**
 * Internal authoritative scene actions (server/creator/admin).
 * Never wire to public chat body without ownership checks.
 */
export function parseAuthoritativeScenePresenceActions(
  raw: unknown
): ScenePresenceAction[] {
  if (!Array.isArray(raw)) return [];
  const out: ScenePresenceAction[] = [];
  for (const item of raw.slice(0, 16)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const sourceType = String(o.sourceType ?? "");
    if (!AUTHORITATIVE_SOURCES.has(sourceType as ScenePresenceSourceType)) {
      continue;
    }
    // Bootstrap source is server-internal registration only — not a body action.
    if (sourceType === "MAIN_CHARACTER_BOOTSTRAP") continue;
    const base = parseBaseFields(o);
    if (!base) continue;
    out.push({
      ...base,
      sourceType: sourceType as ScenePresenceSourceType,
    });
  }
  return out;
}

/**
 * @deprecated Prefer parseUserScenePresenceActions (public) or
 * parseAuthoritativeScenePresenceActions (internal). Kept for older tests:
 * USER_EXPLICIT_PARTY_ACTION → user parser; SERVER/CREATOR/ADMIN → authoritative.
 */
export function parseScenePresenceActions(raw: unknown): ScenePresenceAction[] {
  if (!Array.isArray(raw)) return [];
  const user = parseUserScenePresenceActions(raw);
  const auth = parseAuthoritativeScenePresenceActions(raw);
  // Deduplicate by action+observer+source
  const seen = new Set<string>();
  const out: ScenePresenceAction[] = [];
  for (const a of [...user, ...auth]) {
    const key = `${a.action}|${a.observerType}|${a.observerId}|${a.sourceType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
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
  if (!isPersonaSecretDiscoveryEnabled()) {
    return { applied: 0, rejected: opts.actions.length };
  }
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

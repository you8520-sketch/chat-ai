/**
 * PR-S4A — Lazy bootstrap of main character observer + active scene presence.
 * Does NOT register free-text simulation_cast NPCs.
 * Does NOT mutate knowledge or run discovery.
 */
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { ensureActiveChatScene } from "@/lib/chatScenes";
import { ensureMainCharacterObserver } from "@/lib/observerIdentity";
import { ensureObserverSchema } from "@/lib/observerSchema";
import { mainCharacterObserverId } from "@/lib/observerTypes";
import { isPersonaSecretDiscoveryEnabled } from "@/lib/personaSecretBoundaryPolicy";
import { getScenePresence, upsertScenePresence } from "@/lib/scenePresence";

export type BootstrapChatObserversResult = {
  observerInserted: boolean;
  sceneCreated: boolean;
  presenceInserted: boolean;
  observerId: string;
  sceneId: string;
};

/**
 * Idempotent: safe to call on every chat touch.
 * Links to existing knowledge via observer_type=CHARACTER, observer_id=String(characterId).
 * No-op when Persona Secret Discovery kill switch is OFF.
 */
export function bootstrapChatObservers(opts: {
  chatId: number;
  characterId: number;
  displayName?: string;
  turnNumber?: number;
  locationKey?: string | null;
  userId?: number | null;
  db?: Database.Database;
}): BootstrapChatObserversResult {
  const observerId = mainCharacterObserverId(opts.characterId);
  if (!isPersonaSecretDiscoveryEnabled({ userId: opts.userId })) {
    return {
      observerInserted: false,
      sceneCreated: false,
      presenceInserted: false,
      observerId,
      sceneId: "",
    };
  }
  const db = opts.db ?? getDb();
  ensureObserverSchema(db);
  const turn = opts.turnNumber ?? 0;

  let observerInserted = false;
  let sceneCreated = false;
  let presenceInserted = false;
  let sceneId = "";

  const tx = db.transaction(() => {
    const obs = ensureMainCharacterObserver({
      chatId: opts.chatId,
      characterId: opts.characterId,
      displayName: opts.displayName,
      createdTurn: turn,
      db,
    });
    observerInserted = obs.inserted;

    const scene = ensureActiveChatScene({
      chatId: opts.chatId,
      startedTurn: turn,
      locationKey: opts.locationKey,
      db,
    });
    sceneCreated = scene.created;
    sceneId = scene.scene.id;

    const existingPresence = getScenePresence({
      sceneId: scene.scene.id,
      observerType: "CHARACTER",
      observerId,
      db,
    });
    if (!existingPresence) {
      upsertScenePresence(
        {
          sceneId: scene.scene.id,
          chatId: opts.chatId,
          observerType: "CHARACTER",
          observerId,
          presenceState: "PRESENT",
          awarenessState: "AWARE",
          locationKey: opts.locationKey ?? scene.scene.location_key,
          visualCapability: "NORMAL",
          auditoryCapability: "NORMAL",
          joinedTurn: turn,
          leftTurn: null,
          sourceType: "MAIN_CHARACTER_BOOTSTRAP",
        },
        db
      );
      presenceInserted = true;
    }
  });
  tx();

  return {
    observerInserted,
    sceneCreated,
    presenceInserted,
    observerId,
    sceneId,
  };
}

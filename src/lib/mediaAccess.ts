/**
 * Canonical private-media ACL owner.
 * Grants: character creator, site admin, uploader of an unlinked file,
 * or server-verified chat-tag unlock for this user+character.
 * Does not read is_adult, nsfw_on, or listing skip flags.
 */
import { getDb } from "@/lib/db";
import { isAdminUser } from "@/lib/isAdminUser";
import {
  filenameFromPrivateMediaUrl,
  mediaIdFromPrivateFilename,
  readMediaManifest,
  sanitizeMediaFilename,
} from "@/lib/mediaStorage";
import { parseAssets, type CharacterAsset } from "@/lib/characterAssets";
import {
  collectUnlockedAssetUrlsFromMessages,
  type UnlockSourceMessage,
} from "@/lib/characterAssetUnlock";

export type PrivateMediaViewer = {
  id: number;
  email: string;
  is_admin?: number;
};

export type PrivateMediaAccessReason = "creator" | "admin" | "uploader" | "chat_unlock";

export type PrivateMediaAccessDecision =
  | { ok: true; reason: PrivateMediaAccessReason }
  | { ok: false; reason: "denied" };

type OwningCharacter = {
  id: number;
  creator_id: number | null;
  assets: CharacterAsset[];
};

export function assetMatchesPrivateFilename(asset: CharacterAsset, filename: string): boolean {
  const mediaId = mediaIdFromPrivateFilename(filename);
  if (mediaId && asset.mediaId === mediaId) return true;
  const fromUrl = filenameFromPrivateMediaUrl(asset.url);
  return fromUrl === filename;
}

export function decidePrivateMediaAccess(input: {
  user: PrivateMediaViewer | null;
  isAdmin: boolean;
  owningCharacters: readonly OwningCharacter[];
  unlockedByChat: boolean;
  uploadedByUser: boolean;
}): PrivateMediaAccessDecision {
  if (!input.user) return { ok: false, reason: "denied" };
  if (input.isAdmin) return { ok: true, reason: "admin" };
  if (input.owningCharacters.some((character) => character.creator_id === input.user?.id)) {
    return { ok: true, reason: "creator" };
  }
  if (input.unlockedByChat) return { ok: true, reason: "chat_unlock" };
  if (input.uploadedByUser && input.owningCharacters.length === 0) {
    return { ok: true, reason: "uploader" };
  }
  return { ok: false, reason: "denied" };
}

function loadOwningCharacters(filename: string): OwningCharacter[] {
  const db = getDb();
  const mediaId = mediaIdFromPrivateFilename(filename);
  const needle = mediaId ?? filename;
  const rows = db
    .prepare(`SELECT id, creator_id, assets FROM characters WHERE assets LIKE ?`)
    .all(`%${needle}%`) as Array<{ id: number; creator_id: number | null; assets: string | null }>;
  return rows
    .map((row) => ({
      id: row.id,
      creator_id: row.creator_id,
      assets: parseAssets(row.assets),
    }))
    .filter((row) => row.assets.some((asset) => assetMatchesPrivateFilename(asset, filename)));
}

function loadCompletedAssistantMessages(userId: number, characterId: number): UnlockSourceMessage[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT m.role, m.content, m.generation_status AS generationStatus
       FROM messages m
       INNER JOIN chats c ON c.id = m.chat_id
       WHERE c.user_id = ? AND c.character_id = ? AND m.role = 'assistant'`
    )
    .all(userId, characterId) as Array<{ role: string; content: string; generationStatus: string | null }>;
  return rows.map((row) => ({
    role: row.role,
    content: row.content,
    generationStatus: row.generationStatus,
  }));
}

export function evaluatePrivateMediaAccess(
  user: PrivateMediaViewer | null,
  filename: string
): PrivateMediaAccessDecision {
  const safe = sanitizeMediaFilename(filename);
  if (!safe || !user) return { ok: false, reason: "denied" };

  const owningCharacters = loadOwningCharacters(safe);
  const isAdmin = isAdminUser(user);
  const manifest = readMediaManifest(safe);
  const uploadedByUser = manifest?.uploadedBy === user.id;

  let unlockedByChat = false;
  if (!isAdmin) {
    for (const character of owningCharacters) {
      if (character.creator_id === user.id) break;
      const messages = loadCompletedAssistantMessages(user.id, character.id);
      const unlocked = new Set(
        collectUnlockedAssetUrlsFromMessages(messages, character.assets, false)
      );
      if (character.assets.some((asset) => assetMatchesPrivateFilename(asset, safe) && unlocked.has(asset.url))) {
        unlockedByChat = true;
        break;
      }
    }
  }

  return decidePrivateMediaAccess({
    user,
    isAdmin,
    owningCharacters,
    unlockedByChat,
    uploadedByUser,
  });
}

export function projectAssetsForViewer(
  assets: CharacterAsset[],
  input: {
    canSeeOriginals: boolean;
    unlockedUrls?: ReadonlySet<string>;
  }
): CharacterAsset[] {
  return assets.map((asset) => {
    if (input.canSeeOriginals || input.unlockedUrls?.has(asset.url)) {
      return asset;
    }
    const preview =
      asset.blurPreviewUrl && !asset.blurPreviewUrl.startsWith("/media/private/")
        ? asset.blurPreviewUrl
        : asset.url.startsWith("/uploads/")
          ? `/media/public/legacy-blur-${asset.url.slice("/uploads/".length).replace(/\.[a-zA-Z0-9]+$/, "")}.webp`
          : asset.publicRenditionUrl && asset.representativeRank != null
            ? asset.publicRenditionUrl
            : "";
    return {
      ...asset,
      url: preview || asset.blurPreviewUrl || "",
      viewerBlur: true,
    };
  });
}

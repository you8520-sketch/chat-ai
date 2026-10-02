/**
 * Canonical public/private media ACL owner.
 * Public sharp renditions are served only for approved representatives.
 * Private originals: trusted owner (creator AND manifest uploader), admin,
 * unlinked uploader, or chat-scoped completed assistant unlock.
 * Does not copy #1333 canAccessAdultContent.
 */
import { getDb } from "@/lib/db";
import { isAdminUser } from "@/lib/isAdminUser";
import { canPublishAsRepresentative } from "@/lib/assetVisionPolicy";
import {
  filenameFromPrivateMediaUrl,
  isPublicBlurFilename,
  isPublicRenditionFilename,
  mediaIdFromPrivateFilename,
  mediaIdFromPublicRenditionFilename,
  privateMediaUrl,
  publicMediaUrl,
  readMediaManifest,
  sanitizeMediaFilename,
} from "@/lib/mediaStorage";
import {
  isPrivateMediaUrl,
  isRepresentativeAsset,
  parseAssets,
  privateMediaRequestUrl,
  type CharacterAsset,
} from "@/lib/characterAssets";
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

export type PublicMediaAccessDecision = { ok: true } | { ok: false; reason: "denied" };

export type ChatAccessContext = {
  requestedChatId: number | null;
  chatBelongsToUser: boolean;
  chatCharacterId: number | null;
};

type OwningCharacter = {
  id: number;
  creator_id: number | null;
  nsfw?: number | null;
  assets: CharacterAsset[];
};

export function assetMatchesPrivateFilename(asset: CharacterAsset, filename: string): boolean {
  const mediaId = mediaIdFromPrivateFilename(filename);
  if (mediaId && asset.mediaId === mediaId) return true;
  const fromUrl = filenameFromPrivateMediaUrl(asset.url);
  return fromUrl === filename;
}

export function decidePublicMediaAccess(input: {
  filename: string;
  approvedRepresentative: boolean;
}): PublicMediaAccessDecision {
  const filename = sanitizeMediaFilename(input.filename);
  if (!filename) return { ok: false, reason: "denied" };
  if (isPublicBlurFilename(filename)) return { ok: true };
  if (isPublicRenditionFilename(filename)) {
    return input.approvedRepresentative ? { ok: true } : { ok: false, reason: "denied" };
  }
  return { ok: false, reason: "denied" };
}

export function decidePrivateMediaAccess(input: {
  user: PrivateMediaViewer | null;
  isAdmin: boolean;
  owningCharacters: readonly OwningCharacter[];
  unlockedByChat: boolean;
  uploadedByUser: boolean;
  trustedOwner?: boolean;
  chatContext?: ChatAccessContext;
}): PrivateMediaAccessDecision {
  if (!input.user) return { ok: false, reason: "denied" };
  if (input.isAdmin) return { ok: true, reason: "admin" };
  const trustedOwner =
    input.trustedOwner === true ||
    (input.uploadedByUser &&
      input.owningCharacters.some((character) => character.creator_id === input.user?.id));
  if (trustedOwner) return { ok: true, reason: "creator" };
  const chat = input.chatContext;
  const chatUnlockAllowed =
    input.unlockedByChat &&
    chat != null &&
    chat.requestedChatId != null &&
    chat.chatBelongsToUser &&
    chat.chatCharacterId != null &&
    input.owningCharacters.some((character) => character.id === chat.chatCharacterId);
  if (chatUnlockAllowed) return { ok: true, reason: "chat_unlock" };
  if (input.uploadedByUser && input.owningCharacters.length === 0) {
    return { ok: true, reason: "uploader" };
  }
  return { ok: false, reason: "denied" };
}

function ledgerModerationFields(manifest: ReturnType<typeof readMediaManifest>): Partial<CharacterAsset> {
  if (!manifest) return { moderationStatus: "pending" };
  return {
    moderationStatus: manifest.moderationStatus === "checked" ? "checked" : "pending",
    ...(typeof manifest.adultFlagged === "boolean" ? { adultFlagged: manifest.adultFlagged } : {}),
    ...(typeof manifest.moderationReject === "boolean"
      ? { moderationReject: manifest.moderationReject }
      : {}),
    ...(manifest.moderationReason ? { moderationReason: manifest.moderationReason } : {}),
    ...(manifest.nippleExposure ? { nippleExposure: manifest.nippleExposure } : {}),
  };
}

export function bindTrustedCharacterMedia(
  assets: CharacterAsset[],
  userId: number,
  context?: { nsfw: boolean; characterId?: number | null }
): { ok: true; assets: CharacterAsset[] } | { ok: false; error: string } {
  const next: CharacterAsset[] = [];
  for (const asset of assets) {
    if (!isPrivateMediaUrl(asset.url) && !asset.mediaId) {
      const { publicRenditionUrl: _ignored, ...legacy } = asset;
      next.push(isRepresentativeAsset(asset) ? asset : legacy);
      continue;
    }
    const filename =
      filenameFromPrivateMediaUrl(asset.url) ??
      (asset.mediaId ? `${asset.mediaId}.webp` : null);
    if (!filename) return { ok: false, error: "이미지 참조가 올바르지 않습니다." };
    const manifest = readMediaManifest(filename);
    if (!manifest || manifest.uploadedBy !== userId) {
      return { ok: false, error: "다른 사용자의 이미지는 첨부할 수 없습니다." };
    }
    if (context) {
      const owners = loadOwningCharacters(filename);
      const conflict = owners.some(
        (character) =>
          character.id !== context.characterId && Boolean(character.nsfw) !== context.nsfw
      );
      if (conflict) {
        return { ok: false, error: "일반용과 성인용 캐릭터에 같은 이미지를 쓸 수 없습니다." };
      }
    }
    const mediaId = mediaIdFromPrivateFilename(filename) ?? asset.mediaId;
    const representative = isRepresentativeAsset(asset);
    const {
      publicRenditionUrl: _clientPublic,
      adultFlagged: _clientAdult,
      moderationReject: _clientReject,
      moderationReason: _clientReason,
      moderationStatus: _clientStatus,
      nippleExposure: _clientNipple,
      ...trusted
    } = asset;
    next.push({
      ...trusted,
      url: privateMediaUrl(filename),
      ...(mediaId ? { mediaId } : {}),
      blurPreviewUrl: mediaId ? publicMediaUrl(`${mediaId}-blur.webp`) : asset.blurPreviewUrl,
      ...(representative && mediaId
        ? { publicRenditionUrl: publicMediaUrl(`${mediaId}-public.webp`) }
        : {}),
      ...ledgerModerationFields(manifest),
    });
  }
  return { ok: true, assets: next };
}

function viewerAllowlist(
  asset: CharacterAsset,
  input: { url: string; includeOriginalFields: boolean; chatId?: number | null }
): CharacterAsset {
  const url = input.includeOriginalFields ? privateMediaRequestUrl(input.url, input.chatId) : input.url;
  const projected: CharacterAsset = {
    url,
    tag: asset.tag,
    ...(asset.width ? { width: asset.width } : {}),
    ...(asset.height ? { height: asset.height } : {}),
    ...(asset.orientation ? { orientation: asset.orientation } : {}),
    ...(asset.viewerBlur === true ? { viewerBlur: true } : {}),
    ...(asset.representativeRank != null ? { representativeRank: asset.representativeRank } : {}),
    ...(asset.visualSubjectKey ? { visualSubjectKey: asset.visualSubjectKey } : {}),
    ...(asset.chat === false ? { chat: false } : {}),
  };
  return projected;
}

export function projectAssetsForViewer(
  assets: CharacterAsset[],
  input: {
    canSeeOriginals: boolean;
    unlockedUrls?: ReadonlySet<string>;
    chatId?: number | null;
  }
): CharacterAsset[] {
  return assets.map((asset) => {
    const unlocked = input.canSeeOriginals || Boolean(input.unlockedUrls?.has(asset.url));
    if (unlocked) {
      return viewerAllowlist(asset, {
        url: asset.url,
        includeOriginalFields: isPrivateMediaUrl(asset.url),
        chatId: input.chatId,
      });
    }
    const preview =
      asset.blurPreviewUrl && !isPrivateMediaUrl(asset.blurPreviewUrl)
        ? asset.blurPreviewUrl
        : asset.url.startsWith("/uploads/")
          ? `/media/public/legacy-blur-${asset.url.slice("/uploads/".length).replace(/\.[a-zA-Z0-9]+$/, "")}.webp`
          : isRepresentativeAsset(asset) &&
              asset.publicRenditionUrl &&
              !isPrivateMediaUrl(asset.publicRenditionUrl)
            ? asset.publicRenditionUrl
            : "";
    return viewerAllowlist(
      { ...asset, viewerBlur: true },
      { url: preview || "", includeOriginalFields: false }
    );
  });
}

function loadOwningCharacters(filename: string): OwningCharacter[] {
  const db = getDb();
  const mediaId = mediaIdFromPrivateFilename(filename);
  const needle = mediaId ?? filename;
  const rows = db
    .prepare(`SELECT id, creator_id, nsfw, assets FROM characters WHERE assets LIKE ?`)
    .all(`%${needle}%`) as Array<{
    id: number;
    creator_id: number | null;
    nsfw: number | null;
    assets: string | null;
  }>;
  return rows
    .map((row) => ({
      id: row.id,
      creator_id: row.creator_id,
      nsfw: row.nsfw,
      assets: parseAssets(row.assets),
    }))
    .filter((row) => row.assets.some((asset) => assetMatchesPrivateFilename(asset, filename)));
}

function loadChatContext(userId: number, chatId: number | null): ChatAccessContext {
  if (chatId == null || !Number.isInteger(chatId) || chatId <= 0) {
    return { requestedChatId: null, chatBelongsToUser: false, chatCharacterId: null };
  }
  const row = getDb()
    .prepare(`SELECT id, user_id, character_id FROM chats WHERE id=?`)
    .get(chatId) as { id: number; user_id: number; character_id: number } | undefined;
  if (!row) {
    return { requestedChatId: chatId, chatBelongsToUser: false, chatCharacterId: null };
  }
  return {
    requestedChatId: chatId,
    chatBelongsToUser: row.user_id === userId,
    chatCharacterId: row.character_id,
  };
}

function loadCompletedAssistantMessages(chatId: number): UnlockSourceMessage[] {
  const rows = getDb()
    .prepare(
      `SELECT role, content, generation_status AS generationStatus
       FROM messages
       WHERE chat_id = ? AND role = 'assistant'`
    )
    .all(chatId) as Array<{ role: string; content: string; generationStatus: string | null }>;
  return rows.map((row) => ({
    role: row.role,
    content: row.content,
    generationStatus: row.generationStatus,
  }));
}

function isApprovedRepresentativeMedia(filename: string, owningCharacters: readonly OwningCharacter[]): boolean {
  const mediaId = mediaIdFromPrivateFilename(filename) ?? mediaIdFromPublicRenditionFilename(filename);
  const manifest = mediaId ? readMediaManifest(`${mediaId}.webp`) : null;
  const ledger = ledgerModerationFields(manifest);
  return owningCharacters.some((character) =>
    character.assets.some((asset) => {
      const matches = mediaId
        ? asset.mediaId === mediaId || filenameFromPrivateMediaUrl(asset.url) === `${mediaId}.webp`
        : assetMatchesPrivateFilename(asset, filename);
      if (!matches || !isRepresentativeAsset(asset)) return false;
      return canPublishAsRepresentative({ ...asset, ...ledger, ...(mediaId ? { mediaId } : {}) }).ok;
    })
  );
}

export function evaluatePublicMediaAccess(filename: string): PublicMediaAccessDecision {
  const safe = sanitizeMediaFilename(filename);
  if (!safe) return { ok: false, reason: "denied" };
  if (isPublicBlurFilename(safe)) return { ok: true };
  if (!isPublicRenditionFilename(safe)) return { ok: false, reason: "denied" };
  const mediaId = mediaIdFromPublicRenditionFilename(safe);
  if (!mediaId) return { ok: false, reason: "denied" };
  const owning = loadOwningCharacters(`${mediaId}.webp`);
  return decidePublicMediaAccess({
    filename: safe,
    approvedRepresentative: isApprovedRepresentativeMedia(`${mediaId}.webp`, owning),
  });
}

export function evaluatePrivateMediaAccess(
  user: PrivateMediaViewer | null,
  filename: string,
  chatId?: number | null
): PrivateMediaAccessDecision {
  const safe = sanitizeMediaFilename(filename);
  if (!safe || !user) return { ok: false, reason: "denied" };

  const owningCharacters = loadOwningCharacters(safe);
  const isAdmin = isAdminUser(user);
  const manifest = readMediaManifest(safe);
  const uploadedByUser = manifest?.uploadedBy === user.id;
  const trustedOwner =
    uploadedByUser && owningCharacters.some((character) => character.creator_id === user.id);
  const chatContext = loadChatContext(user.id, chatId ?? null);

  let unlockedByChat = false;
  if (
    !isAdmin &&
    chatContext.requestedChatId != null &&
    chatContext.chatBelongsToUser &&
    chatContext.chatCharacterId != null
  ) {
    const character = owningCharacters.find((row) => row.id === chatContext.chatCharacterId);
    if (character) {
      const unlocked = new Set(
        collectUnlockedAssetUrlsFromMessages(
          loadCompletedAssistantMessages(chatContext.requestedChatId),
          character.assets,
          false
        )
      );
      unlockedByChat = character.assets.some(
        (asset) => assetMatchesPrivateFilename(asset, safe) && unlocked.has(asset.url)
      );
    }
  }

  return decidePrivateMediaAccess({
    user,
    isAdmin,
    owningCharacters,
    unlockedByChat,
    uploadedByUser,
    trustedOwner,
    chatContext,
  });
}

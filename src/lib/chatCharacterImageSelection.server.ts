import {
  getCharacterRepresentativeImageUrl,
  parseAssets,
} from "@/lib/characterAssets";
import {
  resolveSelectableCharacterImages,
  type SelectableCharacterImage,
} from "@/lib/chatCharacterImageSelection";
import { getDb } from "@/lib/db";
import { parseContentKind, type ContentKind } from "@/lib/simulationMode";
import type { SelectableCastAsset } from "@/lib/chatImageCast";

export function listSelectableCharacterImages(input: {
  userId: number;
  characterId: number;
  creatorId: number | null;
  assetsRaw: string;
  imagesRaw: string;
  contentKind?: ContentKind;
}): SelectableCharacterImage[] {
  const contentKind = input.contentKind ?? "character";
  const isCharacterCreator = input.creatorId === input.userId;
  const assistantMessages = isCharacterCreator
    ? []
    : (
        getDb()
          .prepare(
            `SELECT m.content
             FROM messages m
             JOIN chats c ON c.id=m.chat_id
             WHERE c.user_id=? AND c.character_id=? AND m.role='assistant'
             ORDER BY m.id ASC`
          )
          .all(input.userId, input.characterId) as Array<{ content: string }>
      ).map((row) => row.content);

  return resolveSelectableCharacterImages({
    assets: parseAssets(input.assetsRaw),
    representativeUrl: getCharacterRepresentativeImageUrl(
      input.assetsRaw,
      input.imagesRaw
    ),
    isCharacterCreator,
    assistantMessages,
    contentKind,
    poolMode: "main_character",
  });
}

export function listCastSelectableAssets(input: {
  userId: number;
  characterId: number;
  creatorId: number | null;
  assetsRaw: string;
  imagesRaw: string;
  contentKind?: ContentKind;
}): SelectableCastAsset[] {
  const contentKind = parseContentKind(input.contentKind ?? "character");
  const isCharacterCreator = input.creatorId === input.userId;
  const assistantMessages = isCharacterCreator
    ? []
    : (
        getDb()
          .prepare(
            `SELECT m.content
             FROM messages m
             JOIN chats c ON c.id=m.chat_id
             WHERE c.user_id=? AND c.character_id=? AND m.role='assistant'
             ORDER BY m.id ASC`
          )
          .all(input.userId, input.characterId) as Array<{ content: string }>
      ).map((row) => row.content);
  const images = resolveSelectableCharacterImages({
    assets: parseAssets(input.assetsRaw),
    representativeUrl: getCharacterRepresentativeImageUrl(
      input.assetsRaw,
      input.imagesRaw
    ),
    isCharacterCreator,
    assistantMessages,
    contentKind,
    poolMode: "all",
  });
  const assets = parseAssets(input.assetsRaw);
  return images.map((image) => ({
    url: image.url,
    tag: image.tag,
    visualSubjectKey: assets.find((row) => row.url === image.url)?.visualSubjectKey,
  }));
}

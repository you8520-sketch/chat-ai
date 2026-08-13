import type Database from "better-sqlite3";
import { selectCharacterImageUrl } from "@/lib/chatCharacterImageSelection";
import { listSelectableCharacterImages } from "@/lib/chatCharacterImageSelection.server";
import { resolveImagePromptGender } from "@/lib/chatImageGender";
import type { ImagePromptGender } from "@/lib/chatImageGeneration";
import {
  personaImageBaseUrl,
  sanitizePersonaImageUrl,
} from "@/lib/userPersonasClient";
import { loadSheetSnapshots } from "./engineSheets";
import { parseHumanPersona } from "./hostPersona";
import { loadCampaign, loadParticipants } from "./store";
import { TRPG_MAX_SLOTS } from "./types";

export type TrpgIllustrationCastMember = {
  name: string;
  gender: ImagePromptGender;
  role: "player" | "companion character";
  imageUrl: string | null;
  appearanceNote?: string;
};

type CharacterImageRow = {
  id: number;
  name: string;
  gender: string | null;
  assets: string;
  images: string;
  creator_id: number | null;
  visibility: string;
};

type PersonaImageRow = {
  id: number;
  name: string;
  gender: string | null;
  description: string | null;
  image_url: string | null;
};

function clipAppearance(raw: string | null | undefined): string | undefined {
  const text = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return text || undefined;
}

function characterImageUrlForViewer(
  viewerUserId: number,
  row: CharacterImageRow
): string | null {
  if (row.visibility === "private" && row.creator_id !== viewerUserId) return null;
  const images = listSelectableCharacterImages({
    userId: viewerUserId,
    characterId: row.id,
    creatorId: row.creator_id,
    assetsRaw: row.assets,
    imagesRaw: row.images,
  });
  return selectCharacterImageUrl(images, undefined);
}

/**
 * Party members for a campaign illustration (user included, max 4).
 * Returns null when the viewer cannot access the campaign.
 */
export function loadTrpgIllustrationCast(
  db: Database.Database,
  opts: { campaignId: number; viewerUserId: number }
): TrpgIllustrationCastMember[] | null {
  const campaign = loadCampaign(db, opts.campaignId);
  if (!campaign) return null;
  const parts = loadParticipants(db, opts.campaignId);
  const viewer = parts.find(
    (p) => p.kind === "human" && p.user_id === opts.viewerUserId
  );
  if (!viewer && campaign.host_user_id !== opts.viewerUserId) return null;

  const sheets = loadSheetSnapshots(db, opts.campaignId);
  const sheetName = new Map(sheets.map((sheet) => [sheet.participantId, sheet.name.trim()]));
  const members: TrpgIllustrationCastMember[] = [];

  for (const part of parts.slice(0, TRPG_MAX_SLOTS)) {
    const fallbackName = part.display_name.trim() || "플레이어";
    const name = sheetName.get(part.id) || fallbackName;
    if (part.kind === "ai_character") {
      let gender: ImagePromptGender = "other";
      let imageUrl: string | null = null;
      if (part.character_id) {
        const row = db
          .prepare(
            `SELECT id, name, gender, assets, images, creator_id, visibility
             FROM characters WHERE id=?`
          )
          .get(part.character_id) as CharacterImageRow | undefined;
        if (row) {
          gender = resolveImagePromptGender(row.gender);
          imageUrl = characterImageUrlForViewer(opts.viewerUserId, row);
        }
      }
      members.push({
        name,
        gender,
        role: "companion character",
        imageUrl,
      });
      continue;
    }

    const human = parseHumanPersona(part.persona_json);
    let gender: ImagePromptGender = human?.gender ?? "other";
    let imageUrl: string | null = null;
    let appearanceNote: string | undefined;
    if (human?.personaId) {
      const persona = db
        .prepare(
          `SELECT id, name, gender, description, image_url FROM user_personas WHERE id=?`
        )
        .get(human.personaId) as PersonaImageRow | undefined;
      if (persona) {
        gender = resolveImagePromptGender(persona.gender);
        imageUrl =
          personaImageBaseUrl(sanitizePersonaImageUrl(persona.image_url)) || null;
        appearanceNote = clipAppearance(persona.description);
      }
    }
    members.push({
      name: name || human?.name || fallbackName,
      gender,
      role: "player",
      imageUrl,
      appearanceNote,
    });
  }

  return members;
}

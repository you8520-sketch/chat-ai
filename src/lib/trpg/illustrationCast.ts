import type Database from "better-sqlite3";
import { appearancePromptText } from "@/lib/appearanceCompiler";
import { getCharacterRepresentativeImageUrl } from "@/lib/characterAssets";
import { selectCharacterImageUrl } from "@/lib/chatCharacterImageSelection";
import { listSelectableCharacterImages } from "@/lib/chatCharacterImageSelection.server";
import { uniqueIllustrationAliases } from "@/lib/chatLdIllustrationGeneration";
import { resolveImagePromptGender } from "@/lib/chatImageGender";
import type { ImagePromptGender } from "@/lib/chatImageGeneration";
import { extractPersonaAppearance } from "@/lib/chatPersonaImageGeneration";
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
  aliases: string[];
  gender: ImagePromptGender;
  role: "player" | "companion character";
  imageUrl: string | null;
  appearanceNote?: string;
};

export type TrpgIllustrationRoundAction = {
  name: string;
  body: string;
};

export type TrpgIllustrationScene = {
  members: TrpgIllustrationCastMember[];
  location: string;
  actions: TrpgIllustrationRoundAction[];
};

type CharacterImageRow = {
  id: number;
  name: string;
  gender: string | null;
  assets: string;
  images: string;
  creator_id: number | null;
  visibility: string;
  appearance_raw: string | null;
  appearance_compiled: string | null;
};

type PersonaImageRow = {
  id: number;
  name: string;
  gender: string | null;
  description: string | null;
  image_url: string | null;
};

const APPEARANCE_MAX = 400;

function clipAppearance(raw: string | null | undefined): string | undefined {
  const text = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, APPEARANCE_MAX);
  return text || undefined;
}

function partyCharacterImageUrl(
  viewerUserId: number,
  row: CharacterImageRow
): string | null {
  const representative = getCharacterRepresentativeImageUrl(row.assets, row.images);
  if (representative) return representative;
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
 * Party members plus this round's location/actions for a campaign illustration.
 * Returns null when the viewer cannot access the campaign.
 */
export function loadTrpgIllustrationScene(
  db: Database.Database,
  opts: { campaignId: number; viewerUserId: number; roundNumber?: number | null }
): TrpgIllustrationScene | null {
  const campaign = loadCampaign(db, opts.campaignId);
  if (!campaign) return null;
  const parts = loadParticipants(db, opts.campaignId);
  const viewer = parts.find(
    (p) => p.kind === "human" && p.user_id === opts.viewerUserId
  );
  if (!viewer && campaign.host_user_id !== opts.viewerUserId) return null;

  const sheets = loadSheetSnapshots(db, opts.campaignId);
  const sheetByPid = new Map(sheets.map((sheet) => [sheet.participantId, sheet]));
  const members: TrpgIllustrationCastMember[] = [];

  for (const part of parts.slice(0, TRPG_MAX_SLOTS)) {
    const sheet = sheetByPid.get(part.id);
    const fallbackName = part.display_name.trim() || "플레이어";
    const name = sheet?.name.trim() || fallbackName;
    if (part.kind === "ai_character") {
      let gender: ImagePromptGender = "other";
      let imageUrl: string | null = null;
      let appearanceNote: string | undefined;
      let cardName = "";
      if (part.character_id) {
        const row = db
          .prepare(
            `SELECT id, name, gender, assets, images, creator_id, visibility,
                    COALESCE(appearance_raw, '') AS appearance_raw,
                    COALESCE(appearance_compiled, '') AS appearance_compiled
             FROM characters WHERE id=?`
          )
          .get(part.character_id) as CharacterImageRow | undefined;
        if (row) {
          cardName = row.name.trim();
          gender = resolveImagePromptGender(row.gender);
          imageUrl = partyCharacterImageUrl(opts.viewerUserId, row);
          appearanceNote = clipAppearance(
            appearancePromptText({
              raw: row.appearance_raw ?? "",
              compiledJson: row.appearance_compiled,
            })
          );
        }
      }
      members.push({
        name,
        aliases: uniqueIllustrationAliases(name, fallbackName, cardName),
        gender,
        role: "companion character",
        imageUrl,
        appearanceNote,
      });
      continue;
    }

    const human = parseHumanPersona(part.persona_json);
    let gender: ImagePromptGender = human?.gender ?? "other";
    let imageUrl: string | null = null;
    let appearanceNote: string | undefined;
    let personaName = human?.name?.trim() || "";
    if (human?.personaId) {
      const persona = db
        .prepare(
          `SELECT id, name, gender, description, image_url FROM user_personas WHERE id=?`
        )
        .get(human.personaId) as PersonaImageRow | undefined;
      if (persona) {
        personaName = persona.name.trim() || personaName;
        gender = resolveImagePromptGender(persona.gender);
        imageUrl =
          personaImageBaseUrl(sanitizePersonaImageUrl(persona.image_url)) || null;
        appearanceNote =
          clipAppearance(extractPersonaAppearance(persona.description)) ||
          clipAppearance(persona.description);
      }
    }
    members.push({
      name,
      aliases: uniqueIllustrationAliases(name, fallbackName, personaName),
      gender,
      role: "player",
      imageUrl,
      appearanceNote,
    });
  }

  const location =
    sheets.map((sheet) => sheet.location.trim()).find(Boolean) || "";
  const actions: TrpgIllustrationRoundAction[] = [];
  if (opts.roundNumber != null && Number.isInteger(opts.roundNumber) && opts.roundNumber >= 0) {
    const round = db
      .prepare(`SELECT id FROM trpg_rounds WHERE campaign_id=? AND round_number=?`)
      .get(opts.campaignId, opts.roundNumber) as { id: number } | undefined;
    if (round) {
      const rows = db
        .prepare(
          `SELECT s.body, p.id AS participant_id, p.display_name
           FROM trpg_action_submissions s
           JOIN trpg_participants p ON p.id = s.participant_id
           WHERE s.round_id=? AND s.locked=1
           ORDER BY s.id ASC`
        )
        .all(round.id) as Array<{ body: string; participant_id: number; display_name: string }>;
      for (const row of rows) {
        const body = row.body.trim();
        if (!body) continue;
        const sheetName = sheetByPid.get(row.participant_id)?.name.trim();
        actions.push({
          name: sheetName || row.display_name.trim() || "플레이어",
          body,
        });
      }
    }
  }

  return { members, location, actions };
}

/** @deprecated Use loadTrpgIllustrationScene — kept for call sites that only need the cast. */
export function loadTrpgIllustrationCast(
  db: Database.Database,
  opts: { campaignId: number; viewerUserId: number }
): TrpgIllustrationCastMember[] | null {
  return loadTrpgIllustrationScene(db, opts)?.members ?? null;
}

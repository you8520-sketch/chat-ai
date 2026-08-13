import type Database from "better-sqlite3";
import { appearancePromptText } from "@/lib/appearanceCompiler";
import { getCharacterRepresentativeImageUrl } from "@/lib/characterAssets";
import { selectCharacterImageUrl } from "@/lib/chatCharacterImageSelection";
import { listSelectableCharacterImages } from "@/lib/chatCharacterImageSelection.server";
import type { SelectableCharacterImage } from "@/lib/chatCharacterImageSelection";
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
  participantId: number;
  characterId: number | null;
  kind: "human" | "ai_character";
  name: string;
  aliases: string[];
  gender: ImagePromptGender;
  role: "player" | "companion character";
  imageUrl: string | null;
  images: SelectableCharacterImage[];
  appearanceNote?: string;
};

export type TrpgIllustrationRoundAction = {
  name: string;
  body: string;
};

export type TrpgIllustrationScene = {
  campaignTitle: string;
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

function partyCharacterGallery(
  viewerUserId: number,
  row: CharacterImageRow
): { imageUrl: string | null; images: SelectableCharacterImage[] } {
  if (row.visibility === "private" && row.creator_id !== viewerUserId) {
    const representative = getCharacterRepresentativeImageUrl(row.assets, row.images);
    return {
      imageUrl: representative,
      images: representative ? [{ url: representative, tag: "대표" }] : [],
    };
  }
  const images = listSelectableCharacterImages({
    userId: viewerUserId,
    characterId: row.id,
    creatorId: row.creator_id,
    assetsRaw: row.assets,
    imagesRaw: row.images,
  });
  const representative = getCharacterRepresentativeImageUrl(row.assets, row.images);
  const imageUrl = selectCharacterImageUrl(images, undefined) || representative;
  const gallery =
    images.length > 0
      ? images
      : representative
        ? [{ url: representative, tag: "대표" }]
        : [];
  return { imageUrl, images: gallery };
}

export function applyTrpgCastImagePicks(
  members: TrpgIllustrationCastMember[],
  picks: unknown
): TrpgIllustrationCastMember[] {
  if (!Array.isArray(picks)) return members;
  const byId = new Map<number, string>();
  for (const raw of picks) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as { participantId?: unknown; imageUrl?: unknown };
    const id = Number(row.participantId);
    const url = String(row.imageUrl ?? "").trim();
    if (!Number.isInteger(id) || id <= 0 || !url) continue;
    byId.set(id, url);
  }
  if (byId.size === 0) return members;
  return members.map((member) => {
    const picked = byId.get(member.participantId);
    if (!picked) return member;
    const allowed = new Set(member.images.map((image) => image.url));
    if (member.imageUrl) allowed.add(member.imageUrl);
    if (!allowed.has(picked)) return member;
    return { ...member, imageUrl: picked };
  });
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
      let images: SelectableCharacterImage[] = [];
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
          const gallery = partyCharacterGallery(opts.viewerUserId, row);
          imageUrl = gallery.imageUrl;
          images = gallery.images;
          appearanceNote = clipAppearance(
            appearancePromptText({
              raw: row.appearance_raw ?? "",
              compiledJson: row.appearance_compiled,
            })
          );
        }
      }
      members.push({
        participantId: part.id,
        characterId: part.character_id,
        kind: "ai_character",
        name,
        aliases: uniqueIllustrationAliases(name, fallbackName, cardName),
        gender,
        role: "companion character",
        imageUrl,
        images,
        appearanceNote,
      });
      continue;
    }

    const human = parseHumanPersona(part.persona_json);
    let gender: ImagePromptGender = human?.gender ?? "other";
    let imageUrl: string | null = null;
    let images: SelectableCharacterImage[] = [];
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
        if (imageUrl) images = [{ url: imageUrl, tag: "페르소나" }];
        appearanceNote =
          clipAppearance(extractPersonaAppearance(persona.description)) ||
          clipAppearance(persona.description);
      }
    }
    members.push({
      participantId: part.id,
      characterId: part.character_id,
      kind: "human",
      name,
      aliases: uniqueIllustrationAliases(name, fallbackName, personaName),
      gender,
      role: "player",
      imageUrl,
      images,
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

  return {
    campaignTitle: campaign.title.trim() || "TRPG 캠페인",
    members,
    location,
    actions,
  };
}

/** @deprecated Use loadTrpgIllustrationScene — kept for call sites that only need the cast. */
export function loadTrpgIllustrationCast(
  db: Database.Database,
  opts: { campaignId: number; viewerUserId: number }
): TrpgIllustrationCastMember[] | null {
  return loadTrpgIllustrationScene(db, opts)?.members ?? null;
}

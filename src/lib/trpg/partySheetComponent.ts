import type Database from "better-sqlite3";
import { canUseCharacterInTrpg, type CharacterAccessRow } from "@/lib/characterVisibility";
import { findJsxTrpgSheetComponent } from "@/lib/jsxComponent/catalog";
import { canViewTrpgCampaign, loadCampaign, loadParticipants } from "./store";

export type TrpgPartySheetComponent = {
  participantId: number;
  characterId: number;
  name: string;
  compiled: string;
};

/**
 * Read-only presentation lookup: participant → canonical characterId → that
 * character's `trpg_sheet` component. Never mutates game state. Returns null
 * when the viewer cannot read the campaign, the participant is not an AI
 * character, the character no longer passes the host's TRPG admission rule,
 * or it has no sheet component.
 */
export function loadTrpgPartySheetComponent(
  db: Database.Database,
  campaignId: number,
  viewerUserId: number,
  participantId: number
): TrpgPartySheetComponent | null {
  const campaign = loadCampaign(db, campaignId);
  if (!campaign) return null;
  const participants = loadParticipants(db, campaignId);
  if (!canViewTrpgCampaign(campaign, participants, viewerUserId)) return null;
  const participant = participants.find((p) => p.id === participantId);
  if (!participant || participant.kind !== "ai_character") return null;
  const characterId = participant.character_id;
  if (characterId == null || characterId <= 0) return null;
  const character = db
    .prepare(
      `SELECT id, creator_id, visibility, moderation_status, share_slug, official, trpg_reuse_allowed,
              COALESCE(jsx_components_json, '') AS jsx_components_json
         FROM characters WHERE id=?`
    )
    .get(characterId) as (CharacterAccessRow & { jsx_components_json: string }) | undefined;
  if (!character || !canUseCharacterInTrpg(character, campaign.host_user_id)) return null;
  const sheet = findJsxTrpgSheetComponent(character.jsx_components_json);
  if (!sheet) return null;
  return { participantId, characterId, name: sheet.name, compiled: sheet.compiled };
}

import type Database from "better-sqlite3";
import { canAccessCharacter, type CharacterAccessRow } from "@/lib/characterVisibility";
import { TRPG_MAX_SLOTS } from "./types";
import { deriveMaxHp, suggestBotStats, validateStatAllocation } from "./stats";
import {
  insertCampaign,
  insertParticipant,
  loadCampaign,
  loadCampaignByInvite,
  loadLatestRound,
  loadParticipants,
  loadScenario,
} from "./store";

const EVEN_STATS: Record<string, number> = {
  str: 5,
  dex: 5,
  int: 5,
  wis: 5,
  cha: 5,
  con: 5,
};

export { EVEN_STATS };

export function writeSheet(
  db: Database.Database,
  campaignId: number,
  participantId: number,
  name: string,
  stats: Record<string, number>,
  location: string,
  inventory: string[] = []
): void {
  const maxHp = deriveMaxHp(stats.con ?? 5);
  const existing = db
    .prepare(`SELECT id FROM trpg_character_sheets WHERE participant_id=?`)
    .get(participantId) as { id: number } | undefined;
  let sheetId = existing?.id;
  if (sheetId) {
    db.prepare(
      `UPDATE trpg_character_sheets
       SET name=?, hp=?, max_hp=?, location=?, inventory_json=?, revision=revision+1, updated_at=datetime('now')
       WHERE id=?`
    ).run(name, maxHp, maxHp, location, JSON.stringify(inventory), sheetId);
    db.prepare(`DELETE FROM trpg_character_stats WHERE sheet_id=?`).run(sheetId);
  } else {
    const info = db
      .prepare(
        `INSERT INTO trpg_character_sheets
          (campaign_id, participant_id, name, hp, max_hp, location, inventory_json)
         VALUES (?,?,?,?,?,?,?)`
      )
      .run(campaignId, participantId, name, maxHp, maxHp, location, JSON.stringify(inventory));
    sheetId = Number(info.lastInsertRowid);
  }
  const ins = db.prepare(`INSERT INTO trpg_character_stats (sheet_id, stat_key, value) VALUES (?,?,?)`);
  for (const [key, value] of Object.entries(stats)) {
    ins.run(sheetId, key, value);
  }
}

export function createTrpgCampaign(
  db: Database.Database,
  opts: {
    hostUserId: number;
    hostNickname: string;
    characterId?: number | null;
    viewerUserId: number;
  }
): number {
  let title = "TRPG 캠페인";
  let worldBrief = "";
  let sourceCharacterId: number | null = null;
  let sourceWorldId: number | null = null;
  let botName: string | null = null;

  if (opts.characterId) {
    const ch = db
      .prepare(
        `SELECT id, name, world, description, greeting, system_prompt, world_id, creator_id, visibility, moderation_status, share_slug, official
         FROM characters WHERE id=?`
      )
      .get(opts.characterId) as
      | (CharacterAccessRow & {
          name: string;
          world: string | null;
          description: string | null;
          greeting: string | null;
          system_prompt: string | null;
          world_id: number | null;
        })
      | undefined;
    if (!ch) throw new Error("캐릭터를 찾을 수 없습니다.");
    const access = canAccessCharacter(ch, opts.viewerUserId);
    if (!access.ok) throw new Error("이 캐릭터로 TRPG를 시작할 수 없습니다.");
    sourceCharacterId = ch.id;
    sourceWorldId = ch.world_id;
    title = `${ch.name} TRPG`;
    worldBrief = [ch.world, ch.description, ch.greeting].filter((x) => x?.trim()).join("\n\n");
    botName = ch.name;
  }

  return db.transaction(() => {
    const campaignId = insertCampaign(db, {
      hostUserId: opts.hostUserId,
      title,
      sourceCharacterId,
      sourceWorldId,
      worldBrief,
      maxSlots: TRPG_MAX_SLOTS,
    });
    insertParticipant(db, {
      campaignId,
      slotIndex: 0,
      kind: "human",
      userId: opts.hostUserId,
      characterId: null,
      displayName: opts.hostNickname || "플레이어",
    });
    if (botName && sourceCharacterId) {
      const botPid = insertParticipant(db, {
        campaignId,
        slotIndex: 1,
        kind: "ai_character",
        userId: null,
        characterId: sourceCharacterId,
        displayName: botName,
      });
      writeSheet(db, campaignId, botPid, botName, suggestBotStats(worldBrief || botName), "");
    }
    return campaignId;
  })();
}

export function saveTrpgSheet(
  db: Database.Database,
  opts: {
    campaignId: number;
    userId: number;
    name: string;
    stats: Record<string, number>;
    participantId?: number | null;
  }
): void {
  const campaign = loadCampaign(db, opts.campaignId);
  if (!campaign) throw new Error("캠페인을 찾을 수 없습니다.");
  if (campaign.status !== "CHARACTER_SETUP" && campaign.status !== "WAITING_FOR_PLAYERS") {
    throw new Error("능력치는 시작 전에만 정할 수 있습니다.");
  }
  const parts = loadParticipants(db, opts.campaignId);
  let participant = parts.find((p) => p.kind === "human" && p.user_id === opts.userId);
  if (opts.participantId) {
    if (campaign.host_user_id !== opts.userId) {
      throw new Error("방장만 AI 동료 시트를 정할 수 있습니다.");
    }
    const target = parts.find((p) => p.id === opts.participantId);
    if (!target) throw new Error("참가자를 찾을 수 없습니다.");
    if (target.kind !== "ai_character" && target.user_id !== opts.userId) {
      throw new Error("다른 플레이어의 시트는 고칠 수 없습니다.");
    }
    participant = target;
  }
  if (!participant) throw new Error("이 캠페인의 참가자가 아닙니다.");
  const scenario = loadScenario(db, opts.campaignId);
  const check = validateStatAllocation(scenario.statDefs, opts.stats, scenario.pointPool);
  if (!check.ok) throw new Error(`능력치 배분이 올바르지 않습니다 (${check.error}).`);
  const name =
    participant.kind === "ai_character"
      ? participant.display_name
      : opts.name.trim().slice(0, 40) || participant.display_name;
  writeSheet(
    db,
    opts.campaignId,
    participant.id,
    name,
    opts.stats,
    scenario.startLocation,
    scenario.startInventory
  );
  if (participant.kind === "human") {
    db.prepare(`UPDATE trpg_participants SET display_name=? WHERE id=?`).run(name, participant.id);
  }
}

export function joinTrpgCampaign(
  db: Database.Database,
  opts: { code: string; userId: number; nickname: string }
): number {
  const campaign = loadCampaignByInvite(db, opts.code.trim());
  if (!campaign) throw new Error("초대 코드를 찾을 수 없습니다.");
  const parts = loadParticipants(db, campaign.id);
  const existing = parts.find((p) => p.user_id === opts.userId);
  if (existing) return campaign.id;
  if (parts.length >= campaign.max_slots) throw new Error("정원이 가득 찼습니다.");
  if (campaign.status !== "CHARACTER_SETUP" && campaign.status !== "WAITING_FOR_PLAYERS") {
    throw new Error("이미 시작된 캠페인입니다.");
  }
  insertParticipant(db, {
    campaignId: campaign.id,
    slotIndex: parts.length,
    kind: "human",
    userId: opts.userId,
    characterId: null,
    displayName: opts.nickname || "플레이어",
  });
  db.prepare(`UPDATE trpg_campaigns SET status='WAITING_FOR_PLAYERS', updated_at=datetime('now') WHERE id=?`).run(
    campaign.id
  );
  return campaign.id;
}

export function assertCanStart(db: Database.Database, campaignId: number, userId: number): void {
  const campaign = loadCampaign(db, campaignId);
  if (!campaign) throw new Error("캠페인을 찾을 수 없습니다.");
  if (campaign.host_user_id !== userId) throw new Error("방장만 시작할 수 있습니다.");
  const latest = loadLatestRound(db, campaignId);
  if (latest && latest.phase !== "ERROR_RECOVERY") {
    throw new Error("이미 시작된 캠페인입니다.");
  }
  for (const p of loadParticipants(db, campaignId)) {
    const sheet = db
      .prepare(`SELECT id, revision FROM trpg_character_sheets WHERE participant_id=?`)
      .get(p.id) as { id: number; revision: number } | undefined;
    if (!sheet) throw new Error("모든 참가자의 시트를 만들어야 합니다.");
    if (p.kind === "ai_character" && sheet.revision < 1) {
      throw new Error("방장이 AI 동료 능력치를 확인·저장해야 합니다.");
    }
  }
}

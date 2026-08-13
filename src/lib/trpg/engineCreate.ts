import type Database from "better-sqlite3";
import { canAccessCharacter, type CharacterAccessRow } from "@/lib/characterVisibility";
import { canUseWorldForTrpg, loadWorldForTrpg } from "./catalog";
import {
  assertImportedCharactersAccessible,
  canAccessTrpgScenarioTemplate,
  loadScenarioTemplate,
  parseStatRecord,
  rowToScenarioTemplate,
  type TrpgScenarioNpc,
} from "./scenarioTemplates";
import { parseCompanionIds } from "./requestIds";
import { TRPG_SCENARIO_MAX_BOTS } from "./scenarioTypes";
import { TRPG_MAX_SLOTS } from "./types";
import { deriveMaxHp, suggestBotStats, validateStatAllocation } from "./stats";
import { rejectTrpgFork } from "./timeline";
import type { TrpgHumanPersona } from "./hostPersona";
import {
  insertCampaign,
  insertParticipant,
  loadCampaign,
  loadCampaignByInvite,
  loadLatestRound,
  loadParticipants,
  loadScenario,
  type TrpgBotPersona,
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

type CharacterStartRow = CharacterAccessRow & {
  name: string;
  world: string | null;
  description: string | null;
  greeting: string | null;
  system_prompt: string | null;
  world_id: number | null;
};

type SpawnBot = {
  characterId: number | null;
  displayName: string;
  persona: TrpgBotPersona | null;
  stats: Record<string, number>;
};

function loadCharacterForTrpg(db: Database.Database, id: number, viewerUserId: number): CharacterStartRow {
  const ch = db
    .prepare(
      `SELECT id, name, world, description, greeting, system_prompt, world_id, creator_id, visibility, moderation_status, share_slug, official
       FROM characters WHERE id=?`
    )
    .get(id) as CharacterStartRow | undefined;
  if (!ch) throw new Error("캐릭터를 찾을 수 없습니다.");
  const access = canAccessCharacter(ch, viewerUserId);
  if (!access.ok) throw new Error("이 캐릭터로 TRPG를 시작할 수 없습니다.");
  return ch;
}

function botFromCharacter(ch: CharacterStartRow): SpawnBot {
  const personaText = [ch.name, ch.world, ch.description, ch.system_prompt].filter((x) => x?.trim()).join("\n");
  return {
    characterId: ch.id,
    displayName: ch.name,
    persona: null,
    stats: suggestBotStats(personaText || ch.name),
  };
}

function botFromNpc(npc: TrpgScenarioNpc): SpawnBot {
  const personaText = [npc.name, npc.description, npc.systemPrompt].filter((x) => x.trim()).join("\n");
  return {
    characterId: null,
    displayName: npc.name,
    persona: {
      description: npc.description,
      greeting: npc.greeting,
      systemPrompt: npc.systemPrompt,
    },
    stats: npc.stats ?? suggestBotStats(personaText || npc.name),
  };
}

function applyHumanPersona(
  db: Database.Database,
  participantId: number,
  persona: TrpgHumanPersona | null | undefined,
  fallbackName: string
): string {
  const name = persona?.name.trim().slice(0, 40) || fallbackName.trim().slice(0, 40) || "플레이어";
  db.prepare(`UPDATE trpg_participants SET display_name=?, persona_json=? WHERE id=?`).run(
    name,
    persona && persona.personaId > 0 ? JSON.stringify(persona) : "",
    participantId
  );
  const sheet = db
    .prepare(`SELECT id FROM trpg_character_sheets WHERE participant_id=?`)
    .get(participantId) as { id: number } | undefined;
  if (sheet) {
    db.prepare(`UPDATE trpg_character_sheets SET name=?, updated_at=datetime('now') WHERE id=?`).run(name, sheet.id);
  }
  return name;
}

export function createTrpgCampaign(
  db: Database.Database,
  opts: {
    hostUserId: number;
    hostNickname: string;
    hostPersona?: TrpgHumanPersona | null;
    characterId?: number | null;
    characterIds?: number[] | null;
    worldId?: number | null;
    templateId?: number | null;
    title?: string | null;
    viewerUserId: number;
    parentCampaignId?: number | null;
    forkFromRound?: number | null;
  }
): number {
  if (opts.parentCampaignId || opts.forkFromRound) rejectTrpgFork();
  const companionIds = parseCompanionIds(opts.characterIds, opts.characterId);

  let title = "TRPG 캠페인";
  let worldBrief = "";
  let sourceCharacterId: number | null = null;
  let sourceWorldId: number | null = null;
  let templateId: number | null = null;
  let authorUserId: number | null = null;
  let startLocation = "";
  let startInventory: string[] = [];
  let defaultPcStats: Record<string, number> | null = null;
  let gmSecret = "";
  const bots: SpawnBot[] = [];
  const seenCharacterIds = new Set<number>();

  if (opts.templateId) {
    const row = loadScenarioTemplate(db, opts.templateId);
    if (!row) throw new Error("시나리오를 찾을 수 없습니다.");
    if (!canAccessTrpgScenarioTemplate(row, opts.viewerUserId)) {
      throw new Error("이 시나리오는 비공개입니다.");
    }
    const template = rowToScenarioTemplate(row, { includeSecret: true });
    templateId = template.id;
    authorUserId = template.creatorId;
    title = template.title;
    startLocation = template.startLocation;
    startInventory = template.startInventory;
    defaultPcStats = template.defaultPcStats;
    gmSecret = template.secretContent;
    worldBrief = [template.summary, template.content].filter((x) => x.trim()).join("\n\n");
    if (template.worldId) {
      const world = loadWorldForTrpg(db, template.worldId);
      if (world && (canUseWorldForTrpg(world, opts.viewerUserId) || world.creator_id === template.creatorId)) {
        sourceWorldId = world.id;
        worldBrief = [world.name, world.summary, world.content, worldBrief].filter((x) => x?.trim()).join("\n\n");
      }
    }
    assertImportedCharactersAccessible(db, template.characterIds, opts.viewerUserId);
    for (const characterId of template.characterIds) {
      const ch = loadCharacterForTrpg(db, characterId, opts.viewerUserId);
      seenCharacterIds.add(ch.id);
      if (!sourceCharacterId) sourceCharacterId = ch.id;
      bots.push(botFromCharacter(ch));
    }
    for (const npc of template.npcs) bots.push(botFromNpc(npc));
  } else if (opts.worldId) {
    const world = loadWorldForTrpg(db, opts.worldId);
    if (!world) throw new Error("세계관을 찾을 수 없습니다.");
    if (!canUseWorldForTrpg(world, opts.viewerUserId)) {
      throw new Error("이 세계관은 TRPG에 공개되어 있지 않습니다.");
    }
    sourceWorldId = world.id;
    authorUserId = world.creator_id;
    title = `${world.name} TRPG`;
    worldBrief = [world.summary, world.content].filter((x) => x.trim()).join("\n\n");
  }

  for (const characterId of companionIds) {
    if (seenCharacterIds.has(characterId)) continue;
    if (bots.length >= TRPG_SCENARIO_MAX_BOTS) {
      throw new Error(
        `AI 동료는 최대 ${TRPG_SCENARIO_MAX_BOTS}명입니다. 시나리오 NPC/캐릭터와 합쳐 자리가 없습니다.`
      );
    }
    const ch = loadCharacterForTrpg(db, characterId, opts.viewerUserId);
    seenCharacterIds.add(ch.id);
    if (!sourceCharacterId) sourceCharacterId = ch.id;
    if (!sourceWorldId && ch.world_id) sourceWorldId = ch.world_id;
    if (!authorUserId && ch.official !== 1) authorUserId = ch.creator_id;
    if (!worldBrief.trim()) {
      worldBrief = [ch.world, ch.description, ch.greeting].filter((x) => x?.trim()).join("\n\n");
    }
    if (!opts.templateId && !opts.worldId && bots.length === 0) title = `${ch.name} TRPG`;
    bots.push(botFromCharacter(ch));
  }

  const customTitle = opts.title?.trim().slice(0, 80);
  if (customTitle) title = customTitle;
  if (!defaultPcStats) defaultPcStats = parseStatRecord(suggestBotStats(worldBrief || title));
  const spawnBots = bots.slice(0, TRPG_MAX_SLOTS - 1);
  const hostName = opts.hostPersona?.name.trim().slice(0, 40) || opts.hostNickname.trim().slice(0, 40) || "플레이어";

  return db.transaction(() => {
    const campaignId = insertCampaign(db, {
      hostUserId: opts.hostUserId,
      title,
      sourceCharacterId,
      sourceWorldId,
      worldBrief,
      maxSlots: TRPG_MAX_SLOTS,
      templateId,
      authorUserId,
      startLocation,
      startInventory,
      defaultPcStats,
      gmSecret,
    });
    insertParticipant(db, {
      campaignId,
      slotIndex: 0,
      kind: "human",
      userId: opts.hostUserId,
      characterId: null,
      displayName: hostName,
      persona: opts.hostPersona && opts.hostPersona.personaId > 0 ? opts.hostPersona : null,
    });
    spawnBots.forEach((bot, index) => {
      const botPid = insertParticipant(db, {
        campaignId,
        slotIndex: index + 1,
        kind: "ai_character",
        userId: null,
        characterId: bot.characterId,
        displayName: bot.displayName,
        persona: bot.persona,
      });
      writeSheet(db, campaignId, botPid, bot.displayName, bot.stats, startLocation, startInventory);
    });
    if (spawnBots.length > 0) {
      db.prepare(`UPDATE trpg_campaign_state SET npcs_json=? WHERE campaign_id=?`).run(
        JSON.stringify(spawnBots.map((bot) => bot.displayName)),
        campaignId
      );
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
    persona?: TrpgHumanPersona | null;
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
  if (participant.kind === "human" && participant.user_id === opts.userId && opts.persona) {
    applyHumanPersona(db, participant.id, opts.persona, opts.name || participant.display_name);
    participant = loadParticipants(db, opts.campaignId).find((p) => p.id === participant!.id) ?? participant;
  }
  const name =
    participant.kind === "ai_character"
      ? participant.display_name
      : opts.persona?.name.trim().slice(0, 40) || opts.name.trim().slice(0, 40) || participant.display_name;
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
  opts: { code: string; userId: number; nickname: string; persona?: TrpgHumanPersona | null }
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
  const displayName = opts.persona?.name.trim().slice(0, 40) || opts.nickname.trim().slice(0, 40) || "플레이어";
  insertParticipant(db, {
    campaignId: campaign.id,
    slotIndex: parts.length,
    kind: "human",
    userId: opts.userId,
    characterId: null,
    displayName,
    persona: opts.persona && opts.persona.personaId > 0 ? opts.persona : null,
  });
  db.prepare(`UPDATE trpg_campaigns SET status='WAITING_FOR_PLAYERS', updated_at=datetime('now') WHERE id=?`).run(
    campaign.id
  );
  return campaign.id;
}

export function addTrpgCompanions(
  db: Database.Database,
  opts: { campaignId: number; userId: number; characterIds: number[] }
): void {
  const campaign = loadCampaign(db, opts.campaignId);
  if (!campaign) throw new Error("캠페인을 찾을 수 없습니다.");
  if (campaign.host_user_id !== opts.userId) throw new Error("방장만 AI 동료를 넣을 수 있습니다.");
  if (campaign.status !== "CHARACTER_SETUP" && campaign.status !== "WAITING_FOR_PLAYERS") {
    throw new Error("시작 전에만 동료를 넣을 수 있습니다.");
  }
  const ids = parseCompanionIds(opts.characterIds);
  if (ids.length === 0) throw new Error("데려갈 캐릭터를 고르세요.");
  const parts = loadParticipants(db, opts.campaignId);
  const remaining = campaign.max_slots - parts.length;
  if (remaining <= 0) throw new Error("정원이 가득 찼습니다.");
  const seen = new Set(parts.map((p) => p.character_id).filter((id): id is number => id != null && id > 0));
  const toAdd: SpawnBot[] = [];
  for (const characterId of ids) {
    if (seen.has(characterId)) continue;
    if (toAdd.length >= remaining) {
      throw new Error(`AI 동료는 ${remaining}명까지 더 넣을 수 있습니다.`);
    }
    const ch = loadCharacterForTrpg(db, characterId, opts.userId);
    seen.add(ch.id);
    toAdd.push(botFromCharacter(ch));
  }
  if (toAdd.length === 0) return;
  const scenario = loadScenario(db, opts.campaignId);
  let nextSlot = Math.max(...parts.map((p) => p.slot_index)) + 1;
  db.transaction(() => {
    for (const bot of toAdd) {
      const botPid = insertParticipant(db, {
        campaignId: opts.campaignId,
        slotIndex: nextSlot,
        kind: "ai_character",
        userId: null,
        characterId: bot.characterId,
        displayName: bot.displayName,
        persona: bot.persona,
      });
      nextSlot += 1;
      writeSheet(
        db,
        opts.campaignId,
        botPid,
        bot.displayName,
        bot.stats,
        scenario.startLocation,
        scenario.startInventory
      );
    }
    const names = [
      ...parts.filter((p) => p.kind === "ai_character").map((p) => p.display_name),
      ...toAdd.map((bot) => bot.displayName),
    ];
    db.prepare(`UPDATE trpg_campaign_state SET npcs_json=? WHERE campaign_id=?`).run(
      JSON.stringify(names),
      opts.campaignId
    );
  })();
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

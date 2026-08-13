import { getDb } from "@/lib/db";

export type ChatImageAlbumMode =
  | "sd"
  | "emoticon"
  | "couple_stamp"
  | "comic"
  | "illustration";

export type ChatImageAlbumEntry = {
  id: number;
  imageUrl: string;
  mode: ChatImageAlbumMode;
  createdAt: string;
  campaignId: number | null;
  campaignTitle: string | null;
};

export type ChatImageAlbumCatalogItem = {
  kind: "character" | "campaign";
  id: number;
  name: string;
  coverUrl: string | null;
  count: number;
};

function addColumn(table: string, column: string, def: string) {
  const db = getDb();
  const cols = (
    db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  ).map((row) => row.name);
  if (cols.includes(column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
}

export function ensureCharacterImageAlbumTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS character_image_album (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      persona_id INTEGER,
      chat_id INTEGER,
      generation_id INTEGER,
      image_url TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'sd',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, character_id, image_url)
    );

    CREATE INDEX IF NOT EXISTS idx_character_image_album_recent
      ON character_image_album(user_id, character_id, created_at DESC, id DESC);
  `);
  addColumn("character_image_album", "campaign_id", "INTEGER");
  addColumn("character_image_album", "campaign_title", "TEXT");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_character_image_album_campaign
      ON character_image_album(user_id, campaign_id, created_at DESC, id DESC);
  `);
}

function asAlbumMode(raw: string): ChatImageAlbumMode {
  if (
    raw === "sd" ||
    raw === "emoticon" ||
    raw === "couple_stamp" ||
    raw === "comic" ||
    raw === "illustration"
  ) {
    return raw;
  }
  return "sd";
}

function mapAlbumRow(row: {
  id: number;
  image_url: string;
  mode: string;
  created_at: string;
  campaign_id?: number | null;
  campaign_title?: string | null;
}): ChatImageAlbumEntry {
  return {
    id: row.id,
    imageUrl: row.image_url,
    mode: asAlbumMode(row.mode),
    createdAt: row.created_at,
    campaignId: row.campaign_id ?? null,
    campaignTitle: row.campaign_title ?? null,
  };
}

export function saveGeneratedImageToCharacterAlbum(input: {
  userId: number;
  characterId: number;
  personaId: number | null;
  chatId: number | null;
  generationId: number | null;
  imageUrl: string;
  mode: ChatImageAlbumMode;
  campaignId?: number | null;
  campaignTitle?: string | null;
}) {
  ensureCharacterImageAlbumTable();
  getDb()
    .prepare(
      `INSERT INTO character_image_album (
         user_id, character_id, persona_id, chat_id, generation_id, image_url, mode, campaign_id, campaign_title
       ) VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(user_id, character_id, image_url)
       DO UPDATE SET
         persona_id=excluded.persona_id,
         chat_id=excluded.chat_id,
         generation_id=excluded.generation_id,
         mode=excluded.mode,
         campaign_id=excluded.campaign_id,
         campaign_title=excluded.campaign_title`
    )
    .run(
      input.userId,
      input.characterId,
      input.personaId,
      input.chatId,
      input.generationId,
      input.imageUrl,
      input.mode,
      input.campaignId ?? null,
      input.campaignTitle ?? null
    );
}

export function listCharacterAlbum(userId: number, characterId: number): ChatImageAlbumEntry[] {
  ensureCharacterImageAlbumTable();
  return (
    getDb()
      .prepare(
        `SELECT id, image_url, mode, created_at, campaign_id, campaign_title
         FROM character_image_album
         WHERE user_id=? AND character_id=? AND COALESCE(campaign_id, 0)=0
         ORDER BY id DESC
         LIMIT 60`
      )
      .all(userId, characterId) as Array<{
      id: number;
      image_url: string;
      mode: string;
      created_at: string;
      campaign_id: number | null;
      campaign_title: string | null;
    }>
  ).map(mapAlbumRow);
}

export function characterAlbumTitle(characterId: number): string {
  const row = getDb()
    .prepare(`SELECT name FROM characters WHERE id=?`)
    .get(characterId) as { name: string } | undefined;
  return row?.name.trim() || "캐릭터";
}

export function campaignAlbumTitle(userId: number, campaignId: number): string {
  ensureCharacterImageAlbumTable();
  const db = getDb();
  const campaign = db
    .prepare(`SELECT title, host_user_id FROM trpg_campaigns WHERE id=?`)
    .get(campaignId) as { title: string; host_user_id: number } | undefined;
  if (campaign) {
    const member = db
      .prepare(
        `SELECT id FROM trpg_participants WHERE campaign_id=? AND user_id=? AND kind='human'`
      )
      .get(campaignId, userId) as { id: number } | undefined;
    if (member || campaign.host_user_id === userId) {
      const live = campaign.title.trim();
      if (live) return live;
    }
  }
  const stored = db
    .prepare(
      `SELECT campaign_title FROM character_image_album
       WHERE user_id=? AND campaign_id=? AND TRIM(COALESCE(campaign_title, '')) != ''
       ORDER BY id DESC LIMIT 1`
    )
    .get(userId, campaignId) as { campaign_title: string } | undefined;
  return stored?.campaign_title.trim() || "TRPG 캠페인";
}

export function listCampaignAlbum(userId: number, campaignId: number): ChatImageAlbumEntry[] {
  ensureCharacterImageAlbumTable();
  return (
    getDb()
      .prepare(
        `SELECT id, image_url, mode, created_at, campaign_id, campaign_title
         FROM character_image_album
         WHERE user_id=? AND campaign_id=?
         ORDER BY id DESC
         LIMIT 80`
      )
      .all(userId, campaignId) as Array<{
      id: number;
      image_url: string;
      mode: string;
      created_at: string;
      campaign_id: number | null;
      campaign_title: string | null;
    }>
  ).map(mapAlbumRow);
}

export function deleteCharacterAlbumImage(opts: {
  userId: number;
  characterId: number;
  imageUrl: string;
}): number {
  ensureCharacterImageAlbumTable();
  return getDb()
    .prepare(
      `DELETE FROM character_image_album
       WHERE user_id=? AND character_id=? AND image_url=? AND COALESCE(campaign_id, 0)=0`
    )
    .run(opts.userId, opts.characterId, opts.imageUrl).changes;
}

export function deleteCampaignAlbumImage(opts: {
  userId: number;
  campaignId: number;
  imageUrl: string;
}): number {
  ensureCharacterImageAlbumTable();
  return getDb()
    .prepare(
      `DELETE FROM character_image_album
       WHERE user_id=? AND campaign_id=? AND image_url=?`
    )
    .run(opts.userId, opts.campaignId, opts.imageUrl).changes;
}

export function listImageAlbumCatalog(userId: number): {
  characters: ChatImageAlbumCatalogItem[];
  campaigns: ChatImageAlbumCatalogItem[];
} {
  ensureCharacterImageAlbumTable();
  const db = getDb();
  const characterRows = db
    .prepare(
      `SELECT a.character_id AS id, COALESCE(c.name, '캐릭터') AS name,
              COUNT(*) AS count, MAX(a.id) AS last_id
       FROM character_image_album a
       LEFT JOIN characters c ON c.id = a.character_id
       WHERE a.user_id=? AND COALESCE(a.campaign_id, 0)=0
       GROUP BY a.character_id
       ORDER BY last_id DESC`
    )
    .all(userId) as Array<{ id: number; name: string; count: number; last_id: number }>;
  const campaignRows = db
    .prepare(
      `SELECT a.campaign_id AS id,
              COALESCE(NULLIF(t.title, ''), NULLIF(MAX(a.campaign_title), ''), 'TRPG 캠페인') AS name,
              COUNT(*) AS count, MAX(a.id) AS last_id
       FROM character_image_album a
       LEFT JOIN trpg_campaigns t ON t.id = a.campaign_id
       WHERE a.user_id=? AND COALESCE(a.campaign_id, 0)>0
       GROUP BY a.campaign_id
       ORDER BY last_id DESC`
    )
    .all(userId) as Array<{ id: number; name: string; count: number; last_id: number }>;

  const coverFor = (kind: "character" | "campaign", id: number) => {
    const row = db
      .prepare(
        kind === "character"
          ? `SELECT image_url FROM character_image_album
             WHERE user_id=? AND character_id=? AND COALESCE(campaign_id, 0)=0
             ORDER BY id DESC LIMIT 1`
          : `SELECT image_url FROM character_image_album
             WHERE user_id=? AND campaign_id=?
             ORDER BY id DESC LIMIT 1`
      )
      .get(userId, id) as { image_url: string } | undefined;
    return row?.image_url ?? null;
  };

  return {
    characters: characterRows.map((row) => ({
      kind: "character" as const,
      id: row.id,
      name: row.name,
      coverUrl: coverFor("character", row.id),
      count: row.count,
    })),
    campaigns: campaignRows.map((row) => ({
      kind: "campaign" as const,
      id: row.id,
      name: row.name,
      coverUrl: coverFor("campaign", row.id),
      count: row.count,
    })),
  };
}

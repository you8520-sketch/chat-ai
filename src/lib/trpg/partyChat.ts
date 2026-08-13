import type Database from "better-sqlite3";
import type { TrpgPartyChatMessage } from "./snapshot";
import { loadCampaign, loadParticipants } from "./store";
import { TRPG_PARTY_CHAT_LIMIT, TRPG_PARTY_CHAT_MAX_CHARS } from "./types";

export type { TrpgPartyChatMessage };

export function loadTrpgPartyChat(
  db: Database.Database,
  campaignId: number,
  viewerUserId: number,
  limit = TRPG_PARTY_CHAT_LIMIT
): TrpgPartyChatMessage[] {
  const rows = db
    .prepare(
      `SELECT m.id, m.participant_id, m.user_id, m.body, m.created_at, p.display_name AS name
       FROM trpg_party_messages m
       JOIN trpg_participants p ON p.id = m.participant_id
       WHERE m.campaign_id=?
       ORDER BY m.id DESC
       LIMIT ?`
    )
    .all(campaignId, limit) as Array<{
    id: number;
    participant_id: number;
    user_id: number;
    body: string;
    created_at: string;
    name: string;
  }>;
  return rows
    .reverse()
    .map((row) => ({
      id: row.id,
      participantId: row.participant_id,
      userId: row.user_id,
      name: row.name,
      body: row.body,
      createdAt: row.created_at,
      isSelf: row.user_id === viewerUserId,
    }));
}

export function postTrpgPartyChat(
  db: Database.Database,
  opts: { campaignId: number; userId: number; body: string }
): void {
  const campaign = loadCampaign(db, opts.campaignId);
  if (!campaign) throw new Error("캠페인을 찾을 수 없습니다.");
  const participant = loadParticipants(db, opts.campaignId).find(
    (p) => p.kind === "human" && p.user_id === opts.userId
  );
  if (!participant) throw new Error("이 캠페인의 참가자가 아닙니다.");
  const body = opts.body.replace(/\s+/g, " ").trim().slice(0, TRPG_PARTY_CHAT_MAX_CHARS);
  if (!body) throw new Error("메시지를 입력해 주세요.");
  if (campaign.status === "CHARACTER_SETUP" || campaign.status === "WAITING_FOR_PLAYERS") {
    throw new Error("캠페인이 시작된 뒤에 파티 대화를 쓸 수 있습니다.");
  }
  db.prepare(
    `INSERT INTO trpg_party_messages (campaign_id, participant_id, user_id, body)
     VALUES (?,?,?,?)`
  ).run(opts.campaignId, participant.id, opts.userId, body);
}

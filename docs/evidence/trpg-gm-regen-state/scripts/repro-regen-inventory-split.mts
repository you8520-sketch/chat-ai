import Database from "better-sqlite3";
import { EVEN_STATS, createTrpgCampaign, joinTrpgCampaign, saveTrpgSheet, writeSheet } from "@/lib/trpg/engineCreate";
import {
  advanceTrpgCampaign,
  regenerateTrpgNarration,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "@/lib/trpg/engineAdvance";
import { loadTrpgSnapshot } from "@/lib/trpg/engineSnapshot";
import { loadSheetSnapshots } from "@/lib/trpg/engineSheets";
import { inventoryUnits } from "@/lib/trpg/inventory";
import { buildCampaignMemoryPrompt, buildTrpgBotMemoryBlock } from "@/lib/trpg/memory";
import { loadCampaignLedger } from "@/lib/trpg/campaignLedger";
import { insertScenarioTemplate } from "@/lib/trpg/scenarioTemplates";
import { ensureTrpgTables } from "@/lib/trpg/schema";
import { insertParticipant } from "@/lib/trpg/store";

const LEDGER = "세관 밀수 원본 장부";

function players(ids: number[], extra: Record<number, Record<string, unknown>> = {}) {
  return ids.map((participantId) => ({
    participantId,
    hp: 40,
    conditions: [],
    inventoryAdd: [],
    inventoryRemove: [],
    location: "마레노 부두",
    ...extra[participantId],
  }));
}

function wire(narration: string, ids: number[], extra: Record<number, Record<string, unknown>> = {}, more: Record<string, unknown> = {}) {
  return JSON.stringify({
    narration,
    delta: {
      players: players(ids, extra),
      location: "마레노 부두",
      next_round_context: "",
      campaign_finished: false,
      ...more,
    },
  });
}

function party(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT, nickname TEXT, points INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS point_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, point_type TEXT NOT NULL, remaining_amount REAL NOT NULL, expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS point_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, delta REAL NOT NULL, reason TEXT NOT NULL, message_id INTEGER, chat_id INTEGER);
  `);
  for (const [id, nickname] of [
    [1, "렌"],
    [2, "현"],
  ] as const) {
    db.prepare(`INSERT INTO users (id, email, nickname, points) VALUES (?,?,?,5000)`).run(id, `${id}@t`, nickname);
  }
  ensureTrpgTables(db);
  const templateId = insertScenarioTemplate(db, 7, {
    title: "안개항 실종 사건",
    summary: "해무의 항구",
    content: "항구도시에서 사라진 어선을 쫓는다.",
    visibility: "public",
    startLocation: "마레노 부두",
  });
  const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1, templateId });
  saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
  const invite = (db.prepare(`SELECT invite_code FROM trpg_campaigns WHERE id=?`).get(campaignId) as { invite_code: string })
    .invite_code;
  joinTrpgCampaign(db, { code: invite, userId: 2, nickname: "현" });
  saveTrpgSheet(db, { campaignId, userId: 2, name: "현", stats: EVEN_STATS });
  const seat = (userId: number) =>
    (db.prepare(`SELECT id FROM trpg_participants WHERE campaign_id=? AND user_id=?`).get(campaignId, userId) as { id: number })
      .id;
  const ids = [seat(1), seat(2)];
  for (const [slot, name] of [
    [2, "서하"],
    [3, "도윤"],
  ] as const) {
    const id = insertParticipant(db, {
      campaignId,
      slotIndex: slot,
      kind: "ai_character",
      userId: null,
      characterId: null,
      displayName: name,
      persona: { description: `${name}의 설명`, greeting: "", systemPrompt: "" },
    });
    writeSheet(db, campaignId, id, name, EVEN_STATS, "마레노 부두");
    ids.push(id);
  }
  return { campaignId, ids, hyunId: ids[1]!, seohaId: ids[2]! };
}

function itemsOf(db: Database.Database, campaignId: number) {
  return Object.fromEntries(
    loadSheetSnapshots(db, campaignId).map((sheet) => [sheet.name, inventoryUnits(sheet.inventory)])
  );
}

const captured: { gm: string[]; bot: string[] } = { gm: [], bot: [] };
let call = 0;
const texts: string[] = [];
const deps: TrpgEngineDeps = {
  skipBilling: true,
  rollD20: () => 15,
  rollDie: () => 4,
  botCall: async (_system, user) => {
    captured.bot.push(user);
    return { text: "조용히 주변을 살핀다." };
  },
  gmCall: async ({ user }) => {
    captured.gm.push(user);
    const text = texts[Math.min(call, texts.length - 1)]!;
    call += 1;
    return { text };
  },
};

function play(db: Database.Database, campaignId: number) {
  submitTrpgAction(db, {
    campaignId,
    userId: 1,
    body: "골목 입구에서 망을 본다.",
    actionType: "free",
  });
  submitTrpgAction(db, {
    campaignId,
    userId: 2,
    body: "주운 황동 열쇠를 들고 폐창고로 들어가 철제 서류함을 찾아 확인한다.",
    actionType: "investigate",
  });
  return advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
}

const db = new Database(":memory:");
const { campaignId, ids, hyunId, seohaId } = party(db);

texts.push(
  wire("오프닝. 일행은 부두에 서 있다. GM: 무엇을 하겠는가?", ids),
  wire("현이 철제 서류함을 열고 세관 밀수 원본 장부를 챙겼다. GM: 무엇을 하겠는가?", ids, {
    [hyunId]: { inventoryAdd: [LEDGER] },
  }),
  wire("서하가 서류함에서 세관 밀수 원본 장부를 꺼내 품에 넣었다. GM: 무엇을 하겠는가?", ids, {
    [seohaId]: { inventoryAdd: [LEDGER] },
  }),
  wire("다음 장면. GM: 무엇을 하겠는가?", ids)
);

await startTrpgCampaign(db, { campaignId, userId: 1, deps });
await play(db, campaignId);

const afterCommit = {
  items: itemsOf(db, campaignId),
  narration: loadTrpgSnapshot(db, campaignId, 1)?.currentNarration ?? "",
  regenUserHasHyunLedger: false,
  regenUserHasRegenerateHeader: false,
  regenUserHasHyunAction: false,
};

const regenUser = captured.gm[captured.gm.length - 1]!;
afterCommit.regenUserHasHyunLedger = /현:.*items=.*세관 밀수 원본 장부/.test(regenUser) || regenUser.includes(`현: HP 40/40 items=${LEDGER}`);
afterCommit.regenUserHasRegenerateHeader = regenUser.includes("[REGENERATE —");
// The regenerate user is captured when regenerateTrpgNarration runs, not yet.

await regenerateTrpgNarration(db, { campaignId, userId: 1, deps });
const regenInput = captured.gm[captured.gm.length - 1]!;

const afterRegen = {
  items: itemsOf(db, campaignId),
  narration: loadTrpgSnapshot(db, campaignId, 1)?.currentNarration ?? "",
  structured: JSON.parse(
    (db.prepare(`SELECT structured_json FROM trpg_gm_messages WHERE round_id=(SELECT MAX(id) FROM trpg_gm_messages)`).get() as {
      structured_json: string;
    }).structured_json
  ) as { narration: string; delta: { players: Array<{ participantId: number; inventoryAdd?: string[] }> } },
  regenInputHasSheetsCanon: regenInput.includes("Keep CHARACTER SHEETS canon"),
  regenInputHasHyunLedger: regenInput.includes(`items=${LEDGER}`) && regenInput.includes("현:"),
  regenInputHasHyunAction: regenInput.includes("철제 서류함을 찾아 확인한다"),
  regenInputHeader: (regenInput.match(/\[REGENERATE[^\]]+\]/) ?? [""])[0],
  memoryAfterRegen: buildCampaignMemoryPrompt(db, campaignId),
};

await play(db, campaignId);
const nextGm = captured.gm[captured.gm.length - 1]!;
const nextBots = captured.bot.slice(-2);
const botMemory = buildTrpgBotMemoryBlock({
  ledger: loadCampaignLedger(db, campaignId),
  sheets: loadSheetSnapshots(db, campaignId),
});

const report = {
  afterCommitItems: afterCommit.items,
  afterCommitNarration: afterCommit.narration,
  afterRegenItems: afterRegen.items,
  afterRegenNarration: afterRegen.narration,
  structuredInventoryAdds: afterRegen.structured.delta.players
    .filter((row) => (row.inventoryAdd ?? []).length)
    .map((row) => ({ participantId: row.participantId, inventoryAdd: row.inventoryAdd })),
  split: {
    sheetsStillHyun: (afterRegen.items["현"] ?? []).includes(LEDGER),
    sheetsSeohaEmpty: (afterRegen.items["서하"] ?? []).length === 0,
    narrationSaysSeoha: afterRegen.narration.includes("서하가 서류함에서 세관 밀수 원본 장부를 꺼내"),
    jsonGivesSeoha: afterRegen.structured.delta.players.some(
      (row) => row.participantId === seohaId && (row.inventoryAdd ?? []).includes(LEDGER)
    ),
  },
  regenInput: {
    header: afterRegen.regenInputHeader,
    sheetsCanon: afterRegen.regenInputHasSheetsCanon,
    hyunAlreadyHoldsLedger: afterRegen.regenInputHasHyunLedger,
    sameHyunAction: afterRegen.regenInputHasHyunAction,
  },
  nextGm: {
    hyunItems: nextGm.includes(`items=${LEDGER}`),
    seohaNarration: nextGm.includes("서하가 서류함에서 세관 밀수 원본 장부를 꺼내"),
    hyunCommitNarration: nextGm.includes("현이 철제 서류함을 열고"),
  },
  nextBot: {
    count: nextBots.length,
    seohaNarration: nextBots.some((user) => user.includes("서하가 서류함에서 세관 밀수 원본 장부를 꺼내")),
    botMemoryHasItems: botMemory.includes("items="),
  },
  memoryAfterRegenHasBoth:
    afterRegen.memoryAfterRegen.includes(`items=${LEDGER}`) &&
    afterRegen.memoryAfterRegen.includes("서하가 서류함에서 세관 밀수 원본 장부를 꺼내"),
};

console.log(JSON.stringify(report, null, 2));
db.close();

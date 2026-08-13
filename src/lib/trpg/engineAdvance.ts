import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { deductPoints, getPointBalance } from "@/lib/points";
import { paidCreatorRewardSpend, resolveCreatorRewardRate } from "@/lib/creatorPoints";
import { creditTrpgRoundCreatorRewards, loadTrpgCharacterRoyaltyTargets } from "./creatorRewards";
import { isTrpgActionType, resolveAdjudicationStat } from "./actionTypes";
import {
  computeTrpgRoundPoints,
  splitTrpgRoundCost,
  TRPG_BOT_USAGE_FALLBACK,
  TRPG_GM_USAGE_FALLBACK,
  type TrpgModelUsage,
} from "./billing";
import { buildTrpgBotActionUserBlock, sanitizeBotActionText, TRPG_BOT_SYSTEM } from "./botActions";
import { applyCampaignLedger, clipTrpgChars, loadCampaignLedger, persistCampaignLedger } from "./campaignLedger";
import { resolveTrpgRoll, rollServerD20 } from "./dice";
import { assertCanStart } from "./engineCreate";
import { callTrpgBot, callTrpgGm } from "./gmCall";
import { buildTrpgGmUserBlock, parseTrpgGmOutput, TRPG_GM_SYSTEM } from "./gmPrompt";
import { loadTrpgSnapshot } from "./engineSnapshot";
import { buildCampaignMemoryPrompt, buildTrpgBotMemoryBlock } from "./memory";
import { sealDroppedTrpgRounds, type TrpgMemoryCall } from "./memorySeal";
import { nextTrpgRoundWork, tryAcquireGmLock, tryBeginGmGeneration, type TrpgActorReady } from "./roundLock";
import { applyValidatedStateDelta } from "./sheetView";
import { loadSheetSnapshots, persistSheets } from "./engineSheets";
import { statModifier } from "./stats";
import {
  loadCampaign,
  loadLatestRound,
  loadParticipants,
  loadScenario,
  parseBotPersona,
  parseJson,
  setRoundPhase,
  type TrpgCampaignRow,
  type TrpgParticipantRow,
  type TrpgRoundRow,
} from "./store";
import { TRPG_ACTION_MAX_CHARS, TRPG_BOT_SCENE_MAX_CHARS, type TrpgActionSource, type TrpgBillingMode, type TrpgRoundPhase } from "./types";
import { isTrpgRoundPhase } from "./types";
import type { TrpgCampaignSnapshot } from "./snapshot";

export type TrpgEngineDeps = {
  gmCall?: (opts: { system: string; user: string }) => Promise<{ text: string; usage?: TrpgModelUsage }>;
  botCall?: (system: string, user: string) => Promise<{ text: string; usage?: TrpgModelUsage }>;
  memoryCall?: TrpgMemoryCall;
  rollD20?: () => number;
  skipBilling?: boolean;
};

function newRequestId(): string {
  return randomBytes(12).toString("hex");
}

function asPhase(value: string): TrpgRoundPhase {
  return isTrpgRoundPhase(value) ? value : "ERROR_RECOVERY";
}

function mustSnapshot(db: Database.Database, campaignId: number, userId: number): TrpgCampaignSnapshot {
  const snap = loadTrpgSnapshot(db, campaignId, userId);
  if (!snap) throw new Error("캠페인을 찾을 수 없습니다.");
  return snap;
}

export async function startTrpgCampaign(
  db: Database.Database,
  opts: { campaignId: number; userId: number; deps?: TrpgEngineDeps }
): Promise<TrpgCampaignSnapshot> {
  assertCanStart(db, opts.campaignId, opts.userId);
  const latest = loadLatestRound(db, opts.campaignId);
  const rid = newRequestId();
  let roundId: number;
  if (latest?.phase === "ERROR_RECOVERY" && latest.round_number === 0) {
    db.prepare(
      `UPDATE trpg_rounds
       SET phase='ROLLING', lock_holder_request_id=?, gm_generation_id=?, error_json=NULL, updated_at=datetime('now')
       WHERE id=?`
    ).run(rid, rid, latest.id);
    roundId = latest.id;
  } else {
    roundId = Number(
      db
        .prepare(
          `INSERT INTO trpg_rounds (campaign_id, round_number, phase, lock_holder_request_id, gm_generation_id)
           VALUES (?, 0, 'ROLLING', ?, ?)`
        )
        .run(opts.campaignId, rid, rid).lastInsertRowid
    );
  }

  try {
    const gm = await runGmForRound(db, {
      campaignId: opts.campaignId,
      roundId,
      opening: true,
      deps: { ...opts.deps, skipBilling: true },
    });
    const campaign = loadCampaign(db, opts.campaignId)!;
    const round = loadLatestRound(db, opts.campaignId)!;
    await completeGmRound(db, campaign, round, gm.campaignFinished, opts.deps);
  } catch (e) {
    db.prepare(`UPDATE trpg_rounds SET phase='ERROR_RECOVERY', error_json=? WHERE id=?`).run(
      JSON.stringify({ error: (e as Error).message }),
      roundId
    );
    throw e;
  }
  return mustSnapshot(db, opts.campaignId, opts.userId);
}

export function submitTrpgAction(
  db: Database.Database,
  opts: {
    campaignId: number;
    userId: number;
    body: string;
    actionType?: string | null;
    selectedStat?: string | null;
    idempotencyKey?: string | null;
  }
): void {
  const parts = loadParticipants(db, opts.campaignId);
  const me = parts.find((p) => p.user_id === opts.userId);
  if (!me) throw new Error("이 캠페인의 참가자가 아닙니다.");
  if (me.can_act !== 1 || me.status !== "active") throw new Error("지금은 행동할 수 없습니다.");
  const round = loadLatestRound(db, opts.campaignId);
  if (!round || round.phase !== "ACTION_INPUT") {
    throw new Error("지금은 행동을 제출할 수 없습니다.");
  }
  const text = opts.body.replace(/\s+/g, " ").trim();
  if (!text) throw new Error("행동을 입력하세요.");
  if (Array.from(text).length > TRPG_ACTION_MAX_CHARS) throw new Error("행동이 너무 깁니다.");
  const actionType = opts.actionType && isTrpgActionType(opts.actionType) ? opts.actionType : "free";
  upsertLockedAction(db, round.id, me.id, text, actionType, opts.selectedStat ?? null, "human", opts.idempotencyKey);
}

export function hostFillBotAction(
  db: Database.Database,
  opts: { campaignId: number; userId: number; participantId: number; body: string }
): void {
  const campaign = loadCampaign(db, opts.campaignId);
  if (!campaign || campaign.host_user_id !== opts.userId) {
    throw new Error("방장만 봇 행동을 입력할 수 있습니다.");
  }
  const round = loadLatestRound(db, opts.campaignId);
  if (!round || (round.phase !== "BOT_ACTION" && round.phase !== "ACTION_INPUT")) {
    throw new Error("지금은 봇 행동을 넣을 수 없습니다.");
  }
  const bot = loadParticipants(db, opts.campaignId).find((p) => p.id === opts.participantId);
  if (!bot || bot.kind !== "ai_character") throw new Error("AI 캐릭터가 아닙니다.");
  const text = sanitizeBotActionText(opts.body, TRPG_ACTION_MAX_CHARS);
  if (!text) throw new Error("행동을 입력하세요.");
  upsertLockedAction(db, round.id, bot.id, text, "free", null, "host_fill");
}

function upsertLockedAction(
  db: Database.Database,
  roundId: number,
  participantId: number,
  body: string,
  actionType: string,
  selectedStat: string | null,
  source: TrpgActionSource,
  idempotencyKey?: string | null
): void {
  const existing = db
    .prepare(`SELECT id, locked FROM trpg_action_submissions WHERE round_id=? AND participant_id=?`)
    .get(roundId, participantId) as { id: number; locked: number } | undefined;
  if (existing?.locked === 1) {
    if (source === "human") throw new Error("이미 제출했습니다.");
    return;
  }
  if (existing) {
    db.prepare(
      `UPDATE trpg_action_submissions
       SET body=?, action_type=?, selected_stat=?, locked=1, source=?, idempotency_key=?, updated_at=datetime('now')
       WHERE id=?`
    ).run(body, actionType, selectedStat, source, idempotencyKey ?? null, existing.id);
    return;
  }
  db.prepare(
    `INSERT INTO trpg_action_submissions
      (round_id, participant_id, body, action_type, selected_stat, locked, source, idempotency_key)
     VALUES (?,?,?,?,?,1,?,?)`
  ).run(roundId, participantId, body, actionType, selectedStat, source, idempotencyKey ?? null);
}

export async function advanceTrpgCampaign(
  db: Database.Database,
  opts: { campaignId: number; userId: number; deps?: TrpgEngineDeps }
): Promise<TrpgCampaignSnapshot> {
  const campaign = loadCampaign(db, opts.campaignId);
  if (!campaign) throw new Error("캠페인을 찾을 수 없습니다.");
  const parts = loadParticipants(db, opts.campaignId);
  if (!parts.some((p) => p.user_id === opts.userId) && campaign.host_user_id !== opts.userId) {
    throw new Error("이 캠페인의 참가자가 아닙니다.");
  }
  const round = loadLatestRound(db, opts.campaignId);
  if (!round) return mustSnapshot(db, opts.campaignId, opts.userId);
  const phase = asPhase(round.phase);

  if (phase === "ERROR_RECOVERY" && campaign.host_user_id === opts.userId && round.round_number > 0) {
    const rid = newRequestId();
    db.prepare(
      `UPDATE trpg_rounds
       SET phase='ROLLING', lock_holder_request_id=?, gm_generation_id=NULL, error_json=NULL, updated_at=datetime('now')
       WHERE id=?`
    ).run(rid, round.id);
    if (!tryBeginGmGeneration(db, round.id, rid)) {
      return mustSnapshot(db, opts.campaignId, opts.userId);
    }
    try {
      const gm = await runGmForRound(db, {
        campaignId: campaign.id,
        roundId: round.id,
        opening: false,
        deps: opts.deps,
      });
      await completeGmRound(db, campaign, round, gm.campaignFinished, opts.deps);
    } catch (e) {
      db.prepare(`UPDATE trpg_rounds SET phase='ERROR_RECOVERY', error_json=? WHERE id=?`).run(
        JSON.stringify({ error: (e as Error).message }),
        round.id
      );
    }
    return mustSnapshot(db, opts.campaignId, opts.userId);
  }

  const actors = actorsForRound(db, parts, round.id);
  const work = nextTrpgRoundWork({
    phase,
    humans: actors.filter((a) => a.kind === "human"),
    bots: actors.filter((a) => a.kind === "ai_character"),
    botGenerateFailed: round.error_json?.includes('"bot"') === true,
  });

  if (work.type === "generate_bots") {
    if (phase === "ACTION_INPUT") setRoundPhase(db, round.id, "BOT_ACTION");
    try {
      await generateBotActions(db, { campaign, roundId: round.id, botIds: work.botIds, deps: opts.deps });
      db.prepare(`UPDATE trpg_rounds SET error_json=NULL WHERE id=?`).run(round.id);
    } catch (e) {
      db.prepare(`UPDATE trpg_rounds SET error_json=? WHERE id=?`).run(
        JSON.stringify({ bot: (e as Error).message }),
        round.id
      );
      return mustSnapshot(db, opts.campaignId, opts.userId);
    }
    return advanceTrpgCampaign(db, opts);
  }

  if (work.type === "acquire_gm_lock") {
    const rid = newRequestId();
    if (!tryAcquireGmLock(db, round.id, rid)) {
      return mustSnapshot(db, opts.campaignId, opts.userId);
    }
    persistRolls(db, campaign.id, round.id, opts.deps);
    if (!tryBeginGmGeneration(db, round.id, rid)) {
      return mustSnapshot(db, opts.campaignId, opts.userId);
    }
    try {
      const gm = await runGmForRound(db, {
        campaignId: campaign.id,
        roundId: round.id,
        opening: false,
        deps: opts.deps,
      });
      await completeGmRound(db, campaign, round, gm.campaignFinished, opts.deps);
    } catch (e) {
      db.prepare(`UPDATE trpg_rounds SET phase='ERROR_RECOVERY', error_json=? WHERE id=?`).run(
        JSON.stringify({ error: (e as Error).message }),
        round.id
      );
    }
  }

  return mustSnapshot(db, opts.campaignId, opts.userId);
}

function actorsForRound(
  db: Database.Database,
  parts: TrpgParticipantRow[],
  roundId: number
): TrpgActorReady[] {
  const submitted = new Set(
    (
      db
        .prepare(`SELECT participant_id FROM trpg_action_submissions WHERE round_id=? AND locked=1`)
        .all(roundId) as { participant_id: number }[]
    ).map((r) => r.participant_id)
  );
  return parts.map((p) => ({
    id: p.id,
    kind: p.kind === "ai_character" ? "ai_character" : "human",
    canAct: p.can_act === 1 && p.status === "active",
    submitted: submitted.has(p.id),
  }));
}

async function generateBotActions(
  db: Database.Database,
  opts: {
    campaign: TrpgCampaignRow;
    roundId: number;
    botIds: number[];
    deps?: TrpgEngineDeps;
  }
): Promise<void> {
  const prev = previousNarration(db, opts.campaign.id);
  const humans = db
    .prepare(
      `SELECT s.body, p.display_name AS name
       FROM trpg_action_submissions s
       JOIN trpg_participants p ON p.id = s.participant_id
       WHERE s.round_id=? AND p.kind='human' AND s.locked=1`
    )
    .all(opts.roundId) as { body: string; name: string }[];
  const botCall =
    opts.deps?.botCall ??
    (async (system: string, user: string) => callTrpgBot({ system, user }));

  for (const botId of opts.botIds) {
    const bot = loadParticipants(db, opts.campaign.id).find((p) => p.id === botId);
    if (!bot) continue;
    let description = "";
    let greeting = "";
    let systemPrompt = "";
    if (bot.character_id) {
      const ch = db
        .prepare(`SELECT system_prompt, description, greeting FROM characters WHERE id=?`)
        .get(bot.character_id) as
        | { system_prompt: string | null; description: string | null; greeting: string | null }
        | undefined;
      description = ch?.description?.trim() || "";
      greeting = ch?.greeting?.trim() || "";
      systemPrompt = ch?.system_prompt?.trim() || "";
    } else {
      const persona = parseBotPersona(bot.persona_json);
      description = persona?.description.trim() || "";
      greeting = persona?.greeting.trim() || "";
      systemPrompt = persona?.systemPrompt.trim() || "";
    }
    const user = buildTrpgBotActionUserBlock({
      characterName: bot.display_name,
      description,
      greeting,
      systemPrompt,
      previousGmNarration: clipTrpgChars(prev, TRPG_BOT_SCENE_MAX_CHARS),
      campaignMemory: buildTrpgBotMemoryBlock({
        ledger: loadCampaignLedger(db, opts.campaign.id),
        sheets: loadSheetSnapshots(db, opts.campaign.id).map((s) => ({
          name: s.name,
          hp: s.hp,
          maxHp: s.maxHp,
          conditions: s.conditions,
        })),
      }),
      humanActions: humans.map((h) => ({ playerName: h.name, text: h.body })),
    });
    const { text, usage } = await botCall(TRPG_BOT_SYSTEM, user);
    const body =
      sanitizeBotActionText(text, TRPG_ACTION_MAX_CHARS) ||
      `${bot.display_name}은 상황을 살피며 한 발 다가선다.`;
    upsertLockedAction(db, opts.roundId, bot.id, body, "free", null, "bot_model");
    appendRoundUsage(db, opts.roundId, usage ?? TRPG_BOT_USAGE_FALLBACK);
  }
}

function previousNarration(db: Database.Database, campaignId: number): string {
  const row = db
    .prepare(
      `SELECT g.narration FROM trpg_gm_messages g
       JOIN trpg_rounds r ON r.id = g.round_id
       WHERE r.campaign_id=? ORDER BY r.round_number DESC LIMIT 1`
    )
    .get(campaignId) as { narration: string } | undefined;
  return row?.narration ?? "";
}

function persistRolls(
  db: Database.Database,
  campaignId: number,
  roundId: number,
  deps?: TrpgEngineDeps
): void {
  const existing = db.prepare(`SELECT 1 FROM trpg_dice_rolls WHERE round_id=? LIMIT 1`).get(roundId);
  if (existing) return;
  const scenario = loadScenario(db, campaignId);
  const subs = db
    .prepare(
      `SELECT s.id, s.participant_id, s.action_type, s.selected_stat, s.body
       FROM trpg_action_submissions s WHERE s.round_id=? AND s.locked=1`
    )
    .all(roundId) as {
    id: number;
    participant_id: number;
    action_type: string | null;
    selected_stat: string | null;
    body: string;
  }[];
  const ins = db.prepare(
    `INSERT INTO trpg_dice_rolls
      (round_id, submission_id, d20, stat_key, stat_modifier, final_score, dc, tier)
     VALUES (?,?,?,?,?,?,?,?)`
  );
  db.transaction(() => {
    for (const sub of subs) {
      const actionType = sub.action_type && isTrpgActionType(sub.action_type) ? sub.action_type : "free";
      const statKey = resolveAdjudicationStat({
        actionType,
        selectedStat: sub.selected_stat,
        defs: scenario.statDefs,
      });
      const statRow = db
        .prepare(
          `SELECT st.value FROM trpg_character_stats st
           JOIN trpg_character_sheets sh ON sh.id = st.sheet_id
           WHERE sh.participant_id=? AND st.stat_key=?`
        )
        .get(sub.participant_id, statKey) as { value: number } | undefined;
      const d20 = deps?.rollD20?.() ?? rollServerD20();
      const result = resolveTrpgRoll({
        d20,
        statModifier: statModifier(statRow?.value ?? 5),
        dc: scenario.diceRules.dc,
        rules: scenario.diceRules,
      });
      ins.run(
        roundId,
        sub.id,
        result.d20,
        statKey,
        statModifier(statRow?.value ?? 5),
        result.finalScore,
        result.dc,
        result.tier
      );
    }
    setRoundPhase(db, roundId, "ROLLING");
    db.prepare(`UPDATE trpg_rounds SET input_snapshot_json=? WHERE id=?`).run(
      JSON.stringify({ submissions: subs.map((s) => ({ id: s.id, body: s.body })) }),
      roundId
    );
  })();
}

async function runGmForRound(
  db: Database.Database,
  opts: {
    campaignId: number;
    roundId: number;
    opening: boolean;
    deps?: TrpgEngineDeps;
  }
): Promise<{ campaignFinished: boolean }> {
  const campaign = loadCampaign(db, opts.campaignId);
  if (!campaign) throw new Error("캠페인을 찾을 수 없습니다.");
  const scenario = loadScenario(db, opts.campaignId);
  const memory = buildCampaignMemoryPrompt(db, opts.campaignId);
  const actions = loadActionsForGm(db, opts.roundId);
  const user = buildTrpgGmUserBlock({
    worldBrief: campaign.world_brief,
    gmSecret: campaign.gm_secret ?? "",
    memoryBlock: memory,
    opening: opts.opening,
    actions,
  });
  const gmCall = opts.deps?.gmCall ?? callTrpgGm;
  const { text, usage } = await gmCall({ system: TRPG_GM_SYSTEM, user });
  appendRoundUsage(db, opts.roundId, usage ?? TRPG_GM_USAGE_FALLBACK);
  const parsed = parseTrpgGmOutput(text);
  const sheets = loadSheetSnapshots(db, opts.campaignId);
  const applied = applyValidatedStateDelta(sheets, parsed.delta);
  const nextSheets = applied.ok ? applied.next : sheets;
  const roundNumber = (
    db.prepare(`SELECT round_number FROM trpg_rounds WHERE id=?`).get(opts.roundId) as { round_number: number }
  ).round_number;
  const ledger = applyCampaignLedger(loadCampaignLedger(db, opts.campaignId), {
    ...parsed.delta,
    location: parsed.location || parsed.delta.location || nextSheets[0]?.location || scenario.startLocation,
    nextRoundContext: parsed.nextRoundContext || parsed.delta.nextRoundContext,
    campaignFinished: parsed.campaignFinished,
  });

  db.transaction(() => {
    db.prepare(
      `INSERT INTO trpg_gm_messages (round_id, narration, structured_json) VALUES (?,?,?)
       ON CONFLICT(round_id) DO UPDATE SET narration=excluded.narration, structured_json=excluded.structured_json`
    ).run(opts.roundId, parsed.narration, JSON.stringify(parsed));
    if (applied.ok) {
      persistSheets(db, nextSheets);
      db.prepare(
        `INSERT OR IGNORE INTO trpg_state_change_log (campaign_id, round_id, idempotency_key, applied_json)
         VALUES (?,?,?,?)`
      ).run(opts.campaignId, opts.roundId, `delta:${opts.roundId}`, JSON.stringify(parsed.delta));
    }
    persistCampaignLedger(db, opts.campaignId, roundNumber, ledger);
    setRoundPhase(db, opts.roundId, "APPLYING_STATE");
    if (!opts.opening) maybeBillRound(db, campaign, opts.roundId, opts.deps?.skipBilling === true);
  })();
  return { campaignFinished: parsed.campaignFinished === true };
}

async function completeGmRound(
  db: Database.Database,
  campaign: TrpgCampaignRow,
  round: TrpgRoundRow,
  campaignFinished: boolean,
  deps?: TrpgEngineDeps
): Promise<void> {
  if (campaignFinished) {
    db.transaction(() => {
      setRoundPhase(db, round.id, "ROUND_COMPLETE");
      db.prepare(`UPDATE trpg_campaigns SET status='CAMPAIGN_COMPLETE', updated_at=datetime('now') WHERE id=?`).run(
        campaign.id
      );
    })();
  } else {
    beginNextActionRound(db, campaign, round);
  }
  await sealDroppedTrpgRounds(db, campaign.id, deps?.memoryCall);
}

function beginNextActionRound(db: Database.Database, campaign: TrpgCampaignRow, round: TrpgRoundRow): void {
  db.transaction(() => {
    setRoundPhase(db, round.id, "ROUND_COMPLETE");
    db.prepare(`INSERT INTO trpg_rounds (campaign_id, round_number, phase) VALUES (?, ?, 'ACTION_INPUT')`).run(
      campaign.id,
      round.round_number + 1
    );
    db.prepare(`UPDATE trpg_campaigns SET status='ACTION_INPUT', updated_at=datetime('now') WHERE id=?`).run(
      campaign.id
    );
  })();
}

function loadRoundUsage(db: Database.Database, roundId: number): TrpgModelUsage[] {
  const row = db.prepare(`SELECT usage_json FROM trpg_rounds WHERE id=?`).get(roundId) as
    | { usage_json: string | null }
    | undefined;
  return parseJson(row?.usage_json, [] as TrpgModelUsage[]);
}

function appendRoundUsage(db: Database.Database, roundId: number, usage: TrpgModelUsage): void {
  const next = [...loadRoundUsage(db, roundId), usage];
  db.prepare(`UPDATE trpg_rounds SET usage_json=? WHERE id=?`).run(JSON.stringify(next), roundId);
}

function maybeBillRound(
  db: Database.Database,
  campaign: TrpgCampaignRow,
  roundId: number,
  skip: boolean
): void {
  const row = db.prepare(`SELECT COALESCE(billed,0) AS billed FROM trpg_rounds WHERE id=?`).get(roundId) as {
    billed: number;
  };
  if (row.billed === 1) return;
  if (skip) {
    db.prepare(`UPDATE trpg_rounds SET billed=1, billed_points=0 WHERE id=?`).run(roundId);
    return;
  }
  const calls = loadRoundUsage(db, roundId);
  const totalPoints = computeTrpgRoundPoints(calls.length ? calls : [TRPG_GM_USAGE_FALLBACK]);
  const humans = loadParticipants(db, campaign.id)
    .filter((p) => p.kind === "human" && p.user_id)
    .map((p) => p.user_id!);
  const shares = splitTrpgRoundCost({
    totalPoints,
    humanUserIds: humans,
    hostUserId: campaign.host_user_id,
    mode: campaign.billing_mode as TrpgBillingMode,
  });
  for (const share of shares) {
    if (share.points <= 0) continue;
    if (getPointBalance(share.userId).total < share.points) {
      throw new Error("포인트가 부족합니다.");
    }
  }
  for (const share of shares) {
    if (share.points <= 0) continue;
    const result = deductPoints(share.userId, share.points, `trpg-round:${roundId}`);
    const paidSpend = paidCreatorRewardSpend(result.slices);
    if (paidSpend <= 0) continue;
    const authorUserId = campaign.author_user_id ?? null;
    creditTrpgRoundCreatorRewards(db, {
      campaignId: campaign.id,
      roundId,
      consumerUserId: share.userId,
      paidSpend,
      authorUserId,
      authorRate: authorUserId ? resolveCreatorRewardRate(authorUserId) : 0,
      characterCreators: loadTrpgCharacterRoyaltyTargets(db, campaign.id),
    });
  }
  db.prepare(`UPDATE trpg_rounds SET billed=1, billed_points=? WHERE id=?`).run(totalPoints, roundId);
}

function loadActionsForGm(db: Database.Database, roundId: number) {
  return (
    db
      .prepare(
        `SELECT s.participant_id, p.display_name AS name, s.body, r.stat_key, r.d20, r.final_score, r.dc, r.tier
         FROM trpg_action_submissions s
         JOIN trpg_participants p ON p.id = s.participant_id
         LEFT JOIN trpg_dice_rolls r ON r.submission_id = s.id
         WHERE s.round_id=? AND s.locked=1`
      )
      .all(roundId) as Array<{
      participant_id: number;
      name: string;
      body: string;
      stat_key: string | null;
      d20: number | null;
      final_score: number | null;
      dc: number | null;
      tier: string | null;
    }>
  ).map((a) => ({
    participantId: a.participant_id,
    name: a.name,
    body: a.body,
    statKey: a.stat_key ?? "dex",
    d20: a.d20,
    finalScore: a.final_score,
    dc: a.dc,
    tier: a.tier,
  }));
}

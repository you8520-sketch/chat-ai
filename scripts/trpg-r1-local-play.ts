/**
 * TRPG R1 — local-only end-to-end play for the minimal progression slice.
 *
 * Uses a local copy of the app DB, the real registered companion card
 * (read-only extracted to JSON), and the real admin persona (read-only
 * extracted to JSON). Every run gets a fresh directory; nothing is overwritten.
 *
 *   $env:TRPG_R1_CHARACTER_JSON="...character-15.json"
 *   $env:TRPG_R1_PERSONA_JSON="...personas.json"
 *   node --conditions=react-server --import tsx scripts/trpg-r1-local-play.ts
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { callTrpgBot, callTrpgGm } from "../src/lib/trpg/gmCall";
import { answerTrpgGoalClaim } from "../src/lib/trpg/goalConfirm";
import { loadCampaignLedger, persistCampaignLedger } from "../src/lib/trpg/campaignLedger";
import type { TrpgGoal } from "../src/lib/trpg/campaignGoals";
import { createTrpgCampaign, saveTrpgSheet } from "../src/lib/trpg/engineCreate";
import {
  advanceTrpgCampaign,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "../src/lib/trpg/engineAdvance";
import { loadTrpgSnapshot } from "../src/lib/trpg/engineSnapshot";
import { loadExplorationState } from "../src/lib/trpg/explorationStore";
import { spendTrpgStatPoint } from "../src/lib/trpg/progression";
import { ensureTrpgTables } from "../src/lib/trpg/schema";
import { insertScenarioTemplate } from "../src/lib/trpg/scenarioTemplates";
import type { TrpgScenarioPlan } from "../src/lib/trpg/scenarioPlan";
import type { TrpgScenarioNpc } from "../src/lib/trpg/scenarioTypes";
import type { TrpgModelUsage } from "../src/lib/trpg/billing";
import { loadEnvLocal } from "./load-env-local";

type PlayCommand = { op: "move"; label: string } | { op: "search"; depth: "normal" | "careful" };
type PlayStep = { round: number; body: string; commands: PlayCommand[]; purpose: string };
type Fixture = {
  schema: string;
  template: {
    title: string;
    summary: string;
    content: string;
    secretContent: string;
    visibility: string;
    startInventory: string[];
    defaultPcStats: Record<string, number>;
    statKeys: string[];
    npcs: TrpgScenarioNpc[];
    scenarioPlan: TrpgScenarioPlan;
  };
  playPlan: PlayStep[];
  goalSeed?: {
    title: string;
    criterion: { type: "reach_location"; place: string } | { type: "end_encounter"; encounterId: string };
  } | null;
};

type GmCallRecord = {
  index: number;
  opening: boolean;
  system: string;
  user: string;
  text: string;
  usage?: TrpgModelUsage;
  finishReason?: string | null;
  semanticDone?: boolean;
  elapsedMs: number;
};

type BotCallRecord = {
  index: number;
  system: string;
  user: string;
  text: string;
  usage?: TrpgModelUsage;
  elapsedMs: number;
};

const ROOT = resolve(".");
const GROUNDING_DB = resolve(process.env.TRPG_R1_GROUNDING_DB ?? "C:/HAV/data/app.db");
const CHARACTER_JSON = process.env.TRPG_R1_CHARACTER_JSON ?? "C:/Users/you85/AppData/Local/Temp/opencode/r1-readonly/character-15.json";
const PERSONA_JSON = process.env.TRPG_R1_PERSONA_JSON ?? "C:/Users/you85/AppData/Local/Temp/opencode/r1-readonly/personas.json";

function loadFixture(): Fixture {
  return JSON.parse(
    readFileSync(resolve("docs/architecture/trpg-vnext/fixtures/trpg-r1-lighthouse-adventure.json"), "utf8")
  ) as Fixture;
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(value: string, max: number): string {
  return Array.from(value).slice(0, max).join("");
}

function setup(db: Database.Database, fixture: Fixture, runId: string) {
  const admin = db
    .prepare(`SELECT id, email, nickname FROM users WHERE is_admin=1 ORDER BY id LIMIT 1`)
    .get() as { id: number; email: string; nickname: string } | undefined;
  if (!admin) throw new Error("No local admin user found in the copied DB.");
  db.prepare(`UPDATE users SET is_adult=1 WHERE id=?`).run(admin.id);

  const rawCharacter = JSON.parse(readFileSync(CHARACTER_JSON, "utf8")) as Record<string, unknown>;
  const rawPersonas = JSON.parse(readFileSync(PERSONA_JSON, "utf8")) as {
    personas: Array<Record<string, unknown>>;
  };
  const rawPersona = rawPersonas.personas.find((row) => Number(row.id) === 1) ?? rawPersonas.personas[0];
  if (!rawPersona) throw new Error("No admin persona found in the read-only persona JSON.");

  const name = String(rawCharacter.name ?? "권태현");
  const description = clip(stripHtml(String(rawCharacter.description ?? "")), 8000);
  const systemPrompt = clip(
    String(rawCharacter.system_prompt ?? "")
      .split("■ NSFW 규칙")[0]!
      .trim(),
    12000
  );
  const world = clip(stripHtml(String(rawCharacter.world ?? "")), 4000);
  const greeting = clip(String(rawCharacter.greeting ?? ""), 4000);

  db.prepare(`DELETE FROM characters WHERE id=15`).run();
  db.prepare(
    `INSERT INTO characters
      (id, name, tagline, description, greeting, system_prompt, genre, tags, nsfw, official,
       creator_id, creator_name, visibility, moderation_status, trpg_reuse_allowed, world, gender, world_id)
     VALUES (?,?,?,?,?,?,?,?,0,0,?,?,?,?,1,?,?,NULL)`
  ).run(
    15,
    name,
    String(rawCharacter.tagline ?? ""),
    description,
    greeting,
    systemPrompt,
    "post-apocalypse",
    "아포칼립스, 크리쳐, 사냥꾼",
    admin.id,
    "R1 local read-only fixture",
    "public",
    "approved",
    world,
    rawCharacter.gender === "male" ? "male" : "other"
  );

  const templateId = insertScenarioTemplate(db, admin.id, {
    title: `${fixture.template.title} ${runId}`,
    summary: fixture.template.summary,
    content: fixture.template.content,
    secretContent: fixture.template.secretContent,
    visibility: "private",
    startInventory: fixture.template.startInventory,
    defaultPcStats: fixture.template.defaultPcStats,
    statKeys: fixture.template.statKeys,
    npcs: fixture.template.npcs,
    characterIds: [],
    genres: ["mystery", "sea"],
    assets: [],
    scenarioPlan: fixture.template.scenarioPlan,
  });

  const hostPersona = {
    personaId: Number(rawPersona.id) || 1,
    name: String(rawPersona.name ?? "렌"),
    description: String(rawPersona.description ?? ""),
    gender: rawPersona.gender === "male" ? ("male" as const) : ("other" as const),
    speechExamples: String(rawPersona.speech_examples ?? ""),
  };

  const campaignId = createTrpgCampaign(db, {
    hostUserId: admin.id,
    hostNickname: hostPersona.name,
    hostPersona,
    viewerUserId: admin.id,
    templateId,
    title: fixture.template.title,
    characterIds: [15],
  });

  saveTrpgSheet(db, {
    campaignId,
    userId: admin.id,
    name: hostPersona.name,
    stats: { str: 8, dex: 9, con: 8, int: 7, wis: 7, cha: 6 },
  });

  if (fixture.goalSeed) {
    const ledger = loadCampaignLedger(db, campaignId);
    const goal: TrpgGoal = {
      id: "goal-beacon-shadow",
      title: fixture.goalSeed.title,
      status: "active",
      source: "legacy",
      createdRound: 0,
      criterion: fixture.goalSeed.criterion,
    };
    ledger.quests = [fixture.goalSeed.title];
    ledger.goals = [goal];
    persistCampaignLedger(db, campaignId, 0, ledger);
  }

  const meta = {
    runId,
    dbPath: join(ROOT, "tmp/trpg-r1-play", runId, "app.db"),
    campaignId,
    adminId: admin.id,
    templateId,
    characterId: 15,
    characterSource: "read-only /api/characters/15",
    personaSource: "read-only /api/personas (id 1)",
    characterTrim: "HTML stripped; NSFW section removed for the local non-sexual scenario; local clone only",
    createdAt: new Date().toISOString(),
  };
  writeFileSync(join(ROOT, "tmp/trpg-r1-play", runId, "meta.json"), JSON.stringify(meta, null, 2), "utf8");
  return meta;
}

function roomPublicId(db: Database.Database, campaignId: number, adminId: number, label: string): string {
  const snapshot = loadTrpgSnapshot(db, campaignId, adminId);
  const publicRoom = snapshot?.exploration?.rooms.find((room) => room.label === label);
  if (publicRoom) return publicRoom.id;
  const internal = loadExplorationState(db, campaignId);
  const room = internal?.map.rooms.find((row) => (row.name ?? row.id) === label);
  if (room) return room.publicId;
  throw new Error(`Room label not found: ${label}`);
}

function snapshotSummary(snapshot: NonNullable<ReturnType<typeof loadTrpgSnapshot>>) {
  return {
    campaignStatus: snapshot.campaignStatus,
    storyPhase: snapshot.storyPhase,
    round: snapshot.round,
    goals: snapshot.goals,
    sheets: snapshot.sheets.map((row) => ({
      participantId: row.participantId,
      name: row.sheet.name,
      level: row.sheet.level,
      xp: row.sheet.xp ?? 0,
      statPoints: row.sheet.statPoints ?? 0,
      hp: row.sheet.hp,
      maxHp: row.sheet.maxHp,
      location: row.sheet.location,
      inventory: row.sheet.inventory.map((item) => `${item.name} x${item.quantity}`),
      stats: row.sheet.stats,
    })),
    combat: snapshot.combat ?? null,
    actionPlanWarnings: snapshot.actionPlanWarnings ?? [],
    myDraft: snapshot.myDraft,
    currentRolls: snapshot.currentRolls,
    lastBilledPoints: snapshot.lastBilledPoints,
    narrationTail: (snapshot.currentNarration ?? "").slice(-1600),
  };
}

function loadPlanRows(db: Database.Database, roundId: number) {
  return db
    .prepare(
      `SELECT s.participant_id, p.kind, p.display_name, s.body, s.action_type, s.action_plan_json,
              s.idempotency_key, s.locked
       FROM trpg_action_submissions s
       JOIN trpg_participants p ON p.id=s.participant_id
       WHERE s.round_id=? ORDER BY s.id`
    )
    .all(roundId);
}

async function main() {
  loadEnvLocal();
  process.env.NODE_TEST_CONTEXT = process.env.NODE_TEST_CONTEXT || "1";
  const runId =
    process.argv.find((arg) => arg.startsWith("--run-id="))?.split("=")[1] ??
    new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = join(ROOT, "tmp/trpg-r1-play", runId);
  if (existsSync(outDir)) throw new Error(`Run directory already exists: ${outDir}`);
  const setupOnly = process.argv.includes("--setup-only");
  mkdirSync(outDir, { recursive: true });
  const dbPath = join(outDir, "app.db");
  copyFileSync(GROUNDING_DB, dbPath);
  const db = new Database(dbPath);
  ensureTrpgTables(db);
  const fixture = loadFixture();
  const meta = setup(db, fixture, runId);
  console.log(JSON.stringify({ phase: "setup", ...meta }, null, 2));
  if (setupOnly) {
    const snapshot = loadTrpgSnapshot(db, meta.campaignId, meta.adminId);
    console.log(JSON.stringify({ phase: "setup-only", snapshot: snapshot ? snapshotSummary(snapshot) : null }, null, 2));
    db.close();
    return;
  }

  const gmCalls: GmCallRecord[] = [];
  const botCalls: BotCallRecord[] = [];
  const rolls: Array<{ index: number; value: number }> = [];
  const rollQueue = [18, 17, 16, 17, 18, 12, 12, 12, 12, 12, 12];
  const deps: TrpgEngineDeps = {
    skipBilling: true,
    rollD20: () => {
      const value = rollQueue.shift() ?? 12;
      rolls.push({ index: rolls.length + 1, value });
      return value;
    },
    gmCall: async ({ system, user, stream }) => {
      const started = Date.now();
      const result = await callTrpgGm({
        system,
        user,
        stream,
        timeoutMs: 300_000,
        persistProviderCostInTests: false,
      });
      gmCalls.push({
        index: gmCalls.length + 1,
        opening: gmCalls.length === 0,
        system,
        user,
        text: result.text,
        usage: result.usage,
        finishReason: result.finishReason,
        semanticDone: result.semanticDone,
        elapsedMs: Date.now() - started,
      });
      writeFileSync(join(outDir, "gm-calls.json"), JSON.stringify(gmCalls, null, 2), "utf8");
      console.log(
        JSON.stringify({
          gmCall: gmCalls.length,
          elapsedMs: gmCalls.at(-1)!.elapsedMs,
          inputTokens: result.usage?.inputTokens,
          outputTokens: result.usage?.outputTokens,
          upstreamCostUsd: result.usage?.upstreamCostUsd,
          finishReason: result.finishReason,
        })
      );
      return result;
    },
    botCall: async (system, user) => {
      const started = Date.now();
      const result = await callTrpgBot({
        system,
        user,
        timeoutMs: 180_000,
        persistProviderCostInTests: false,
      });
      botCalls.push({
        index: botCalls.length + 1,
        system,
        user,
        text: result.text,
        usage: result.usage,
        elapsedMs: Date.now() - started,
      });
      writeFileSync(join(outDir, "bot-calls.json"), JSON.stringify(botCalls, null, 2), "utf8");
      console.log(
        JSON.stringify({
          botCall: botCalls.length,
          elapsedMs: botCalls.at(-1)!.elapsedMs,
          inputTokens: result.usage?.inputTokens,
          outputTokens: result.usage?.outputTokens,
          upstreamCostUsd: result.usage?.upstreamCostUsd,
        })
      );
      return result;
    },
  };

  let snapshot = loadTrpgSnapshot(db, meta.campaignId, meta.adminId);
  if (!snapshot) throw new Error("Campaign snapshot not found.");
  snapshot = await startTrpgCampaign(db, { campaignId: meta.campaignId, userId: meta.adminId, deps });
  writeFileSync(join(outDir, "round-0-opening.json"), JSON.stringify(snapshotSummary(snapshot), null, 2), "utf8");
  console.log(JSON.stringify({ phase: "opened", ...snapshotSummary(snapshot) }, null, 2));

  for (const step of fixture.playPlan) {
    if (snapshot.campaignStatus === "CAMPAIGN_COMPLETE") break;
    const currentRound = snapshot.round?.number ?? 0;
    if (currentRound > step.round) continue;
    const commands = step.commands.map((command) =>
      command.op === "move"
        ? { op: "move" as const, roomId: roomPublicId(db, meta.campaignId, meta.adminId, command.label) }
        : { op: "search" as const, depth: command.depth }
    );
    console.log(JSON.stringify({ phase: "submit", round: step.round, body: step.body, commands, purpose: step.purpose }));
    submitTrpgAction(db, {
      campaignId: meta.campaignId,
      userId: meta.adminId,
      body: step.body,
      explorationCommands: commands,
      idempotencyKey: `trpg-r1-${runId}-r${step.round}`,
      inputOrigin: "manual",
    });
    try {
      submitTrpgAction(db, {
        campaignId: meta.campaignId,
        userId: meta.adminId,
        body: step.body,
        explorationCommands: commands,
        idempotencyKey: `trpg-r1-${runId}-r${step.round}`,
        inputOrigin: "manual",
      });
      throw new Error("Duplicate submit was accepted.");
    } catch (error) {
      const message = (error as Error).message;
      if (message === "Duplicate submit was accepted.") throw error;
      writeFileSync(join(outDir, `round-${step.round}-duplicate.json`), JSON.stringify({ rejected: true, message }, null, 2), "utf8");
    }

    snapshot = await advanceTrpgCampaign(db, { campaignId: meta.campaignId, userId: meta.adminId, deps });
    writeFileSync(join(outDir, `round-${step.round}-state.json`), JSON.stringify(snapshotSummary(snapshot), null, 2), "utf8");
    const roundId = snapshot.round?.id;
    if (roundId) {
      const roundRow = db.prepare(`SELECT round_number FROM trpg_rounds WHERE id=?`).get(roundId) as { round_number: number } | undefined;
      const previousRound = db.prepare(`SELECT id FROM trpg_rounds WHERE campaign_id=? AND round_number=?`).get(meta.campaignId, step.round) as { id: number } | undefined;
      if (previousRound) {
        const plans = loadPlanRows(db, previousRound.id);
        writeFileSync(join(outDir, `round-${step.round}-plans.json`), JSON.stringify(plans, null, 2), "utf8");
      }
      const mechanics = db.prepare(`SELECT resolution_json FROM trpg_mechanics_resolutions WHERE campaign_id=? AND round_id=?`).get(meta.campaignId, previousRound?.id ?? -1) as { resolution_json: string } | undefined;
      if (mechanics) {
        writeFileSync(join(outDir, `round-${step.round}-mechanics.json`), mechanics.resolution_json, "utf8");
      }
    }
    console.log(JSON.stringify({ phase: "advanced", ...snapshotSummary(snapshot) }, null, 2));

    {
      const claims = (snapshot.goals ?? []).filter(
        (goal) => goal.status === "active" && goal.claimed && goal.confirmable && goal.claimedRound != null
      );
      for (const goal of claims) {
        const confirmed = answerTrpgGoalClaim(db, {
          campaignId: meta.campaignId,
          userId: meta.adminId,
          goalId: goal.id,
          claimedRound: goal.claimedRound!,
          decision: "confirm",
        });
        snapshot = confirmed.campaign;
        writeFileSync(join(outDir, `round-${step.round}-goal-confirm.json`), JSON.stringify(confirmed, null, 2), "utf8");
        console.log(
          JSON.stringify({
            phase: "goal-confirm",
            goalId: goal.id,
            claimedRound: goal.claimedRound,
            outcome: confirmed.outcome,
            campaignStatus: snapshot.campaignStatus,
            round: snapshot.round,
            goals: snapshot.goals,
          })
        );
      }
    }
  }

  let finalSnapshot = loadTrpgSnapshot(db, meta.campaignId, meta.adminId);
  if (!finalSnapshot) throw new Error("Final snapshot not found.");
  let allocation = null;
  if (finalSnapshot.campaignStatus === "CAMPAIGN_COMPLETE") {
    const mine = finalSnapshot.sheets.find((row) => row.isSelf)?.sheet;
    if (mine && (mine.statPoints ?? 0) > 0) {
      allocation = spendTrpgStatPoint(db, { campaignId: meta.campaignId, userId: meta.adminId, statKey: "dex" });
      finalSnapshot = loadTrpgSnapshot(db, meta.campaignId, meta.adminId)!;
    }
  }
  writeFileSync(join(outDir, "final-state.json"), JSON.stringify(finalSnapshot, null, 2), "utf8");
  writeFileSync(join(outDir, "rolls.json"), JSON.stringify(rolls, null, 2), "utf8");
  writeFileSync(join(outDir, "allocation.json"), JSON.stringify(allocation, null, 2), "utf8");
  const growthRows = db
    .prepare(
      `SELECT sh.participant_id, sh.name, sh.level, sh.xp, sh.stat_points, sh.hp, sh.max_hp, sh.location,
              c.completion_xp_awarded
       FROM trpg_character_sheets sh JOIN trpg_campaigns c ON c.id=sh.campaign_id
       WHERE sh.campaign_id=? ORDER BY sh.participant_id`
    )
    .all(meta.campaignId);
  writeFileSync(join(outDir, "growth.json"), JSON.stringify(growthRows, null, 2), "utf8");

  const gmCost = gmCalls.reduce((sum, call) => sum + (call.usage?.upstreamCostUsd ?? 0), 0);
  const botCost = botCalls.reduce((sum, call) => sum + (call.usage?.upstreamCostUsd ?? 0), 0);
  const cost = {
    gm: gmCalls.map((call, index) => ({
      call: index + 1,
      opening: call.opening,
      inputTokens: call.usage?.inputTokens ?? null,
      outputTokens: call.usage?.outputTokens ?? null,
      upstreamCostUsd: call.usage?.upstreamCostUsd ?? null,
      finishReason: call.finishReason ?? null,
      semanticDone: call.semanticDone ?? null,
      elapsedMs: call.elapsedMs,
      systemChars: call.system.length,
      userChars: call.user.length,
      textChars: call.text.length,
      systemSha256: require("crypto").createHash("sha256").update(call.system).digest("hex"),
      userSha256: require("crypto").createHash("sha256").update(call.user).digest("hex"),
    })),
    bot: botCalls.map((call, index) => ({
      call: index + 1,
      inputTokens: call.usage?.inputTokens ?? null,
      outputTokens: call.usage?.outputTokens ?? null,
      upstreamCostUsd: call.usage?.upstreamCostUsd ?? null,
      elapsedMs: call.elapsedMs,
      systemChars: call.system.length,
      userChars: call.user.length,
      textChars: call.text.length,
    })),
    totals: {
      gmCalls: gmCalls.length,
      botCalls: botCalls.length,
      retries: 0,
      gmInputTokens: gmCalls.reduce((sum, call) => sum + (call.usage?.inputTokens ?? 0), 0),
      gmOutputTokens: gmCalls.reduce((sum, call) => sum + (call.usage?.outputTokens ?? 0), 0),
      botInputTokens: botCalls.reduce((sum, call) => sum + (call.usage?.inputTokens ?? 0), 0),
      botOutputTokens: botCalls.reduce((sum, call) => sum + (call.usage?.outputTokens ?? 0), 0),
      gmCostUsd: gmCost,
      botCostUsd: botCost,
      totalCostUsd: gmCost + botCost,
      gmElapsedMs: gmCalls.reduce((sum, call) => sum + call.elapsedMs, 0),
      botElapsedMs: botCalls.reduce((sum, call) => sum + call.elapsedMs, 0),
    },
  };
  writeFileSync(join(outDir, "cost.json"), JSON.stringify(cost, null, 2), "utf8");
  writeFileSync(
    join(outDir, "summary.json"),
    JSON.stringify(
      {
        runId,
        campaignStatus: finalSnapshot.campaignStatus,
        storyPhase: finalSnapshot.storyPhase,
        round: finalSnapshot.round,
        goals: finalSnapshot.goals,
        combat: finalSnapshot.combat,
        growth: growthRows,
        allocation,
        cost: cost.totals,
      },
      null,
      2
    ),
    "utf8"
  );
  console.log(
    JSON.stringify(
      {
        phase: "done",
        runId,
        outDir,
        campaignStatus: finalSnapshot.campaignStatus,
        round: finalSnapshot.round,
        goals: finalSnapshot.goals,
        growth: growthRows,
        allocation,
        cost: cost.totals,
      },
      null,
      2
    )
  );
  db.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

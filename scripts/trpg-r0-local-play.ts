/**
 * TRPG R0 — local-only 5-turn real-GM play.
 *
 * Reuses the existing campaign, scenario, exploration, dice, sheet, and GM
 * owners. No product schema change, no production DB access, no new runtime
 * path. The only test seams are the existing `gmCall` and `rollD20` engine
 * dependencies, used to preserve the exact provider input/output and to make
 * one success and one failure reproducible.
 *
 * Setup only (no provider call):
 *   node --conditions=react-server --import tsx scripts/trpg-r0-local-play.ts --fresh --setup-only
 *
 * Play:
 *   node --conditions=react-server --import tsx scripts/trpg-r0-local-play.ts --fresh --play
 *
 * Resume the same local campaign:
 *   node --conditions=react-server --import tsx scripts/trpg-r0-local-play.ts --play
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import { callTrpgGm } from "../src/lib/trpg/gmCall";
import { loadCampaignLedger, persistCampaignLedger } from "../src/lib/trpg/campaignLedger";
import type { TrpgGoal } from "../src/lib/trpg/campaignGoals";
import { answerTrpgGoalClaim } from "../src/lib/trpg/goalConfirm";
import { createTrpgCampaign, saveTrpgSheet } from "../src/lib/trpg/engineCreate";
import {
  advanceTrpgCampaign,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "../src/lib/trpg/engineAdvance";
import { loadTrpgSnapshot } from "../src/lib/trpg/engineSnapshot";
import { loadExplorationState } from "../src/lib/trpg/explorationStore";
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
  goalSeed: { title: string; criterion: { type: "reach_location"; place: string } } | null;
  playPlan: PlayStep[];
};

type Meta = {
  dbPath: string;
  campaignId: number;
  adminId: number;
  templateId: number;
  createdAt: string;
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

type RollRecord = { index: number; value: number };

const ROOT = resolve(".");
const OUT_DIR = join(ROOT, "tmp/trpg-r0-play");
const META_PATH = join(OUT_DIR, "meta.json");
const GROUNDING_DB = resolve(process.env.TRPG_R0_GROUNDING_DB ?? "C:/HAV/data/app.db");

function loadFixture(): Fixture {
  return JSON.parse(
    readFileSync(resolve("docs/architecture/trpg-vnext/fixtures/trpg-r0-lighthouse-adventure.json"), "utf8")
  ) as Fixture;
}

async function copyDatabase(dest: string): Promise<void> {
  if (existsSync(dest)) unlinkSync(dest);
  // The local grounding DB is idle and has no WAL; a file copy preserves the
  // fixture users/characters without opening the source read-write.
  copyFileSync(GROUNDING_DB, dest);
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function setup(db: Database.Database, fixture: Fixture): Meta {
  const admin = db
    .prepare(`SELECT id, email, nickname FROM users WHERE is_admin=1 ORDER BY id LIMIT 1`)
    .get() as { id: number; email: string; nickname: string } | undefined;
  if (!admin) throw new Error("No local admin user found in the copied DB.");
  const character = db.prepare(`SELECT id, name FROM characters WHERE id=9820011`).get() as
    | { id: number; name: string }
    | undefined;
  if (!character) throw new Error("The local registered character 렌 (9820011) is missing.");

  const templateId = insertScenarioTemplate(db, admin.id, {
    title: fixture.template.title,
    summary: fixture.template.summary,
    content: fixture.template.content,
    secretContent: fixture.template.secretContent,
    visibility: fixture.template.visibility,
    startInventory: fixture.template.startInventory,
    defaultPcStats: fixture.template.defaultPcStats,
    statKeys: fixture.template.statKeys,
    npcs: fixture.template.npcs,
    characterIds: [],
    genres: ["mystery", "sea"],
    assets: [],
    scenarioPlan: fixture.template.scenarioPlan,
  });

  const campaignId = createTrpgCampaign(db, {
    hostUserId: admin.id,
    hostNickname: "렌",
    hostPersona: {
      personaId: 1,
      name: "렌",
      description: "낯선 항구에 내려온 젊은 여행자. 말수는 적지만 눈은 빠르다.",
      gender: "other",
      speechExamples: "",
    },
    viewerUserId: admin.id,
    templateId,
    title: fixture.template.title,
  });

  saveTrpgSheet(db, {
    campaignId,
    userId: admin.id,
    name: "렌",
    stats: { str: 7, dex: 10, con: 8, int: 7, wis: 7, cha: 6 },
  });

  const ledger = loadCampaignLedger(db, campaignId);
  if (fixture.goalSeed) {
    const goal: TrpgGoal = {
      id: "goal-beacon",
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

  const meta: Meta = {
    dbPath: join(OUT_DIR, "app.db"),
    campaignId,
    adminId: admin.id,
    templateId,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(META_PATH, JSON.stringify(meta, null, 2), "utf8");
  return meta;
}

function roomPublicId(db: Database.Database, campaignId: number, label: string): string {
  const snapshot = loadTrpgSnapshot(db, campaignId, readMeta()!.adminId);
  const publicRoom = snapshot?.exploration?.rooms.find((room) => room.label === label);
  if (publicRoom) return publicRoom.id;
  const internal = loadExplorationState(db, campaignId);
  const room = internal?.map.rooms.find((row) => (row.name ?? row.id) === label);
  if (room) return room.publicId;
  throw new Error(`Room label not found in exploration state: ${label}`);
}

function readMeta(): Meta | null {
  return readJson<Meta>(META_PATH);
}

function materializeCommands(
  db: Database.Database,
  campaignId: number,
  commands: PlayCommand[]
): Array<{ op: "move"; roomId: string } | { op: "search"; depth: "normal" | "careful" }> {
  return commands.map((command) =>
    command.op === "move"
      ? { op: "move" as const, roomId: roomPublicId(db, campaignId, command.label) }
      : { op: "search" as const, depth: command.depth }
  );
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
      hp: row.sheet.hp,
      maxHp: row.sheet.maxHp,
      location: row.sheet.location,
      inventory: row.sheet.inventory.map((item) => `${item.name} x${item.quantity}`),
      stats: row.sheet.stats,
    })),
    exploration: snapshot.exploration,
    myDraft: snapshot.myDraft,
    currentRolls: snapshot.currentRolls,
    lastBilledPoints: snapshot.lastBilledPoints,
    narrationTail: (snapshot.currentNarration ?? "").slice(-1200),
  };
}

async function main() {
  loadEnvLocal();
  process.env.NODE_TEST_CONTEXT = process.env.NODE_TEST_CONTEXT || "1";
  mkdirSync(OUT_DIR, { recursive: true });

  const fresh = process.argv.includes("--fresh");
  const setupOnly = process.argv.includes("--setup-only");
  const play = process.argv.includes("--play");
  const fromRound = Number(
    (process.argv.find((arg) => arg.startsWith("--from=")) ?? "--from=1").split("=")[1] ?? "1"
  );
  if (!setupOnly && !play) {
    throw new Error("Use --setup-only or --play.");
  }

  const fixture = loadFixture();
  const dbPath = join(OUT_DIR, "app.db");
  if (fresh) {
    await copyDatabase(dbPath);
    if (existsSync(META_PATH)) unlinkSync(META_PATH);
  } else if (!existsSync(dbPath)) {
    await copyDatabase(dbPath);
  }

  const db = new Database(dbPath);
  ensureTrpgTables(db);
  let meta = fresh ? null : readMeta();
  if (!meta) {
    meta = setup(db, fixture);
    console.log(JSON.stringify({ phase: "setup", ...meta }, null, 2));
  }
  if (setupOnly) {
    const snapshot = loadTrpgSnapshot(db, meta.campaignId, meta.adminId);
    console.log(JSON.stringify({ phase: "setup-only", snapshot: snapshot ? snapshotSummary(snapshot) : null }, null, 2));
    db.close();
    return;
  }

  const gmCalls: GmCallRecord[] = [];
  const rolls: RollRecord[] = [];
  // One high success for the hut search, one high success for the wreck search,
  // then a hit on the lighthouse threat strike, then routine values.
  const rollQueue = [18, 17, 16, 12, 12, 12, 12, 12];
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
      writeFileSync(join(OUT_DIR, "gm-calls.json"), JSON.stringify(gmCalls, null, 2), "utf8");
      console.log(
        JSON.stringify({
          gmCall: gmCalls.length,
          elapsedMs: gmCalls[gmCalls.length - 1]!.elapsedMs,
          inputTokens: result.usage?.inputTokens,
          outputTokens: result.usage?.outputTokens,
          upstreamCostUsd: result.usage?.upstreamCostUsd,
          finishReason: result.finishReason,
          textLength: result.text.length,
        })
      );
      return result;
    },
  };

  let snapshot = loadTrpgSnapshot(db, meta.campaignId, meta.adminId);
  if (!snapshot) throw new Error("Campaign snapshot not found.");
  if (snapshot.campaignStatus === "CHARACTER_SETUP" || snapshot.campaignStatus === "WAITING_FOR_PLAYERS") {
    console.log(JSON.stringify({ phase: "start" }));
    snapshot = await startTrpgCampaign(db, { campaignId: meta.campaignId, userId: meta.adminId, deps });
    writeFileSync(join(OUT_DIR, "round-0-opening.json"), JSON.stringify(snapshotSummary(snapshot), null, 2), "utf8");
    console.log(JSON.stringify({ phase: "opened", ...snapshotSummary(snapshot) }, null, 2));
  }

  for (const step of fixture.playPlan) {
    if (step.round < fromRound) continue;
    if (snapshot.campaignStatus === "CAMPAIGN_COMPLETE") break;
    const currentRound = snapshot.round?.number ?? 0;
    if (currentRound > step.round) continue;

    const commands = materializeCommands(db, meta.campaignId, step.commands);
    console.log(
      JSON.stringify({ phase: "submit", round: step.round, currentRound, body: step.body, commands, purpose: step.purpose })
    );
    try {
      submitTrpgAction(db, {
        campaignId: meta.campaignId,
        userId: meta.adminId,
        body: step.body,
        explorationCommands: commands,
        idempotencyKey: `trpg-r0-local-r${step.round}`,
        inputOrigin: "manual",
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          phase: "submit_error",
          round: step.round,
          currentRound,
          message: (error as Error).message,
        })
      );
      throw error;
    }

    // Duplicate submit must be rejected before another GM call. The first error
    // is the expected idempotency/duplicate guard; it is not retried.
    try {
      submitTrpgAction(db, {
        campaignId: meta.campaignId,
        userId: meta.adminId,
        body: step.body,
        explorationCommands: commands,
        idempotencyKey: `trpg-r0-local-r${step.round}`,
        inputOrigin: "manual",
      });
      throw new Error("Duplicate submit was accepted; the duplicate guard did not fire.");
    } catch (error) {
      const message = (error as Error).message;
      if (message === "Duplicate submit was accepted; the duplicate guard did not fire.") throw error;
      writeFileSync(
        join(OUT_DIR, `round-${step.round}-duplicate.json`),
        JSON.stringify({ rejected: true, message }, null, 2),
        "utf8"
      );
    }

    snapshot = await advanceTrpgCampaign(db, { campaignId: meta.campaignId, userId: meta.adminId, deps });
    writeFileSync(
      join(OUT_DIR, `round-${step.round}-state.json`),
      JSON.stringify(snapshotSummary(snapshot), null, 2),
      "utf8"
    );
    console.log(JSON.stringify({ phase: "advanced", ...snapshotSummary(snapshot) }, null, 2));

    const confirmClaims = process.argv.includes("--confirm-claims") && step.round >= 4;
    if (confirmClaims) {
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
        writeFileSync(
          join(OUT_DIR, `round-${step.round}-goal-confirm.json`),
          JSON.stringify(confirmed, null, 2),
          "utf8"
        );
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

  const finalSnapshot = loadTrpgSnapshot(db, meta.campaignId, meta.adminId);
  writeFileSync(join(OUT_DIR, "final-state.json"), JSON.stringify(finalSnapshot, null, 2), "utf8");
  writeFileSync(join(OUT_DIR, "rolls.json"), JSON.stringify(rolls, null, 2), "utf8");
  console.log(
    JSON.stringify(
      {
        phase: "done",
        campaignStatus: finalSnapshot?.campaignStatus,
        round: finalSnapshot?.round,
        goals: finalSnapshot?.goals,
        gmCalls: gmCalls.length,
        rolls,
        totalUpstreamCostUsd: gmCalls.reduce((sum, call) => sum + (call.usage?.upstreamCostUsd ?? 0), 0),
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

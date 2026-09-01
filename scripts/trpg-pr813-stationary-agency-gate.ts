#!/usr/bin/env npx tsx
/**
 * PR #813 final merge gate — unambiguous stationary human agency retest.
 * Audit-only harness. 3 provider calls (Bot1, Bot2, GM normal). No production changes.
 */
import Module from "module";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL } from "@/lib/chatModels";
import { TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION } from "@/lib/trpg/blueprintValidity";
import { EVEN_STATS, createTrpgCampaign, saveTrpgSheet } from "@/lib/trpg/engineCreate";
import {
  advanceTrpgCampaign,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "@/lib/trpg/engineAdvance";
import { callTrpgBot, callTrpgGm } from "@/lib/trpg/gmCall";
import { parseTrpgBotAction } from "@/lib/trpg/botActionParse";
import {
  TRPG_GM_LABEL_AI_ATTEMPT,
  TRPG_GM_LABEL_HUMAN_ACTION,
  parseTrpgGmOutput,
} from "@/lib/trpg/gmPrompt";
import { ensureTrpgTables } from "@/lib/trpg/schema";
import { parseTrpgScenarioPlan } from "@/lib/trpg/scenarioPlan";
import {
  casPublishWorldBlueprintArtifact,
  loadWorldSnapshotForBlueprint,
} from "@/lib/trpg/worldBlueprintArtifact";
import { TRPG_BOT_MAX_TOKENS, TRPG_GM_MAX_TOKENS } from "@/lib/trpg/types";
import { loadEnvLocal } from "./load-env-local";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

const OUT_DIR = path.join(process.cwd(), "docs/audits/trpg-pr813-human-agency-retest/stationary-gate");
const PARENT_OUT_DIR = path.join(process.cwd(), "docs/audits/trpg-pr813-human-agency-retest");
const PR_HEAD_SHA = process.env.PR813_HEAD_SHA ?? "00089706";
const MAIN_SHA = "80140cf8afc59de38d849eb9323e7ccdf32ea3fb";
const HUMAN_PC_NAME = "렌";
/** Explicitly stationary — no follow/forward/move verbs in human submission. */
const HUMAN_ACTION =
  "나는 제자리에서 움직이지 않은 채 주변을 살피고, 두 동료에게 각자 주변을 확인하라는 손짓만 한다.";

/** Material voluntary human choice invented by GM (not incidental posture). */
const GM_MATERIAL_HUMAN_CHOICE_FAIL: Array<{ id: string; re: RegExp }> = [
  {
    id: "human_to_cover",
    re: /렌(?:이|은)\s+.{0,45}?엄폐물.{0,35}?(?:뒤|쪽|으로).{0,25}?(?:이동|옮|피|숨|들어|나아|접근|행|갔|갔다)/,
  },
  {
    id: "human_lateral_route",
    re: /렌(?:이|은)\s+.{0,35}?(?:좌측|우측|왼쪽|오른쪽).{0,30}?(?:이동|향|진입|접근|나아|선택|택)/,
  },
  {
    id: "human_leads_or_advances",
    re: /렌(?:이|은)\s+.{0,35}?(?:앞장|선두|먼저\s+나아|앞으로\s+(?:나아|이동|진행|뛰|달려))/,
  },
  {
    id: "human_follows_companions",
    re: /렌(?:이|은)\s+.{0,35}?(?:동료(?:들)?(?:을|를)\s+따라|뒤를\s+따르)/,
  },
  {
    id: "human_to_destination",
    re: /렌(?:이|은)\s+.{0,45}?(?:환기|계단|통로|입구).{0,30}?(?:향|이동|진입|접근|나아|걸어|달려)/,
  },
  {
    id: "human_dialogue_invented",
    re: new RegExp(`${HUMAN_PC_NAME}\\s*:\\s*["「]`),
  },
  {
    id: "human_new_decision",
    re: /렌(?:이|은)\s+.{0,40}?(?:결심|결정했|선택했|마음먹|진로(?:를)?\s+(?:잡|정|택))/,
  },
];

const GM_HUMAN_DIALOGUE_FAIL: Array<{ id: string; re: RegExp }> = [
  { id: "human_quote_verb", re: /렌(?:이|은)\s+.{0,30}?(?:말(?:했|하)|외치|속삭|외쳤)/ },
];

const GM_STATIONARY_PASS_HINTS: Array<{ id: string; re: RegExp }> = [
  { id: "stays_in_place", re: /제자리(?:에|에서)?\s*(?:남|머물|유지|서)/ },
  { id: "no_movement", re: /움직이지\s+않/ },
  { id: "gesture_only", re: /손짓(?:만|으로)?/ },
  { id: "observes", re: /주변(?:을|을\s+)?(?:살피|살펴|경계|주시)/ },
];

const BOT_CROSS_PC_UI_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: "human_movement_in_bot_prose", re: /렌(?:이|은)\s+.{0,30}?(?:나아|이동|앞으로|뛰)/ },
];

type PatternHit = { id: string; match: string; context: string };

type PromptCapture = { role: string; system: string; user: string };

type ExecutedCall = {
  role: string;
  raw: string;
  finishReason: string | null;
  semanticDone: boolean | null;
  outputTokens: number | null;
  elapsedMs: number | null;
  maxTokens: number | null;
  model: string;
};

const CHAR_A = {
  id: 901,
  name: "권태현",
  description: "왕실 수호대장. A_UNIQUE_TRAIT: 왼손잡이 마체테. 위험하면 먼저 앞에 선다.",
  greeting: '"…또 먼저 나설 생각이야?"',
  exampleDialog: '"죽으면 내가 대신 사과할 일은 없어."',
  systemPrompt: "말투: 짧고 단호. 반말. A_UNIQUE_TRAIT",
  world: "",
};

const CHAR_B = {
  id: 902,
  name: "강이현",
  description: "전술 보조관. B_UNIQUE_TRAIT: 데이터 패드로 주변 수치 기록.",
  greeting: '"…기다려."',
  exampleDialog: '"괜찮으십니까?"',
  systemPrompt: "말투: 차분한 존댓말. B_UNIQUE_TRAIT",
  world: "",
};

const WARM_PLAN = parseTrpgScenarioPlan({
  title: "회색 생태권",
  startingSituation: "회색 생태권 외곽 검문소. 포자 경보가 울리고 있다.",
  centralConflict: "생태권 침식과 생존자 대피",
  goal: "안전한 통로를 확보한다",
  secret: "BLUEPRINT_SANDBOX_SECRET_CANARY",
  endingConditions: ["검문소를 통과한다"],
  clues: ["포자 농도 급상승"],
  gmDirection: "scene-first, immediate tension",
})!;

function writeText(name: string, content: string): void {
  fs.writeFileSync(path.join(OUT_DIR, name), content, "utf8");
}

function memoryAuditDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE worlds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      trpg_enabled INTEGER NOT NULL DEFAULT 0,
      trpg_visibility TEXT NOT NULL DEFAULT 'private',
      genres TEXT NOT NULL DEFAULT '[]',
      cover_url TEXT NOT NULL DEFAULT '',
      shared_from_nickname TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      gender TEXT NOT NULL DEFAULT 'male',
      description TEXT NOT NULL DEFAULT '',
      greeting TEXT NOT NULL DEFAULT '',
      example_dialog TEXT NOT NULL DEFAULT '',
      system_prompt TEXT NOT NULL DEFAULT '',
      world TEXT NOT NULL DEFAULT '',
      world_id INTEGER,
      creator_id INTEGER NOT NULL DEFAULT 1,
      visibility TEXT NOT NULL DEFAULT 'public',
      moderation_status TEXT NOT NULL DEFAULT 'approved',
      share_slug TEXT NOT NULL DEFAULT '',
      official INTEGER NOT NULL DEFAULT 0,
      trpg_reuse_allowed INTEGER NOT NULL DEFAULT 1,
      tagline TEXT NOT NULL DEFAULT '',
      emoji TEXT NOT NULL DEFAULT '',
      assets TEXT NOT NULL DEFAULT '[]'
    );
  `);
  ensureTrpgTables(db);
  return db;
}

function seedAuditFixtures(db: Database.Database): void {
  db.prepare(
    `INSERT INTO worlds (id, creator_id, name, summary, content, trpg_enabled, trpg_visibility, updated_at)
     VALUES (1, 1, '회색 생태권', '포자와 잿빛 하늘', ?, 1, 'public', datetime('now'))`
  ).run(
    [
      "회색 생태권은 잿빛 하늘과 포자 안개가 늘 깔린 대륙이다.",
      "생존자들은 검문소와 방벽 마을을 중심으로 움직인다.",
      "CAMPAIGN_WORLD_CANON: 포자 농도가 올라가면 호흡기를 착용해야 한다.",
    ].join("\n\n")
  );
  for (const ch of [CHAR_A, CHAR_B]) {
    db.prepare(
      `INSERT INTO characters (id, name, gender, description, greeting, example_dialog, system_prompt, world, creator_id, trpg_reuse_allowed, visibility, moderation_status)
       VALUES (?, ?, 'male', ?, ?, ?, ?, ?, 1, 1, 'public', 'approved')`
    ).run(ch.id, ch.name, ch.description, ch.greeting, ch.exampleDialog, ch.systemPrompt, ch.world);
  }
  const snap = loadWorldSnapshotForBlueprint(db, 1)!;
  casPublishWorldBlueprintArtifact(db, {
    worldId: 1,
    expectedSourceFingerprint: snap.sourceFingerprint,
    expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
    plan: WARM_PLAN,
  });
}

function scanPatterns(text: string, patterns: Array<{ id: string; re: RegExp }>): PatternHit[] {
  const hay = text.replace(/\s+/g, " ");
  const out: PatternHit[] = [];
  for (const { id, re } of patterns) {
    const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
    const globalRe = new RegExp(re.source, flags);
    for (const m of hay.matchAll(globalRe)) {
      const idx = m.index ?? 0;
      const start = Math.max(0, idx - 50);
      const end = Math.min(hay.length, idx + m[0].length + 50);
      out.push({ id, match: m[0], context: hay.slice(start, end).trim() });
    }
  }
  return out;
}

function gmNarrationOnly(raw: string): string {
  const parsed = parseTrpgGmOutput(raw.includes("<<<NARRATION>>>") ? raw : `<<<NARRATION>>>\n${raw}`);
  return parsed.narration.replace(/\nGM:.*$/s, "").trim();
}

function botProseOnly(raw: string): string {
  return parseTrpgBotAction(raw).prose.trim();
}

function verifyStructuralIsolation(user: string, bot1Prose: string, bot2Prose: string) {
  return {
    humanActionPresent: user.includes(HUMAN_ACTION),
    humanAuthoritativeLabelCount: (user.match(new RegExp(TRPG_GM_LABEL_HUMAN_ACTION.replace(/[[\]]/g, "\\$&"), "g")) ?? []).length,
    aiAttemptLabelCount: (user.match(new RegExp(TRPG_GM_LABEL_AI_ATTEMPT.replace(/[[\]]/g, "\\$&"), "g")) ?? []).length,
    botPresentationProsePresentInGmInput:
      (bot1Prose.length > 12 && user.includes(bot1Prose.slice(0, 24))) ||
      (bot2Prose.length > 12 && user.includes(bot2Prose.slice(0, 24))),
    aiFullPresentationProseAbsent: !user.includes("<<<INTENT>>>") && !/(?:VISIBLE AI ACTION PROSE|AI ACTION PROSE —)/.test(user),
  };
}

async function main(): Promise<void> {
  if (process.env.RUN_TRPG_PR813_STATIONARY_GATE !== "1") {
    console.error("Set RUN_TRPG_PR813_STATIONARY_GATE=1");
    process.exit(2);
  }
  delete process.env.MOCK_MODE;
  loadEnvLocal();
  if (!process.env.CHEAPER_INFERENCE_API_KEY?.trim()) {
    console.error("CHEAPER_INFERENCE_API_KEY required");
    process.exit(2);
  }

  process.env.TRPG_SANDBOX_DIRECTOR_ENABLED = "1";
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const openingSeedPath = path.join(PARENT_OUT_DIR, "OPENING_SEED_RAW.txt");
  if (!fs.existsSync(openingSeedPath)) {
    throw new Error(`Missing ${openingSeedPath}`);
  }
  const openingSeedRaw = fs.readFileSync(openingSeedPath, "utf8");

  const db = memoryAuditDb();
  seedAuditFixtures(db);

  const prompts: PromptCapture[] = [];
  const executed: ExecutedCall[] = [];
  let providerSeq = 0;
  const expectedRoles = ["bot_1", "bot_2", "gm_normal"];
  let roleIdx = 0;
  let openingGmPending = true;

  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url.includes("cheaperinference.com")) {
      providerSeq += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      assert.equal(body.max_tokens, 65_536);
    }
    return previousFetch(input, init);
  }) as typeof fetch;

  const deps: TrpgEngineDeps = {
    skipBilling: true,
    rollD20: () => 12,
    gmCall: async (opts) => {
      if (openingGmPending) {
        openingGmPending = false;
        return {
          text: openingSeedRaw,
          finishReason: "stop",
          semanticDone: true,
          elapsedMs: 0,
          usage: { modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL, inputTokens: 0, outputTokens: 0 },
        };
      }
      const role = expectedRoles[roleIdx] ?? "gm_unknown";
      prompts.push({ role, system: opts.system, user: opts.user });
      const started = Date.now();
      const result = await callTrpgGm(opts);
      executed.push({
        role,
        raw: result.text,
        finishReason: result.finishReason ?? null,
        semanticDone: result.semanticDone ?? null,
        outputTokens: result.usage?.outputTokens ?? null,
        elapsedMs: result.elapsedMs ?? Date.now() - started,
        maxTokens: TRPG_GM_MAX_TOKENS,
        model: result.usage?.modelId ?? CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      });
      roleIdx += 1;
      return result;
    },
    botCall: async (system, user) => {
      const role = expectedRoles[roleIdx] ?? "bot_unknown";
      prompts.push({ role, system, user });
      const started = Date.now();
      const result = await callTrpgBot({ system, user });
      executed.push({
        role,
        raw: result.text,
        finishReason: result.finishReason ?? null,
        semanticDone: result.semanticDone ?? null,
        outputTokens: result.usage?.outputTokens ?? null,
        elapsedMs: result.elapsedMs ?? Date.now() - started,
        maxTokens: TRPG_BOT_MAX_TOKENS,
        model: result.usage?.modelId ?? CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      });
      roleIdx += 1;
      return result;
    },
  };

  const hostUserId = 1;
  const campaignId = createTrpgCampaign(db, {
    hostUserId,
    hostNickname: HUMAN_PC_NAME,
    viewerUserId: hostUserId,
    worldId: 1,
    characterIds: [CHAR_A.id, CHAR_B.id],
    title: "pr813 stationary gate",
  });
  saveTrpgSheet(db, { campaignId, userId: hostUserId, name: HUMAN_PC_NAME, stats: EVEN_STATS });
  await startTrpgCampaign(db, { campaignId, userId: hostUserId, deps });

  submitTrpgAction(db, { campaignId, userId: hostUserId, body: HUMAN_ACTION });
  let snap = await advanceTrpgCampaign(db, { campaignId, userId: hostUserId, deps, source: "audit" });
  for (let i = 0; i < 16 && snap.round.phase !== "ACTION_INPUT"; i += 1) {
    snap = await advanceTrpgCampaign(db, { campaignId, userId: hostUserId, deps, source: "audit" });
  }

  globalThis.fetch = previousFetch;
  assert.equal(providerSeq, 3, `expected 3 provider calls, got ${providerSeq}`);

  for (const p of prompts) {
    writeText(`${p.role.toUpperCase()}_SYSTEM.txt`, p.system);
    writeText(`${p.role.toUpperCase()}_USER.txt`, p.user);
  }
  for (const call of executed) {
    writeText(`${call.role.toUpperCase()}_RAW.txt`, call.raw);
  }

  const bot1Raw = executed.find((c) => c.role === "bot_1")?.raw ?? "";
  const bot2Raw = executed.find((c) => c.role === "bot_2")?.raw ?? "";
  const gmNormalRaw = executed.find((c) => c.role === "gm_normal")?.raw ?? "";
  const gmNormalUser = prompts.find((p) => p.role === "gm_normal")?.user ?? "";
  const gmNarration = gmNarrationOnly(gmNormalRaw);
  const bot1Prose = botProseOnly(bot1Raw);
  const bot2Prose = botProseOnly(bot2Raw);

  const structural = verifyStructuralIsolation(gmNormalUser, bot1Prose, bot2Prose);
  const materialFails = scanPatterns(gmNarration, GM_MATERIAL_HUMAN_CHOICE_FAIL);
  const dialogueFails = scanPatterns(gmNarration, GM_HUMAN_DIALOGUE_FAIL);
  const passHints = scanPatterns(gmNarration, GM_STATIONARY_PASS_HINTS);
  const bot1CrossPcUi = scanPatterns(bot1Prose, BOT_CROSS_PC_UI_PATTERNS);
  const bot2CrossPcUi = scanPatterns(bot2Prose, BOT_CROSS_PC_UI_PATTERNS);

  const bot1OwnResolved = /(?:강이현|데이터\s*패드|센서|스캔|조사|확인|분석|환기)/.test(gmNarration);
  const bot2OwnResolved = /(?:권태현|마체테|엄호|전방|경계)/.test(gmNarration);

  const meta = {
    gate: "stationary-human-agency",
    latestMainSha: MAIN_SHA,
    prHeadSha: PR_HEAD_SHA,
    humanSubmittedText: HUMAN_ACTION,
    realProviderCalls: providerSeq,
    structuralIsolation: structural,
    botCrossPcInUiProse: {
      bot1: bot1CrossPcUi,
      bot2: bot2CrossPcUi,
    },
    materialHumanChoiceFails: materialFails,
    humanDialogueFails: dialogueFails,
    stationaryPassHints: passHints,
    explicitStationaryHumanMovedByGm: materialFails.length > 0,
    humanRouteChoiceInvented: materialFails.some((h) => h.id.includes("route") || h.id.includes("destination")),
    humanDialogueInvented: dialogueFails.length > 0 || materialFails.some((h) => h.id === "human_dialogue_invented"),
    humanDecisionInvented: materialFails.some((h) => h.id === "human_new_decision"),
    bot1OwnActionResolved: bot1OwnResolved,
    bot2OwnActionResolved: bot2OwnResolved,
    aiBotOwnMovementAllowed: bot1OwnResolved || bot2OwnResolved,
    worldAdvancementPreserved: gmNarration.length > 200,
    stationaryAgencyGatePass:
      materialFails.length === 0 &&
      dialogueFails.length === 0 &&
      structural.humanActionPresent &&
      !structural.botPresentationProsePresentInGmInput &&
      bot1OwnResolved &&
      bot2OwnResolved,
    normalGm: executed.find((c) => c.role === "gm_normal"),
  };

  writeText("PROVIDER_META.json", JSON.stringify(meta, null, 2));
  writeText("GM_NORMAL_CANONICAL.txt", gmNarration);

  const review = [
    "# PR #813 Stationary Human Agency Gate",
    "",
    `Main: \`${MAIN_SHA}\` | PR head: \`${PR_HEAD_SHA}\``,
    "",
    "## Human action (explicitly stationary)",
    `\`${HUMAN_ACTION}\``,
    "",
    "## Structural isolation",
    `- humanActionPresent = ${structural.humanActionPresent}`,
    `- botPresentationProsePresentInGmInput = ${structural.botPresentationProsePresentInGmInput}`,
    `- aiAttemptLabelCount = ${structural.aiAttemptLabelCount}`,
    "",
    "## Material voluntary choice (GM narration)",
    `- EXPLICIT_STATIONARY_HUMAN_MOVED_BY_GM = ${meta.explicitStationaryHumanMovedByGm}`,
    `- HUMAN_ROUTE_CHOICE_INVENTED = ${meta.humanRouteChoiceInvented}`,
    `- HUMAN_DIALOGUE_INVENTED = ${meta.humanDialogueInvented}`,
    `- HUMAN_DECISION_INVENTED = ${meta.humanDecisionInvented}`,
    `- STATIONARY_AGENCY_GATE_PASS = ${meta.stationaryAgencyGatePass}`,
    "",
    ...(materialFails.length
      ? materialFails.map((h) => `- FAIL [\`${h.id}\`] \`${h.match}\` — …${h.context}…`)
      : ["- (no material human choice violations detected)"]),
    "",
    "## AI bot preservation",
    `- BOT1_OWN_ACTION_RESOLVED = ${meta.bot1OwnActionResolved}`,
    `- BOT2_OWN_ACTION_RESOLVED = ${meta.bot2OwnActionResolved}`,
    `- AI_BOT_OWN_MOVEMENT_ALLOWED = ${meta.aiBotOwnMovementAllowed}`,
    "",
    "## Bot UI cross-PC (stress, not scored against structural boundary)",
    `- bot1 cross-PC in UI = ${bot1CrossPcUi.length > 0}`,
    `- bot2 cross-PC in UI = ${bot2CrossPcUi.length > 0}`,
    "",
    "## Pass hints in GM narration",
    ...(passHints.length ? passHints.map((h) => `- [\`${h.id}\`] \`${h.match}\``) : ["- (none matched)"]),
  ].join("\n");
  writeText("REVIEW_PACKET.md", review);

  console.info(JSON.stringify(meta, null, 2));
  db.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

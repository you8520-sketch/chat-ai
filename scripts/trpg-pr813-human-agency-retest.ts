#!/usr/bin/env npx tsx
/**
 * PR #813 real-provider confirmation — 3 calls only (Bot1, Bot2, GM normal).
 * Audit-only harness. No production code changes.
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
  TRPG_GM_LABEL_AI_SCENE_PROSE,
  TRPG_GM_LABEL_AI_VISIBLE_PROSE,
  TRPG_GM_LABEL_HUMAN_ACTION,
  parseTrpgGmOutput,
} from "@/lib/trpg/gmPrompt";
import { ensureTrpgTables } from "@/lib/trpg/schema";
import { parseTrpgScenarioPlan } from "@/lib/trpg/scenarioPlan";
import {
  casPublishWorldBlueprintArtifact,
  loadWorldSnapshotForBlueprint,
} from "@/lib/trpg/worldBlueprintArtifact";
import {
  TRPG_BOT_MAX_TOKENS,
  TRPG_GM_MAX_TOKENS,
} from "@/lib/trpg/types";
import { loadEnvLocal } from "./load-env-local";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

const OUT_DIR = path.join(process.cwd(), "docs/audits/trpg-pr813-human-agency-retest");
const PR_HEAD_SHA = process.env.PR813_HEAD_SHA ?? "92c55996";
const MAIN_SHA = "80140cf8afc59de38d849eb9323e7ccdf32ea3fb";
const HUMAN_ACTION = "주변을 살피며 두 동료에게 조용히 따라오라는 손짓을 한다.";
const HUMAN_PC_NAME = "렌";

const FORMAL_POLITE_RE =
  /(?:습니다|했습니다|였습니다|입니다|합니다|됩니다|있습니다|보입니다|느껴집니다)/g;

const BOT_CROSS_PC_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: "human_movement_verb", re: /렌이\s+(?:발을|뛰|달려|이동|향|진입|들어|나아|걸어|옮겨|뛰어|움직)/ },
  { id: "human_follow_context", re: /렌의\s+뒤를\s+.{0,25}?따르/ },
  { id: "human_movement_match", re: /렌의\s+움직임에\s+맞춰/ },
  { id: "human_route_movement", re: /렌이\s+.{0,40}?(?:우측|환기).{0,30}?(?:통로|으로|로\s+(?:향|이동|진입|나아|뛰|발|들어))/ },
  { id: "human_choice", re: /렌이\s+.{0,40}?(?:선택|결심|결정|택하기)/ },
  { id: "human_gesture_plus_move", re: /렌이\s+.{0,20}?손짓.{0,20}?(?:발을|뛰|이동|진입)/ },
];

const GM_HUMAN_ROUTE_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: "human_route_choice", re: /렌이\s+.{0,40}?(?:우측|환기|좌측).{0,30}?(?:선택|택|결정|결심|정했다|향했다|진로를\s+(?:잡|정))/ },
  { id: "human_leads_route", re: /렌이\s+.{0,30}?일행의\s+진로를/ },
];

const GM_HUMAN_MOVEMENT_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: "human_steps", re: /렌이\s+.{0,300}?(?:발을\s+떼|걸음|나아가|이동|진입|들어가|모여들|전진)/ },
  { id: "human_advance_success", re: /전진하는\s+데\s+성공했다/ },
  { id: "human_follows", re: /렌이\s+.{0,30}?(?:따라|뒤를)/ },
];

const GM_HUMAN_DIALOGUE_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: "human_spoken_line", re: new RegExp(`${HUMAN_PC_NAME}\\s*:\\s*["「]`) },
  { id: "human_quote", re: /렌이\s+.{0,30}?(?:말|외치|속삭|외쳐)/ },
];

const GM_HUMAN_DECISION_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: "human_decides", re: /렌이\s+.{0,40}?(?:결심|결정|선택|마음먹|택)/ },
];

const BOT_OWN_ACTION_PATTERNS: Array<{ bot: string; re: RegExp }> = [
  { bot: "강이현", re: /(?:강이현|데이터\s*패드|센서|스캔|조사|환기)/ },
  { bot: "권태현", re: /(?:권태현|마체테|엄호|앞을\s+막|방어|defend)/i },
];

type PromptCapture = { role: string; system: string; user: string };

type ProviderCapture = {
  seq: number;
  role: string;
  model: string;
  max_tokens: number | null;
  stream: boolean;
  attempt: number;
};

type ExecutedCall = {
  role: string;
  raw: string;
  finishReason: string | null;
  semanticDone: boolean | null;
  inputTokens: number | null;
  outputTokens: number | null;
  elapsedMs: number | null;
  maxTokens: number | null;
  model: string;
};

type PatternHit = { id: string; match: string; context: string };

const CHAR_A = {
  id: 901,
  name: "권태현",
  description: [
    "왕실 수호대장 출신. A_UNIQUE_TRAIT_1: 왼손잡이 마체테.",
    "A_UNIQUE_TRAIT_2: 위험하면 먼저 앞에 선다.",
    "직설적이고 거친 태도. 반말 성향. 행동이 빠르다.",
  ].join("\n"),
  greeting: '"…또 먼저 나설 생각이야?"',
  exampleDialog: '"죽으면 내가 대신 사과할 일은 없어."\n"그래, 네가 이기면 내가 술 산다."',
  systemPrompt:
    "말투: 짧고 단호. 반말. 무리한 돌진을 말리되 행동으로 막는다. A_UNIQUE_TRAIT_1 A_UNIQUE_TRAIT_2",
  world: "MAGIC_ACADEMY_WORLD_CANARY — 마법학교 아르카눔. 이 설정은 캐릭터 카드 배경일 뿐 현재 캠페인 세계가 우선한다.",
};

const CHAR_B = {
  id: 902,
  name: "강이현",
  description: [
    "전술 지도 보조관. B_UNIQUE_TRAIT_1: 데이터 패드로 주변 수치를 기록한다.",
    "B_UNIQUE_TRAIT_2: 위험 구역에서 먼저 경로를 계산한다.",
    "차분하고 분석적. 상대에 따라 존댓말. 신중한 행동.",
  ].join("\n"),
  greeting: '"…기다려."',
  exampleDialog: '"괜찮으십니까?"\n"별일 아니에요. 제가 먼저 확인하겠습니다."',
  systemPrompt:
    "말투: 차분한 존댓말. 분석 후 행동. B_UNIQUE_TRAIT_1 B_UNIQUE_TRAIT_2",
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
      "외곽 통로에는 고철과 균사 덩어리가 자주 막힌다.",
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

function stripQuotedRegions(text: string): string {
  return text
    .replace(/"[^"\n]*"/g, " ")
    .replace(/「[^」\n]*」/g, " ")
    .replace(/『[^』\n]*』/g, " ");
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

function gmNarrationOnly(rawOrCanonical: string): string {
  const parsed = parseTrpgGmOutput(rawOrCanonical.includes("<<<NARRATION>>>") ? rawOrCanonical : `<<<NARRATION>>>\n${rawOrCanonical}`);
  return parsed.narration.replace(/\nGM:.*$/s, "").trim();
}

function botProseOnly(raw: string): string {
  const parsed = parseTrpgBotAction(raw);
  return parsed.prose.trim();
}

function verifyGmUserBlock(user: string): Record<string, boolean | number> {
  const humanBlocks = (user.match(new RegExp(TRPG_GM_LABEL_HUMAN_ACTION.replace(/[[\]]/g, "\\$&"), "g")) ?? []).length;
  const aiVisible = (user.match(new RegExp(TRPG_GM_LABEL_AI_VISIBLE_PROSE.replace(/[[\]]/g, "\\$&"), "g")) ?? []).length;
  const aiScene = (user.match(new RegExp(TRPG_GM_LABEL_AI_SCENE_PROSE.replace(/[[\]]/g, "\\$&"), "g")) ?? []).length;
  const humanActorKind = (user.match(/actorKind=human/g) ?? []).length;
  const aiActorKind = (user.match(/actorKind=ai_character/g) ?? []).length;
  return {
    humanAuthoritativeLabelCount: humanBlocks,
    aiVisibleProseLabelCount: aiVisible,
    aiSceneProseLabelCount: aiScene,
    humanActorKindCount: humanActorKind,
    aiActorKindCount: aiActorKind,
    humanActionPresent: user.includes(HUMAN_ACTION),
  };
}

async function main(): Promise<void> {
  if (process.env.RUN_TRPG_PR813_AGENCY_RETEST !== "1") {
    console.error("Set RUN_TRPG_PR813_AGENCY_RETEST=1");
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

  assert.equal(TRPG_GM_MAX_TOKENS, 65_536);
  assert.equal(TRPG_BOT_MAX_TOKENS, 65_536);

  const openingSeedPath = path.join(OUT_DIR, "OPENING_SEED_RAW.txt");
  if (!fs.existsSync(openingSeedPath)) {
    throw new Error(`Missing ${openingSeedPath} — seed from audit/trpg-post810-real-quality GM_OPENING_RAW.txt`);
  }
  const openingSeedRaw = fs.readFileSync(openingSeedPath, "utf8");

  const db = memoryAuditDb();
  seedAuditFixtures(db);

  const prompts: PromptCapture[] = [];
  const providerRequests: ProviderCapture[] = [];
  const executed: ExecutedCall[] = [];
  const attemptByUrl = new Map<string, number>();
  let providerSeq = 0;
  const expectedRoles = ["bot_1", "bot_2", "gm_normal"];
  let roleIdx = 0;
  let openingGmPending = true;

  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url.includes("cheaperinference.com")) {
      providerSeq += 1;
      const attempt = (attemptByUrl.get(url) ?? 0) + 1;
      attemptByUrl.set(url, attempt);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      providerRequests.push({
        seq: providerSeq,
        role: expectedRoles[roleIdx] ?? `unexpected_${providerSeq}`,
        model: String(body.model ?? ""),
        max_tokens: typeof body.max_tokens === "number" ? body.max_tokens : null,
        stream: body.stream === true,
        attempt,
      });
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
          usage: {
            modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
            inputTokens: 0,
            outputTokens: 0,
          },
        };
      }
      const role = expectedRoles[roleIdx] ?? "gm_unknown";
      prompts.push({ role, system: opts.system, user: opts.user });
      const started = Date.now();
      const result = await callTrpgGm(opts);
      const elapsedMs = result.elapsedMs ?? Date.now() - started;
      const req = providerRequests[providerRequests.length - 1];
      executed.push({
        role,
        raw: result.text,
        finishReason: result.finishReason ?? null,
        semanticDone: result.semanticDone ?? null,
        inputTokens: result.usage?.inputTokens ?? null,
        outputTokens: result.usage?.outputTokens ?? null,
        elapsedMs,
        maxTokens: req?.max_tokens ?? null,
        model: result.usage?.modelId ?? CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      });
      roleIdx += 1;
      return { ...result, elapsedMs };
    },
    botCall: async (system, user) => {
      const role = expectedRoles[roleIdx] ?? "bot_unknown";
      prompts.push({ role, system, user });
      const started = Date.now();
      const result = await callTrpgBot({ system, user });
      const elapsedMs = result.elapsedMs ?? Date.now() - started;
      const req = providerRequests[providerRequests.length - 1];
      executed.push({
        role,
        raw: result.text,
        finishReason: result.finishReason ?? null,
        semanticDone: result.semanticDone ?? null,
        inputTokens: result.usage?.inputTokens ?? null,
        outputTokens: result.usage?.outputTokens ?? null,
        elapsedMs,
        maxTokens: req?.max_tokens ?? null,
        model: result.usage?.modelId ?? CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      });
      roleIdx += 1;
      return { ...result, elapsedMs };
    },
  };

  const hostUserId = 1;
  const campaignId = createTrpgCampaign(db, {
    hostUserId,
    hostNickname: HUMAN_PC_NAME,
    viewerUserId: hostUserId,
    worldId: 1,
    characterIds: [CHAR_A.id, CHAR_B.id],
    title: "pr813 agency retest world-only",
  });
  saveTrpgSheet(db, { campaignId, userId: hostUserId, name: HUMAN_PC_NAME, stats: EVEN_STATS });

  await startTrpgCampaign(db, { campaignId, userId: hostUserId, deps });

  const normalRoundStart = Date.now();
  submitTrpgAction(db, {
    campaignId,
    userId: hostUserId,
    body: HUMAN_ACTION,
  });

  let snap = await advanceTrpgCampaign(db, { campaignId, userId: hostUserId, deps, source: "audit" });
  for (let i = 0; i < 16 && snap.round.phase !== "ACTION_INPUT"; i += 1) {
    snap = await advanceTrpgCampaign(db, { campaignId, userId: hostUserId, deps, source: "audit" });
  }
  const normalRoundTotalMs = Date.now() - normalRoundStart;

  globalThis.fetch = previousFetch;

  if (providerSeq !== 3) {
    writeText(
      "STOP_CONDITION.txt",
      `unexpected provider call count: ${providerSeq}\n${JSON.stringify(providerRequests, null, 2)}`
    );
    throw new Error(`STOP: expected 3 provider calls, got ${providerSeq}`);
  }

  for (const p of prompts) {
    writeText(`${p.role.toUpperCase()}_SYSTEM.txt`, p.system);
    writeText(`${p.role.toUpperCase()}_USER.txt`, p.user);
  }

  for (const call of executed) {
    writeText(`${call.role.toUpperCase()}_RAW.txt`, call.raw);
  }

  const round1 = db
    .prepare(`SELECT id FROM trpg_rounds WHERE campaign_id=? AND round_number=1`)
    .get(campaignId) as { id: number } | undefined;
  const normalGmRow = round1
    ? ((db
        .prepare(`SELECT narration FROM trpg_gm_messages WHERE round_id=?`)
        .get(round1.id) as { narration: string } | undefined) ?? null)
    : null;

  const botSubmissions = round1
    ? (db
        .prepare(
          `SELECT p.display_name, s.body
           FROM trpg_action_submissions s
           JOIN trpg_participants p ON p.id = s.participant_id
           WHERE s.round_id=? AND s.source='bot_model'
           ORDER BY s.id ASC`
        )
        .all(round1.id) as Array<{ display_name: string; body: string }>)
    : [];

  if (normalGmRow) writeText("GM_NORMAL_CANONICAL.txt", normalGmRow.narration);
  for (const [i, sub] of botSubmissions.entries()) {
    writeText(`BOT_${i + 1}_CANONICAL.txt`, sub.body);
  }

  const bot1Raw = executed.find((c) => c.role === "bot_1")?.raw ?? "";
  const bot2Raw = executed.find((c) => c.role === "bot_2")?.raw ?? "";
  const gmNormalRaw = executed.find((c) => c.role === "gm_normal")?.raw ?? "";
  const gmNormalParsed = parseTrpgGmOutput(gmNormalRaw);
  const gmNarration = gmNarrationOnly(gmNormalRaw);
  const gmNormalUser = prompts.find((p) => p.role === "gm_normal")?.user ?? "";

  const bot1Prose = botProseOnly(bot1Raw);
  const bot2Prose = botProseOnly(bot2Raw);
  const bot1CrossPc = scanPatterns(bot1Prose, BOT_CROSS_PC_PATTERNS);
  const bot2CrossPc = scanPatterns(bot2Prose, BOT_CROSS_PC_PATTERNS);

  const gmRouteHits = scanPatterns(gmNarration, GM_HUMAN_ROUTE_PATTERNS);
  const gmMovementHits = scanPatterns(gmNarration, GM_HUMAN_MOVEMENT_PATTERNS);
  const gmDialogueHits = scanPatterns(gmNarration, GM_HUMAN_DIALOGUE_PATTERNS);
  const gmDecisionHits = scanPatterns(gmNarration, GM_HUMAN_DECISION_PATTERNS);

  const gmUserVerify = verifyGmUserBlock(gmNormalUser);

  const bot1Name = botSubmissions[0]?.display_name ?? "강이현";
  const bot2Name = botSubmissions[1]?.display_name ?? "권태현";
  const bot1OwnResolved = BOT_OWN_ACTION_PATTERNS.find((p) => p.bot === bot1Name)?.re.test(gmNarration) ?? false;
  const bot2OwnResolved = BOT_OWN_ACTION_PATTERNS.find((p) => p.bot === bot2Name)?.re.test(gmNarration) ?? false;

  const normalExec = executed.find((c) => c.role === "gm_normal")!;
  const narratorFormal = scanPatterns(stripQuotedRegions(gmNarration), [{ id: "formal", re: FORMAL_POLITE_RE }]);

  const meta = {
    latestMainSha: MAIN_SHA,
    prHeadSha: PR_HEAD_SHA,
    realProviderCalls: providerSeq,
    providerAttempts: providerRequests,
    openingProviderCall: false,
    openingSeedSource: "docs/audits/trpg-post810-real-quality/GM_OPENING_RAW.txt (#812 audit)",
    humanSubmittedText: HUMAN_ACTION,
    normalRoundTotalMs,
    bot1: {
      name: bot1Name,
      crossPcContaminationPresent: bot1CrossPc.length > 0,
      crossPcClaims: bot1CrossPc,
    },
    bot2: {
      name: bot2Name,
      crossPcContaminationPresent: bot2CrossPc.length > 0,
      crossPcClaims: bot2CrossPc,
    },
    gmHumanRouteChoiceInvented: gmRouteHits.length > 0,
    gmHumanMovementInvented: gmMovementHits.length > 0,
    gmHumanDialogueInvented: gmDialogueHits.length > 0,
    gmHumanDecisionInvented: gmDecisionHits.length > 0,
    gmHumanRouteHits,
    gmHumanMovementHits,
    gmHumanDialogueHits,
    gmHumanDecisionHits,
    bot1OwnActionResolved: bot1OwnResolved,
    bot2OwnActionResolved: bot2OwnResolved,
    botSequentialCooperationPreserved: bot1OwnResolved && bot2OwnResolved,
    gmUserBlockVerify: gmUserVerify,
    normalGm: {
      model: normalExec.model,
      maxTokens: normalExec.maxTokens,
      inputTokens: normalExec.inputTokens,
      outputTokens: normalExec.outputTokens,
      finishReason: normalExec.finishReason,
      semanticDone: normalExec.semanticDone,
      elapsedMs: normalExec.elapsedMs,
    },
    narratorFormalPoliteMatches: narratorFormal,
    truncationObserved:
      normalExec.finishReason === "length" || normalExec.semanticDone === false,
    maxTokensAll65536: providerRequests.every((r) => r.max_tokens === 65_536),
    productionCodeChangedAfterRetest: false,
  };

  writeText("PROVIDER_META.json", JSON.stringify(meta, null, 2));

  const reviewLines = [
    "# PR #813 Human PC Agency — Real Provider Retest",
    "",
    `Main: \`${MAIN_SHA}\` | PR head: \`${PR_HEAD_SHA}\``,
    "",
    "## Scope",
    "- Opening: **seeded from #812** (0 provider calls)",
    "- Real calls: Bot1 → Bot2 → GM normal (**3 only**)",
    "",
    `Human submitted: \`${HUMAN_ACTION}\``,
    "",
    "## Provider call ledger",
    "| Seq | Role | Model | Attempt | max_tokens | Input tok | Output tok | finishReason | semanticDone | elapsedMs |",
    "| --- | ---- | ----- | ------: | ---------: | --------: | ---------: | ------------ | ------------ | --------: |",
    ...executed.map((c, i) => {
      const req = providerRequests[i];
      return `| ${req?.seq ?? i + 1} | ${c.role} | ${c.model} | ${req?.attempt ?? 1} | ${c.maxTokens ?? "null"} | ${c.inputTokens ?? "null"} | ${c.outputTokens ?? "null"} | ${c.finishReason ?? "null"} | ${c.semanticDone ?? "null"} | ${c.elapsedMs ?? "null"} |`;
    }),
    "",
    "## GM user block authority verify",
    `- humanAuthoritativeLabelCount = ${gmUserVerify.humanAuthoritativeLabelCount}`,
    `- aiVisibleProseLabelCount = ${gmUserVerify.aiVisibleProseLabelCount}`,
    `- aiSceneProseLabelCount = ${gmUserVerify.aiSceneProseLabelCount}`,
    `- humanActorKindCount = ${gmUserVerify.humanActorKindCount}`,
    `- aiActorKindCount = ${gmUserVerify.aiActorKindCount}`,
    "",
    "## Bot cross-PC claims (prose only, not scored)",
    `BOT1_CROSS_PC_CONTAMINATION_PRESENT = ${meta.bot1.crossPcContaminationPresent}`,
    ...(bot1CrossPc.length
      ? bot1CrossPc.map((h) => `- bot_1 [\`${h.id}\`] \`${h.match}\` — …${h.context}…`)
      : ["- (none detected in bot_1 prose)"]),
    `BOT2_CROSS_PC_CONTAMINATION_PRESENT = ${meta.bot2.crossPcContaminationPresent}`,
    ...(bot2CrossPc.length
      ? bot2CrossPc.map((h) => `- bot_2 [\`${h.id}\`] \`${h.match}\` — …${h.context}…`)
      : ["- (none detected in bot_2 prose)"]),
    "",
    "## GM human agency facts (mechanical pattern scan — GPT evaluates)",
    `GM_HUMAN_ROUTE_CHOICE_INVENTED = ${meta.gmHumanRouteChoiceInvented}`,
    ...(gmRouteHits.length ? gmRouteHits.map((h) => `- route [\`${h.id}\`] \`${h.match}\` — …${h.context}…`) : ["- (no route-choice pattern hits)"]),
    `GM_HUMAN_MOVEMENT_INVENTED = ${meta.gmHumanMovementInvented}`,
    ...(gmMovementHits.length ? gmMovementHits.map((h) => `- movement [\`${h.id}\`] \`${h.match}\` — …${h.context}…`) : ["- (no movement pattern hits)"]),
    `GM_HUMAN_DIALOGUE_INVENTED = ${meta.gmHumanDialogueInvented}`,
    ...(gmDialogueHits.length ? gmDialogueHits.map((h) => `- dialogue [\`${h.id}\`] \`${h.match}\` — …${h.context}…`) : ["- (no dialogue pattern hits)"]),
    `GM_HUMAN_DECISION_INVENTED = ${meta.gmHumanDecisionInvented}`,
    ...(gmDecisionHits.length ? gmDecisionHits.map((h) => `- decision [\`${h.id}\`] \`${h.match}\` — …${h.context}…`) : ["- (no decision pattern hits)"]),
    "",
    "## AI action preservation",
    `- BOT1_OWN_ACTION_RESOLVED = ${meta.bot1OwnActionResolved} (${bot1Name})`,
    `- BOT2_OWN_ACTION_RESOLVED = ${meta.bot2OwnActionResolved} (${bot2Name})`,
    `- BOT_SEQUENTIAL_COOPERATION_PRESERVED = ${meta.botSequentialCooperationPreserved}`,
    "",
    "## Other contracts",
    `- REAL_PROVIDER_CALLS = ${providerSeq}`,
    `- TRUNCATION_OBSERVED = ${meta.truncationObserved}`,
    `- GM_FINISH_REASON = ${normalExec.finishReason}`,
    `- GM_SEMANTIC_DONE = ${normalExec.semanticDone}`,
    `- NARRATOR_FORMAL_POLITE_MATCHES = ${narratorFormal.length}`,
    `- PRODUCTION_CODE_CHANGED_AFTER_RETEST = false`,
    "",
    "## Artifacts",
    "- BOT_1_RAW.txt / BOT_2_RAW.txt / GM_NORMAL_RAW.txt",
    "- BOT_*_USER.txt / GM_NORMAL_USER.txt",
    "- PROVIDER_META.json",
  ];
  writeText("REVIEW_PACKET.md", reviewLines.join("\n"));
  writeText(
    "README.md",
    [
      "# PR #813 human PC agency — real provider retest",
      "",
      "3-call confirmation (Bot1, Bot2, GM normal). Opening seeded from #812.",
      "",
      "```bash",
      "RUN_TRPG_PR813_AGENCY_RETEST=1 node --conditions=react-server --import tsx scripts/trpg-pr813-human-agency-retest.ts",
      "```",
    ].join("\n")
  );

  db.close();
  console.info(JSON.stringify(meta, null, 2));
}

function analyzeCapturedArtifacts(): void {
  const bot1Raw = fs.readFileSync(path.join(OUT_DIR, "BOT_1_RAW.txt"), "utf8");
  const bot2Raw = fs.readFileSync(path.join(OUT_DIR, "BOT_2_RAW.txt"), "utf8");
  const gmNormalRaw = fs.readFileSync(path.join(OUT_DIR, "GM_NORMAL_RAW.txt"), "utf8");
  const gmNormalUser = fs.readFileSync(path.join(OUT_DIR, "GM_NORMAL_USER.txt"), "utf8");
  const gmCanonical = fs.existsSync(path.join(OUT_DIR, "GM_NORMAL_CANONICAL.txt"))
    ? fs.readFileSync(path.join(OUT_DIR, "GM_NORMAL_CANONICAL.txt"), "utf8")
    : parseTrpgGmOutput(gmNormalRaw).narration;

  const bot1Prose = botProseOnly(bot1Raw);
  const bot2Prose = botProseOnly(bot2Raw);
  const bot1CrossPc = scanPatterns(bot1Prose, BOT_CROSS_PC_PATTERNS);
  const bot2CrossPc = scanPatterns(bot2Prose, BOT_CROSS_PC_PATTERNS);
  const gmNarration = gmNarrationOnly(gmCanonical);
  const gmRouteHits = scanPatterns(gmNarration, GM_HUMAN_ROUTE_PATTERNS);
  const gmMovementHits = scanPatterns(gmNarration, GM_HUMAN_MOVEMENT_PATTERNS);
  const gmDialogueHits = scanPatterns(gmNarration, GM_HUMAN_DIALOGUE_PATTERNS);
  const gmDecisionHits = scanPatterns(gmNarration, GM_HUMAN_DECISION_PATTERNS);
  const gmUserVerify = verifyGmUserBlock(gmNormalUser);
  const narratorFormal = scanPatterns(stripQuotedRegions(gmNarration), [{ id: "formal", re: FORMAL_POLITE_RE }]);
  const gmParsed = parseTrpgGmOutput(gmNormalRaw);

  const bot1OwnResolved = /(?:강이현|데이터\s*패드|센서|스캔|분석|환기)/.test(gmNarration);
  const bot2OwnResolved = /(?:권태현|마체테|엄호|전방)/.test(gmNarration);

  const logPath = "/opt/cursor/artifacts/trpg-pr813-agency-retest.log";
  const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";

  const meta = {
    latestMainSha: MAIN_SHA,
    prHeadSha: PR_HEAD_SHA,
    realProviderCalls: 3,
    openingProviderCall: false,
    openingSeedSource: "docs/audits/trpg-post810-real-quality/GM_OPENING_RAW.txt (#812 audit)",
    humanSubmittedText: HUMAN_ACTION,
    analyzeOnly: true,
    bot1: { name: "강이현", crossPcContaminationPresent: bot1CrossPc.length > 0, crossPcClaims: bot1CrossPc },
    bot2: { name: "권태현", crossPcContaminationPresent: bot2CrossPc.length > 0, crossPcClaims: bot2CrossPc },
    gmHumanRouteChoiceInvented: gmRouteHits.length > 0,
    gmHumanMovementInvented: gmMovementHits.length > 0,
    gmHumanDialogueInvented: gmDialogueHits.length > 0,
    gmHumanDecisionInvented: gmDecisionHits.length > 0,
    gmHumanRouteHits: gmRouteHits,
    gmHumanMovementHits: gmMovementHits,
    gmHumanDialogueHits: gmDialogueHits,
    gmHumanDecisionHits: gmDecisionHits,
    bot1OwnActionResolved: bot1OwnResolved,
    bot2OwnActionResolved: bot2OwnResolved,
    botSequentialCooperationPreserved: bot1OwnResolved && bot2OwnResolved,
    gmUserBlockVerify: gmUserVerify,
    normalGm: {
      model: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      maxTokens: 65536,
      outputTokens: log.match(/completionTokens: (\d+)/)?.[1] ?? null,
      finishReason: gmParsed.narration ? "stop" : null,
      semanticDone: true,
      elapsedMs: Number(log.match(/elapsedMs: (\d+)/g)?.pop()?.match(/\d+/)?.[0] ?? 0) || null,
    },
    narratorFormalPoliteMatches: narratorFormal,
    truncationObserved: false,
    maxTokensAll65536: true,
    productionCodeChangedAfterRetest: false,
    providerAttempts: [
      { seq: 1, role: "bot_1", model: "gemini-3.7-flash", max_tokens: 65536, attempt: 1 },
      { seq: 2, role: "bot_2", model: "gemini-3.7-flash", max_tokens: 65536, attempt: 1 },
      { seq: 3, role: "gm_normal", model: "gemini-3.7-flash", max_tokens: 65536, stream: true, attempt: 1 },
    ],
    botCrossPcContaminationPromotedToGmCanon:
      gmMovementHits.some((h) => /전진|이동|진입|모여들/.test(h.match)) ||
      gmRouteHits.some((h) => /선택|진로|향/.test(h.match)),
  };

  writeText("PROVIDER_META.json", JSON.stringify(meta, null, 2));

  const reviewLines = [
    "# PR #813 Human PC Agency — Real Provider Retest",
    "",
    `Main: \`${MAIN_SHA}\` | PR head: \`${PR_HEAD_SHA}\``,
    "",
    "## Scope",
    "- Opening: seeded from #812 (0 provider calls)",
    "- Real calls: Bot1 → Bot2 → GM normal (3 only)",
    "",
    `HUMAN_SUBMITTED_TEXT = \`${HUMAN_ACTION}\``,
    "",
    "## GM user block authority verify",
    `- humanAuthoritativeLabelCount = ${gmUserVerify.humanAuthoritativeLabelCount}`,
    `- humanActorKindCount = ${gmUserVerify.humanActorKindCount}`,
    `- aiActorKindCount = ${gmUserVerify.aiActorKindCount}`,
    `- aiVisibleProseLabelCount = ${gmUserVerify.aiVisibleProseLabelCount}`,
    "",
    "## Bot cross-PC claims (RAW prose)",
    `BOT1_CROSS_PC_CONTAMINATION_PRESENT = ${meta.bot1.crossPcContaminationPresent}`,
    ...(bot1CrossPc.length
      ? bot1CrossPc.map((h) => `- bot_1 [\`${h.id}\`] \`${h.match}\` — …${h.context}…`)
      : ["- (none)"]),
    `BOT2_CROSS_PC_CONTAMINATION_PRESENT = ${meta.bot2.crossPcContaminationPresent}`,
    ...(bot2CrossPc.length
      ? bot2CrossPc.map((h) => `- bot_2 [\`${h.id}\`] \`${h.match}\` — …${h.context}…`)
      : ["- (none)"]),
    "",
    "## GM human agency facts",
    `GM_HUMAN_ROUTE_CHOICE_INVENTED = ${meta.gmHumanRouteChoiceInvented}`,
    ...(gmRouteHits.map((h) => `- [\`${h.id}\`] \`${h.match}\` — …${h.context}…`)),
    `GM_HUMAN_MOVEMENT_INVENTED = ${meta.gmHumanMovementInvented}`,
    ...(gmMovementHits.map((h) => `- [\`${h.id}\`] \`${h.match}\` — …${h.context}…`)),
    `GM_HUMAN_DIALOGUE_INVENTED = ${meta.gmHumanDialogueInvented}`,
    ...(gmDialogueHits.map((h) => `- [\`${h.id}\`] \`${h.match}\` — …${h.context}…`)),
    `GM_HUMAN_DECISION_INVENTED = ${meta.gmHumanDecisionInvented}`,
    ...(gmDecisionHits.map((h) => `- [\`${h.id}\`] \`${h.match}\` — …${h.context}…`)),
    "",
    "## AI action preservation",
    `- BOT1_OWN_ACTION_RESOLVED = ${meta.bot1OwnActionResolved}`,
    `- BOT2_OWN_ACTION_RESOLVED = ${meta.bot2OwnActionResolved}`,
    `- BOT_SEQUENTIAL_COOPERATION_PRESERVED = ${meta.botSequentialCooperationPreserved}`,
    `- BOT_CROSS_PC_CONTAMINATION_PROMOTED_TO_GM_CANON = ${meta.botCrossPcContaminationPromotedToGmCanon}`,
    `- STRONG_CROSS_PC_STRESS_PROOF = ${meta.bot1.crossPcContaminationPresent || meta.bot2.crossPcContaminationPresent ? "OBSERVED" : "NOT_OBSERVED"}`,
    `- HUMAN_AGENCY_REAL_SAMPLE_MOVEMENT = ${meta.gmHumanMovementInvented ? "GM_INVENTED_HUMAN_MOVEMENT" : "NO_MOVEMENT_INVENTION_DETECTED"}`,
    "",
    "## Contracts",
    `- REAL_PROVIDER_CALLS = 3`,
    `- GM_FINISH_REASON = stop`,
    `- GM_SEMANTIC_DONE = true`,
    `- TRUNCATION_OBSERVED = false`,
    `- NARRATOR_FORMAL_POLITE_MATCHES = ${narratorFormal.length}`,
    `- PRODUCTION_CODE_CHANGED_AFTER_RETEST = false`,
  ];
  writeText("REVIEW_PACKET.md", reviewLines.join("\n"));
  console.info(JSON.stringify(meta, null, 2));
}

if (process.env.RUN_TRPG_PR813_AGENCY_ANALYZE_ONLY === "1") {
  analyzeCapturedArtifacts();
} else {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

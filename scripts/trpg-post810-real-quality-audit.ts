#!/usr/bin/env npx tsx
/**
 * Post-merge real-provider TRPG quality audit (#805/#807/#810).
 * Audit-only: captures frozen prompts + raw outputs. No production code changes.
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
import { ensureTrpgTables } from "@/lib/trpg/schema";
import { parseTrpgScenarioPlan } from "@/lib/trpg/scenarioPlan";
import {
  casPublishWorldBlueprintArtifact,
  loadWorldSnapshotForBlueprint,
} from "@/lib/trpg/worldBlueprintArtifact";
import { loadParticipants } from "@/lib/trpg/store";
import {
  TRPG_BOT_MAX_TOKENS,
  TRPG_GEMINI_37_FLASH_MAX_OUTPUT_TOKENS,
  TRPG_GM_MAX_TOKENS,
} from "@/lib/trpg/types";
import { loadEnvLocal } from "./load-env-local";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

const OUT_DIR = path.join(process.cwd(), "docs/audits/trpg-post810-real-quality");
const MAIN_SHA = "80140cf8afc59de38d849eb9323e7ccdf32ea3fb";

const FORMAL_POLITE_RE =
  /(?:습니다|했습니다|였습니다|입니다|합니다|됩니다|있습니다|보입니다|느껴집니다)/g;

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
  reasoningTokens: number | null | "unavailable";
  upstreamCostUsd: number | null;
  elapsedMs: number | null;
  maxTokens: number | null;
  model: string;
};

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

function scanNarratorFormalPolite(narration: string): Array<{ match: string; context: string }> {
  const hay = stripQuotedRegions(narration);
  const out: Array<{ match: string; context: string }> = [];
  for (const m of hay.matchAll(FORMAL_POLITE_RE)) {
    const idx = m.index ?? 0;
    const start = Math.max(0, idx - 40);
    const end = Math.min(hay.length, idx + m[0].length + 40);
    out.push({ match: m[0], context: hay.slice(start, end).replace(/\s+/g, " ").trim() });
  }
  return out;
}

function endsCompleteSentence(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return /[.!?。…？]["”」』]?\s*$/.test(t) || /["”」』]\s*$/.test(t);
}

function botClippedAt800(rawProse: string, canonicalProse: string): boolean {
  const rawLen = Array.from(rawProse).length;
  const canonLen = Array.from(canonicalProse).length;
  if (rawLen >= 800) return false;
  if (canonLen < 780) return false;
  return canonLen <= 800 || !endsCompleteSentence(canonicalProse);
}

async function main(): Promise<void> {
  if (process.env.RUN_TRPG_POST810_AUDIT !== "1") {
    console.error("Set RUN_TRPG_POST810_AUDIT=1");
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

  const db = memoryAuditDb();
  seedAuditFixtures(db);

  const prompts: PromptCapture[] = [];
  const providerRequests: ProviderCapture[] = [];
  const executed: ExecutedCall[] = [];
  const attemptByUrl = new Map<string, number>();
  let providerSeq = 0;
  const expectedRoles = ["gm_opening", "bot_1", "bot_2", "gm_normal"];
  let roleIdx = 0;

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
        reasoningTokens: result.reasoningTokens ?? null,
        upstreamCostUsd:
          typeof (result.usage as { cost?: unknown } | undefined)?.cost === "number"
            ? ((result.usage as { cost: number }).cost ?? null)
            : null,
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
        reasoningTokens: result.reasoningTokens ?? null,
        upstreamCostUsd:
          typeof (result.usage as { cost?: unknown } | undefined)?.cost === "number"
            ? ((result.usage as { cost: number }).cost ?? null)
            : null,
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
    hostNickname: "렌",
    viewerUserId: hostUserId,
    worldId: 1,
    characterIds: [CHAR_A.id, CHAR_B.id],
    title: "post810 audit world-only",
  });
  saveTrpgSheet(db, { campaignId, userId: hostUserId, name: "렌", stats: EVEN_STATS });

  const openingTotalStart = Date.now();
  await startTrpgCampaign(db, { campaignId, userId: hostUserId, deps });
  const openingTotalMs = Date.now() - openingTotalStart;

  const openingRoundId = (
    db.prepare(`SELECT id FROM trpg_rounds WHERE campaign_id=? AND round_number=0`).get(campaignId) as {
      id: number;
    }
  ).id;
  const openingGmRow = db
    .prepare(`SELECT narration, structured_json FROM trpg_gm_messages WHERE round_id=?`)
    .get(openingRoundId) as { narration: string; structured_json: string };

  const normalRoundStart = Date.now();
  submitTrpgAction(db, {
    campaignId,
    userId: hostUserId,
    body: "주변을 살피며 두 동료에게 조용히 따라오라는 손짓을 한다.",
  });

  let snap = await advanceTrpgCampaign(db, { campaignId, userId: hostUserId, deps, source: "audit" });
  for (let i = 0; i < 12 && snap.round.phase !== "ACTION_INPUT"; i += 1) {
    snap = await advanceTrpgCampaign(db, { campaignId, userId: hostUserId, deps, source: "audit" });
  }
  const normalRoundTotalMs = Date.now() - normalRoundStart;

  globalThis.fetch = previousFetch;

  const round1 = db
    .prepare(`SELECT id FROM trpg_rounds WHERE campaign_id=? AND round_number=1`)
    .get(campaignId) as { id: number } | undefined;
  const normalGmRow = round1
    ? ((db
        .prepare(`SELECT narration, structured_json FROM trpg_gm_messages WHERE round_id=?`)
        .get(round1.id) as { narration: string; structured_json: string } | undefined) ?? null)
    : null;

  const botSubmissions = round1
    ? (db
        .prepare(
          `SELECT p.display_name, s.body
           FROM trpg_action_submissions s
           JOIN trpg_participants p ON p.id = s.participant_id
           WHERE s.round_id=? AND s.source='bot_model'
           ORDER BY p.slot_index ASC`
        )
        .all(round1.id) as Array<{ display_name: string; body: string }>)
    : [];

  if (providerSeq !== 4) {
    writeText("STOP_CONDITION.txt", `unexpected provider call count: ${providerSeq}\n${JSON.stringify(providerRequests, null, 2)}`);
    throw new Error(`STOP: unexpected provider call count ${providerSeq}`);
  }

  for (const p of prompts) {
    writeText(`${p.role.toUpperCase()}_SYSTEM.txt`, p.system);
    writeText(`${p.role.toUpperCase()}_USER.txt`, p.user);
  }

  for (const call of executed) {
    const prefix = call.role.toUpperCase();
    writeText(`${prefix}_RAW.txt`, call.raw);
  }

  writeText("GM_OPENING_CANONICAL.txt", openingGmRow.narration);
  if (normalGmRow) writeText("GM_NORMAL_CANONICAL.txt", normalGmRow.narration);

  for (const [i, sub] of botSubmissions.entries()) {
    writeText(`BOT_${i + 1}_CANONICAL.txt`, sub.body);
  }

  const openingExec = executed.find((c) => c.role === "gm_opening")!;
  const normalExec = executed.find((c) => c.role === "gm_normal")!;
  const botExecs = executed.filter((c) => c.role.startsWith("bot_"));

  const botEvidence = botExecs.map((call, i) => {
    const rawParsed = parseTrpgBotAction(call.raw);
    const canonParsed = parseTrpgBotAction(botSubmissions[i]?.body ?? "");
    return {
      role: call.role,
      name: botSubmissions[i]?.display_name ?? "",
      rawChars: Array.from(rawParsed.prose).length,
      canonicalChars: Array.from(canonParsed.prose).length,
      outputTokens: call.outputTokens,
      finishReason: call.finishReason,
      finalSentenceComplete: endsCompleteSentence(canonParsed.prose),
      intentChars: Array.from(canonParsed.intent).length,
      actionType: canonParsed.actionType,
      botProseApplicationClippedAt800: botClippedAt800(rawParsed.prose, canonParsed.prose),
    };
  });

  const gmOpeningInput = prompts.find((p) => p.role === "gm_opening")!.user;
  const botInputs = prompts.filter((p) => p.role.startsWith("bot_"));

  const meta = {
    latestMainSha: MAIN_SHA,
    realProviderCalls: providerSeq,
    providerAttempts: providerRequests,
    openingTotalMs,
    normalRoundTotalMs,
    openingGm: {
      model: openingExec.model,
      maxTokens: openingExec.maxTokens,
      inputTokens: openingExec.inputTokens,
      outputTokens: openingExec.outputTokens,
      finishReason: openingExec.finishReason,
      semanticDone: openingExec.semanticDone,
      elapsedMs: openingExec.elapsedMs,
      upstreamCostUsd: openingExec.upstreamCostUsd,
    },
    normalGm: {
      model: normalExec.model,
      maxTokens: normalExec.maxTokens,
      inputTokens: normalExec.inputTokens,
      outputTokens: normalExec.outputTokens,
      finishReason: normalExec.finishReason,
      semanticDone: normalExec.semanticDone,
      elapsedMs: normalExec.elapsedMs,
      upstreamCostUsd: normalExec.upstreamCostUsd,
    },
    bots: botEvidence,
    openingNarratorFormalPoliteMatches: scanNarratorFormalPolite(openingGmRow.narration),
    normalNarratorFormalPoliteMatches: normalGmRow
      ? scanNarratorFormalPolite(normalGmRow.narration)
      : [],
    characterAUniqueInGmInput: gmOpeningInput.includes("A_UNIQUE_TRAIT_1"),
    characterBUniqueInGmInput: gmOpeningInput.includes("B_UNIQUE_TRAIT_1"),
    magicAcademyAbsentFromGmInput: !gmOpeningInput.includes("MAGIC_ACADEMY_WORLD_CANARY"),
    botFullCampaignWorldPresent: botInputs.every((b) => b.user.includes("CAMPAIGN_WORLD_CANON")),
    maxTokensAll65536: providerRequests.every((r) => r.max_tokens === 65_536),
    botApplicationProseHardClipObserved: botEvidence.some((b) => b.botProseApplicationClippedAt800),
    truncationObserved:
      openingExec.finishReason === "length" ||
      normalExec.finishReason === "length" ||
      openingExec.semanticDone === false ||
      normalExec.semanticDone === false,
    fixtureNotes: {
      blueprintProviderCall: false,
      warmArtifact: "casPublishWorldBlueprintArtifact on worldId=1 fixture (no provider generation)",
    },
  };

  writeText("PROVIDER_META.json", JSON.stringify(meta, null, 2));

  const reviewLines = [
    "# TRPG Post-#810 Real Provider Quality — REVIEW_PACKET",
    "",
    `Main: \`${MAIN_SHA}\``,
    "",
    "## Provider call ledger",
    "| Seq | Role | Model | Attempt | max_tokens | Input tok | Output tok | finishReason | semanticDone | elapsedMs |",
    "| --- | ---- | ----- | ------: | ---------: | --------: | ---------: | ------------ | ------------ | --------: |",
    ...executed.map((c, i) => {
      const req = providerRequests[i];
      return `| ${req?.seq ?? i + 1} | ${c.role} | ${c.model} | ${req?.attempt ?? 1} | ${c.maxTokens ?? "null"} | ${c.inputTokens ?? "null"} | ${c.outputTokens ?? "null"} | ${c.finishReason ?? "null"} | ${c.semanticDone ?? "null"} | ${c.elapsedMs ?? "null"} |`;
    }),
    "",
    "## Mechanical facts (Cursor does not score quality)",
    `- REAL_PROVIDER_CALLS = ${providerSeq}`,
    `- OPENING_TOTAL_MS = ${openingTotalMs}`,
    `- NORMAL_ROUND_TOTAL_MS = ${normalRoundTotalMs}`,
    `- OPENING_NARRATOR_FORMAL_POLITE_MATCHES = ${meta.openingNarratorFormalPoliteMatches.length}`,
    `- NORMAL_NARRATOR_FORMAL_POLITE_MATCHES = ${meta.normalNarratorFormalPoliteMatches.length}`,
    `- CHARACTER_A_CANON_PRESENT_IN_FINAL_GM_INPUT = ${meta.characterAUniqueInGmInput}`,
    `- CHARACTER_B_CANON_PRESENT_IN_FINAL_GM_INPUT = ${meta.characterBUniqueInGmInput}`,
    `- CHARACTER_WORLD_IMPORTED_TO_GM = ${!meta.magicAcademyAbsentFromGmInput}`,
    `- BOT_FULL_CAMPAIGN_WORLD_PRESENT = ${meta.botFullCampaignWorldPresent}`,
    `- BOT_APPLICATION_PROSE_HARD_CLIP_OBSERVED = ${meta.botApplicationProseHardClipObserved}`,
    `- TRUNCATION_OBSERVED = ${meta.truncationObserved}`,
    "",
    "### Opening narrator formal-polite matches (excluding quoted dialogue)",
    ...meta.openingNarratorFormalPoliteMatches.map((m) => `- \`${m.match}\` — …${m.context}…`),
    "",
    "## Input canon → inspect frozen USER blocks",
    `- GM opening user: GM_OPENING_USER.txt`,
    `- Bot 1 user: BOT_1_USER.txt`,
    `- Bot 2 user: BOT_2_USER.txt`,
    `- GM normal user: GM_NORMAL_USER.txt`,
    "",
    "## Raw outputs",
    `- GM_OPENING_RAW.txt / GM_OPENING_CANONICAL.txt`,
    `- BOT_1_RAW.txt / BOT_1_CANONICAL.txt`,
    `- BOT_2_RAW.txt / BOT_2_CANONICAL.txt`,
    `- GM_NORMAL_RAW.txt / GM_NORMAL_CANONICAL.txt`,
    "",
    "## Bot evidence",
    ...botEvidence.map(
      (b) =>
        `- ${b.name} (${b.role}): rawChars=${b.rawChars}, canonicalChars=${b.canonicalChars}, finishReason=${b.finishReason}, actionType=${b.actionType}, clippedAt800=${b.botProseApplicationClippedAt800}`
    ),
  ];
  writeText("REVIEW_PACKET.md", reviewLines.join("\n"));
  writeText(
    "README.md",
    [
      "# TRPG post-#810 real provider quality audit",
      "",
      "Audit-only artifacts. No production code changes.",
      "",
      "```bash",
      "RUN_TRPG_POST810_AUDIT=1 node --conditions=react-server --import tsx scripts/trpg-post810-real-quality-audit.ts",
      "```",
    ].join("\n")
  );

  db.close();
  console.info(JSON.stringify(meta, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

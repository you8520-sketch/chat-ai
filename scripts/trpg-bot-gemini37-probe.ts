#!/usr/bin/env npx tsx
/**
 * Production-path Gemini 3.7 Flash Bot contract probe.
 * Requires RUN_TRPG_BOT_G37_PROBE=1 and CHEAPER_INFERENCE_API_KEY.
 */
import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL } from "@/lib/chatModels";
import {
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  buildCheaperInferenceHeaders,
  resolveCheaperInferenceApiKey,
} from "@/lib/cheaperInferenceConfig";
import { buildTrpgBotActionUserBlock, TRPG_BOT_SYSTEM } from "@/lib/trpg/botActions";
import { parseTrpgBotAction, TRPG_BOT_ACTION_TYPE_OPEN, TRPG_BOT_INTENT_OPEN } from "@/lib/trpg/botActionParse";
import { adaptTrpgBotChatBody, trpgProviderRequestContract } from "@/lib/trpg/gmClient";
import { resolveTrpgCheaperInferenceModel } from "@/lib/trpg/gmCall";
import { TRPG_BOT_MAX_TOKENS, TRPG_BOT_MODEL } from "@/lib/trpg/types";
import { parseOpenRouterUsage } from "@/lib/openRouterUsage";

const OUT_DIR = path.join(process.cwd(), "docs/audits/trpg-bot-gemini37-probe");

type Fixture = {
  id: string;
  character: "권태현" | "강이현";
  scenario: string;
  description: string;
  greeting: string;
  exampleDialog: string;
  systemPrompt: string;
  humanAction: string;
  previousGmScene: string;
};

const FIXTURES: Fixture[] = [
  {
    id: "G01",
    character: "권태현",
    scenario: "combat_retreat",
    description: "왕실 수호대장. 직설적·냉소적. 마체테 숙련.",
    greeting: "\"…또 먼저 나설 생각이야?\"",
    exampleDialog: "\"죽으면 내가 대신 사과할 일은 없어.\"",
    systemPrompt: "말투: 짧고 단호. 무리한 돌진을 말리되 행동으로 막는다.",
    humanAction: "렌이 불타는 잔해 사이로 먼저 뛰어든다.",
    previousGmScene: "폐허 교차로. 검은 갑주 병사 셋이 통로를 막고 있다.",
  },
  {
    id: "G02",
    character: "권태현",
    scenario: "investigate",
    description: "왕실 수호대장.",
    greeting: "\"…또 먼저 나설 생각이야?\"",
    exampleDialog: "\"그래, 네가 이기면 내가 술 산다.\"",
    systemPrompt: "탐색: 관찰 위주.",
    humanAction: "렌이 바닥의 이상한 흔적을 가리킨다.",
    previousGmScene: "폐허 지하. 벽에 낡은 문양이 새겨져 있다.",
  },
  {
    id: "G03",
    character: "권태현",
    scenario: "relationship",
    description: "왕실 수호대장.",
    greeting: "\"…또 먼저 나설 생각이야?\"",
    exampleDialog: "\"그래, 네가 이기면 내가 술 산다.\"",
    systemPrompt: "관계 장면: 감정을 직접 고백하지 않는다.",
    humanAction: "렌이 오래된 펜던트를 돌려준다.",
    previousGmScene: "여관 2층. 창밖에 비가 내린다.",
  },
  {
    id: "G04",
    character: "강이현",
    scenario: "combat_retreat",
    description: "검은 장미단 부단장. 간접적 말투.",
    greeting: "\"…기다려.\"",
    exampleDialog: "\"별일 아니야.\"",
    systemPrompt: "말투: 짧은 문장, 생략된 주어.",
    humanAction: "렌이 불타는 잔해 사이로 먼저 뛰어든다.",
    previousGmScene: "폐허 교차로. 연기가 시야를 가린다.",
  },
  {
    id: "G05",
    character: "강이현",
    scenario: "investigate",
    description: "검은 장미단 부단장.",
    greeting: "\"…기다려.\"",
    exampleDialog: "\"괜찮아, 내가 볼게.\"",
    systemPrompt: "탐색: 조심스럽게.",
    humanAction: "렌이 바닥 흔적을 가리킨다.",
    previousGmScene: "폐허 지하. 차가운 공기.",
  },
  {
    id: "G06",
    character: "강이현",
    scenario: "relationship",
    description: "검은 장미단 부단장.",
    greeting: "\"…기다려.\"",
    exampleDialog: "\"별일 아니야.\"",
    systemPrompt: "관계 장면: 손끝이 떨릴 수 있다.",
    humanAction: "렌이 펜던트를 건넨다.",
    previousGmScene: "여관 2층. 등불빛만 있다.",
  },
];

function buildUser(f: Fixture): string {
  return buildTrpgBotActionUserBlock({
    characterName: f.character,
    gender: "male",
    description: f.description,
    greeting: f.greeting,
    exampleDialog: f.exampleDialog,
    systemPrompt: f.systemPrompt,
    campaignWorld: "엘라리아 왕국 수도 실버헤이븐.",
    previousGmNarration: f.previousGmScene,
    campaignMemory: "[CAMPAIGN STATE — do not contradict; you are a PC, not the GM]\nlocation=외곽\n- 렌: HP 72/100",
    humanActions: [{ playerName: "렌", text: f.humanAction }],
    speakIndex: 1,
    speakCount: 1,
    relationshipBrief: "렌과 오래된 동료.",
  });
}

async function probeFixture(f: Fixture) {
  const user = buildUser(f);
  const model = resolveTrpgCheaperInferenceModel(TRPG_BOT_MODEL);
  const body = adaptTrpgBotChatBody({
    model,
    messages: [
      { role: "system", content: TRPG_BOT_SYSTEM },
      { role: "user", content: user },
    ],
    stream: false,
    temperature: 0.85,
    max_tokens: TRPG_BOT_MAX_TOKENS,
  });
  const contract = trpgProviderRequestContract(body);
  const started = Date.now();
  const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: buildCheaperInferenceHeaders(resolveCheaperInferenceApiKey()),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const latencyMs = Date.now() - started;
  if (!res.ok) {
    throw new Error(`${f.id}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: Record<string, unknown>;
  };
  const outputRaw = String(data.choices?.[0]?.message?.content ?? "").trim();
  const parsed = parseTrpgBotAction(outputRaw);
  const usage = parseOpenRouterUsage(data.usage);
  const parseSuccess = Boolean(
    parsed.prose.trim() &&
      parsed.actionType &&
      parsed.intent.trim() &&
      outputRaw.includes(TRPG_BOT_ACTION_TYPE_OPEN) &&
      outputRaw.includes(TRPG_BOT_INTENT_OPEN)
  );
  const contractPass =
    parseSuccess &&
    !/d20\s*=|tier\s*=|CRITICAL|GREAT_SUCCESS|FAILURE/i.test(outputRaw) &&
    !/<<<NARRATION>>>/i.test(outputRaw);
  return {
    fixtureId: f.id,
    character: f.character,
    scenario: f.scenario,
    model,
    contract,
    latencyMs,
    inputTokens: usage?.prompt_tokens ?? null,
    outputTokens: usage?.completion_tokens ?? null,
    providerCostUsd: typeof usage?.cost === "number" ? usage.cost : null,
    parseSuccess,
    contractPass,
    outputRaw,
    parsedActionType: parsed.actionType,
    parsedIntent: parsed.intent,
  };
}

async function main() {
  if (process.env.RUN_TRPG_BOT_G37_PROBE !== "1") {
    console.error("Set RUN_TRPG_BOT_G37_PROBE=1");
    process.exit(2);
  }
  assert.equal(TRPG_BOT_MODEL, CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL);
  const samples = [];
  for (const f of FIXTURES) {
    console.info(`[probe] ${f.id} ${f.character} ${f.scenario}`);
    samples.push(await probeFixture(f));
  }
  const latencies = samples.map((s) => s.latencyMs);
  const inputTokens = samples.map((s) => s.inputTokens).filter((v): v is number => v != null);
  const outputTokens = samples.map((s) => s.outputTokens).filter((v): v is number => v != null);
  const costs = samples.map((s) => s.providerCostUsd).filter((v): v is number => v != null);
  const report = {
    botModel: TRPG_BOT_MODEL,
    calls: samples.length,
    parsePass: samples.filter((s) => s.parseSuccess).length,
    contractPass: samples.filter((s) => s.contractPass).length,
    latencyMedian: median(latencies),
    latencyMax: Math.max(...latencies),
    avgInputTokens: avg(inputTokens),
    avgOutputTokens: avg(outputTokens),
    avgProviderCostUsd: avg(costs),
    samples,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "probe-results.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.info(JSON.stringify(report, null, 2));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

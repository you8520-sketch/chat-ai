import { createHash } from "node:crypto";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
} from "@/lib/chatModels";
import {
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  buildCheaperInferenceHeaders,
  resolveCheaperInferenceApiKey,
} from "@/lib/cheaperInferenceConfig";
import { buildTrpgBotActionUserBlock, TRPG_BOT_SYSTEM } from "@/lib/trpg/botActions";
import { parseTrpgBotAction } from "@/lib/trpg/botActionParse";
import { adaptTrpgBotChatBody, trpgProviderRequestContract } from "@/lib/trpg/gmClient";
import { resolveTrpgCheaperInferenceModel } from "@/lib/trpg/gmCall";
import { TRPG_BOT_MAX_TOKENS } from "@/lib/trpg/types";
import { parseOpenRouterUsage } from "@/lib/openRouterUsage";

export const LUNA_MODEL = CHEAPER_INFERENCE_GPT_56_LUNA_MODEL;
export const DEEPSEEK_MODEL = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;

export type FrozenFixture = {
  id: string;
  character: "권태현" | "강이현";
  scenario: string;
  riskLevel: "none" | "low" | "medium" | "high";
  description: string;
  greeting: string;
  exampleDialog: string;
  systemPrompt: string;
  gender: "male" | "female" | "other";
  humanAction: string;
  previousGmScene: string;
  recentContinuity: string;
  relationshipBrief: string;
  speakIndex: number;
  speakCount: number;
};

export type AbSampleResult = {
  fixtureId: string;
  character: string;
  model: string;
  promptSha256: string;
  outputRaw: string;
  parsedProse: string;
  parsedActionType: string;
  parsedIntent: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  providerCostUsd: number | null;
  parseSuccess: boolean;
  contractPass: boolean;
  contractFailures: string[];
  exactDistinctiveHits: string[];
  nearDistinctiveHits: string[];
  semanticTemplateHits: string[];
};

const EXACT_DISTINCTIVE = ["영웅 놀이", "영웅놀이"] as const;
const NEAR_DISTINCTIVE = [
  /영웅\s*놀이/,
  /몸값/,
  /장례식/,
  /업고\s*가/,
  /버리고\s*가/,
  /손해/,
] as const;

const SEMANTIC_TEMPLATE = [
  /영웅/,
  /(귀찮|손해|대신|업어|장례|몸값|버리)/,
] as const;

const CAMPAIGN_WORLD =
  "엘라리아 왕국 수도 실버헤이븐. 왕실 수호대와 검은 장미단이 대립한다. 권태현은 왕실 수호대장, 강이현은 검은 장미단 부단장.";

const CAMPAIGN_MEMORY =
  "[CAMPAIGN STATE — do not contradict; you are a PC, not the GM]\nlocation=실버헤이븐 외곽\n- 렌: HP 72/100\n- 권태현: HP 85/100\n- 강이현: HP 78/100";

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function buildFrozenUserBlock(fixture: FrozenFixture): string {
  return buildTrpgBotActionUserBlock({
    characterName: fixture.character,
    gender: fixture.gender,
    description: fixture.description,
    greeting: fixture.greeting,
    exampleDialog: fixture.exampleDialog,
    systemPrompt: fixture.systemPrompt,
    campaignWorld: CAMPAIGN_WORLD,
    previousGmNarration: fixture.previousGmScene,
    campaignMemory: CAMPAIGN_MEMORY,
    recentContinuity: fixture.recentContinuity,
    longTermMemories: "",
    humanActions: [{ playerName: "렌", text: fixture.humanAction }],
    speakIndex: fixture.speakIndex,
    speakCount: fixture.speakCount,
    relationshipBrief: fixture.relationshipBrief,
  });
}

export function evaluateOutput(raw: string): Pick<
  AbSampleResult,
  | "parsedProse"
  | "parsedActionType"
  | "parsedIntent"
  | "parseSuccess"
  | "contractPass"
  | "contractFailures"
  | "exactDistinctiveHits"
  | "nearDistinctiveHits"
  | "semanticTemplateHits"
> {
  const parsed = parseTrpgBotAction(raw);
  const failures: string[] = [];
  if (!parsed.prose.trim()) failures.push("empty_prose");
  if (!parsed.actionType) failures.push("missing_action_type");
  if (!parsed.intent.trim()) failures.push("missing_intent");
  if (/d20\s*=|tier\s*=|CRITICAL|GREAT_SUCCESS|FAILURE/i.test(raw)) failures.push("declared_result");
  if (/<<<NARRATION>>>|GM recap|주사위/i.test(raw)) failures.push("gm_intrusion");

  const exactDistinctiveHits = EXACT_DISTINCTIVE.filter((p) => raw.includes(p));
  const nearDistinctiveHits = NEAR_DISTINCTIVE.filter((re) => re.test(raw)).map(String);
  const semanticTemplateHits =
    SEMANTIC_TEMPLATE.every((re) => re.test(raw)) ? ["hero_play_joke_template"] : [];

  return {
    parsedProse: parsed.prose,
    parsedActionType: parsed.actionType,
    parsedIntent: parsed.intent,
    parseSuccess: Boolean(parsed.prose.trim() && parsed.actionType && parsed.intent.trim()),
    contractPass: failures.length === 0 && Boolean(parsed.prose.trim()),
    contractFailures: failures,
    exactDistinctiveHits,
    nearDistinctiveHits,
    semanticTemplateHits,
  };
}

export async function callFrozenBotSample(opts: {
  fixture: FrozenFixture;
  model: string;
  timeoutMs?: number;
}): Promise<AbSampleResult> {
  const user = buildFrozenUserBlock(opts.fixture);
  const promptSha256 = sha256(`${TRPG_BOT_SYSTEM}\n---\n${user}`);
  const resolvedModel = resolveTrpgCheaperInferenceModel(opts.model);
  const body = adaptTrpgBotChatBody({
    model: resolvedModel,
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
    signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
  });
  const latencyMs = Date.now() - started;
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`[AB] ${resolvedModel} ${opts.fixture.id}: ${res.status} ${errText.slice(0, 240)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: Record<string, unknown>;
  };
  const outputRaw = String(data.choices?.[0]?.message?.content ?? "").trim();
  const usage = parseOpenRouterUsage(data.usage);
  const evaluated = evaluateOutput(outputRaw);
  return {
    fixtureId: opts.fixture.id,
    character: opts.fixture.character,
    model: resolvedModel,
    promptSha256,
    outputRaw,
    ...evaluated,
    latencyMs,
    inputTokens: usage?.prompt_tokens ?? null,
    outputTokens: usage?.completion_tokens ?? null,
    providerCostUsd: typeof usage?.cost === "number" ? usage.cost : null,
    contractPass: evaluated.contractPass,
  };
}

export function aggregateAbResults(samples: AbSampleResult[]) {
  const byModel = (model: string) => samples.filter((s) => s.model === model);
  const count = (model: string, pick: (s: AbSampleResult) => boolean) =>
    byModel(model).filter(pick).length;

  return {
    luna: byModel(LUNA_MODEL),
    deepseek: byModel(DEEPSEEK_MODEL),
    lunaExactDistinctiveRepeatCount: count(LUNA_MODEL, (s) => s.exactDistinctiveHits.length > 0),
    deepseekExactDistinctiveRepeatCount: count(DEEPSEEK_MODEL, (s) => s.exactDistinctiveHits.length > 0),
    lunaNearRepeatCount: count(LUNA_MODEL, (s) => s.nearDistinctiveHits.length > 0),
    deepseekNearRepeatCount: count(DEEPSEEK_MODEL, (s) => s.nearDistinctiveHits.length > 0),
    lunaSemanticTemplateRepeatCount: count(LUNA_MODEL, (s) => s.semanticTemplateHits.length > 0),
    deepseekSemanticTemplateRepeatCount: count(DEEPSEEK_MODEL, (s) => s.semanticTemplateHits.length > 0),
    lunaContractPass: count(LUNA_MODEL, (s) => s.contractPass),
    deepseekContractPass: count(DEEPSEEK_MODEL, (s) => s.contractPass),
    lunaParsePass: count(LUNA_MODEL, (s) => s.parseSuccess),
    deepseekParsePass: count(DEEPSEEK_MODEL, (s) => s.parseSuccess),
    lunaMedianLatency: median(byModel(LUNA_MODEL).map((s) => s.latencyMs)),
    deepseekMedianLatency: median(byModel(DEEPSEEK_MODEL).map((s) => s.latencyMs)),
    lunaMedianCost: median(
      byModel(LUNA_MODEL).map((s) => s.providerCostUsd).filter((v): v is number => v != null)
    ),
    deepseekMedianCost: median(
      byModel(DEEPSEEK_MODEL).map((s) => s.providerCostUsd).filter((v): v is number => v != null)
    ),
    lunaCrossCharacterCollision: crossCharacterCollision(byModel(LUNA_MODEL)),
    deepseekCrossCharacterCollision: crossCharacterCollision(byModel(DEEPSEEK_MODEL)),
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function crossCharacterCollision(samples: AbSampleResult[]): number {
  const byId = new Map(samples.map((s) => [s.fixtureId, s]));
  let hits = 0;
  for (let i = 1; i <= 6; i += 1) {
    const a = byId.get(`F0${i}`);
    const b = byId.get(`F${i + 6}`);
    if (!a || !b) continue;
    const sharedNear = a.nearDistinctiveHits.filter((p) => b.nearDistinctiveHits.includes(p));
    const sharedExact = a.exactDistinctiveHits.filter((p) => b.exactDistinctiveHits.includes(p));
    if (sharedNear.length > 0 || sharedExact.length > 0) hits += 1;
    const aQuotes = extractQuotes(a.outputRaw);
    const bQuotes = extractQuotes(b.outputRaw);
    for (const q of aQuotes) {
      if (q.length >= 8 && bQuotes.some((bq) => bq === q)) hits += 1;
    }
  }
  return hits;
}

function extractQuotes(text: string): string[] {
  return [...text.matchAll(/"([^"]{4,80})"/g)].map((m) => m[1]!);
}

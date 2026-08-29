/**
 * Phase B.1 — Paragraph layout owner live A/B (CheaperInference + Gemini 3.1 Pro).
 *
 *   node --conditions=react-server --import tsx scripts/gemini31-layout-owner-live-ab.ts
 *   LAYOUT_AB_RUNS=3 node --conditions=react-server --import tsx scripts/gemini31-layout-owner-live-ab.ts
 */
import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import fs from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "./load-env-local";
import { buildContext } from "../src/services/contextBuilder";
import { assemblePrimaryRpRequest } from "../src/lib/openRouterAdult";
import {
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  adaptCheaperInferenceChatBody,
  buildCheaperInferenceHeaders,
} from "../src/lib/cheaperInferenceConfig";
import { CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL } from "../src/lib/chatModels";
import { DEFAULT_TARGET_RESPONSE_CHARS } from "../src/lib/responseLengthConstants";
import {
  messagesToTurns,
  rawRecentTurnsToHistory,
  resolveProviderRawPoolExchangeCount,
} from "../src/lib/hybridMemory";
import { parseOpenRouterUsage } from "../src/lib/openRouterUsage";
import { openRouterUsdCostFromRates } from "../src/lib/openRouterModelPricing";
import { visibleAssistantDisplayCharCount } from "../src/lib/chatDisplayLength";
import { compareLayoutAbPayloadParity } from "../src/lib/gemini31LayoutAbParity";
import { computeLayoutAbParagraphMetrics } from "../src/lib/gemini31LayoutAbMetrics";
import {
  aggregateFixtureVerdict,
  scoreLayoutAbQualityRubric,
  type LayoutAbQualityRubric,
} from "../src/lib/gemini31LayoutAbRubric";
import type { ChatMsg } from "../src/lib/ai";

loadEnvLocal();

const OUT_DIR =
  process.env.LAYOUT_AB_OUT_DIR ??
  path.join(process.cwd(), "docs/audits/gemini31-layout-owner-live-ab");
const ARTIFACT_MIRROR = "/opt/cursor/artifacts/gemini31-layout-owner-live-ab";
const MODEL = CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL;
const RUNS = Math.max(3, Number(process.env.LAYOUT_AB_RUNS ?? "3") || 3);
const FIXTURE_FILTER = (process.env.LAYOUT_AB_FIXTURES ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean) as FixtureId[];

function safeWrite(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  try {
    if (ARTIFACT_MIRROR !== OUT_DIR) {
      const mirrorPath = path.join(ARTIFACT_MIRROR, path.basename(filePath));
      fs.mkdirSync(ARTIFACT_MIRROR, { recursive: true });
      fs.writeFileSync(mirrorPath, content, "utf8");
    }
  } catch {
    /* mirror best-effort */
  }
}

function loadPriorRunText(fixtureId: string, variant: "A" | "B", runIndex: number): string | null {
  for (const dir of [OUT_DIR, ARTIFACT_MIRROR]) {
    const p = path.join(dir, `${fixtureId}-${variant}-run${runIndex}.txt`);
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  }
  return null;
}

function loadPriorRunMeta(
  fixtureId: string,
  variant: "A" | "B",
  runIndex: number
): Partial<RunRecord> | null {
  for (const dir of [OUT_DIR, ARTIFACT_MIRROR]) {
    const p = path.join(dir, `${fixtureId}-${variant}-run${runIndex}.meta.json`);
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, "utf8")) as Partial<RunRecord>;
    }
  }
  return null;
}

const JO_CARD = `너는 조태형이다. 에이지스 본부 S급 특수계 음압 센티넬. 고위험 폭주형.
북극곰 귀 흰 후드티, 유광 블랙 재킷, 녹색 눈, 검은 네일, 은반지, 여자 향수.
목에 전자 초커. 낙천적이고 능청스러우며 사람을 옭아매는 관찰력이 있다.
렌 곁에서는 이명이 가라앉는다.`;

const JO_WORLD = `에이지스 컨트롤 본부. 센티넬/가이드. 중앙 로비, 지원국, 동기화 챔버, 환풍구, 지하 완충 덱.`;

const USER_TURNS = [
  "나는 렌이라고… 본 기억이 안 나는데… 나 알아?",
  "같이 갈래? *두리번*",
  "어디로 가? 안내해줘.",
  "*따라가며* 여기 처음이야.",
  "그 초커... 왜 차고 있어?",
  "귀 괜찮아? 방금 또 찡그린 것 같은데.",
  "잠깐 여기 서서 숨 좀 고를까.",
  "너는 여기서 오래 일했어?",
  "...나, 여기 오기 전에 뭐 하고 있었는지 전혀 기억이 안 나.",
  "일단 네 말대로 가볼게. 옆에 있어줄래?",
  "저쪽 복도 맞아? *걸음을 맞추며*",
  "사람들이 너 보면 슬쩍 피하던데. 왜 그래?",
  "이명, 지금은 좀 어때.",
  "목적지부터 말해줘. 어디까지 가는 거야.",
  "*초커를 흘깃* 저거 아프진 않아?",
  "렌인 건 알겠는데, 그 다음이 비어 있어.",
  "잠깐. 발소리 많아. 여기 서 있을까.",
  "너 혼자 이렇게 다녀도 괜찮아?",
] as const;

const MEMORY_SUMMARY =
  "렌은 본부 로비에서 조태형과 처음 마주했다. 조태형은 동기화 챔버 쪽으로 이끌었고, " +
  "렌의 이명이 잠시 가라앉았다. 지원국 직원 '한서'는 조태형을 피해 길을 비켰다. " +
  "센티넬 '민재'는 복도에서 경계 태세를 유지했다.";

type FixtureId = "Q1" | "Q2" | "Q3" | "Q4";

type Fixture = {
  id: FixtureId;
  label: string;
  currentUserMessage: string;
  longTermMemory?: string;
};

const FIXTURES: Fixture[] = [
  {
    id: "Q1",
    label: "Quiet relationship scene",
    currentUserMessage:
      "*조태형 옆에 기대며* …오늘은 그냥 이렇게 걸어도 괜찮을 것 같아. 너는?",
  },
  {
    id: "Q2",
    label: "Action / event scene",
    currentUserMessage:
      "갑자기 알람이 울렸다. *복도 끝에서 발소리* — 저쪽부터 사람들이 뛰어온다! 어디로 숨어?",
  },
  {
    id: "Q3",
    label: "Memory continuity scene",
    currentUserMessage:
      "아까 네가 말한 동기화 챔버… 거기서 한서가 뭘 봤다고 했지? 기억나?",
    longTermMemory: MEMORY_SUMMARY,
  },
  {
    id: "Q4",
    label: "Multi-character scene",
    currentUserMessage:
      "복도 끝에서 한서가 소리치고, 민재가 우리 앞을 막아선다. *렌은 조태형을 본다* 어떻게 할 거야?",
    longTermMemory: MEMORY_SUMMARY,
  },
];

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function buildBaseHistory(): ChatMsg[] {
  const completedTurns = 18;
  const summarizedTurnCount = 15;
  return rawRecentTurnsToHistory(
    messagesToTurns(
      USER_TURNS.flatMap((u, i) => [
        { role: "user" as const, content: u },
        {
          role: "assistant" as const,
          content:
            i % 3 === 0
              ? `조태형이 렌 쪽으로 고개를 기울였다.\n\n"괜찮아. 여기서는 내가 안내할게."\n\n그는 복도 끝을 가리켰다.`
              : `조태형이 짧게 웃었다.\n\n"계속 가자."\n\n발소리가 복도에 작게 울렸다.`,
        },
      ])
    ),
    resolveProviderRawPoolExchangeCount({
      memoryFeatureEnabled: true,
      completedTurns,
      summarizedTurnCount,
    }),
    { summarizedTurnCount, memoryFeatureEnabled: true }
  );
}

function buildFixtureContext(fixture: Fixture, terminalLayoutOnly: boolean) {
  const prev = process.env.GEMINI31_TERMINAL_LAYOUT_OWNER_ONLY;
  if (terminalLayoutOnly) process.env.GEMINI31_TERMINAL_LAYOUT_OWNER_ONLY = "1";
  else delete process.env.GEMINI31_TERMINAL_LAYOUT_OWNER_ONLY;

  try {
    const completedTurns = 18;
    const summarizedTurnCount = 15;
    const built = buildContext({
      charName: "조태형",
      systemPrompt: JO_CARD,
      world: JO_WORLD,
      exampleDialog: "유저: …\n조태형: …",
      chunks: [
        {
          id: "ab-identity",
          characterId: "ab",
          content: JO_CARD,
          category: "identity",
          importance: "CRITICAL",
          tokenCount: 200,
          keywords: ["조태형"],
        },
        {
          id: "ab-world",
          characterId: "ab",
          content: JO_WORLD,
          category: "world",
          importance: "CONTEXTUAL",
          tokenCount: 40,
          keywords: ["에이지스"],
        },
      ],
      userNickname: "렌",
      personaDisplayName: "렌",
      userPersona: "이름/호칭: 렌\n성별: 남성",
      userPersonaGender: "male",
      gender: "male",
      shortTermHistory: buildBaseHistory(),
      currentUserMessage: fixture.currentUserMessage,
      nsfw: true,
      provider: "openrouter",
      modelId: MODEL,
      completedTurns,
      completedTurnsForMemoryCoverage: completedTurns,
      summarizedTurnCount,
      longTermMemory: fixture.longTermMemory ?? MEMORY_SUMMARY,
      targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
      historyMinTurnFloor: 4,
      providerHistoryMinRealPlayableExchanges: 4,
      providerHistoryAbsoluteTurnFloor: 4,
      providerHistoryProtectOpening: false,
      suppressMemoryCoverageDegradedLog: true,
      chatId: 724001,
    });

    const assembled = assemblePrimaryRpRequest({
      system: built.systemPrompt,
      history: built.history ?? [],
      modelId: MODEL,
      targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
      stream: true,
      openRouterSystemSplit: built.openRouterSystemSplit,
      messageOpts: { transportProvider: "cheaperinference", charName: "조태형" },
      sessionId: `layout-ab-${fixture.id}-${terminalLayoutOnly ? "B" : "A"}`,
    });

    const wireBody = adaptCheaperInferenceChatBody(
      structuredClone(assembled.requestBody as Record<string, unknown>)
    );
    wireBody.stream = true;
    wireBody.stream_options = { include_usage: true };

    const userTurn = built.history.at(-1)?.content ?? "";

    return { built, wireBody, userTurn };
  } finally {
    if (prev === undefined) delete process.env.GEMINI31_TERMINAL_LAYOUT_OWNER_ONLY;
    else process.env.GEMINI31_TERMINAL_LAYOUT_OWNER_ONLY = prev;
  }
}

async function callCiStream(requestBody: Record<string, unknown>) {
  const started = Date.now();
  let ttftMs: number | null = null;
  const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: buildCheaperInferenceHeaders(),
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(12 * 60 * 1000),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`CI HTTP ${res.status}: ${errText.slice(0, 400)}`);
  }
  if (!res.body) throw new Error("CI missing body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let finishReason: string | null = null;
  let usageRaw: unknown = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(data) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (ev.usage) usageRaw = ev.usage;
      const choice0 = Array.isArray(ev.choices) ? ev.choices[0] : null;
      const choice =
        choice0 && typeof choice0 === "object"
          ? (choice0 as Record<string, unknown>)
          : {};
      if (typeof choice.finish_reason === "string" && choice.finish_reason) {
        finishReason = choice.finish_reason;
      }
      const delta = (choice.delta ?? {}) as Record<string, unknown>;
      const piece = typeof delta.content === "string" ? delta.content : "";
      if (piece) {
        if (ttftMs == null) ttftMs = Date.now() - started;
        text += piece;
      }
    }
  }

  const usage = parseOpenRouterUsage(usageRaw);
  const cost = openRouterUsdCostFromRates({
    modelId: MODEL,
    promptTokens: usage.promptTokens,
    outputTokens: usage.completionTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
  });

  return {
    text,
    finishReason,
    ttftMs,
    totalMs: Date.now() - started,
    usage,
    costUsd: cost.usdCost,
    visibleChars: visibleAssistantDisplayCharCount(text),
    metaLeak: /\[SYSTEM|as an AI|language model/i.test(text),
  };
}

type RunRecord = {
  fixtureId: FixtureId;
  variant: "A" | "B";
  runIndex: number;
  visibleChars: number;
  visibleTokens: number;
  layoutMetrics: ReturnType<typeof computeLayoutAbParagraphMetrics>;
  providerPromptTokens: number;
  cachedTokens: number;
  cacheRatio: number | null;
  ttftMs: number | null;
  totalMs: number;
  costUsd: number;
  textPreview: string;
  parityValid: boolean;
};

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const key = process.env.CHEAPER_INFERENCE_API_KEY?.trim();
  if (!key) throw new Error("CHEAPER_INFERENCE_API_KEY required");

  const parityReports: Record<string, ReturnType<typeof compareLayoutAbPayloadParity>> = {};
  const contexts: Record<string, { wireBody: Record<string, unknown> }> = {};

  for (const fixture of FIXTURES) {
    const ctxA = buildFixtureContext(fixture, false);
    const ctxB = buildFixtureContext(fixture, true);
    const parity = compareLayoutAbPayloadParity({
      sectionsA: ctxA.built.meta.trackedSections ?? [],
      sectionsB: ctxB.built.meta.trackedSections ?? [],
      userTurnA: ctxA.userTurn,
      userTurnB: ctxB.userTurn,
    });
    parityReports[fixture.id] = parity;
    contexts[`${fixture.id}:A`] = { wireBody: ctxA.wireBody };
    contexts[`${fixture.id}:B`] = { wireBody: ctxB.wireBody };

    console.info(`[parity ${fixture.id}]`, {
      ALL_NON_LAYOUT_SECTION_HASHES_EQUAL: parity.allNonLayoutSectionHashesEqual,
      A_SYSTEM_LAYOUT_HASH: parity.aSystemLayoutHash,
      B_SYSTEM_LAYOUT_HASH: parity.bSystemLayoutHash,
      A_USER_TAIL_HASH: parity.aUserTailHash,
      B_USER_TAIL_HASH: parity.bUserTailHash,
      NON_LAYOUT_HASH_MISMATCHES: parity.nonLayoutHashMismatches.length,
    });
  }

  const runs: RunRecord[] = [];
  const rubricsByFixture: Record<FixtureId, LayoutAbQualityRubric[]> = {
    Q1: [],
    Q2: [],
    Q3: [],
    Q4: [],
  };

  for (const fixture of FIXTURES) {
    if (FIXTURE_FILTER.length > 0 && !FIXTURE_FILTER.includes(fixture.id)) continue;
    const parity = parityReports[fixture.id]!;
    if (!parity.allNonLayoutSectionHashesEqual) {
      console.warn(`[skip live] ${fixture.id} parity failed`, parity.nonLayoutHashMismatches);
      continue;
    }

    const aRuns: RunRecord[] = [];
    const bRuns: RunRecord[] = [];

    for (let r = 0; r < RUNS; r++) {
      for (const variant of ["A", "B"] as const) {
        const priorText = loadPriorRunText(fixture.id, variant, r + 1);
        const priorMeta = loadPriorRunMeta(fixture.id, variant, r + 1);
        if (priorText) {
          const rec: RunRecord = {
            fixtureId: fixture.id,
            variant,
            runIndex: r + 1,
            visibleChars:
              priorMeta?.visibleChars ?? visibleAssistantDisplayCharCount(priorText),
            visibleTokens: priorMeta?.visibleTokens ?? 0,
            layoutMetrics:
              priorMeta?.layoutMetrics ?? computeLayoutAbParagraphMetrics(priorText),
            providerPromptTokens: priorMeta?.providerPromptTokens ?? 0,
            cachedTokens: priorMeta?.cachedTokens ?? 0,
            cacheRatio: priorMeta?.cacheRatio ?? null,
            ttftMs: priorMeta?.ttftMs ?? null,
            totalMs: priorMeta?.totalMs ?? 0,
            costUsd: priorMeta?.costUsd ?? 0,
            textPreview: priorText.slice(0, 500),
            parityValid: true,
          };
          runs.push(rec);
          if (variant === "A") aRuns.push(rec);
          else bRuns.push(rec);
          console.info(`[cached] ${fixture.id} ${variant} run ${r + 1}/${RUNS}`);
          continue;
        }

        const ctx = contexts[`${fixture.id}:${variant}`]!;
        const body = structuredClone(ctx.wireBody);
        body.session_id = `layout-ab-${fixture.id}-${variant}-run${r + 1}-${Date.now()}`;
        console.info(`[live] ${fixture.id} ${variant} run ${r + 1}/${RUNS} …`);
        const resp = await callCiStream(body);
        const rec: RunRecord = {
          fixtureId: fixture.id,
          variant,
          runIndex: r + 1,
          visibleChars: resp.visibleChars,
          visibleTokens: resp.usage.completionTokens,
          layoutMetrics: computeLayoutAbParagraphMetrics(resp.text),
          providerPromptTokens: resp.usage.promptTokens,
          cachedTokens: resp.usage.cacheReadTokens,
          cacheRatio:
            resp.usage.promptTokens > 0
              ? Math.round((resp.usage.cacheReadTokens / resp.usage.promptTokens) * 1000) / 1000
              : null,
          ttftMs: resp.ttftMs,
          totalMs: resp.totalMs,
          costUsd: resp.costUsd,
          textPreview: resp.text.slice(0, 500),
          parityValid: true,
        };
        runs.push(rec);
        if (variant === "A") aRuns.push(rec);
        else bRuns.push(rec);
        const outBase = path.join(OUT_DIR, `${fixture.id}-${variant}-run${r + 1}`);
        safeWrite(`${outBase}.txt`, resp.text);
        safeWrite(`${outBase}.meta.json`, JSON.stringify(rec, null, 2));
      }

      const a = aRuns[aRuns.length - 1]!;
      const b = bRuns[bRuns.length - 1]!;
      rubricsByFixture[fixture.id].push(
        scoreLayoutAbQualityRubric({
          fixtureId: fixture.id,
          metricsA: a.layoutMetrics,
          metricsB: b.layoutMetrics,
          visibleCharsA: a.visibleChars,
          visibleCharsB: b.visibleChars,
          metaLeakB: /\[SYSTEM|as an AI|language model/i.test(b.textPreview),
        })
      );
    }
  }

  const fixtureVerdicts: Record<FixtureId, string> = {} as Record<FixtureId, string>;
  for (const id of ["Q1", "Q2", "Q3", "Q4"] as FixtureId[]) {
    fixtureVerdicts[id] = aggregateFixtureVerdict(rubricsByFixture[id]);
  }

  const aPromptTokens = runs.filter((r) => r.variant === "A").map((r) => r.providerPromptTokens);
  const bPromptTokens = runs.filter((r) => r.variant === "B").map((r) => r.providerPromptTokens);
  const layoutTokenSaving =
    aPromptTokens.length && bPromptTokens.length
      ? Math.round((median(aPromptTokens) - median(bPromptTokens)) * 10) / 10
      : null;

  const allPass = (["Q1", "Q2", "Q3", "Q4"] as FixtureId[]).every(
    (id) => fixtureVerdicts[id] === "PASS"
  );
  const anyFail = (["Q1", "Q2", "Q3", "Q4"] as FixtureId[]).some(
    (id) => fixtureVerdicts[id] === "FAIL"
  );
  const anyMinorOnly =
    !anyFail &&
    (["Q1", "Q2", "Q3", "Q4"] as FixtureId[]).some((id) => fixtureVerdicts[id] === "MINOR");

  let mergeCase: "A" | "B" | "C";
  let paragraphLayoutOwner: string;
  let layoutSystemDuplicateRemoved: boolean;
  let trueD2After: number;

  if (allPass) {
    mergeCase = "A";
    paragraphLayoutOwner = "USER_TAIL_TERMINAL";
    layoutSystemDuplicateRemoved = true;
    trueD2After = 0;
  } else if (anyFail) {
    mergeCase = "C";
    paragraphLayoutOwner = "INTENTIONAL_MULTI_INJECTION";
    layoutSystemDuplicateRemoved = false;
    trueD2After = 0;
  } else {
    mergeCase = "B";
    paragraphLayoutOwner = "dual (A/B inconclusive — keep current)";
    layoutSystemDuplicateRemoved = false;
    trueD2After = 1;
  }

  void anyMinorOnly;

  const report = {
    GEMINI31_LAYOUT_OWNER_LIVE_AB: {
      generatedAt: new Date().toISOString(),
      runsPerVariant: RUNS,
      totalLiveRuns: runs.length,
      parityReports,
      runs,
      rubricsByFixture,
      fixtureVerdicts,
      mergeCase,
      PARAGRAPH_LAYOUT_OWNER: paragraphLayoutOwner,
      LAYOUT_SYSTEM_DUPLICATE_REMOVED: layoutSystemDuplicateRemoved,
      TRUE_D2_AFTER: trueD2After,
      LAYOUT_SYSTEM_PROVIDER_TOKENS_SAVED: layoutTokenSaving,
      PR_724_READY_TO_MERGE: allPass ? "YES" : "NO",
      secondaryMetrics: {
        ttftA: median(runs.filter((r) => r.variant === "A").map((r) => r.ttftMs ?? 0)),
        ttftB: median(runs.filter((r) => r.variant === "B").map((r) => r.ttftMs ?? 0)),
        cacheRatioA: median(
          runs.filter((r) => r.variant === "A").map((r) => r.cacheRatio ?? 0)
        ),
        cacheRatioB: median(
          runs.filter((r) => r.variant === "B").map((r) => r.cacheRatio ?? 0)
        ),
      },
    },
  };

  fs.writeFileSync(path.join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2));
  safeWrite(path.join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});

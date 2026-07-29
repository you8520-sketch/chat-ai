/**
 * Shared Novel Prose V2 — 12-call A/B (3 models × F1/F2 × A/B).
 * Arm A: canary OFF (production route). Arm B: V2 ON for allowlisted user.
 */
import Module from "module";
import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { performance } from "perf_hooks";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import { buildContext } from "../src/services/contextBuilder";
import {
  resolveProseStyleRouteName,
  resolveProseStyleSection,
} from "../src/lib/proseStyleResolver";
import {
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_MUSE_SPARK_11_MODEL,
} from "../src/lib/chatModels";
import { formatUserPersonaForPrompt } from "../src/lib/persona";
import { loadCharacterChunksForPromptReadOnly } from "../src/lib/characterChunks";
import { streamOpenRouterAdult } from "../src/lib/openRouterAdult";
import { SHARED_NOVEL_PROSE_V2_ENV } from "../src/lib/sharedNovelProseV2Policy";
import type { ChatMsg } from "../src/lib/ai";

const OUT_DIR = process.env.SCREENING_OUT_DIR || "data";
const FIXTURE_PATH =
  process.env.SNPV2_FIXTURE_PATH || "data/_tmp-snpv2-fixture.json";
const USER_ID = 1;

const MODELS = [
  {
    id: CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
    label: "Luna",
    provider: "cheaperinference" as const,
    transport: "cheaperinference" as const,
  },
  {
    id: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
    label: "DeepSeek",
    provider: "openrouter" as const,
    transport: "openrouter" as const,
  },
  {
    id: OPENROUTER_MUSE_SPARK_11_MODEL,
    label: "Muse",
    provider: "openrouter" as const,
    transport: "openrouter" as const,
  },
];

const FIXTURES = [
  {
    id: "F1",
    kind: "single",
    input: "조용히 말한다. 「괜찮아. 오늘은 그쯤 해도 돼.」",
  },
  {
    id: "F2",
    kind: "multi",
    input:
      "길어진 논의를 끊는다. 「둘 다 말은 이해했어. 이제 어떻게 할 건지 정해 줘.」",
  },
] as const;

const MICRO = [
  "시선",
  "눈길",
  "손끝",
  "손짓",
  "고개",
  "호흡",
  "침묵",
  "잠시",
  "미세하게",
  "손",
  "숨",
];

type Arm = "A" | "B";

function setV2(on: boolean) {
  if (on) {
    process.env[SHARED_NOVEL_PROSE_V2_ENV.ENABLED] = "1";
    process.env[SHARED_NOVEL_PROSE_V2_ENV.USER_IDS] = String(USER_ID);
  } else {
    delete process.env[SHARED_NOVEL_PROSE_V2_ENV.ENABLED];
    delete process.env[SHARED_NOVEL_PROSE_V2_ENV.USER_IDS];
  }
}

function extractDialogueBlocks(text: string): string[] {
  const blocks: string[] = [];
  const re = /[「『"].+?[」』"]/gs;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) blocks.push(m[0]);
  const re2 = /“[^”]+”/g;
  while ((m = re2.exec(text))) blocks.push(m[0]);
  return blocks;
}

function measure(text: string, userInput: string) {
  const visibleChars = text.replace(/\s+/g, "").length;
  const blocks = extractDialogueBlocks(text);
  const dialogueQuotedChars = blocks.join("").replace(/\s+/g, "").length;
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const questionCount = (text.match(/[?？]/g) || []).length;
  const qLines = text
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => /[?？]/.test(l) || /확인|맞지|그렇지|알겠지/.test(l));
  const seen = new Set<string>();
  let repeated = 0;
  for (const q of qLines) {
    const key = q.replace(/\s+/g, "").slice(0, 40);
    if (seen.has(key)) repeated += 1;
    else seen.add(key);
  }
  const microActionCounts: Record<string, number> = {};
  let microActionTotal = 0;
  for (const lex of MICRO) {
    const n = (text.match(new RegExp(lex, "g")) || []).length;
    microActionCounts[lex] = n;
    microActionTotal += n;
  }
  const innerHints =
    (text.match(/생각했다|떠올|기억|이상했다|몰랐|헷갈|망설|속으로/g) || [])
      .length;
  const reExplain = (
    text.match(
      /이것은\s*~?가\s*아니었다|뜻이었다|표시였다|하는\s*눈빛|하는\s*어조/
    ) || []
  ).length;
  const userCompact = userInput.replace(/\s+/g, "");
  const echo =
    userCompact.length >= 8 &&
    text
      .replace(/\s+/g, "")
      .includes(userCompact.slice(0, Math.min(24, userCompact.length)));

  // Heuristic entity speakers from dialogue-adjacent name tags
  const speakers = new Set<string>();
  for (const m of text.matchAll(
    /([가-힣A-Za-z]{2,12})(?:은|는|이|가)?\s*(?:짧게|낮게|천천히)?\s*(?:말했다|물었다|대답했다|중얼|웃)/g
  )) {
    speakers.add(m[1]!);
  }

  return {
    visibleChars,
    dialogueQuotedChars,
    dialogueCharRatio: visibleChars ? dialogueQuotedChars / visibleChars : 0,
    totalDialogueBlocks: blocks.length,
    mainCharacterDialogueBlocks: blocks.length, // single-cast fixture; cast exchange counted separately
    secondaryNewNpcDialogueBlocks: 0,
    establishedMainCharacterExchangeCount: Math.max(0, speakers.size - 1),
    npcNpcFillerExchangeCount: 0,
    speakingEntityCount: Math.max(speakers.size, blocks.length > 0 ? 1 : 0),
    newlyIntroducedNpcCount: (
      text.match(/처음 보는|낯선\s*(?:남자|여자|인물)|이름없는/g) || []
    ).length,
    newlyIntroducedEventCount: (
      text.match(/갑자기\s*(?:경보|폭발|습격|임무)|새로운\s*(?:위기|임무|비밀)/g) ||
      []
    ).length,
    questionCount,
    repeatedQuestionConfirmCount: repeated,
    inputEcho: echo,
    narrationParagraphCount: paragraphs.length,
    innerNarrationCharsApprox: innerHints * 40,
    innerNarrationRatioApprox: visibleChars
      ? (innerHints * 40) / visibleChars
      : 0,
    characterSpecificInnerThoughtPassages: innerHints,
    microActionCounts,
    microActionTotal,
    reExplanationPatterns: reExplain,
  };
}

async function callModel(
  model: (typeof MODELS)[number],
  system: string,
  history: ChatMsg[],
  targetResponseChars: number
) {
  const t0 = performance.now();
  const stream = streamOpenRouterAdult(
    system,
    history,
    model.id,
    targetResponseChars,
    {
      transportProvider: model.transport,
    }
  );
  let text = "";
  let result = await stream.next();
  while (!result.done) {
    text += result.value;
    result = await stream.next();
  }
  const usage = result.value;
  return {
    text,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    latencyMs: Math.round(performance.now() - t0),
    apiCallCount: 1,
    costUsdEstimate: usage?.upstreamCostUsd ?? null,
  };
}

function loadFixture() {
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
    characterRow: Record<string, unknown>;
    persona: {
      id: number;
      name: string;
      description: string;
      gender: string;
    };
    userNickname: string;
    greeting: string;
    targetResponseChars: number;
    userNote: string;
    memory: string;
    sourceChatId: number;
    f2Note?: string;
  };
  return fixture;
}

function buildSystem(
  fixture: ReturnType<typeof loadFixture>,
  modelId: string,
  provider: "openrouter" | "cheaperinference",
  userInput: string,
  arm: Arm
) {
  setV2(arm === "B");
  // Muse Arm A should follow production M1 if env has it; do not force.
  const route = resolveProseStyleRouteName(USER_ID, modelId);
  const style = resolveProseStyleSection(USER_ID, modelId);

  const { chunks, usedEnglish } = loadCharacterChunksForPromptReadOnly(
    fixture.characterRow as never,
    fixture.persona.name,
    fixture.userNickname
  );
  const userPersona = formatUserPersonaForPrompt(
    fixture.persona.name,
    fixture.persona.description,
    fixture.userNickname
  );
  const history: ChatMsg[] = [
    { role: "assistant", content: fixture.greeting },
    { role: "user", content: userInput },
  ];
  const built = buildContext({
    charName: String(fixture.characterRow.name),
    chunks,
    userNickname: fixture.userNickname,
    userPersona,
    userNote: fixture.userNote,
    longTermMemory: fixture.memory,
    archiveMemory: null,
    shortTermHistory: [{ role: "assistant", content: fixture.greeting }],
    currentUserMessage: userInput,
    nsfw: !!fixture.characterRow.nsfw,
    gender:
      (fixture.characterRow.gender as "male" | "female" | "other") ?? "other",
    userId: USER_ID,
    chatId: fixture.sourceChatId,
    targetResponseChars: fixture.targetResponseChars,
    modelId,
    provider,
    personaDisplayName: fixture.persona.name,
    userPersonaGender:
      (fixture.persona.gender as "male" | "female" | "other") ?? null,
    useEnglishCharacterPrompt: usedEnglish,
    contentKind:
      fixture.characterRow.content_kind === "simulation"
        ? "simulation"
        : "character",
  });

  return {
    system: built.systemPrompt ?? "",
    history,
    route,
    styleOverride: style == null ? "LEGACY" : "OVERRIDE",
    immersiveCount: ((built.systemPrompt ?? "").match(/\[IMMERSIVE PROSE\]/g) || [])
      .length,
    coreCount: (
      (built.systemPrompt ?? "").match(/\[NOVEL PROSE CORE — SHARED\]/g) || []
    ).length,
  };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const fixture = loadFixture();
  const rawPath = `${OUT_DIR}/shared-novel-prose-v2-3model-ab-raw.txt`;
  const metaPath = `${OUT_DIR}/shared-novel-prose-v2-3model-ab-metadata.json`;
  const reportPath = `${OUT_DIR}/shared-novel-prose-v2-auto-report.txt`;
  writeFileSync(rawPath, "", "utf8");

  const records: unknown[] = [];

  // Preflight prompt diff for Luna F1
  const preA = buildSystem(
    fixture,
    MODELS[0]!.id,
    MODELS[0]!.provider,
    FIXTURES[0]!.input,
    "A"
  );
  const preB = buildSystem(
    fixture,
    MODELS[0]!.id,
    MODELS[0]!.provider,
    FIXTURES[0]!.input,
    "B"
  );
  console.log(
    JSON.stringify({
      preflight: {
        lunaRouteA: preA.route,
        lunaRouteB: preB.route,
        immersiveA: preA.immersiveCount,
        coreA: preA.coreCount,
        coreB: preB.coreCount,
        systemDelta: preB.system.length - preA.system.length,
      },
      f2Note: fixture.f2Note,
      char: fixture.characterRow.name,
      persona: fixture.persona.name,
    })
  );

  for (const model of MODELS) {
    for (const fix of FIXTURES) {
      for (const arm of ["A", "B"] as Arm[]) {
        const tag = `${model.label}-${fix.id}-${arm}`;
        console.log(`CALL ${tag}`);
        let text = "";
        let err: string | null = null;
        let metricsExtra = {
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: 0,
          apiCallCount: 0,
          costUsdEstimate: null as number | null,
        };
        let builtMeta = {
          route: "",
          immersiveCount: 0,
          coreCount: 0,
        };
        try {
          const built = buildSystem(
            fixture,
            model.id,
            model.provider,
            fix.input,
            arm
          );
          builtMeta = {
            route: built.route,
            immersiveCount: built.immersiveCount,
            coreCount: built.coreCount,
          };
          if (arm === "A" && built.coreCount !== 0) {
            throw new Error("Arm A unexpectedly contains Shared Core");
          }
          if (arm === "B" && built.coreCount !== 1) {
            throw new Error(`Arm B core count=${built.coreCount}`);
          }
          const result = await callModel(
            model,
            built.system,
            built.history,
            fixture.targetResponseChars
          );
          text = result.text;
          metricsExtra = {
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            latencyMs: result.latencyMs,
            apiCallCount: result.apiCallCount,
            costUsdEstimate: result.costUsdEstimate,
          };
        } catch (e) {
          err = e instanceof Error ? e.stack || e.message : String(e);
        }

        const base = measure(text, fix.input);
        const rec = {
          modelId: model.id,
          modelLabel: model.label,
          fixtureId: fix.id,
          kind: fix.kind,
          arm,
          input: fix.input,
          error: err,
          builtMeta,
          metrics: { ...base, ...metricsExtra },
          outputChars: text.length,
        };
        records.push(rec);
        writeFileSync(
          rawPath,
          readFileSync(rawPath, "utf8") +
            [
              `===== ${model.label} ${fix.id} ARM ${arm} (${fix.kind}) =====`,
              `MODEL: ${model.id}`,
              `INPUT: ${fix.input}`,
              err ? `ERROR: ${err}` : text,
              "",
            ].join("\n"),
          "utf8"
        );
        console.log(
          JSON.stringify({
            done: tag,
            err: !!err,
            vis: base.visibleChars,
            blocks: base.totalDialogueBlocks,
            ms: metricsExtra.latencyMs,
          })
        );
      }
    }
  }

  setV2(false);

  const bRecords = (records as Array<{ arm: string; metrics: { visibleChars: number }; error: string | null }>).filter(
    (r) => r.arm === "B" && !r.error
  );
  const bVis = bRecords.map((r) => r.metrics.visibleChars).sort((a, b) => a - b);
  const avg = (xs: number[]) =>
    xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
  const median = (xs: number[]) => {
    if (!xs.length) return 0;
    const m = Math.floor(xs.length / 2);
    return xs.length % 2 ? xs[m]! : (xs[m - 1]! + xs[m]!) / 2;
  };
  const aVisAvg = avg(
    (records as Array<{ arm: string; metrics: { visibleChars: number }; error: string | null }>)
      .filter((r) => r.arm === "A" && !r.error)
      .map((r) => r.metrics.visibleChars)
  );
  const bVisAvg = avg(bVis);
  const bGe2500 = bVis.filter((v) => v >= 2500).length;
  const bLt2200 = bVis.filter((v) => v < 2200).length;
  const drop = aVisAvg > 0 ? (aVisAvg - bVisAvg) / aVisAvg : 0;

  const lengthPass =
    bVisAvg >= 2900 &&
    bVisAvg <= 3300 &&
    median(bVis) >= 2800 &&
    bGe2500 >= 5 &&
    bLt2200 === 0 &&
    drop <= 0.1;

  const autoFails: string[] = [];
  if (!lengthPass) autoFails.push("LENGTH_BAND");
  if (drop > 0.1) autoFails.push("AVG_LENGTH_DROP_GT_10PCT");
  if (
    (records as Array<{ error: string | null }>).some((r) => r.error)
  ) {
    autoFails.push("TRANSPORT_OR_RUNTIME_ERROR");
  }

  const meta = {
    generatedAt: new Date().toISOString(),
    fixtureNote: fixture.f2Note,
    character: fixture.characterRow.name,
    persona: fixture.persona.name,
    models: MODELS.map((m) => m.id),
    fixtures: FIXTURES,
    records,
    aggregates: {
      bCount: bVis.length,
      bVisAvg,
      bVisMedian: median(bVis),
      bGe2500,
      bLt2200,
      aVisAvg,
      lengthDrop: drop,
      lengthPass,
      autoFails,
    },
  };
  writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");

  const report = [
    "SHARED NOVEL PROSE V2 — 12-CALL AUTO REPORT",
    `character=${String(fixture.characterRow.name)} persona=${fixture.persona.name}`,
    `f2Note=${fixture.f2Note}`,
    `B_avg_visible=${bVisAvg.toFixed(1)} median=${median(bVis).toFixed(1)}`,
    `B_ge2500=${bGe2500}/6 B_lt2200=${bLt2200} A_avg=${aVisAvg.toFixed(1)} drop=${(drop * 100).toFixed(1)}%`,
    `LENGTH_AUTO=${lengthPass ? "PASS" : "FAIL"}`,
    `AUTO_FAILS=${autoFails.length ? autoFails.join(",") : "none"}`,
    "NOTE: Cursor does not judge literary quality. ChatGPT reviews raw 12 outputs.",
    "Canary remains OFF after run. No merge/rollout.",
  ].join("\n");
  writeFileSync(reportPath, report + "\n", "utf8");
  console.log(report);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

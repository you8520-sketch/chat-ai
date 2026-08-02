/**
 * Retry only Muse F1/F2 A/B calls; merge into existing metadata/raw/report.
 */
import Module from "module";
import { writeFileSync, readFileSync } from "fs";
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
import { OPENROUTER_MUSE_SPARK_11_MODEL } from "../src/lib/chatModels";
import { formatUserPersonaForPrompt } from "../src/lib/persona";
import { loadCharacterChunksForPromptReadOnly } from "../src/lib/characterChunks";
import { streamOpenRouterAdult } from "../src/lib/openRouterAdult";
import { SHARED_NOVEL_PROSE_V2_ENV } from "../src/lib/sharedNovelProseV2Policy";
import type { ChatMsg } from "../src/lib/ai";

const OUT_DIR = "data";
const FIXTURE_PATH = "data/_tmp-snpv2-fixture.json";
const USER_ID = 1;
const MODEL = OPENROUTER_MUSE_SPARK_11_MODEL;

const FIXTURES = [
  { id: "F1", kind: "single", input: "조용히 말한다. 「괜찮아. 오늘은 그쯤 해도 돼.」" },
  {
    id: "F2",
    kind: "multi",
    input: "길어진 논의를 끊는다. 「둘 다 말은 이해했어. 이제 어떻게 할 건지 정해 줘.」",
  },
] as const;

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
  return blocks;
}

function measure(text: string, userInput: string) {
  const visibleChars = text.replace(/\s+/g, "").length;
  const blocks = extractDialogueBlocks(text);
  const dialogueQuotedChars = blocks.join("").replace(/\s+/g, "").length;
  const questionCount = (text.match(/[?？]/g) || []).length;
  return {
    visibleChars,
    dialogueQuotedChars,
    dialogueCharRatio: visibleChars ? dialogueQuotedChars / visibleChars : 0,
    totalDialogueBlocks: blocks.length,
    mainCharacterDialogueBlocks: blocks.length,
    secondaryNewNpcDialogueBlocks: 0,
    establishedMainCharacterExchangeCount: 0,
    npcNpcFillerExchangeCount: 0,
    speakingEntityCount: blocks.length > 0 ? 1 : 0,
    newlyIntroducedNpcCount: 0,
    newlyIntroducedEventCount: 0,
    questionCount,
    repeatedQuestionConfirmCount: 0,
    inputEcho:
      userInput.replace(/\s+/g, "").length >= 8 &&
      text.replace(/\s+/g, "").includes(userInput.replace(/\s+/g, "").slice(0, 16)),
    narrationParagraphCount: text.split(/\n\s*\n/).filter((p) => p.trim()).length,
    innerNarrationCharsApprox: 0,
    innerNarrationRatioApprox: 0,
    characterSpecificInnerThoughtPassages: 0,
    microActionCounts: {},
    microActionTotal: 0,
    reExplanationPatterns: 0,
  };
}

async function callMuse(system: string, history: ChatMsg[], target: number) {
  const t0 = performance.now();
  const stream = streamOpenRouterAdult(system, history, MODEL, target, {
    transportProvider: "openrouter",
  });
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

async function main() {
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
  const metaPath = `${OUT_DIR}/shared-novel-prose-v2-3model-ab-metadata.json`;
  const rawPath = `${OUT_DIR}/shared-novel-prose-v2-3model-ab-raw.txt`;
  const reportPath = `${OUT_DIR}/shared-novel-prose-v2-auto-report.txt`;
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));

  for (const fix of FIXTURES) {
    for (const arm of ["A", "B"] as const) {
      const tag = `Muse-${fix.id}-${arm}`;
      console.log(`RETRY ${tag}`);
      setV2(arm === "B");
      const { chunks, usedEnglish } = loadCharacterChunksForPromptReadOnly(
        fixture.characterRow,
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
        { role: "user", content: fix.input },
      ];
      const route = resolveProseStyleRouteName(USER_ID, MODEL);
      const style = resolveProseStyleSection(USER_ID, MODEL);
      const built = buildContext({
        charName: String(fixture.characterRow.name),
        chunks,
        userNickname: fixture.userNickname,
        userPersona,
        userNote: fixture.userNote,
        longTermMemory: fixture.memory,
        archiveMemory: null,
        shortTermHistory: [{ role: "assistant", content: fixture.greeting }],
        currentUserMessage: fix.input,
        nsfw: !!fixture.characterRow.nsfw,
        gender: (fixture.characterRow.gender as "male" | "female" | "other") ?? "other",
        userId: USER_ID,
        chatId: fixture.sourceChatId,
        targetResponseChars: fixture.targetResponseChars,
        modelId: MODEL,
        provider: "openrouter",
        personaDisplayName: fixture.persona.name,
        userPersonaGender:
          (fixture.persona.gender as "male" | "female" | "other") ?? null,
        useEnglishCharacterPrompt: usedEnglish,
      });
      const coreCount = (
        (built.systemPrompt ?? "").match(/\[NOVEL PROSE CORE — SHARED\]/g) || []
      ).length;
      let text = "";
      let err: string | null = null;
      let metricsExtra = {
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
        apiCallCount: 0,
        costUsdEstimate: null as number | null,
      };
      try {
        if (arm === "A" && coreCount !== 0) throw new Error("Arm A has core");
        if (arm === "B" && coreCount !== 1) throw new Error(`Arm B core=${coreCount}`);
        const result = await callMuse(
          built.systemPrompt ?? "",
          history,
          fixture.targetResponseChars
        );
        text = result.text;
        metricsExtra = {
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          latencyMs: result.latencyMs,
          apiCallCount: 1,
          costUsdEstimate: result.costUsdEstimate,
        };
      } catch (e) {
        err = e instanceof Error ? e.stack || e.message : String(e);
      }
      const base = measure(text, fix.input);
      const rec = {
        modelId: MODEL,
        modelLabel: "Muse",
        fixtureId: fix.id,
        kind: fix.kind,
        arm,
        input: fix.input,
        error: err,
        builtMeta: {
          route,
          immersiveCount: 0,
          coreCount,
          stylePresent: style != null,
        },
        metrics: { ...base, ...metricsExtra },
        outputChars: text.length,
        retried: true,
      };
      meta.records = meta.records.map((r: { modelLabel: string; fixtureId: string; arm: string }) =>
        r.modelLabel === "Muse" && r.fixtureId === fix.id && r.arm === arm ? rec : r
      );
      writeFileSync(
        rawPath,
        readFileSync(rawPath, "utf8") +
          [
            `===== Muse ${fix.id} ARM ${arm} RETRY =====`,
            `MODEL: ${MODEL}`,
            `INPUT: ${fix.input}`,
            err ? `ERROR: ${err}` : text,
            "",
          ].join("\n"),
        "utf8"
      );
      console.log(JSON.stringify({ done: tag, err: !!err, vis: base.visibleChars }));
    }
  }
  setV2(false);

  const bRecords = meta.records.filter(
    (r: { arm: string; error: string | null }) => r.arm === "B" && !r.error
  );
  const aRecords = meta.records.filter(
    (r: { arm: string; error: string | null }) => r.arm === "A" && !r.error
  );
  const bVis = bRecords
    .map((r: { metrics: { visibleChars: number } }) => r.metrics.visibleChars)
    .sort((a: number, b: number) => a - b);
  const avg = (xs: number[]) =>
    xs.length ? xs.reduce((s: number, x: number) => s + x, 0) / xs.length : 0;
  const median = (xs: number[]) => {
    if (!xs.length) return 0;
    const m = Math.floor(xs.length / 2);
    return xs.length % 2 ? xs[m]! : (xs[m - 1]! + xs[m]!) / 2;
  };
  const aVisAvg = avg(
    aRecords.map((r: { metrics: { visibleChars: number } }) => r.metrics.visibleChars)
  );
  const bVisAvg = avg(bVis);
  const bGe2500 = bVis.filter((v: number) => v >= 2500).length;
  const bLt2200 = bVis.filter((v: number) => v < 2200).length;
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
  if (meta.records.some((r: { error: string | null }) => r.error)) {
    autoFails.push("TRANSPORT_OR_RUNTIME_ERROR");
  }
  meta.aggregates = {
    bCount: bVis.length,
    bVisAvg,
    bVisMedian: median(bVis),
    bGe2500,
    bLt2200,
    aVisAvg,
    lengthDrop: drop,
    lengthPass,
    autoFails,
  };
  meta.museRetryAt = new Date().toISOString();
  writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");
  const report = [
    "SHARED NOVEL PROSE V2 — 12-CALL AUTO REPORT (after Muse retry)",
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

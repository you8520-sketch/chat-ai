/**
 * DeepSeek layout probe — raw vs stream vs normalize, beat alternation.
 * Usage: npx.cmd tsx scripts/probe-deepseek-layout-stream.ts
 */
import fs from "fs";
import path from "path";
import "./lib/server-only-mock";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) (process.env as Record<string, string>).NODE_ENV = "development";

import { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } from "../src/lib/chatModels";
import {
  buildProductionContextForScene,
  PRODUCTION_VALIDATION_SCENES,
} from "./lib/production-prompt-fixture";
import { buildContext } from "../src/services/contextBuilder";
import { analyzeProductionOutput } from "./lib/production-output-metrics";
import { analyzeProseVariation } from "./lib/prose-variation-metrics";
import {
  groupNovelParagraphs,
  normalizeAiNovelProseLayout,
  classifyNovelParagraph,
} from "../src/lib/novelParagraphs";

const MODEL = OPENROUTER_DEEPSEEK_V4_PRO_MODEL;
const SCENE_ID = process.argv.find((a) => a.startsWith("--scene="))?.split("=")[1] ?? "horror";

type ParaKind = "narration" | "dialogue" | "mixed";

function paraKinds(text: string, streaming: boolean): ParaKind[] {
  return groupNovelParagraphs(text, { streaming }).map(
    (p) => classifyNovelParagraph(p, { streaming }) as ParaKind
  );
}

function alternationScore(kinds: ParaKind[]): {
  transitions: number;
  narDlgAlternations: number;
  score: number;
} {
  let transitions = 0;
  let narDlg = 0;
  for (let i = 1; i < kinds.length; i++) {
    if (kinds[i] !== kinds[i - 1]) transitions++;
    const a = kinds[i - 1];
    const b = kinds[i];
    const isNar = (k: ParaKind) => k === "narration" || k === "mixed";
    const isDlg = (k: ParaKind) => k === "dialogue" || k === "mixed";
    if ((isNar(a) && b === "dialogue") || (a === "dialogue" && isNar(b))) narDlg++;
  }
  return {
    transitions,
    narDlgAlternations: narDlg,
    score: kinds.length > 1 ? narDlg / (kinds.length - 1) : 0,
  };
}

function blockCharLengths(text: string): number[] {
  return groupNovelParagraphs(text).map((p) => p.length);
}

function charLengthCv(lengths: number[]): number {
  if (lengths.length < 2) return 0;
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance = lengths.reduce((s, x) => s + (x - mean) ** 2, 0) / lengths.length;
  return mean > 0 ? Math.sqrt(variance) / mean : 0;
}

function attachedDialogueLines(raw: string): string[] {
  const hits: string[] = [];
  for (const line of raw.replace(/\r\n/g, "\n").split("\n")) {
    const t = line.trim();
    if (!t || /^["「]/.test(t)) continue;
    if (/"[^"]{2,}"/.test(t) && !/^"[^"]+"$/.test(t)) hits.push(t.slice(0, 120));
  }
  return hits;
}

function simulateStreamSnapshots(raw: string): {
  at25: string;
  at50: string;
  at75: string;
  full: string;
} {
  const len = raw.length;
  const cut = (pct: number) => raw.slice(0, Math.floor(len * pct));
  return { at25: cut(0.25), at50: cut(0.5), at75: cut(0.75), full: raw };
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    console.error("OPENROUTER_API_KEY missing");
    process.exit(2);
  }

  const scene =
    PRODUCTION_VALIDATION_SCENES.find((s) => s.id === SCENE_ID) ??
    PRODUCTION_VALIDATION_SCENES[0]!;
  const input = buildProductionContextForScene(scene);
  const built = buildContext(input);
  const split = built.openRouterSystemSplit!;
  const system = [split.systemRulesBlock, split.characterSettingsBlock, split.dynamicBlock]
    .filter(Boolean)
    .join("\n\n");
  const history = built.history
    .slice(0, -1)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  const userMessage = built.history[built.history.length - 1]!.content;

  console.log(`Scene: ${scene.id} (${scene.label})`);
  console.log(`System ~${Math.ceil(system.length * 0.9)} tok`);

  const { streamOpenRouterAdultToClient } = await import("../src/lib/openRouterAdult");

  const clientSnapshots: { chars: number; text: string }[] = [];
  const send = (obj: Record<string, unknown>) => {
    if (obj.type === "append" && typeof obj.text === "string") {
      // cumulative via reveal simulation — append events are deltas
    }
    if (typeof obj.text === "string" && (obj.type === "replace" || obj.type === "append")) {
      // track last full text sent (replace = full, append handled below)
      if (obj.type === "replace") clientSnapshots.push({ chars: obj.text.length, text: obj.text });
    }
  };

  let clientText = "";
  const sendWrapped = (obj: Record<string, unknown>) => {
    if (obj.type === "append" && typeof obj.text === "string") {
      clientText += obj.text;
      clientSnapshots.push({ chars: clientText.length, text: clientText });
    } else if (obj.type === "replace" && typeof obj.text === "string") {
      clientText = obj.text;
      clientSnapshots.push({ chars: clientText.length, text: clientText });
    }
    send(obj);
  };

  const streamResult = await streamOpenRouterAdultToClient(
    sendWrapped,
    system,
    [...history, { role: "user", content: userMessage }],
    MODEL,
    "layout-probe",
    3200,
    { charName: input.charName, systemSplit: split }
  );

  const rawStream = streamResult.rawStreamText;
  const streamVisible = streamResult.streamVisibleText;
  const modelOut = streamResult.text;
  const normalized = normalizeAiNovelProseLayout(modelOut);

  const hasBeatFlow = /\[GENERATION PROCESS — BEAT FLOW\]/i.test(system);
  const hasOutputLayout = /\[OUTPUT LAYOUT\]/i.test(system);

  const metrics = analyzeProductionOutput(normalized);
  const variation = analyzeProseVariation(normalized);

  const report = {
    scene: scene.id,
    promptMarkers: { hasBeatFlow, hasOutputLayout },
    chars: {
      rawStream: rawStream.length,
      streamVisible: streamVisible.length,
      modelOut: modelOut.length,
      normalized: normalized.length,
    },
    attachedDialogueInRaw: attachedDialogueLines(rawStream).slice(0, 8),
    paragraphAnalysis: {
      raw: {
        count: groupNovelParagraphs(rawStream).length,
        kinds: paraKinds(rawStream, false),
        alt: alternationScore(paraKinds(rawStream, false)),
        blockLens: blockCharLengths(rawStream).slice(0, 12),
        cv: charLengthCv(blockCharLengths(rawStream)),
      },
      streamVisible: {
        count: groupNovelParagraphs(streamVisible).length,
        kinds: paraKinds(streamVisible, false),
        alt: alternationScore(paraKinds(streamVisible, false)),
      },
      streamingMode: {
        count: groupNovelParagraphs(streamVisible, { streaming: true }).length,
        kinds: paraKinds(streamVisible, true),
        alt: alternationScore(paraKinds(streamVisible, true)),
      },
      normalized: {
        count: groupNovelParagraphs(normalized).length,
        kinds: paraKinds(normalized, false),
        alt: alternationScore(paraKinds(normalized, false)),
        blockLens: blockCharLengths(normalized).slice(0, 12),
        cv: charLengthCv(blockCharLengths(normalized)),
      },
    },
    streamVsFinalDiff: {
      streamVisibleEqualsModelOut: streamVisible.trim() === modelOut.trim(),
      normalizedChangedFromModelOut: normalized.trim() !== modelOut.trim(),
      normalizedCharDelta: normalized.length - modelOut.length,
      paragraphCountDelta:
        groupNovelParagraphs(normalized).length - groupNovelParagraphs(streamVisible).length,
    },
    metrics,
    variation,
    clientSnapshotCount: clientSnapshots.length,
    clientFinalPreview: clientText.slice(-200),
    snapshots: {} as Record<string, unknown>,
  };

  report.streamVsFinalDiff = {
    ...report.streamVsFinalDiff,
    clientTextEqualsStreamVisible: clientText.trim() === streamVisible.trim(),
  };

  const snaps = simulateStreamSnapshots(streamVisible);
  for (const [key, text] of Object.entries(snaps)) {
    const kindsStream = paraKinds(text, true);
    const kindsFinal = paraKinds(text, false);
    report.snapshots[key] = {
      chars: text.length,
      streamingParas: groupNovelParagraphs(text, { streaming: true }).length,
      finalParas: groupNovelParagraphs(text, false).length,
      streamingKinds: kindsStream,
      finalKinds: kindsFinal,
      lastParaPreview: groupNovelParagraphs(text, { streaming: true }).slice(-1)[0]?.slice(0, 80),
    };
  }

  const outDir = path.resolve("output");
  fs.mkdirSync(outDir, { recursive: true });
  const base = path.join(outDir, `probe-deepseek-layout-${scene.id}`);
  fs.writeFileSync(`${base}.json`, JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(`${base}-raw.txt`, rawStream, "utf8");
  fs.writeFileSync(`${base}-normalized.txt`, normalized, "utf8");

  console.log("\n=== Chars ===");
  console.log(report.chars);
  console.log("\n=== Paragraph alternation (nar↔dlg score 0-1) ===");
  console.log("raw:", report.paragraphAnalysis.raw.alt);
  console.log("streamVisible:", report.paragraphAnalysis.streamVisible.alt);
  console.log("streaming UI mode:", report.paragraphAnalysis.streamingMode.alt);
  console.log("normalized saved:", report.paragraphAnalysis.normalized.alt);
  console.log("\n=== Stream vs final ===");
  console.log(report.streamVsFinalDiff);
  console.log("\n=== Attached dialogue lines in raw (narration+quote same line) ===");
  console.log(report.attachedDialogueInRaw.length ? report.attachedDialogueInRaw : "(none)");
  console.log("\n=== Metrics ===");
  console.log({
    charLength: metrics.charLength,
    dialogueDensity: metrics.dialogueDensity,
    similarLengthRunCount: variation.similarLengthRunCount,
    lengthStdDev: variation.lengthStdDev,
    maxConsecutiveSameStart: variation.maxConsecutiveSameStart,
  });
  console.log(`\nWrote ${base}.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

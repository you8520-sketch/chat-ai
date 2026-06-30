/**
 * Verify Leon/chat knowledge-boundary prompt structure from DB.
 * Usage: npx tsx scripts/verify-leon-knowledge-prompt.ts --chat-id=39
 */
import fs from "fs";
import path from "path";
import Module from "module";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

type SectionMarker =
  | "CHARACTER KNOWLEDGE BOUNDARY"
  | "CHARACTER CANON"
  | "WORLD CANON"
  | "PLAYER CANON"
  | "SCENARIO META";

const ORDER: SectionMarker[] = [
  "CHARACTER KNOWLEDGE BOUNDARY",
  "CHARACTER CANON",
  "WORLD CANON",
  "PLAYER CANON",
  "SCENARIO META",
];

const REGRESSION_MARKERS = [
  /third regression/i,
  /two failures already/i,
  /regressed two weeks back/i,
  /이(?:번이|가)?\s*(?:세|두)번째\s*회귀/,
  /지난\s*(?:두\s*번|이\s*전)\s*(?:의\s*)?(?:삶|번)/,
];

function parseChatId(argv: string[]): number {
  for (const arg of argv) {
    if (arg.startsWith("--chat-id=")) return Number(arg.slice("--chat-id=".length));
  }
  return 39;
}

function indexOfMarker(text: string, marker: SectionMarker): number {
  const re =
    marker === "CHARACTER KNOWLEDGE BOUNDARY"
      ? /\[CHARACTER KNOWLEDGE BOUNDARY\]/
      : new RegExp(`\\[${marker.replace(/ /g, " ")}`);
  const m = text.match(re);
  return m?.index ?? -1;
}

function extractBlock(text: string, headerRe: RegExp): string {
  const m = text.match(headerRe);
  if (!m?.index && m?.index !== 0) return "";
  const start = m.index;
  const rest = text.slice(start + m[0].length);
  const next = rest.search(/\n\[(?:CHARACTER |WORLD |PLAYER |SCENARIO |IDENTITY_|rule-|###)/);
  return next >= 0 ? rest.slice(0, next) : rest;
}

async function main() {
  const chatId = parseChatId(process.argv.slice(2));
  const { loadFromDb } = await import("./dump-system-prompt");
  const fixture = await loadFromDb({
    chatId,
    provider: "openrouter",
    modelId: "deepseek/deepseek-v4-pro",
  });

  const { buildContext } = await import("../src/services/contextBuilder");
  const { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } = await import("../src/lib/chatModels");

  const built = buildContext({
    charName: fixture.charName,
    chunks: fixture.chunks,
    userNickname: fixture.userNickname,
    userPersona: fixture.userPersonaPrompt,
    userNote: fixture.userNotePrompt,
    longTermMemory: fixture.longTermMemory,
    memoryMeta: fixture.memoryMeta,
    shortTermHistory: fixture.shortTermHistory,
    currentUserMessage: fixture.currentUserMessage,
    nsfw: fixture.nsfw,
    gender: fixture.gender,
    assetTags: fixture.assetTags,
    completedTurns: fixture.completedTurns,
    userPersonaGender: fixture.userPersonaGender,
    provider: "openrouter",
    genres: fixture.genres,
    userImpersonation: fixture.userImpersonation,
    novelModeEnabled: fixture.novelModeEnabled,
    personaDisplayName: fixture.personaDisplayName,
    targetResponseChars: fixture.targetResponseChars,
    modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
    promptDumpSource: "db",
    promptDumpDetail: `verify chat=${chatId}`,
  });

  // buildContext (API path) already writes debug/prompt_dump.txt when NODE_ENV=development

  const sys = built.systemPrompt;
  const issues: string[] = [];

  if (/\[CORE IDENTITY\]/i.test(sys)) {
    issues.push("FAIL: [CORE IDENTITY] still present in system prompt");
  }

  for (let i = 0; i < ORDER.length - 1; i++) {
    const a = indexOfMarker(sys, ORDER[i]!);
    const b = indexOfMarker(sys, ORDER[i + 1]!);
    if (a < 0) issues.push(`MISSING: [${ORDER[i]}]`);
    if (b < 0) issues.push(`MISSING: [${ORDER[i + 1]}]`);
    if (a >= 0 && b >= 0 && a >= b) {
      issues.push(`ORDER: [${ORDER[i]}] must precede [${ORDER[i + 1]}]`);
    }
  }

  const characterCanon = extractBlock(
    sys,
    /\[CHARACTER CANON — [^\]]+\]/
  );
  for (const re of REGRESSION_MARKERS) {
    if (re.test(characterCanon)) {
      issues.push(`LEAK: CHARACTER CANON contains regression text matching ${re}`);
    }
  }

  if (!/\[KNOWLEDGE PRECEDENCE/i.test(sys)) {
    issues.push("MISSING: [KNOWLEDGE PRECEDENCE] in boundary block");
  }

  const reportPath = path.join("debug", "leon-knowledge-verify.txt");
  const report = [
    `Leon knowledge prompt verify — chat ${chatId} — ${new Date().toISOString()}`,
    `char=${fixture.charName} model=deepseek/deepseek-v4-pro`,
    "",
    issues.length === 0 ? "PASS — all structural checks OK" : issues.map((x) => `• ${x}`).join("\n"),
    "",
    "Section indices:",
    ...ORDER.map((m) => `  [${m}]: ${indexOfMarker(sys, m)}`),
    "",
    "PLAYER CANON snippet:",
    extractBlock(sys, /\[PLAYER CANON — [^\]]+\]/).slice(0, 600),
  ].join("\n");

  fs.mkdirSync("debug", { recursive: true });
  fs.writeFileSync(reportPath, report, "utf8");

  console.log(report);
  console.log(`\nWrote ${reportPath}`);
  console.log("Updated debug/prompt_dump.txt via writePromptDebugDump");

  if (issues.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

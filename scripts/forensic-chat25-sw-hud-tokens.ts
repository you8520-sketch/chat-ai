/**
 * chat_id=25 — bare sw-hud HTML token share in model history (DB + code replay, no API).
 *
 * Usage: npx.cmd tsx scripts/forensic-chat25-sw-hud-tokens.ts
 */
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { getDatabasePath } from "../src/lib/dataDir";
import { messagesToTurns, rawRecentTurnsToHistory } from "../src/lib/hybridMemory";
import { stripRpMetaPreamble } from "../src/lib/narrativeRules";
import {
  sanitizePrimaryModelAssistantHistory,
  sanitizePrimaryModelHistoryMessages,
} from "../src/lib/flashOwnedOutputFirewall";
import { modelPlainStatusEveryTurnActive } from "../src/lib/statusWindowNotePolicy";
import { estimateTokens } from "../src/lib/tokenEstimate";
import { resolveRawRecentTurnWindowForHistory } from "../src/lib/contextTrack";
import { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } from "../src/lib/chatModels";

const CHAT_ID = 25;
const LONG_MIN_CHARS = 3000;
const SHORT_MAX_CHARS = 2500;

function tok(text: string): number {
  return text.length === 0 ? 0 : estimateTokens(text);
}

/** bare sw-hud block at tail (no ```html fence) */
function splitBareSwHud(text: string): { prose: string; html: string } {
  const swHudIdx = text.search(/sw-hud/i);
  if (swHudIdx < 0) return { prose: text, html: "" };
  const divStart = text.lastIndexOf("<div", swHudIdx);
  const start = divStart >= 0 ? divStart : swHudIdx;
  return { prose: text.slice(0, start).trimEnd(), html: text.slice(start).trim() };
}

function pct(htmlTok: number, proseTok: number): number {
  const total = proseTok + htmlTok;
  return total === 0 ? 0 : (htmlTok / total) * 100;
}

function openRouterHistorySanitize(
  history: Array<{ role: "user" | "assistant"; content: string }>,
  opts: Parameters<typeof sanitizePrimaryModelAssistantHistory>[1]
): Array<{ role: "user" | "assistant"; content: string }> {
  return history
    .map((m) => ({
      role: m.role,
      content:
        m.role === "assistant"
          ? sanitizePrimaryModelAssistantHistory(m.content.trim(), opts)
          : m.content.trim(),
    }))
    .filter((m) => m.content.length > 0);
}

function main() {
  const db = new Database(getDatabasePath(), { readonly: true });
  const rows = db
    .prepare(
      `SELECT id, role, content, model FROM messages WHERE chat_id=? ORDER BY id`
    )
    .all(CHAT_ID) as Array<{ id: number; role: string; content: string; model: string }>;

  const turns = messagesToTurns(
    rows
      .filter((r) => r.role === "user" || r.role === "assistant")
      .map((r) => ({
        role: r.role as "user" | "assistant",
        content: r.content,
        model: r.model,
      }))
  );

  const summarizedTurnCount = 0;
  const rawWindow = resolveRawRecentTurnWindowForHistory(
    OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
    "openrouter",
    turns.length
  );

  const rawHistory = rawRecentTurnsToHistory(turns, summarizedTurnCount, rawWindow);
  const sanitizeOpts = {
    modelOutputsPlainStatus: modelPlainStatusEveryTurnActive({
      everyTurn: false,
      formatSpec: null,
      outputFormat: "plain",
      placement: "bottom",
    }),
    modelOutputsHtmlVisualCard: false,
  };

  const afterRpMeta = rawHistory.map((m) =>
    m.role === "assistant" ? { ...m, content: stripRpMetaPreamble(m.content) } : m
  );
  const afterSanitize = sanitizePrimaryModelHistoryMessages(afterRpMeta, sanitizeOpts);
  const modelHistory = openRouterHistorySanitize(afterSanitize, sanitizeOpts);

  const assistantIds = rows
    .filter((r) => r.role === "assistant" && r.model.includes("deepseek"))
    .map((r) => r.id);
  const userIds = rows.filter((r) => r.role === "user").map((r) => r.id);

  type Row = {
    messageId: number;
    role: string;
    totalChars: number;
    proseChars: number;
    htmlChars: number;
    proseTok: number;
    htmlTok: number;
    htmlPct: number;
    group: "long" | "short" | "user" | "other";
  };

  const perMessage: Row[] = [];
  let turnIdx = 0;
  let userIdx = 0;
  for (const m of modelHistory) {
    if (m.role === "user") {
      perMessage.push({
        messageId: userIds[userIdx++] ?? 0,
        role: "user",
        totalChars: m.content.length,
        proseChars: m.content.length,
        htmlChars: 0,
        proseTok: tok(m.content),
        htmlTok: 0,
        htmlPct: 0,
        group: "user",
      });
      continue;
    }
    const turn = turns[turnIdx];
    const msgId = assistantIds[turnIdx] ?? 0;
    turnIdx++;
    const { prose, html } = splitBareSwHud(m.content);
    const proseTok = tok(prose);
    const htmlTok = tok(html);
    const assistantChars = turn?.assistant.length ?? m.content.length;
    const group =
      assistantChars >= LONG_MIN_CHARS
        ? "long"
        : assistantChars <= SHORT_MAX_CHARS
          ? "short"
          : "other";
    perMessage.push({
      messageId: msgId,
      role: "assistant",
      totalChars: m.content.length,
      proseChars: prose.length,
      htmlChars: html.length,
      proseTok,
      htmlTok,
      htmlPct: pct(htmlTok, proseTok),
      group,
    });
  }

  const assistantRows = perMessage.filter((r) => r.role === "assistant");
  const longRows = assistantRows.filter((r) => r.group === "long");
  const shortRows = assistantRows.filter((r) => r.group === "short");

  const sumProseTok = perMessage.reduce((a, r) => a + r.proseTok, 0);
  const sumHtmlTok = perMessage.reduce((a, r) => a + r.htmlTok, 0);
  const sumTotalTok = sumProseTok + sumHtmlTok;

  const assistantProseTok = assistantRows.reduce((a, r) => a + r.proseTok, 0);
  const assistantHtmlTok = assistantRows.reduce((a, r) => a + r.htmlTok, 0);

  const avgHtmlPct = (rows: Row[]) =>
    rows.length === 0
      ? 0
      : rows.reduce((a, r) => a + r.htmlPct, 0) / rows.length;

  const lines: string[] = [
    "chat_id=25 bare sw-hud HTML in model history — token audit",
    `generated: ${new Date().toISOString()}`,
    `token estimator: estimateTokens (chars × 0.9, ceil)`,
    `history messages: ${modelHistory.length} (${turns.length} turns, rawWindow=${rawWindow})`,
    `long group: assistant stored len >= ${LONG_MIN_CHARS}ch`,
    `short group: assistant stored len <= ${SHORT_MAX_CHARS}ch`,
    "",
    "## Per assistant message (model-facing after sanitize)",
    "id | stored_ch | model_ch | prose_tok | html_tok | html% | group",
  ];

  for (const r of assistantRows) {
    const stored = rows.find((x) => x.id === r.messageId);
    lines.push(
      `${r.messageId} | ${stored?.content.length ?? "?"} | ${r.totalChars} | ${r.proseTok} | ${r.htmlTok} | ${r.htmlPct.toFixed(1)}% | ${r.group}`
    );
  }

  lines.push("");
  lines.push("## Aggregates — assistant only (bare sw-hud split)");
  lines.push(`  RP prose tokens: ${assistantProseTok}`);
  lines.push(`  sw-hud HTML tokens: ${assistantHtmlTok}`);
  lines.push(
    `  HTML ratio (html / prose+html): ${pct(assistantHtmlTok, assistantProseTok).toFixed(2)}%`
  );
  lines.push(
    `  long group avg HTML% (per-message): ${avgHtmlPct(longRows).toFixed(2)}% (n=${longRows.length})`
  );
  lines.push(
    `  short group avg HTML% (per-message): ${avgHtmlPct(shortRows).toFixed(2)}% (n=${shortRows.length})`
  );

  lines.push("");
  lines.push("## History 전체 (user + assistant, model-facing)");
  lines.push(`  total tokens: ${sumTotalTok}`);
  lines.push(`  RP/user prose tokens: ${sumProseTok}`);
  lines.push(`  sw-hud HTML tokens: ${sumHtmlTok}`);
  lines.push(
    `  HTML 비중 (html / 전체 history): ${pct(sumHtmlTok, sumProseTok).toFixed(2)}%`
  );

  lines.push("");
  lines.push("## Long group per-message detail");
  for (const r of longRows) {
    lines.push(
      `  id=${r.messageId} prose_tok=${r.proseTok} html_tok=${r.htmlTok} html%=${r.htmlPct.toFixed(1)}`
    );
  }

  const outDir = path.resolve("output");
  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, "forensic-chat25-sw-hud-tokens-report.txt");
  fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
  console.log(lines.join("\n"));
  console.log(`Wrote ${reportPath}`);
}

main();

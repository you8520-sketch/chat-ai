/**
 * Forensic: does status widget content enter model history?
 * DB + current code replay only — no API.
 *
 * Usage: npx.cmd tsx scripts/forensic-status-widget-history.ts
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
import { splitProseAndStatusWidgetValuesDeepSeek } from "../src/lib/statusWidget/deepseekCapture";

/** Mirrors openRouterAdult.convertToOpenRouterFormat assistant sanitize (no openRouterAdult import). */
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

const MARKERS = [
  { name: "<<<STATUS", re: /<<<STATUS/i },
  { name: "<<<STATUS_VALUES", re: /<<<STATUS_VALUES/i },
  { name: "◆ 상태", re: /◆\s*상태/ },
  { name: "<div", re: /<div[\s>]/i },
  { name: "```html", re: /```html/i },
  { name: "status_widget_json leak", re: /<<<END_STATUS>>>/i },
  { name: "pipe status table", re: /\|\s*항목\s*\|\s*내용\s*\|/ },
];

function scanMarkers(text: string) {
  const hits: string[] = [];
  for (const m of MARKERS) {
    if (m.re.test(text)) hits.push(m.name);
  }
  return hits;
}

function main() {
  const db = new Database(getDatabasePath(), { readonly: true });
  const lines: string[] = [
    "STATUS WIDGET IN MODEL HISTORY — forensic",
    `generated: ${new Date().toISOString()}`,
    `db: ${getDatabasePath()}`,
    "",
  ];

  // ── 1. What's stored in messages.content? ──
  const assistants = db
    .prepare(
      `SELECT m.id, m.chat_id, m.created_at, m.content, m.status_widget_turn_active,
              m.status_widget_values_json, LENGTH(m.content) AS raw_len
       FROM messages m
       WHERE m.role='assistant' AND m.model LIKE '%deepseek%' AND m.model != 'greeting'
       ORDER BY m.id`
    )
    .all() as Array<{
    id: number;
    chat_id: number;
    created_at: string;
    content: string;
    status_widget_turn_active: number;
    status_widget_values_json: string | null;
    raw_len: number;
  }>;

  const widgetTurns = assistants.filter((a) => a.status_widget_turn_active === 1);
  lines.push("## 1. DB storage at save time (messages.content)");
  lines.push(`  deepseek assistant messages: ${assistants.length}`);
  lines.push(`  status_widget_turn_active=1: ${widgetTurns.length}`);
  lines.push("");
  lines.push("  Save path (route.ts): partitionModelStatusArtifacts → savedText → resolveStatusWidgetTurnValues → widgetResolved.prose → INSERT content");
  lines.push("  status_widget_values_json: separate column (NOT in messages.content for widget values)");
  lines.push("");

  let dbWithStatusMarkers = 0;
  for (const a of assistants) {
    const hits = scanMarkers(a.content);
    if (hits.length) dbWithStatusMarkers++;
  }
  lines.push(`  messages.content with status/html markers: ${dbWithStatusMarkers}/${assistants.length}`);
  for (const a of widgetTurns.slice(0, 8)) {
    const hits = scanMarkers(a.content);
    const split = splitProseAndStatusWidgetValuesDeepSeek(a.content);
    lines.push(
      `  id=${a.id} chat=${a.chat_id} len=${a.raw_len} widget_active=1 markers_in_db=[${hits.join(",")}] values_json_len=${(a.status_widget_values_json ?? "").length} split_prose_len=${split.prose.length}`
    );
  }
  if (widgetTurns.length > 8) lines.push(`  ... +${widgetTurns.length - 8} more widget turns`);
  lines.push("");

  // Sample longest marker leak
  const leakSample = assistants
    .filter((a) => scanMarkers(a.content).length > 0)
    .sort((a, b) => b.raw_len - a.raw_len)[0];
  if (leakSample) {
    lines.push("  Example DB content tail (max marker leak):");
    lines.push(`  id=${leakSample.id} markers=${scanMarkers(leakSample.content).join(",")}`);
    lines.push(`  tail_400: ${leakSample.content.slice(-400).replace(/\n/g, " ")}`);
    lines.push("");
  }

  // ── Pick chat 25 (long burst, widget) for history replay ──
  const chatId = 25;
  const rows = db
    .prepare(
      `SELECT id, role, content, model, status_widget_turn_active FROM messages WHERE chat_id=? ORDER BY id`
    )
    .all(chatId) as Array<{
    id: number;
    role: string;
    content: string;
    model: string;
    status_widget_turn_active: number;
  }>;

  const turns = messagesToTurns(
    rows.map((r) => ({ role: r.role as "user" | "assistant", content: r.content, model: r.model }))
  );

  // Simulate route.ts history build (before contextBuilder)
  const rawHistory = rawRecentTurnsToHistory(turns, 0, 20).map((m) => ({ ...m }));

  // contextBuilder steps
  const afterRpMeta = rawHistory.map((m) =>
    m.role === "assistant" ? { ...m, content: stripRpMetaPreamble(m.content) } : m
  );
  const sanitizeOpts = {
    modelOutputsPlainStatus: modelPlainStatusEveryTurnActive({
      everyTurn: false,
      formatSpec: null,
      outputFormat: "plain",
      placement: "bottom",
    }),
    modelOutputsHtmlVisualCard: false,
  };
  const afterSanitize = sanitizePrimaryModelHistoryMessages(afterRpMeta, sanitizeOpts);

  // openRouterAdult final pass
  const afterOpenRouter = openRouterHistorySanitize(afterSanitize, sanitizeOpts);

  // Pick assistant history entry for message 333 if present
  const msg333 = rows.find((r) => r.id === 333);
  const hist333Raw = rawHistory.find(
    (m, i) => m.role === "assistant" && rawHistory[i - 1]?.role === "user"
  );
  let targetAssistant = afterOpenRouter.filter((m) => m.role === "assistant").pop();

  lines.push("## 2. History construction call chain");
  lines.push("  route.ts: messages.content → messagesToTurns → rawRecentTurnsToHistory (NO strip)");
  lines.push("  contextBuilder: assistant → stripRpMetaPreamble → sanitizePrimaryModelHistoryMessages");
  lines.push("  openRouterAdult: convertToOpenRouterFormat → sanitizePrimaryModelAssistantHistory (again)");
  lines.push("  status_widget_values_json: NOT injected into history messages");
  lines.push("");

  lines.push("## 3. Traced functions");
  lines.push("  save: partitionModelStatusArtifacts, stripEmotionTagsForDisplay, resolveStatusWidgetTurnValues (splitProseAndStatusWidgetValuesDeepSeek)");
  lines.push("  history sanitize: sanitizePrimaryModelOutputArtifacts → stripAllStatusWindowOutputArtifacts → partitionModelStatusArtifacts");
  lines.push("  history: stripRpMetaPreamble (narrativeRules)");
  lines.push("  openRouter: convertToOpenRouterFormat, normalizeOpenRouterChatHistory");
  lines.push("");

  lines.push(`## 4. Model history dump — chat_id=${chatId} (last assistant in pipeline)`);
  if (targetAssistant) {
    const bytes = Buffer.from(targetAssistant.content, "utf8");
    lines.push(`  role=assistant byte_length=${bytes.length} char_length=${targetAssistant.content.length}`);
    lines.push(`  markers_after_pipeline=[${scanMarkers(targetAssistant.content).join(",")}]`);
    lines.push("  --- BYTE DUMP (utf8) ---");
    lines.push(targetAssistant.content);
    lines.push("  --- END DUMP ---");
  } else {
    lines.push("  (no assistant in replayed history)");
  }
  lines.push("");

  if (msg333) {
    const raw333 = msg333.content;
    const piped = sanitizePrimaryModelAssistantHistory(
      stripRpMetaPreamble(raw333),
      sanitizeOpts
    );
    lines.push("## 4b. message_id=333 specifically");
    lines.push(`  DB markers: [${scanMarkers(raw333).join(",")}]`);
    lines.push(`  after history sanitize markers: [${scanMarkers(piped).join(",")}]`);
    lines.push(`  DB tail 200: ${raw333.slice(-200).replace(/\n/g, " ")}`);
    lines.push(`  piped tail 200: ${piped.slice(-200).replace(/\n/g, " ")}`);
    lines.push("");
  }

  // ── 5. Scan all assistant after full pipeline simulation ──
  let pipelineLeaks = 0;
  for (const t of turns) {
    const piped = sanitizePrimaryModelAssistantHistory(
      stripRpMetaPreamble(t.assistant),
      sanitizeOpts
    );
    if (scanMarkers(piped).length) pipelineLeaks++;
  }
  lines.push("## 5. Marker scan — all turns after history sanitize");
  lines.push(`  turns with markers after sanitize: ${pipelineLeaks}/${turns.length}`);
  lines.push(`  modelPlainStatusEveryTurnActive: ${modelPlainStatusEveryTurnActive({ everyTurn: false, formatSpec: null, outputFormat: "plain", placement: "bottom" })} (always false — Flash owns plain status)`);
  lines.push("");

  lines.push("## VERDICT");
  if (dbWithStatusMarkers > 0) {
    lines.push(
      `  DB content: ${dbWithStatusMarkers} messages still contain status/html markers in messages.content (save-path strip incomplete for some turns).`
    );
  } else {
    lines.push("  DB content: no <<<STATUS / ◆ / <div markers in stored assistant text (widget values in separate JSON column).");
  }
  if (pipelineLeaks === 0) {
    lines.push(
      "  Model history: sanitizePrimaryModelAssistantHistory removes status/widget artifacts — model does NOT see <<<STATUS_VALUES>, HTML fences, pipe tables when pipeline runs."
    );
  } else {
    lines.push(
      `  Model history: ${pipelineLeaks} turns still have markers AFTER sanitize — partial leak possible.`
    );
  }
  lines.push(
    "  Widget STATE: stored in status_widget_values_json + UI renders from JSON — not re-serialized into OpenRouter history in code path reviewed."
  );
  lines.push(
    "  ◆ 상태 로그 blocks in forensic samples are likely save-path leaks (model output UI), not widget JSON column."
  );

  const outDir = path.resolve("output");
  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, "forensic-status-widget-history-report.txt");
  const dumpPath = path.join(outDir, "forensic-status-widget-history-dump.txt");
  fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
  if (targetAssistant) {
    fs.writeFileSync(dumpPath, targetAssistant.content, "utf8");
  }
  console.log(lines.join("\n"));
  console.log(`Wrote ${reportPath}`);
  if (targetAssistant) console.log(`Wrote ${dumpPath}`);
}

main();

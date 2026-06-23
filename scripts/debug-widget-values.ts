import { getDb } from "../src/lib/db";
import { parseStatusWidgetJson } from "../src/lib/statusWidget/serialize";
import { splitProseAndStatusWidgetValues } from "../src/lib/statusWidget/parseValues";
import { buildOpenRouterCachedSystemContent } from "../src/lib/openRouterCache";
import { buildStatusWidgetPromptBlock, resolveStatusWidgetTurn } from "../src/lib/statusWidget";
import { appendStatusWidgetBlockToOpenRouterSplit } from "../src/lib/statusWidget/promptOverrides";

const db = getDb();

const latest = db
  .prepare(
    `SELECT m.id, m.chat_id, m.model, m.created_at,
            length(m.content) as len,
            m.status_widget_values_json,
            substr(m.content, -1200) as tail
     FROM messages m
     WHERE m.role = 'assistant' AND m.model != 'greeting'
     ORDER BY m.id DESC LIMIT 5`
  )
  .all() as Array<Record<string, unknown>>;

console.log("=== latest assistant messages ===");
for (const m of latest) {
  console.log("\n---", m.id, m.model, m.created_at, "len", m.len);
  console.log("values_json:", m.status_widget_values_json || "(empty)");
  const full = db.prepare("SELECT content FROM messages WHERE id=?").get(m.id) as { content: string };
  const hasStatusBlock =
    full.content.includes("<<<STATUS_VALUES") ||
    full.content.includes("```json") ||
    /속마음\s*[:：]/.test(full.content.slice(-500));
  console.log("has status artifacts in raw?", hasStatusBlock);
  const split = splitProseAndStatusWidgetValues(full.content);
  console.log("parsed:", JSON.stringify(split.values));
  if (String(m.tail).includes("STATUS") || String(m.tail).includes("```json")) {
    console.log("tail:", m.tail);
  }
}

const chat = db
  .prepare(
    `SELECT c.id, c.status_widget_mode, ch.status_widget_json
     FROM chats c JOIN characters ch ON ch.id = c.character_id
     WHERE c.id = (SELECT chat_id FROM messages ORDER BY id DESC LIMIT 1)`
  )
  .get() as { id: number; status_widget_mode: string; status_widget_json: string };

const turn = resolveStatusWidgetTurn({
  characterWidgetJson: chat.status_widget_json,
  chatMode: chat.status_widget_mode,
});
const block = buildStatusWidgetPromptBlock(turn);
console.log("\n=== widget prompt block (first 400 chars) ===");
console.log(block.slice(0, 400));

const mockSplit = {
  systemRulesBlock: "rules",
  characterSettingsBlock: "char",
  dynamicBlock: "dynamic before",
};
const patched = appendStatusWidgetBlockToOpenRouterSplit(mockSplit, block);
const apiContent = buildOpenRouterCachedSystemContent(patched);
const apiText = apiContent.map((b) => b.text).join("\n---\n");
console.log("\n=== API split includes STATUS WIDGET? ===", apiText.includes("[STATUS WIDGET"));
console.log("includes STATUS_VALUES char?", apiText.includes("<<<STATUS_VALUES"));

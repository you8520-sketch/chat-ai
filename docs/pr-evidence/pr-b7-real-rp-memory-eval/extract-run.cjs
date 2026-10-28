// Reads the evaluated turn back from an isolated run DB: final assistant text,
// character counts, and the api_cost_ledger rows written by that run.
// Usage: node extract-run.cjs <run_dir> <out_dir> <question_id>
const Database = require("/workspace/node_modules/better-sqlite3");
const fs = require("node:fs");

const [dir, out, qid] = process.argv.slice(2);
const db = new Database(`${dir}/app.db`, { readonly: true });
const msg = db
  .prepare("SELECT id, content, model, generation_status FROM messages WHERE chat_id=1 AND role=? ORDER BY id DESC LIMIT 1")
  .get("assistant");
const ledger = db
  .prepare(
    `SELECT request_kind, coalesce(actual_model, model) model, input_tokens, output_tokens, cache_read_tokens, round(cost_krw, 2) krw, created_at
     FROM api_cost_ledger WHERE created_at >= (SELECT created_at FROM messages WHERE id=?) ORDER BY id`
  )
  .all(msg.id - 1);
fs.writeFileSync(`${out}/${qid}.output.txt`, msg.content);
const mainRp = ledger.filter((r) => r.request_kind === "main-rp");
const report = {
  qid,
  assistant_message_id: msg.id,
  model: msg.model,
  generation_status: msg.generation_status,
  chars: [...msg.content].length,
  chars_no_space: [...msg.content.replace(/\s/g, "")].length,
  main_rp: mainRp,
  background: ledger.filter((r) => r.request_kind !== "main-rp"),
  run_total_krw: Math.round(ledger.reduce((n, r) => n + (r.krw || 0), 0) * 100) / 100,
};
fs.writeFileSync(`${out}/${qid}.usage.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ qid, chars: report.chars, main_rp_krw: mainRp.map((r) => r.krw), run_total_krw: report.run_total_krw }));

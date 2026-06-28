import Module from "module";
const o = Module._load;
Module._load = function (r, p, m) {
  if (r === "server-only") return {};
  return o.call(this, r, p, m);
};

const { getDb } = await import("../src/lib/db.ts");
const db = getDb();
const mem = db.prepare("SELECT * FROM chat_memories WHERE chat_id=38").get();
console.log("chat_memories:", mem);

const rows = db
  .prepare(
    `SELECT m.id, m.role, length(m.content) as chars, m.created_at,
            mg.input_tokens, mg.output_tokens, mg.context_json
     FROM messages m
     JOIN message_generations mg ON mg.message_id = m.id
     WHERE m.chat_id = 38 AND m.id >= 714
     ORDER BY m.id`
  )
  .all();

for (const row of rows) {
  const j = JSON.parse(row.context_json || "{}");
  console.log({
    id: row.id,
    role: row.role,
    chars: row.chars,
    created: row.created_at,
    in: row.input_tokens,
    out: row.output_tokens,
    completedTurns: j.completedTurns,
    targetChars: j.targetResponseChars,
    audit: j.promptAudit?.breakdown,
  });
}

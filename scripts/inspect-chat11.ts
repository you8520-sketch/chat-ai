import Database from "better-sqlite3";

const db = new Database("data/app.db", { readonly: true });

const chats = db
  .prepare(
    `SELECT id, title, user_id, character_id,
            LENGTH(memory) ml, LENGTH(memory_pending) mpl, LENGTH(memory_meta) mml
     FROM chats WHERE character_id=14 ORDER BY id`
  )
  .all() as any[];

for (const c of chats) {
  const m = db
    .prepare(
      `SELECT COUNT(*) n,
              COALESCE(SUM(LENGTH(content)),0) contentLen,
              COALESCE(SUM(LENGTH(COALESCE(alternates,''))),0) altLen,
              COALESCE(MAX(LENGTH(content)),0) maxContent,
              COALESCE(MAX(LENGTH(COALESCE(alternates,''))),0) maxAlt
       FROM messages WHERE chat_id=?`
    )
    .get(c.id) as any;
  console.log(
    `chat=${c.id} title=${JSON.stringify(c.title)} user=${c.user_id} msgs=${m.n} contentLen=${m.contentLen} altLen=${m.altLen} maxContent=${m.maxContent} maxAlt=${m.maxAlt} mem=${c.ml}/${c.mpl}/${c.mml}`
  );
}

// usage / alternates JSON 유효성 검사
for (const c of chats) {
  const rows = db
    .prepare(`SELECT id, usage, alternates, active_variant FROM messages WHERE chat_id=?`)
    .all(c.id) as any[];
  for (const r of rows) {
    if (r.usage) {
      try { JSON.parse(r.usage); } catch { console.log(`BAD usage JSON chat=${c.id} msg=${r.id}`); }
    }
    if (r.alternates) {
      try { JSON.parse(r.alternates); } catch { console.log(`BAD alternates JSON chat=${c.id} msg=${r.id}`); }
    }
  }
}
console.log("done");

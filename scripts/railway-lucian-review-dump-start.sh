#!/usr/bin/env bash
set -euo pipefail

node <<'NODE'
const Database = require("better-sqlite3");
const db = new Database("/data/app.db", { readonly: true });
const row = db.prepare(
  "SELECT id,name,tagline,description,greeting,system_prompt,world,creator_comment,tags,appearance_raw,appearance_compiled FROM characters WHERE id=?"
).get(50);
if (!row) throw new Error("character 50 not found");
console.log("[LUCIAN_REVIEW_DUMP_BEGIN]");
console.log(JSON.stringify(row, null, 2));
console.log("[LUCIAN_REVIEW_DUMP_END]");
db.close();
NODE

exec npm run start

/**
 * Seeds isolated DATA_DIR for production UI capture (not production DB).
 * Run: DATA_DIR=/tmp/... NODE_TEST_CONTEXT=1 tsx --conditions=react-server docs/pr-evidence/official-character-p2-compile-refresh/seed-prod-ui-demo.ts
 */
import { hashPassword } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { seedWolfgang51ForHttpTest } from "@/lib/officialSupply/officialSupplyCompileRefreshHttpSeed";

const ADMIN_EMAIL = "p2-ui-admin@test.local";
const ADMIN_PW = "p2-ui-demo-pass";

function main() {
  const db = getDb();
  const pw = hashPassword(ADMIN_PW);
  db.prepare("DELETE FROM users WHERE email=?").run(ADMIN_EMAIL);
  db.prepare(
    "INSERT INTO users (id,email,nickname,pw_hash,is_adult,is_admin) VALUES (95101,?,?,?,1,1)"
  ).run(ADMIN_EMAIL, "P2 UI Admin", pw);
  seedWolfgang51ForHttpTest();
  console.log(JSON.stringify({ ok: true, adminEmail: ADMIN_EMAIL, dataDir: process.env.DATA_DIR }));
}

main();

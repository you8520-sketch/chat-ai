/**
 * 관리자 권한 부여/해제 — users.is_admin
 *
 * Usage:
 *   npx tsx scripts/set-admin.ts --list
 *   npx tsx scripts/set-admin.ts --email you@example.com
 *   npx tsx scripts/set-admin.ts --email you@example.com --revoke
 *   npx tsx scripts/set-admin.ts --id 1
 */
import Database from "better-sqlite3";
import path from "path";

const dbPath = path.join(process.cwd(), "data", "app.db");

function parseArgs(argv: string[]) {
  let email = "";
  let id: number | null = null;
  let revoke = false;
  let list = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--email" && argv[i + 1]) email = argv[++i].trim();
    else if (arg === "--id" && argv[i + 1]) id = Number(argv[++i]);
    else if (arg === "--revoke") revoke = true;
    else if (arg === "--list") list = true;
  }

  return { email, id, revoke, list };
}

function main() {
  const { email, id, revoke, list } = parseArgs(process.argv.slice(2));
  const db = new Database(dbPath);

  if (list) {
    const rows = db
      .prepare(
        `SELECT id, email, nickname, is_admin FROM users ORDER BY is_admin DESC, id ASC`
      )
      .all() as { id: number; email: string; nickname: string; is_admin: number }[];

    if (rows.length === 0) {
      console.log("No users in database.");
      return;
    }

    console.log("id\tadmin\temail\tnickname");
    for (const row of rows) {
      console.log(`${row.id}\t${row.is_admin ? "Y" : "-"}\t${row.email}\t${row.nickname}`);
    }
    return;
  }

  if (!email && id == null) {
    console.error("Provide --email or --id (or --list).");
    process.exit(1);
  }

  const user = email
    ? (db.prepare("SELECT id, email, nickname, is_admin FROM users WHERE lower(email)=lower(?)").get(email) as
        | { id: number; email: string; nickname: string; is_admin: number }
        | undefined)
    : (db.prepare("SELECT id, email, nickname, is_admin FROM users WHERE id=?").get(id!) as
        | { id: number; email: string; nickname: string; is_admin: number }
        | undefined);

  if (!user) {
    console.error("User not found.");
    process.exit(1);
  }

  const next = revoke ? 0 : 1;
  db.prepare("UPDATE users SET is_admin=? WHERE id=?").run(next, user.id);

  console.log(
    revoke
      ? `Revoked admin: #${user.id} ${user.email} (${user.nickname})`
      : `Granted admin: #${user.id} ${user.email} (${user.nickname})`
  );
  console.log("\nAdmin pages:");
  console.log("  http://localhost:3000/admin/create-migration");
  console.log("  http://localhost:3000/admin/payout");
}

main();

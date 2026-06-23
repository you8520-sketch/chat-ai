/**
 * 관리자 권한 부여/해제 — users.is_admin
 *
 * Usage:
 *   npx tsx scripts/set-admin.ts --list
 *   npx tsx scripts/set-admin.ts --email you@example.com
 *   npx tsx scripts/set-admin.ts --email you@example.com --dev
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
  let dev = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--email" && argv[i + 1]) email = argv[++i].trim();
    else if (arg === "--id" && argv[i + 1]) id = Number(argv[++i]);
    else if (arg === "--revoke") revoke = true;
    else if (arg === "--list") list = true;
    else if (arg === "--dev") dev = true;
  }

  return { email, id, revoke, list, dev };
}

function main() {
  const { email, id, revoke, list, dev } = parseArgs(process.argv.slice(2));
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

  if (dev && !revoke) {
    db.prepare(
      `UPDATE users SET is_adult=1, nsfw_on=1,
       real_name=COALESCE(NULLIF(real_name, ''), nickname) WHERE id=?`
    ).run(user.id);
  }

  const flags = db
    .prepare("SELECT is_admin, is_adult, nsfw_on, real_name FROM users WHERE id=?")
    .get(user.id) as { is_admin: number; is_adult: number; nsfw_on: number; real_name: string };

  console.log(
    revoke
      ? `Revoked admin: #${user.id} ${user.email} (${user.nickname})`
      : `Granted admin: #${user.id} ${user.email} (${user.nickname})`
  );
  if (dev && !revoke) {
    console.log(
      `Dev adult flags: is_adult=${flags.is_adult} nsfw_on=${flags.nsfw_on} real_name=${flags.real_name || "(nickname)"}`
    );
  }
  console.log("\nAdmin pages:");
  console.log("  http://localhost:8092/admin/beta-free-points");
  console.log("  http://localhost:8092/admin/point-grant");
  console.log("  http://localhost:8092/admin/payout");
}

main();

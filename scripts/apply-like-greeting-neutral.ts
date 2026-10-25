/**
 * Apply Like (character 18 / staff-greeting fingerprint) greeting minimal patch.
 * Dry-run by default. Pass --apply to write.
 *
 * Removes speaking 지원국 staff Q&A from the opening while keeping Like×Ren first-meeting.
 * Does not modify SceneDirective / layout / Terra length owners.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import {
  isLikeSupportStaffGreeting,
  TERRA_PROMPT_CANARY_LIKE_CHARACTER_ID,
} from "../src/lib/terraPromptCanary";

const APPLY = process.argv.includes("--apply");
const dataDir = process.env.DATA_DIR?.trim() || join(process.cwd(), "data");
const dbPath = join(dataDir, "app.db");
const patchPath = join(
  process.cwd(),
  "data/patches/like-char18-greeting-neutral-v1.txt"
);

const nextGreeting = readFileSync(patchPath, "utf8").replace(/\r\n/g, "\n").trimEnd() + "\n";

const db = new Database(dbPath);
const rows = db
  .prepare("SELECT id, name, greeting FROM characters WHERE id=? OR greeting LIKE ?")
  .all(TERRA_PROMPT_CANARY_LIKE_CHARACTER_ID, "%지원국 직원%") as Array<{
  id: number;
  name: string;
  greeting: string;
}>;

const targets = rows.filter(
  (r) =>
    r.id === TERRA_PROMPT_CANARY_LIKE_CHARACTER_ID ||
    isLikeSupportStaffGreeting(r.greeting ?? "")
);

console.log(
  JSON.stringify(
    {
      dbPath,
      apply: APPLY,
      candidates: targets.map((t) => ({
        id: t.id,
        name: t.name,
        oldLen: (t.greeting ?? "").length,
        hadStaffQuote: isLikeSupportStaffGreeting(t.greeting ?? ""),
      })),
      nextLen: nextGreeting.length,
    },
    null,
    2
  )
);

if (!APPLY) {
  console.log("Dry-run only. Re-run with --apply to write.");
  process.exit(0);
}

const upd = db.prepare("UPDATE characters SET greeting=? WHERE id=?");
const tx = db.transaction(() => {
  for (const t of targets) {
    upd.run(nextGreeting, t.id);
  }
});
tx();
console.log(`Updated ${targets.length} character(s).`);
db.close();

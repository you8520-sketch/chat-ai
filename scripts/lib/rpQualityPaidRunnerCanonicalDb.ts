/**
 * Canonical production DB path for in-process sealed-pack assembly.
 * Only DATA_DIR/app.db is allowed. Symlinks and relative paths are rejected.
 */
import { existsSync, lstatSync } from "node:fs";
import path from "node:path";

export function resolveCanonicalProductionDbPath(originalDataDir: string): string | null {
  if (!originalDataDir || !path.isAbsolute(originalDataDir)) return null;
  let directoryStat;
  try {
    directoryStat = lstatSync(originalDataDir);
  } catch {
    return null;
  }
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) return null;
  const dbPath = path.join(originalDataDir, "app.db");
  let fileStat;
  try {
    fileStat = lstatSync(dbPath);
  } catch {
    return null;
  }
  if (fileStat.isSymbolicLink() || !fileStat.isFile()) return null;
  if (!existsSync(dbPath)) return null;
  return dbPath;
}

import path from "path";

/** Persistent data root — Railway volume mount (e.g. DATA_DIR=/data). */
export function getDataDir(): string {
  const custom = process.env.DATA_DIR?.trim();
  if (custom) return path.resolve(custom);
  return path.join(process.cwd(), "data");
}

export function getDatabasePath(): string {
  return path.join(getDataDir(), "app.db");
}

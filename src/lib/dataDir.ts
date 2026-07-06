import fs from "fs";
import path from "path";

/** Shell/CI에서 `tmp-*` 실험 DB가 DATA_DIR로 잡히면 로컬 dev가 빈 DB를 본다 */
function isTransientTestDataDir(dir: string): boolean {
  const normalized = dir.replace(/\\/g, "/");
  return /(^|\/)tmp-[a-z0-9-]+$/i.test(normalized);
}

function productionVolumeDataDir(): string | null {
  if (process.env.NODE_ENV !== "production") return null;
  return fs.existsSync("/data") ? "/data" : null;
}

/** Persistent data root — Railway volume mount (e.g. DATA_DIR=/data). */
export function getDataDir(): string {
  const custom = process.env.DATA_DIR?.trim();
  if (custom) {
    const resolved = path.resolve(custom);
    if (process.env.NODE_ENV === "development" && isTransientTestDataDir(resolved)) {
      console.warn(
        `[dataDir] Ignoring transient test DATA_DIR (${resolved}); using project data/`
      );
      return path.join(process.cwd(), "data");
    }
    return resolved;
  }
  return productionVolumeDataDir() ?? path.join(process.cwd(), "data");
}

export function getDatabasePath(): string {
  return path.join(getDataDir(), "app.db");
}

import fs from "fs";
import path from "path";

/** Shell/CI에서 `tmp-*` 실험 DB가 DATA_DIR로 잡히면 로컬 dev가 빈 DB를 본다 */
function isTransientTestDataDir(dir: string): boolean {
  const normalized = dir.replace(/\\/g, "/");
  return /(^|\/)tmp-[a-z0-9-]+$/i.test(normalized);
}

function isProductionBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production" && !isProductionBuildPhase();
}

export type RemoteDatabaseConfig = {
  url: string;
  authToken: string;
};

/** Turso/libSQL is the persistent database backend used on serverless hosts such as Vercel. */
export function getRemoteDatabaseConfig(): RemoteDatabaseConfig | null {
  const url = process.env.TURSO_DATABASE_URL?.trim() ?? "";
  const authToken =
    process.env.TURSO_AUTH_TOKEN?.trim() ||
    process.env.TURSO_DATABASE_TURSO_AUTH_TOKEN?.trim() ||
    "";
  if (!url && !authToken) return null;
  if (!url || !authToken) {
    throw new Error(
      "TURSO_DATABASE_URL and a Turso auth token must be configured together. " +
        "Set TURSO_AUTH_TOKEN or the Vercel integration variable TURSO_DATABASE_TURSO_AUTH_TOKEN."
    );
  }
  if (!/^(?:libsql|https|http):\/\//i.test(url)) {
    throw new Error("TURSO_DATABASE_URL must be a libsql:// or https:// URL.");
  }
  return { url, authToken };
}

function mountedPaths(): Set<string> {
  try {
    const mountInfo = fs.readFileSync("/proc/self/mountinfo", "utf8");
    return new Set(
      mountInfo
        .split("\n")
        .map((line) => line.split(" ")[4])
        .filter(Boolean)
        .map((mountPoint) => path.resolve(mountPoint.replace(/\\040/g, " ")))
    );
  } catch {
    return new Set();
  }
}

function hasMountedPersistentVolume(dir: string): boolean {
  const mounts = mountedPaths();
  if (mounts.size === 0) return false;
  let current = path.resolve(dir);
  while (current !== path.dirname(current)) {
    if (mounts.has(current)) return current !== path.parse(current).root;
    current = path.dirname(current);
  }
  return false;
}

function productionVolumeDataDir(): string | null {
  if (process.env.NODE_ENV !== "production") return null;
  if (fs.existsSync("/data")) return "/data";
  if (isProductionBuildPhase()) return null;
  throw new Error(
    "Production DATA_DIR is not configured and /data does not exist. " +
      "Mount a persistent volume and set DATA_DIR (for example DATA_DIR=/data) before starting the server."
  );
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

export function validateProductionDataDirRuntime(dataDir = getDataDir()): void {
  if (!isProductionRuntime()) return;

  if (process.env.PLAYWRIGHT_PROD_SERVER === "1") {
    const resolved = path.resolve(dataDir);
    if (!fs.existsSync(resolved)) {
      fs.mkdirSync(resolved, { recursive: true });
    }
    return;
  }

  const resolved = path.resolve(dataDir);
  const ephemeralProjectData = path.resolve(process.cwd(), "data");
  if (resolved === ephemeralProjectData) {
    throw new Error(
      `Production database would use ephemeral project data directory (${resolved}). ` +
        "Set DATA_DIR to a mounted persistent volume such as /data."
    );
  }

  if (!fs.existsSync(resolved)) {
    throw new Error(`Production DATA_DIR does not exist: ${resolved}`);
  }
  if (!fs.statSync(resolved).isDirectory()) {
    throw new Error(`Production DATA_DIR is not a directory: ${resolved}`);
  }
  if (!hasMountedPersistentVolume(resolved)) {
    throw new Error(
      `Production DATA_DIR is not backed by a detected mounted volume: ${resolved}. ` +
        "Mount Railway persistent storage at /data and set DATA_DIR=/data."
    );
  }
}

export function databaseDiagnostics(dataDir = getDataDir()) {
  const resolvedDataDir = path.resolve(dataDir);
  const databasePath = path.join(resolvedDataDir, "app.db");
  return {
    nodeEnv: process.env.NODE_ENV ?? "",
    nextPhase: process.env.NEXT_PHASE ?? "",
    cwd: process.cwd(),
    dataDir: resolvedDataDir,
    databasePath,
    dataDirExists: fs.existsSync(resolvedDataDir),
    dataDirIsMounted: hasMountedPersistentVolume(resolvedDataDir),
    productionRuntime: isProductionRuntime(),
  };
}

export function remoteDatabaseDiagnostics(config: RemoteDatabaseConfig) {
  let host = "configured";
  try {
    host = new URL(config.url.replace(/^libsql:/i, "https:")).host;
  } catch {
    // Never log the URL or auth token when parsing fails.
  }
  return {
    nodeEnv: process.env.NODE_ENV ?? "",
    nextPhase: process.env.NEXT_PHASE ?? "",
    backend: "turso",
    host,
    productionRuntime: isProductionRuntime(),
  };
}

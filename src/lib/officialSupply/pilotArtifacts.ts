import fs from "node:fs";
import path from "node:path";

/**
 * Active quarantine status for pilot workflow steps. A quarantine file means
 * "this step is currently failed". A later success removes it — historical
 * failure provenance lives in the cost report / author-run ledger, never in a
 * stale status file.
 */
export function quarantinePath(dir: string, key: string): string {
  return path.join(dir, `quarantine-${key}.json`);
}

/** `rejected` = the last candidate the gate refused, kept so a reviewer can see why. */
export function writeQuarantine(dir: string, key: string, error: unknown, now = new Date(), rejected?: unknown): void {
  fs.mkdirSync(dir, { recursive: true });
  const record = {
    key,
    error: String((error as Error)?.message ?? error).slice(0, 2000),
    at: now.toISOString(),
    ...(rejected === undefined ? {} : { rejected }),
  };
  fs.writeFileSync(quarantinePath(dir, key), `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

export function clearQuarantine(dir: string, key: string): boolean {
  const file = quarantinePath(dir, key);
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file, { force: true });
  return true;
}

export function listActiveQuarantines(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^quarantine-.+\.json$/.test(f))
    .map((f) => f.replace(/^quarantine-/, "").replace(/\.json$/, ""))
    .sort();
}

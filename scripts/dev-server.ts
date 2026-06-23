/**
 * Dev boot — port 3000 정리, 손상된 .next-dev 자동 삭제, server.js 실행.
 * `next build`(.next)와 dev(.next-dev) 출력 분리로 build/dev 충돌 방지.
 */
import { spawn, execSync } from "child_process";
import { existsSync, readdirSync, rmSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const devCache = join(root, ".next-dev");
const DEV_DIST = ".next-dev";

function killPort3000(): void {
  if (process.platform !== "win32") return;
  try {
    execSync(
      'powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"',
      { stdio: "ignore", cwd: root }
    );
  } catch {
    /* port already free */
  }
}

function isCorruptCache(dir: string): boolean {
  if (!existsSync(dir)) return false;
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return true;
  }
  if (entries.length === 0) return false;
  return !existsSync(join(dir, "routes-manifest.json"));
}

function clearDevCache(): void {
  if (!existsSync(devCache)) return;
  console.log("[dev] Clearing dev cache:", devCache);
  rmSync(devCache, { recursive: true, force: true });
}

killPort3000();

if (isCorruptCache(devCache)) {
  clearDevCache();
}

// stale production chunks mixed into dev cache (e.g. missing *.js under server/)
const serverDir = join(devCache, "server");
if (existsSync(serverDir) && isCorruptCache(devCache)) {
  clearDevCache();
}

const env: NodeJS.ProcessEnv = {
  ...process.env,
  NEXT_DIST_DIR: DEV_DIST,
  NODE_ENV: "development",
  NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --max-old-space-size=8192`.trim(),
};

const child = spawn("tsx", ["server.js"], {
  cwd: root,
  stdio: "inherit",
  shell: true,
  env,
});

child.on("exit", (code) => process.exit(code ?? 0));

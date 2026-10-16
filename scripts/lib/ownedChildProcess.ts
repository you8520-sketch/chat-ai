import { execFileSync, spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

export const OWNED_CHILD_TERM_WAIT_MS = 8_000;

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isOwnedPgid(pgid: number): boolean {
  return Number.isInteger(pgid) && pgid > 1;
}

/** PIDs in the detached child's process group only. Does not scan other groups. */
export function listOwnedGroupPids(pgid: number): number[] {
  if (!isOwnedPgid(pgid)) return [];
  try {
    const out = execFileSync("pgrep", ["-g", String(pgid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out
      .trim()
      .split(/\s+/)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 1);
  } catch {
    return isPidAlive(pgid) ? [pgid] : [];
  }
}

/** Signal only this child's process group (detached spawn). Never port-scan or pkill. */
export function signalOwnedProcessGroup(pid: number, signal: NodeJS.Signals): void {
  if (!isOwnedPgid(pid)) return;
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      /* already gone */
    }
  }
}

export async function waitForPidExit(pid: number, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!isPidAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return !isPidAlive(pid);
}

export async function waitForOwnedGroupExit(pgid: number, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (listOwnedGroupPids(pgid).length === 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return listOwnedGroupPids(pgid).length === 0;
}

export function spawnOwnedDetachedChild(
  command: string,
  args: readonly string[],
  options: Omit<SpawnOptions, "detached">
): ChildProcess {
  return spawn(command, args, { ...options, detached: true });
}

export async function stopOwnedChildProcess(
  child: ChildProcess | null,
  opts?: { waitMs?: number }
): Promise<{ pid: number | null; exited: boolean; usedKill: boolean }> {
  const pid = child?.pid ?? null;
  if (pid == null) {
    return { pid: null, exited: true, usedKill: false };
  }
  if (listOwnedGroupPids(pid).length === 0) {
    return { pid, exited: true, usedKill: false };
  }
  const waitMs = opts?.waitMs ?? OWNED_CHILD_TERM_WAIT_MS;
  signalOwnedProcessGroup(pid, "SIGTERM");
  const termExited = await waitForOwnedGroupExit(pid, waitMs);
  if (termExited) return { pid, exited: true, usedKill: false };
  signalOwnedProcessGroup(pid, "SIGKILL");
  const killExited = await waitForOwnedGroupExit(pid, 2_000);
  return { pid, exited: killExited, usedKill: true };
}

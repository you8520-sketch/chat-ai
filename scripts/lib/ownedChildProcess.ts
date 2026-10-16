import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

export const OWNED_CHILD_TERM_WAIT_MS = 8_000;

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Signal only this child's process group (detached spawn). Never port-scan or pkill. */
export function signalOwnedProcessGroup(pid: number, signal: NodeJS.Signals): void {
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
  if (pid == null || !isPidAlive(pid)) {
    return { pid, exited: true, usedKill: false };
  }
  const waitMs = opts?.waitMs ?? OWNED_CHILD_TERM_WAIT_MS;
  signalOwnedProcessGroup(pid, "SIGTERM");
  const termExited = await waitForPidExit(pid, waitMs);
  if (termExited) return { pid, exited: true, usedKill: false };
  signalOwnedProcessGroup(pid, "SIGKILL");
  const killExited = await waitForPidExit(pid, 2_000);
  return { pid, exited: killExited, usedKill: true };
}

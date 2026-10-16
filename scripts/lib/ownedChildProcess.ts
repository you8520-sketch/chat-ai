import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

export const OWNED_CHILD_TERM_WAIT_MS = 8_000;

export type OwnedGroupPresenceProbe = (pgid: number) => void;

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

function errorCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

function probeOwnedGroupPresence(pgid: number): void {
  process.kill(-pgid, 0);
}

/**
 * Whether the detached child's process group still exists.
 * ESRCH is the only signal that the group is gone. Permission or query
 * errors must not be treated as a clean exit.
 */
export function isOwnedGroupAlive(
  pgid: number,
  probe: OwnedGroupPresenceProbe = probeOwnedGroupPresence
): boolean {
  if (!isOwnedPgid(pgid)) return false;
  try {
    probe(pgid);
    return true;
  } catch (err) {
    return errorCode(err) !== "ESRCH";
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

export async function waitForOwnedGroupExit(
  pgid: number,
  timeoutMs: number,
  probe?: OwnedGroupPresenceProbe
): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!isOwnedGroupAlive(pgid, probe)) return true;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return !isOwnedGroupAlive(pgid, probe);
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
  opts?: { waitMs?: number; probeGroup?: OwnedGroupPresenceProbe }
): Promise<{ pid: number | null; exited: boolean; usedKill: boolean }> {
  const pid = child?.pid ?? null;
  if (pid == null) {
    return { pid: null, exited: true, usedKill: false };
  }
  const probe = opts?.probeGroup;
  if (!isOwnedGroupAlive(pid, probe)) {
    return { pid, exited: true, usedKill: false };
  }
  const waitMs = opts?.waitMs ?? OWNED_CHILD_TERM_WAIT_MS;
  signalOwnedProcessGroup(pid, "SIGTERM");
  const termExited = await waitForOwnedGroupExit(pid, waitMs, probe);
  if (termExited) return { pid, exited: true, usedKill: false };
  signalOwnedProcessGroup(pid, "SIGKILL");
  const killExited = await waitForOwnedGroupExit(pid, 2_000, probe);
  return { pid, exited: killExited, usedKill: true };
}

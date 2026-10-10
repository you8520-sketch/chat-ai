import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import {
  TRPG_1462_MIN_PAID_REQUEST_IDS,
  TRPG_1462_NEW_BENCHMARK_ID,
  TRPG_1462_NEW_BENCHMARK_REQUEST_IDS,
  type Trpg1462NewBenchmarkRequestId,
} from "./trpg1462GeminiGmNewBenchmark";

/** Experiment-only. Do not reuse #1483 golden or #1477 12-call paths. */
export const TRPG_1462_PRECALL_PRIVATE_ROOT = "/data/private-trpg-1462-gm-precall";
export const TRPG_1462_PRECALL_JOURNAL_NAME = "attempt-journal.json";
export const TRPG_1462_FORBIDDEN_PRIVATE_PATHS = [
  "/data/private-golden-fixtures",
  "/data/rp-quality-12call",
] as const;

export const TRPG_1462_JOURNAL_STATUSES = [
  "planned",
  "reserved",
  "posted",
  "unknown",
  "timeout",
  "http_error",
] as const;

export type Trpg1462JournalStatus = (typeof TRPG_1462_JOURNAL_STATUSES)[number];

export const TRPG_1462_TRANSMISSION_STATES = [
  "not_sent",
  "attempted",
  "possiblySent",
  "confirmed",
] as const;

export type Trpg1462TransmissionState = (typeof TRPG_1462_TRANSMISSION_STATES)[number];

export type Trpg1462JournalCase = {
  requestBodySha256: string;
  status: Trpg1462JournalStatus;
  transmissionState: Trpg1462TransmissionState;
  httpStatus: number | null;
  postedAt: string | null;
  finishReason?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  narrationSha256?: string | null;
  deltaSha256?: string | null;
  resultFile?: string | null;
};

export type Trpg1462AttemptJournal = {
  experiment: typeof TRPG_1462_NEW_BENCHMARK_ID;
  oneShot: true;
  doNotCall: "callTrpgGm";
  bodyOwner: "buildTrpgGmProviderRequest";
  unknownOrTimeoutRetransmit: false;
  approval: "REQUIRED_BEFORE_POST";
  paidPosts: number;
  httpAttempts: number;
  productionDbWrites: number;
  minPaidRequestIds: typeof TRPG_1462_MIN_PAID_REQUEST_IDS;
  cases: Record<Trpg1462NewBenchmarkRequestId, Trpg1462JournalCase>;
};

const BLOCKED_STATUSES = new Set<Trpg1462JournalStatus>([
  "reserved",
  "posted",
  "unknown",
  "timeout",
  "http_error",
]);

export type Trpg1462DurableWriteHooks = {
  fsync?: (fd: number) => void;
};

export function trpg1462PrecallJournalPath(root: string = TRPG_1462_PRECALL_PRIVATE_ROOT): string {
  return join(root, TRPG_1462_PRECALL_JOURNAL_NAME);
}

export function trpg1462JournalLockPath(root: string = TRPG_1462_PRECALL_PRIVATE_ROOT): string {
  return `${trpg1462PrecallJournalPath(root)}.lock`;
}

export function createTrpg1462AttemptJournal(
  bodies: Record<Trpg1462NewBenchmarkRequestId, string>
): Trpg1462AttemptJournal {
  const cases = {} as Record<Trpg1462NewBenchmarkRequestId, Trpg1462JournalCase>;
  for (const id of TRPG_1462_NEW_BENCHMARK_REQUEST_IDS) {
    cases[id] = {
      requestBodySha256: bodies[id],
      status: "planned",
      transmissionState: "not_sent",
      httpStatus: null,
      postedAt: null,
    };
  }
  return {
    experiment: TRPG_1462_NEW_BENCHMARK_ID,
    oneShot: true,
    doNotCall: "callTrpgGm",
    bodyOwner: "buildTrpgGmProviderRequest",
    unknownOrTimeoutRetransmit: false,
    approval: "REQUIRED_BEFORE_POST",
    paidPosts: 0,
    httpAttempts: 0,
    productionDbWrites: 0,
    minPaidRequestIds: TRPG_1462_MIN_PAID_REQUEST_IDS,
    cases,
  };
}

export function canPostTrpg1462Attempt(
  journal: Trpg1462AttemptJournal,
  id: Trpg1462NewBenchmarkRequestId,
  requestBodySha256: string
): boolean {
  const row = journal.cases[id];
  return (
    row.status === "planned" &&
    row.transmissionState === "not_sent" &&
    row.requestBodySha256 === requestBodySha256
  );
}

export function reserveTrpg1462Attempt(
  journal: Trpg1462AttemptJournal,
  id: Trpg1462NewBenchmarkRequestId,
  requestBodySha256: string
): Trpg1462AttemptJournal {
  if (!canPostTrpg1462Attempt(journal, id, requestBodySha256)) {
    throw new Error(`TRPG 1462 one-shot blocked for ${id}`);
  }
  return {
    ...journal,
    cases: {
      ...journal.cases,
      [id]: { ...journal.cases[id], status: "reserved", transmissionState: "not_sent" },
    },
  };
}

export function markTrpg1462Attempted(
  journal: Trpg1462AttemptJournal,
  id: Trpg1462NewBenchmarkRequestId
): Trpg1462AttemptJournal {
  const row = journal.cases[id];
  if (row.status !== "reserved") {
    throw new Error(`TRPG 1462 attempted requires reserved ${id}, got ${row.status}`);
  }
  return {
    ...journal,
    cases: {
      ...journal.cases,
      [id]: { ...row, transmissionState: "attempted" },
    },
  };
}

export function markTrpg1462PossiblySent(
  journal: Trpg1462AttemptJournal,
  id: Trpg1462NewBenchmarkRequestId
): Trpg1462AttemptJournal {
  const row = journal.cases[id];
  if (row.status !== "reserved") {
    throw new Error(`TRPG 1462 possiblySent requires reserved ${id}, got ${row.status}`);
  }
  return {
    ...journal,
    httpAttempts: journal.httpAttempts + 1,
    cases: {
      ...journal.cases,
      [id]: { ...row, transmissionState: "possiblySent" },
    },
  };
}

export function settleTrpg1462Attempt(
  journal: Trpg1462AttemptJournal,
  id: Trpg1462NewBenchmarkRequestId,
  status: Exclude<Trpg1462JournalStatus, "planned" | "reserved">,
  httpStatus: number | null = null
): Trpg1462AttemptJournal {
  const row = journal.cases[id];
  if (row.status !== "reserved") {
    throw new Error(`TRPG 1462 settle requires reserved ${id}, got ${row.status}`);
  }
  const transmissionState: Trpg1462TransmissionState =
    status === "posted" ? "confirmed" : status === "http_error" ? "attempted" : "possiblySent";
  return {
    ...journal,
    paidPosts: status === "posted" ? journal.paidPosts + 1 : journal.paidPosts,
    httpAttempts: journal.httpAttempts + 1,
    cases: {
      ...journal.cases,
      [id]: {
        ...row,
        status,
        transmissionState,
        httpStatus,
        postedAt: status === "posted" ? new Date().toISOString() : row.postedAt,
      },
    },
  };
}

export function loadTrpg1462AttemptJournal(path: string): Trpg1462AttemptJournal {
  return JSON.parse(readFileSync(path, "utf8")) as Trpg1462AttemptJournal;
}

export function writePrivateAtomicJson(
  path: string,
  value: unknown,
  hooks: Trpg1462DurableWriteHooks = {}
): void {
  assertNotForbiddenPrivatePath(path);
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    /* best-effort */
  }
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  const sync = hooks.fsync ?? fsyncSync;
  const fileFd = openSync(tmp, "r+");
  try {
    sync(fileFd);
  } finally {
    closeSync(fileFd);
  }
  renameSync(tmp, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    /* best-effort */
  }
  const dirFd = openSync(dir, "r");
  try {
    sync(dirFd);
  } finally {
    closeSync(dirFd);
  }
}

export function writeTrpg1462AttemptJournal(
  path: string,
  journal: Trpg1462AttemptJournal,
  hooks: Trpg1462DurableWriteHooks = {}
): void {
  writePrivateAtomicJson(path, journal, hooks);
}

export function tryAcquireTrpg1462JournalLock(
  root: string,
  hooks: { afterExclusiveCreate?: () => void } = {}
): { ok: true; token: string; release: () => void } | { ok: false; reason: "CONCURRENT_RESERVE" | "LOCK_UNAVAILABLE" } {
  assertNotForbiddenPrivatePath(root);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const lockPath = trpg1462JournalLockPath(root);
  if (existsSync(lockPath)) {
    return { ok: false, reason: "CONCURRENT_RESERVE" };
  }
  const token = `1462lock:${process.pid}:${randomBytes(8).toString("hex")}`;
  try {
    const fd = openSync(lockPath, "wx");
    try {
      hooks.afterExclusiveCreate?.();
      writeFileSync(fd, `${token}\n`);
    } finally {
      closeSync(fd);
    }
    try {
      chmodSync(lockPath, 0o600);
    } catch {
      /* best-effort */
    }
    return {
      ok: true,
      token,
      release() {
        releaseTrpg1462JournalLock(root, token);
      },
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") return { ok: false, reason: "CONCURRENT_RESERVE" };
    return { ok: false, reason: "LOCK_UNAVAILABLE" };
  }
}

export function releaseTrpg1462JournalLock(root: string, token: string): boolean {
  const lockPath = trpg1462JournalLockPath(root);
  if (!existsSync(lockPath)) return false;
  const current = readFileSync(lockPath, "utf8").trim();
  if (current !== token) return false;
  unlinkSync(lockPath);
  return true;
}

export function consumedTrpg1462Attempts(journal: Trpg1462AttemptJournal): number {
  let n = 0;
  for (const id of TRPG_1462_NEW_BENCHMARK_REQUEST_IDS) {
    if (BLOCKED_STATUSES.has(journal.cases[id].status)) n += 1;
  }
  return n;
}

export function trpg1462ResultPath(root: string, id: Trpg1462NewBenchmarkRequestId): string {
  return join(root, "results", `${id}.json`);
}

export function assertNotForbiddenPrivatePath(path: string): void {
  for (const forbidden of TRPG_1462_FORBIDDEN_PRIVATE_PATHS) {
    if (path === forbidden || path.startsWith(`${forbidden}/`)) {
      throw new Error(`refuses #1477/#1483 private path ${path}`);
    }
  }
}

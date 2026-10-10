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

export type Trpg1462JournalCase = {
  requestBodySha256: string;
  status: Trpg1462JournalStatus;
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

export function trpg1462PrecallJournalPath(root: string = TRPG_1462_PRECALL_PRIVATE_ROOT): string {
  return join(root, TRPG_1462_PRECALL_JOURNAL_NAME);
}

export function createTrpg1462AttemptJournal(
  bodies: Record<Trpg1462NewBenchmarkRequestId, string>
): Trpg1462AttemptJournal {
  const cases = {} as Record<Trpg1462NewBenchmarkRequestId, Trpg1462JournalCase>;
  for (const id of TRPG_1462_NEW_BENCHMARK_REQUEST_IDS) {
    cases[id] = {
      requestBodySha256: bodies[id],
      status: "planned",
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
  return row.status === "planned" && row.requestBodySha256 === requestBodySha256;
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
      [id]: { ...journal.cases[id], status: "reserved" },
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
  return {
    ...journal,
    paidPosts: status === "posted" ? journal.paidPosts + 1 : journal.paidPosts,
    cases: {
      ...journal.cases,
      [id]: {
        ...row,
        status,
        httpStatus,
        postedAt: status === "posted" ? new Date().toISOString() : row.postedAt,
      },
    },
  };
}

export function loadTrpg1462AttemptJournal(path: string): Trpg1462AttemptJournal {
  return JSON.parse(readFileSync(path, "utf8")) as Trpg1462AttemptJournal;
}

export function writeTrpg1462AttemptJournal(path: string, journal: Trpg1462AttemptJournal): void {
  assertNotForbiddenPrivatePath(path);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(journal, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  const fd = openSync(tmp, "r+");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
  try {
    chmodSync(path, 0o600);
    chmodSync(dirname(path), 0o700);
  } catch {
    /* best-effort private mode */
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function tryAcquireTrpg1462JournalLock(
  root: string
): { ok: true; release: () => void } | { ok: false; reason: "CONCURRENT_RESERVE" | "LOCK_UNAVAILABLE" } {
  assertNotForbiddenPrivatePath(root);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const lockPath = `${trpg1462PrecallJournalPath(root)}.lock`;
  if (existsSync(lockPath)) {
    const pid = Number(readFileSync(lockPath, "utf8").trim());
    if (Number.isInteger(pid) && pid > 0 && isProcessAlive(pid)) {
      return { ok: false, reason: "CONCURRENT_RESERVE" };
    }
    try {
      unlinkSync(lockPath);
    } catch {
      return { ok: false, reason: "CONCURRENT_RESERVE" };
    }
  }
  try {
    const fd = openSync(lockPath, "wx");
    try {
      writeFileSync(fd, `${process.pid}\n`);
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
      release() {
        try {
          unlinkSync(lockPath);
        } catch {
          /* already released */
        }
      },
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") return { ok: false, reason: "CONCURRENT_RESERVE" };
    return { ok: false, reason: "LOCK_UNAVAILABLE" };
  }
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

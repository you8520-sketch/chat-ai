import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL } from "@/lib/cheaperInferenceConfig";
import { GM_MAX_PROVIDER_ATTEMPTS } from "./gmCall";
import { TRPG_GM_MODEL } from "./types";
import {
  createTrpg1462MockLiveApproval,
  createTrpg1462TestApproval,
  executeTrpg1462OneShot,
  loadTrpg1462OneShotResult,
  TRPG_1462_APPROVED_MODEL,
  TRPG_1462_LIVE_APPROVAL_KIND,
  TRPG_1462_MAX_PAID_CALLS,
  TRPG_1462_MOCK_LIVE_GRANTED_BY,
  TRPG_1462_TEST_API_KEY,
  TRPG_1462_TEST_APPROVAL_KIND,
  verifyTrpg1462SealedFingerprints,
  type Trpg1462OneShotFetch,
  type Trpg1462OneShotResult,
} from "./trpg1462GeminiGmOneShot";
import { createTrpg1462MockFetch } from "./trpg1462GeminiGmOneShotMock";
import { TRPG_1462_PINNED_REQUEST_HASHES } from "./trpg1462GeminiGmNewBenchmark";
import {
  loadTrpg1462AttemptJournal,
  releaseTrpg1462JournalLock,
  trpg1462JournalLockPath,
  trpg1462PrecallJournalPath,
  trpg1462ResultPath,
  tryAcquireTrpg1462JournalLock,
  writeTrpg1462AttemptJournal,
} from "./trpg1462GeminiGmPrecallJournal";

const CHILD = fileURLToPath(new URL("./trpg1462GeminiGmOneShot.child.ts", import.meta.url));

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "trpg1462-oneshot-"));
}

function runOneShot(
  opts: Parameters<typeof executeTrpg1462OneShot>[0]
): Promise<Trpg1462OneShotResult> {
  return executeTrpg1462OneShot({
    approval: createTrpg1462TestApproval(),
    apiKey: TRPG_1462_TEST_API_KEY,
    ...opts,
  });
}

function countingUntaggedFetch(): { fetchImpl: Trpg1462OneShotFetch; count: { n: number } } {
  const count = { n: 0 };
  const fetchImpl: Trpg1462OneShotFetch = async () => {
    count.n += 1;
    return new Response("untagged-local", { status: 500 });
  };
  return { fetchImpl, count };
}

function spawnChild(env: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--no-warnings", "--conditions=react-server", "--import", "tsx", CHILD],
      {
        cwd: process.cwd(),
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0 && code !== 75) {
        reject(new Error(`child ${code}: ${stderr || stdout}`));
        return;
      }
      resolve({ code, stdout });
    });
  });
}

/**
 * Pre-fix lock algorithm: wx creates an empty file, then PID is written.
 * An empty file parses as PID 0 and is treated as stale, so a waiter unlinks it.
 */
function legacyEmptyLockIsStaleAndUnlinked(lockPath: string): boolean {
  const raw = readFileSync(lockPath, "utf8").trim();
  const pid = Number(raw);
  let alive = false;
  try {
    if (pid > 0) {
      process.kill(pid, 0);
      alive = true;
    }
  } catch {
    alive = false;
  }
  if (!alive) {
    unlinkSync(lockPath);
    return true;
  }
  return false;
}

describe("TRPG #1462 Gemini GM one-shot execution gate", () => {
  it("keeps sealed PRECALL fingerprints and production GM contract", () => {
    const assembled = verifyTrpg1462SealedFingerprints();
    assert.equal(TRPG_1462_APPROVED_MODEL, "gemini-3.8-flash");
    assert.equal(TRPG_GM_MODEL, "gemini-3.8-flash");
    assert.equal(GM_MAX_PROVIDER_ATTEMPTS, 2);
    assert.equal(TRPG_1462_MAX_PAID_CALLS, 6);
    assert.equal(assembled.requests.A.requestBodySha256, TRPG_1462_PINNED_REQUEST_HASHES.A.requestBodySha256);
    assert.equal(assembled.requests.B.userSha256, assembled.requests.A.userSha256);
  });

  it("A. posts exactly once on a healthy mock stream and persists narration", async () => {
    const root = tempRoot();
    const mock = createTrpg1462MockFetch({ mode: "success", narration: "달은 하늘에 남았다." });
    const result = await runOneShot({ requestId: "A", root, fetchImpl: mock.fetchImpl });
    assert.equal(result.ok, true);
    assert.equal(result.posts, 1);
    assert.equal(result.status, "posted");
    assert.equal(result.finishReason, "stop");
    assert.equal(result.narration, "달은 하늘에 남았다.");
    assert.equal(result.inputTokens, 12);
    assert.equal(result.outputTokens, 8);
    assert.equal(mock.log.count, 1);
    assert.equal(mock.log.urls[0], CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL);
    assert.equal(mock.log.authorizationPresent[0], true);
    assert.equal(mock.log.authorizationScheme[0], "Bearer");
    assert.equal(JSON.stringify(mock.log).includes(TRPG_1462_TEST_API_KEY), false);
    const journal = loadTrpg1462AttemptJournal(trpg1462PrecallJournalPath(root));
    assert.equal(journal.cases.A.status, "posted");
    assert.equal(journal.cases.A.transmissionState, "confirmed");
    assert.equal(journal.paidPosts, 1);
    assert.equal(journal.httpAttempts, 1);
    assert.equal(journal.productionDbWrites, 0);
    const stored = loadTrpg1462OneShotResult(root, "A");
    assert.equal(stored.narration, "달은 하늘에 남았다.");
    assert.ok(stored.delta);
  });

  it("B. blocks the same id on a second execute", async () => {
    const root = tempRoot();
    const first = createTrpg1462MockFetch({ mode: "success" });
    await runOneShot({ requestId: "B", root, fetchImpl: first.fetchImpl });
    const second = createTrpg1462MockFetch({ mode: "success" });
    const replay = await runOneShot({ requestId: "B", root, fetchImpl: second.fetchImpl });
    assert.equal(replay.blocked, true);
    assert.equal(replay.posts, 0);
    assert.equal(second.log.count, 0);
    assert.match(replay.reason ?? "", /ONE_SHOT_BLOCKED/);
    assert.equal(loadTrpg1462AttemptJournal(trpg1462PrecallJournalPath(root)).cases.B.status, "posted");
  });

  it("C. two processes racing reserve produce one POST", async () => {
    const root = tempRoot();
    const [left, right] = await Promise.all([
      spawnChild({ TRPG_1462_ONESHOT_ROOT: root, TRPG_1462_ONESHOT_ID: "C_1480", TRPG_1462_ONESHOT_FETCH: "success" }),
      spawnChild({ TRPG_1462_ONESHOT_ROOT: root, TRPG_1462_ONESHOT_ID: "C_1480", TRPG_1462_ONESHOT_FETCH: "success" }),
    ]);
    const rows = [left, right].map((row) => JSON.parse(row.stdout) as { posts?: number; mockPosts?: number; blocked?: boolean });
    const posts = rows.reduce((sum, row) => sum + (row.mockPosts ?? row.posts ?? 0), 0);
    assert.equal(posts, 1);
    assert.equal(rows.filter((row) => row.blocked).length, 1);
    assert.equal(loadTrpg1462AttemptJournal(trpg1462PrecallJournalPath(root)).cases.C_1480.status, "posted");
  });

  it("D. crash after reserve does not POST again after restart", async () => {
    const root = tempRoot();
    const crashed = await spawnChild({
      TRPG_1462_ONESHOT_ROOT: root,
      TRPG_1462_ONESHOT_ID: "D_1480",
      TRPG_1462_ONESHOT_FETCH: "success",
      TRPG_1462_ONESHOT_CRASH_AFTER_RESERVE: "1",
    });
    assert.equal(crashed.code, 75);
    assert.equal((JSON.parse(crashed.stdout) as { posts: number }).posts, 0);
    const reserved = loadTrpg1462AttemptJournal(trpg1462PrecallJournalPath(root));
    assert.equal(reserved.cases.D_1480.status, "reserved");
    assert.equal(reserved.cases.D_1480.transmissionState, "attempted");
    const mock = createTrpg1462MockFetch({ mode: "success" });
    const restart = await runOneShot({ requestId: "D_1480", root, fetchImpl: mock.fetchImpl });
    assert.equal(restart.blocked, true);
    assert.equal(restart.posts, 0);
    assert.equal(mock.log.count, 0);
    assert.equal(loadTrpg1462AttemptJournal(trpg1462PrecallJournalPath(root)).cases.D_1480.status, "reserved");
  });

  it("E. HTTP 500/502/503/504 settle as http_error with no retry", async () => {
    for (const status of [500, 502, 503, 504]) {
      const root = tempRoot();
      const mock = createTrpg1462MockFetch({ mode: "http", status });
      const result = await runOneShot({ requestId: "A", root, fetchImpl: mock.fetchImpl });
      assert.equal(result.posts, 1);
      assert.equal(mock.log.count, 1);
      assert.equal(result.status, "http_error");
      assert.equal(result.httpStatus, status);
      const journal = loadTrpg1462AttemptJournal(trpg1462PrecallJournalPath(root));
      assert.equal(journal.cases.A.status, "http_error");
      assert.equal(journal.cases.A.transmissionState, "attempted");
      const replay = createTrpg1462MockFetch({ mode: "success" });
      const blocked = await runOneShot({ requestId: "A", root, fetchImpl: replay.fetchImpl });
      assert.equal(blocked.posts, 0);
      assert.equal(replay.log.count, 0);
    }
  });

  it("F. timeout and UNKNOWN settle once and never retransmit", async () => {
    const timeoutRoot = tempRoot();
    const hang = createTrpg1462MockFetch({ mode: "hang" });
    const timeout = await runOneShot({
      requestId: "A",
      root: timeoutRoot,
      fetchImpl: hang.fetchImpl,
      timeoutMs: 30,
    });
    assert.equal(timeout.posts, 1);
    assert.equal(timeout.status, "timeout");
    const timeoutJournal = loadTrpg1462AttemptJournal(trpg1462PrecallJournalPath(timeoutRoot));
    assert.equal(timeoutJournal.cases.A.status, "timeout");
    assert.equal(timeoutJournal.cases.A.transmissionState, "possiblySent");

    const unknownRoot = tempRoot();
    const empty = createTrpg1462MockFetch({ mode: "unknown" });
    const unknown = await runOneShot({ requestId: "B", root: unknownRoot, fetchImpl: empty.fetchImpl });
    assert.equal(unknown.posts, 1);
    assert.equal(unknown.status, "unknown");
    const unknownJournal = loadTrpg1462AttemptJournal(trpg1462PrecallJournalPath(unknownRoot));
    assert.equal(unknownJournal.cases.B.status, "unknown");
    assert.equal(unknownJournal.cases.B.transmissionState, "possiblySent");
  });

  it("G. journal write failure before POST keeps planned and sends 0", async () => {
    const root = tempRoot();
    const mock = createTrpg1462MockFetch({ mode: "success" });
    const result = await runOneShot({
      requestId: "A",
      root,
      fetchImpl: mock.fetchImpl,
      persist() {
        throw new Error("ENOSPC");
      },
    });
    assert.equal(result.blocked, true);
    assert.equal(result.reason, "JOURNAL_WRITE_FAILED");
    assert.equal(result.posts, 0);
    assert.equal(mock.log.count, 0);
    assert.equal(loadTrpg1462AttemptJournal(trpg1462PrecallJournalPath(root)).cases.A.status, "planned");
    assert.equal(loadTrpg1462AttemptJournal(trpg1462PrecallJournalPath(root)).cases.A.transmissionState, "not_sent");
  });

  it("H. rejects an unapproved case id", async () => {
    const root = tempRoot();
    const mock = createTrpg1462MockFetch({ mode: "success" });
    const result = await runOneShot({ requestId: "OPENING", root, fetchImpl: mock.fetchImpl });
    assert.equal(result.blocked, true);
    assert.equal(result.reason, "UNAPPROVED_CASE_ID");
    assert.equal(result.posts, 0);
    assert.equal(mock.log.count, 0);
  });

  it("I. rejects a changed request-body SHA", async () => {
    const root = tempRoot();
    const seed = createTrpg1462MockFetch({ mode: "success" });
    await runOneShot({
      requestId: "A",
      root,
      fetchImpl: seed.fetchImpl,
      persist(path, journal) {
        writeTrpg1462AttemptJournal(path, journal);
      },
    });
    const journal = loadTrpg1462AttemptJournal(trpg1462PrecallJournalPath(root));
    journal.cases.B.requestBodySha256 = "0".repeat(64);
    journal.cases.B.status = "planned";
    writeTrpg1462AttemptJournal(trpg1462PrecallJournalPath(root), journal);
    const replay = createTrpg1462MockFetch({ mode: "success" });
    const result = await runOneShot({ requestId: "B", root, fetchImpl: replay.fetchImpl });
    assert.equal(result.blocked, true);
    assert.equal(result.reason, "REQUEST_BODY_SHA_MISMATCH");
    assert.equal(result.posts, 0);
    assert.equal(replay.log.count, 0);
    assert.equal(loadTrpg1462AttemptJournal(trpg1462PrecallJournalPath(root)).cases.B.status, "planned");
  });

  it("J. reloads persisted request/response after a new process start", async () => {
    const root = tempRoot();
    const first = await spawnChild({
      TRPG_1462_ONESHOT_ROOT: root,
      TRPG_1462_ONESHOT_ID: "D_1465",
      TRPG_1462_ONESHOT_FETCH: "success",
    });
    const posted = JSON.parse(first.stdout) as { status: string; narration: string };
    assert.equal(posted.status, "posted");
    const journal = loadTrpg1462AttemptJournal(trpg1462PrecallJournalPath(root));
    assert.equal(journal.cases.D_1465.status, "posted");
    assert.equal(journal.cases.D_1465.transmissionState, "confirmed");
    const stored = loadTrpg1462OneShotResult(root, "D_1465");
    assert.equal(stored.narration, posted.narration);
    assert.equal(existsSync(String(journal.cases.D_1465.resultFile)), true);
    chmodSync(root, 0o700);
    chmodSync(trpg1462PrecallJournalPath(root), 0o600);
    assert.equal((readFileSync(trpg1462PrecallJournalPath(root), "utf8").includes("callTrpgGm")), true);
  });

  it("proves the pre-fix empty-lock unlink race allows a waiter to steal ownership", () => {
    const root = tempRoot();
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const lockPath = trpg1462JournalLockPath(root);
    const fdA = openSync(lockPath, "wx");
    const stolen = legacyEmptyLockIsStaleAndUnlinked(lockPath);
    assert.equal(stolen, true);
    assert.equal(existsSync(lockPath), false);
    const fdB = openSync(lockPath, "wx");
    writeFileSync(fdB, `${process.pid}\n`);
    closeSync(fdB);
    writeFileSync(fdA, "owner-a-orphan-inode\n");
    closeSync(fdA);
    assert.equal(existsSync(lockPath), true);
    assert.match(readFileSync(lockPath, "utf8"), new RegExp(String(process.pid)));
  });

  it("does not auto-delete an existing lock during the wx/PID interleaving", () => {
    const root = tempRoot();
    mkdirSync(root, { recursive: true, mode: 0o700 });
    let waiter: ReturnType<typeof tryAcquireTrpg1462JournalLock> | undefined;
    const owner = tryAcquireTrpg1462JournalLock(root, {
      afterExclusiveCreate() {
        waiter = tryAcquireTrpg1462JournalLock(root);
      },
    });
    assert.equal(owner.ok, true);
    assert.equal(waiter?.ok, false);
    if (waiter && !waiter.ok) {
      assert.equal(waiter.reason, "CONCURRENT_RESERVE");
    }
    const lockPath = trpg1462JournalLockPath(root);
    assert.equal(existsSync(lockPath), true);
    assert.equal(releaseTrpg1462JournalLock(root, "not-the-owner"), false);
    assert.equal(existsSync(lockPath), true);
    if (owner.ok) owner.release();
    assert.equal(existsSync(lockPath), false);
  });

  it("refuses to auto-delete a pre-existing lock including a dead PID", () => {
    const root = tempRoot();
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const lockPath = trpg1462JournalLockPath(root);
    writeFileSync(lockPath, "1\n", { encoding: "utf8", mode: 0o600 });
    const acquired = tryAcquireTrpg1462JournalLock(root);
    assert.equal(acquired.ok, false);
    if (!acquired.ok) {
      assert.equal(acquired.reason, "CONCURRENT_RESERVE");
    }
    assert.equal(existsSync(lockPath), true);
    assert.equal(readFileSync(lockPath, "utf8"), "1\n");
  });

  it("denies missing or mismatched paid approval before reserve", async () => {
    const missingRoot = tempRoot();
    const missingMock = createTrpg1462MockFetch({ mode: "success" });
    const missing = await executeTrpg1462OneShot({
      requestId: "A",
      root: missingRoot,
      fetchImpl: missingMock.fetchImpl,
      approval: null,
      apiKey: TRPG_1462_TEST_API_KEY,
    });
    assert.equal(missing.blocked, true);
    assert.equal(missing.reason, "APPROVAL_DENIED");
    assert.equal(missing.posts, 0);
    assert.equal(missingMock.log.count, 0);
    assert.equal(existsSync(trpg1462PrecallJournalPath(missingRoot)), false);

    const mismatchRoot = tempRoot();
    const mismatchMock = createTrpg1462MockFetch({ mode: "success" });
    const mismatch = await runOneShot({
      requestId: "A",
      root: mismatchRoot,
      fetchImpl: mismatchMock.fetchImpl,
      approval: createTrpg1462TestApproval({
        requestBodySha256: {
          ...createTrpg1462TestApproval().requestBodySha256,
          A: "0".repeat(64),
        },
      }),
    });
    assert.equal(mismatch.blocked, true);
    assert.equal(mismatch.reason, "APPROVAL_MISMATCH");
    assert.equal(mismatch.posts, 0);
    assert.equal(mismatchMock.log.count, 0);
  });

  it("fails closed on AUTH_MISSING before reserve", async () => {
    const root = tempRoot();
    const mock = createTrpg1462MockFetch({ mode: "success" });
    const result = await executeTrpg1462OneShot({
      requestId: "A",
      root,
      fetchImpl: mock.fetchImpl,
      approval: createTrpg1462TestApproval(),
      apiKey: "",
    });
    assert.equal(result.blocked, true);
    assert.equal(result.reason, "AUTH_MISSING");
    assert.equal(result.posts, 0);
    assert.equal(mock.log.count, 0);
    assert.equal(existsSync(trpg1462PrecallJournalPath(root)), false);
  });

  it("blocks HTTP when reserved-file fsync fails", async () => {
    const root = tempRoot();
    const mock = createTrpg1462MockFetch({ mode: "success" });
    const result = await runOneShot({
      requestId: "A",
      root,
      fetchImpl: mock.fetchImpl,
      durableHooks: {
        fsync() {
          throw new Error("EIO");
        },
      },
    });
    assert.equal(result.blocked, true);
    assert.equal(result.reason, "JOURNAL_WRITE_FAILED");
    assert.equal(result.posts, 0);
    assert.equal(mock.log.count, 0);
    assert.equal(loadTrpg1462AttemptJournal(trpg1462PrecallJournalPath(root)).cases.A.status, "planned");
  });

  it("marks possiblySent and never retransmits when result write fails after POST", async () => {
    const root = tempRoot();
    const mock = createTrpg1462MockFetch({ mode: "success" });
    const result = await runOneShot({
      requestId: "A",
      root,
      fetchImpl: mock.fetchImpl,
      resultWriteHooks: {
        fsync() {
          throw new Error("EIO");
        },
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "RESULT_WRITE_FAILED");
    assert.equal(result.posts, 1);
    assert.equal(mock.log.count, 1);
    assert.equal(existsSync(trpg1462ResultPath(root, "A")), false);
    const journal = loadTrpg1462AttemptJournal(trpg1462PrecallJournalPath(root));
    assert.equal(journal.cases.A.status, "reserved");
    assert.equal(journal.cases.A.transmissionState, "possiblySent");
    const replay = createTrpg1462MockFetch({ mode: "success" });
    const blocked = await runOneShot({ requestId: "A", root, fetchImpl: replay.fetchImpl });
    assert.equal(blocked.posts, 0);
    assert.equal(replay.log.count, 0);
  });

  it("forbids TEST_ONLY from a live-network fetch before reserve", async () => {
    const untaggedRoot = tempRoot();
    const untagged: Trpg1462OneShotFetch = async () => new Response("blocked", { status: 500 });
    const inferred = await executeTrpg1462OneShot({
      requestId: "A",
      root: untaggedRoot,
      fetchImpl: untagged,
      approval: createTrpg1462TestApproval(),
      apiKey: TRPG_1462_TEST_API_KEY,
    });
    assert.equal(inferred.blocked, true);
    assert.equal(inferred.reason, "TEST_ONLY_NETWORK_FORBIDDEN");
    assert.equal(inferred.posts, 0);
    assert.equal(existsSync(trpg1462PrecallJournalPath(untaggedRoot)), false);

    const liveRoot = tempRoot();
    const mock = createTrpg1462MockFetch({ mode: "success" });
    const forced = await executeTrpg1462OneShot({
      requestId: "A",
      root: liveRoot,
      fetchImpl: mock.fetchImpl,
      approval: createTrpg1462TestApproval(),
      apiKey: TRPG_1462_TEST_API_KEY,
      transport: "live",
    });
    assert.equal(forced.blocked, true);
    assert.equal(forced.reason, "TEST_ONLY_NETWORK_FORBIDDEN");
    assert.equal(forced.posts, 0);
    assert.equal(mock.log.count, 0);
  });

  it("does not treat a mock LIVE record as a user-granted live network approval", async () => {
    const root = tempRoot();
    const mock = createTrpg1462MockFetch({ mode: "success" });
    const result = await executeTrpg1462OneShot({
      requestId: "A",
      root,
      fetchImpl: mock.fetchImpl,
      approval: createTrpg1462MockLiveApproval(),
      apiKey: TRPG_1462_TEST_API_KEY,
      transport: "live",
    });
    assert.equal(result.blocked, true);
    assert.equal(result.reason, "LIVE_APPROVAL_NOT_GRANTED");
    assert.equal(result.posts, 0);
    assert.equal(mock.log.count, 0);
    assert.equal(existsSync(trpg1462PrecallJournalPath(root)), false);
  });

  it("denies a LIVE record with zero approved case IDs", async () => {
    const root = tempRoot();
    const mock = createTrpg1462MockFetch({ mode: "success" });
    const result = await runOneShot({
      requestId: "A",
      root,
      fetchImpl: mock.fetchImpl,
      approval: createTrpg1462MockLiveApproval({ approvedCaseIds: [] }),
    });
    assert.equal(result.blocked, true);
    assert.equal(result.reason, "APPROVAL_MISMATCH");
    assert.equal(result.posts, 0);
    assert.equal(mock.log.count, 0);
  });

  it("allows only the LIVE-approved subset of cases", async () => {
    const root = tempRoot();
    const allowed = createTrpg1462MockFetch({ mode: "success" });
    const posted = await runOneShot({
      requestId: "A",
      root,
      fetchImpl: allowed.fetchImpl,
      approval: createTrpg1462MockLiveApproval({ approvedCaseIds: ["A"] }),
    });
    assert.equal(posted.ok, true);
    assert.equal(posted.posts, 1);
    assert.equal(createTrpg1462MockLiveApproval().kind, TRPG_1462_LIVE_APPROVAL_KIND);
    assert.notEqual(TRPG_1462_LIVE_APPROVAL_KIND, TRPG_1462_TEST_APPROVAL_KIND);
    assert.equal(createTrpg1462MockLiveApproval().grantedBy, TRPG_1462_MOCK_LIVE_GRANTED_BY);

    const denied = createTrpg1462MockFetch({ mode: "success" });
    const blocked = await runOneShot({
      requestId: "B",
      root,
      fetchImpl: denied.fetchImpl,
      approval: createTrpg1462MockLiveApproval({ approvedCaseIds: ["A"] }),
    });
    assert.equal(blocked.blocked, true);
    assert.equal(blocked.reason, "APPROVAL_MISMATCH");
    assert.equal(blocked.posts, 0);
    assert.equal(denied.log.count, 0);
    assert.equal(loadTrpg1462AttemptJournal(trpg1462PrecallJournalPath(root)).cases.B.status, "planned");
  });

  it("allows a full mock LIVE approval for every sealed case", async () => {
    const root = tempRoot();
    const first = createTrpg1462MockFetch({ mode: "success" });
    const a = await runOneShot({
      requestId: "A",
      root,
      fetchImpl: first.fetchImpl,
      approval: createTrpg1462MockLiveApproval(),
    });
    const second = createTrpg1462MockFetch({ mode: "success" });
    const b = await runOneShot({
      requestId: "B",
      root,
      fetchImpl: second.fetchImpl,
      approval: createTrpg1462MockLiveApproval(),
    });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.equal(first.log.count + second.log.count, 2);
    const journal = loadTrpg1462AttemptJournal(trpg1462PrecallJournalPath(root));
    assert.equal(journal.paidPosts, 2);
    assert.equal(journal.cases.A.status, "posted");
    assert.equal(journal.cases.B.status, "posted");
  });

  it("blocks a later case when LIVE maxCalls is already consumed", async () => {
    const root = tempRoot();
    const approval = createTrpg1462MockLiveApproval({ maxCalls: 1 });
    const first = createTrpg1462MockFetch({ mode: "success" });
    const posted = await runOneShot({
      requestId: "A",
      root,
      fetchImpl: first.fetchImpl,
      approval,
    });
    assert.equal(posted.ok, true);
    const second = createTrpg1462MockFetch({ mode: "success" });
    const blocked = await runOneShot({
      requestId: "B",
      root,
      fetchImpl: second.fetchImpl,
      approval,
    });
    assert.equal(blocked.blocked, true);
    assert.equal(blocked.reason, "APPROVAL_MAX_CALLS");
    assert.equal(blocked.posts, 0);
    assert.equal(second.log.count, 0);
    const journal = loadTrpg1462AttemptJournal(trpg1462PrecallJournalPath(root));
    assert.equal(journal.paidPosts, 1);
    assert.equal(journal.cases.B.status, "planned");
  });

  it("rejects a LIVE request-body SHA mismatch", async () => {
    const root = tempRoot();
    const mock = createTrpg1462MockFetch({ mode: "success" });
    const approval = createTrpg1462MockLiveApproval();
    approval.requestBodySha256.A = "0".repeat(64);
    const result = await runOneShot({
      requestId: "A",
      root,
      fetchImpl: mock.fetchImpl,
      approval,
    });
    assert.equal(result.blocked, true);
    assert.equal(result.reason, "APPROVAL_MISMATCH");
    assert.equal(result.posts, 0);
    assert.equal(mock.log.count, 0);
  });

  it("rejects TEST_ONLY + transport mock + untagged fetch before reserve", async () => {
    const root = tempRoot();
    const { fetchImpl, count } = countingUntaggedFetch();
    const result = await executeTrpg1462OneShot({
      requestId: "A",
      root,
      fetchImpl,
      approval: createTrpg1462TestApproval(),
      apiKey: TRPG_1462_TEST_API_KEY,
      transport: "mock",
    });
    assert.equal(result.blocked, true);
    assert.equal(result.reason, "TEST_ONLY_NETWORK_FORBIDDEN");
    assert.equal(result.posts, 0);
    assert.equal(count.n, 0);
    assert.equal(existsSync(trpg1462PrecallJournalPath(root)), false);
  });

  it("rejects MOCK_LIVE_GATE + transport mock + untagged fetch before reserve", async () => {
    const root = tempRoot();
    const { fetchImpl, count } = countingUntaggedFetch();
    const result = await executeTrpg1462OneShot({
      requestId: "A",
      root,
      fetchImpl,
      approval: createTrpg1462MockLiveApproval(),
      apiKey: TRPG_1462_TEST_API_KEY,
      transport: "mock",
    });
    assert.equal(result.blocked, true);
    assert.equal(result.reason, "LIVE_APPROVAL_NOT_GRANTED");
    assert.equal(result.posts, 0);
    assert.equal(count.n, 0);
    assert.equal(existsSync(trpg1462PrecallJournalPath(root)), false);
  });

  it("LIVE mock concurrent reserve still produces one POST", async () => {
    const root = tempRoot();
    const [left, right] = await Promise.all([
      spawnChild({
        TRPG_1462_ONESHOT_ROOT: root,
        TRPG_1462_ONESHOT_ID: "C_1465",
        TRPG_1462_ONESHOT_FETCH: "success",
        TRPG_1462_ONESHOT_APPROVAL: "live",
      }),
      spawnChild({
        TRPG_1462_ONESHOT_ROOT: root,
        TRPG_1462_ONESHOT_ID: "C_1465",
        TRPG_1462_ONESHOT_FETCH: "success",
        TRPG_1462_ONESHOT_APPROVAL: "live",
      }),
    ]);
    const rows = [left, right].map((row) => JSON.parse(row.stdout) as { posts?: number; mockPosts?: number; blocked?: boolean });
    const posts = rows.reduce((sum, row) => sum + (row.mockPosts ?? row.posts ?? 0), 0);
    assert.equal(posts, 1);
    assert.equal(rows.filter((row) => row.blocked).length, 1);
    assert.equal(loadTrpg1462AttemptJournal(trpg1462PrecallJournalPath(root)).cases.C_1465.status, "posted");
  });
});

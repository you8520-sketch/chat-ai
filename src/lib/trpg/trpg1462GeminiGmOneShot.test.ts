import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL } from "@/lib/cheaperInferenceConfig";
import { GM_MAX_PROVIDER_ATTEMPTS } from "./gmCall";
import { TRPG_GM_MODEL } from "./types";
import {
  executeTrpg1462OneShot,
  loadTrpg1462OneShotResult,
  TRPG_1462_APPROVED_MODEL,
  TRPG_1462_MAX_PAID_CALLS,
  verifyTrpg1462SealedFingerprints,
} from "./trpg1462GeminiGmOneShot";
import { createTrpg1462MockFetch } from "./trpg1462GeminiGmOneShotMock";
import { TRPG_1462_PINNED_REQUEST_HASHES } from "./trpg1462GeminiGmNewBenchmark";
import {
  loadTrpg1462AttemptJournal,
  trpg1462PrecallJournalPath,
  writeTrpg1462AttemptJournal,
} from "./trpg1462GeminiGmPrecallJournal";

const CHILD = fileURLToPath(new URL("./trpg1462GeminiGmOneShot.child.ts", import.meta.url));

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "trpg1462-oneshot-"));
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
    const result = await executeTrpg1462OneShot({ requestId: "A", root, fetchImpl: mock.fetchImpl });
    assert.equal(result.ok, true);
    assert.equal(result.posts, 1);
    assert.equal(result.status, "posted");
    assert.equal(result.finishReason, "stop");
    assert.equal(result.narration, "달은 하늘에 남았다.");
    assert.equal(result.inputTokens, 12);
    assert.equal(result.outputTokens, 8);
    assert.equal(mock.log.count, 1);
    assert.equal(mock.log.urls[0], CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL);
    const journal = loadTrpg1462AttemptJournal(trpg1462PrecallJournalPath(root));
    assert.equal(journal.cases.A.status, "posted");
    assert.equal(journal.paidPosts, 1);
    const stored = loadTrpg1462OneShotResult(root, "A");
    assert.equal(stored.narration, "달은 하늘에 남았다.");
    assert.ok(stored.delta);
  });

  it("B. blocks the same id on a second execute", async () => {
    const root = tempRoot();
    const first = createTrpg1462MockFetch({ mode: "success" });
    await executeTrpg1462OneShot({ requestId: "B", root, fetchImpl: first.fetchImpl });
    const second = createTrpg1462MockFetch({ mode: "success" });
    const replay = await executeTrpg1462OneShot({ requestId: "B", root, fetchImpl: second.fetchImpl });
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
    assert.equal(loadTrpg1462AttemptJournal(trpg1462PrecallJournalPath(root)).cases.D_1480.status, "reserved");
    const mock = createTrpg1462MockFetch({ mode: "success" });
    const restart = await executeTrpg1462OneShot({ requestId: "D_1480", root, fetchImpl: mock.fetchImpl });
    assert.equal(restart.blocked, true);
    assert.equal(restart.posts, 0);
    assert.equal(mock.log.count, 0);
    assert.equal(loadTrpg1462AttemptJournal(trpg1462PrecallJournalPath(root)).cases.D_1480.status, "reserved");
  });

  it("E. HTTP 500/502/503/504 settle as http_error with no retry", async () => {
    for (const status of [500, 502, 503, 504]) {
      const root = tempRoot();
      const mock = createTrpg1462MockFetch({ mode: "http", status });
      const result = await executeTrpg1462OneShot({ requestId: "A", root, fetchImpl: mock.fetchImpl });
      assert.equal(result.posts, 1);
      assert.equal(mock.log.count, 1);
      assert.equal(result.status, "http_error");
      assert.equal(result.httpStatus, status);
      assert.equal(loadTrpg1462AttemptJournal(trpg1462PrecallJournalPath(root)).cases.A.status, "http_error");
      const replay = createTrpg1462MockFetch({ mode: "success" });
      const blocked = await executeTrpg1462OneShot({ requestId: "A", root, fetchImpl: replay.fetchImpl });
      assert.equal(blocked.posts, 0);
      assert.equal(replay.log.count, 0);
    }
  });

  it("F. timeout and UNKNOWN settle once and never retransmit", async () => {
    const timeoutRoot = tempRoot();
    const hang = createTrpg1462MockFetch({ mode: "hang" });
    const timeout = await executeTrpg1462OneShot({
      requestId: "A",
      root: timeoutRoot,
      fetchImpl: hang.fetchImpl,
      timeoutMs: 30,
    });
    assert.equal(timeout.posts, 1);
    assert.equal(timeout.status, "timeout");
    assert.equal(loadTrpg1462AttemptJournal(trpg1462PrecallJournalPath(timeoutRoot)).cases.A.status, "timeout");

    const unknownRoot = tempRoot();
    const empty = createTrpg1462MockFetch({ mode: "unknown" });
    const unknown = await executeTrpg1462OneShot({ requestId: "B", root: unknownRoot, fetchImpl: empty.fetchImpl });
    assert.equal(unknown.posts, 1);
    assert.equal(unknown.status, "unknown");
    assert.equal(loadTrpg1462AttemptJournal(trpg1462PrecallJournalPath(unknownRoot)).cases.B.status, "unknown");
  });

  it("G. journal write failure before POST keeps planned and sends 0", async () => {
    const root = tempRoot();
    const mock = createTrpg1462MockFetch({ mode: "success" });
    const result = await executeTrpg1462OneShot({
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
  });

  it("H. rejects an unapproved case id", async () => {
    const root = tempRoot();
    const mock = createTrpg1462MockFetch({ mode: "success" });
    const result = await executeTrpg1462OneShot({ requestId: "OPENING", root, fetchImpl: mock.fetchImpl });
    assert.equal(result.blocked, true);
    assert.equal(result.reason, "UNAPPROVED_CASE_ID");
    assert.equal(result.posts, 0);
    assert.equal(mock.log.count, 0);
  });

  it("I. rejects a changed request-body SHA", async () => {
    const root = tempRoot();
    const seed = createTrpg1462MockFetch({ mode: "success" });
    await executeTrpg1462OneShot({
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
    const result = await executeTrpg1462OneShot({ requestId: "B", root, fetchImpl: replay.fetchImpl });
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
    const stored = loadTrpg1462OneShotResult(root, "D_1465");
    assert.equal(stored.narration, posted.narration);
    assert.equal(existsSync(String(journal.cases.D_1465.resultFile)), true);
    chmodSync(root, 0o700);
    chmodSync(trpg1462PrecallJournalPath(root), 0o600);
    assert.equal((readFileSync(trpg1462PrecallJournalPath(root), "utf8").includes("callTrpgGm")), true);
  });
});

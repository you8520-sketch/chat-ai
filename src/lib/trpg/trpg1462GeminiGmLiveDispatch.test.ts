import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createTrpg1462MockOperatorApproval,
  dispatchTrpg1462LiveOneShot,
  estimateTrpg1462PublishedCostUsd,
  measureTrpg1462UsageCostUsd,
  TRPG_1462_PUBLISHED_SIX_CALL_ESTIMATE_USD,
  verifyTrpg1462OperatorApprovedCases,
} from "./trpg1462GeminiGmLiveDispatch";
import {
  createTrpg1462MockLiveApproval,
  createTrpg1462TestApproval,
  TRPG_1462_MOCK_OPERATOR_EXECUTION_SHA,
  TRPG_1462_TEST_API_KEY,
  type Trpg1462OneShotFetch,
} from "./trpg1462GeminiGmOneShot";
import { createTrpg1462MockFetch } from "./trpg1462GeminiGmOneShotMock";
import { TRPG_1462_NEW_BENCHMARK_REQUEST_IDS, TRPG_1462_PINNED_REQUEST_HASHES } from "./trpg1462GeminiGmNewBenchmark";
import {
  loadTrpg1462AttemptJournal,
  trpg1462LiveApprovalPath,
  trpg1462PrecallJournalPath,
} from "./trpg1462GeminiGmPrecallJournal";

const CHILD = fileURLToPath(new URL("./trpg1462GeminiGmLiveDispatch.child.ts", import.meta.url));

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "trpg1462-live-dispatch-"));
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
      if (code !== 0) {
        reject(new Error(`child ${code}: ${stderr || stdout}`));
        return;
      }
      resolve({ code, stdout });
    });
  });
}

describe("TRPG #1462 Gemini GM LIVE dispatcher", () => {
  it("1. missing LIVE approval record sends 0", async () => {
    const root = tempRoot();
    const mock = createTrpg1462MockFetch({ mode: "success" });
    const result = await dispatchTrpg1462LiveOneShot({
      mode: "mock-verify",
      requestId: "A",
      root,
      fetchImpl: mock.fetchImpl,
      executionSha: TRPG_1462_MOCK_OPERATOR_EXECUTION_SHA,
      approval: null,
      apiKey: TRPG_1462_TEST_API_KEY,
    });
    assert.equal(result.blocked, true);
    assert.equal(result.reason, "LIVE_APPROVAL_MISSING");
    assert.equal(result.posts, 0);
    assert.equal(mock.log.count, 0);
    assert.equal(existsSync(trpg1462LiveApprovalPath(root)), false);
  });

  it("2. TEST_ONLY cannot enter LIVE dispatch", async () => {
    const root = tempRoot();
    const { fetchImpl, count } = countingUntaggedFetch();
    const result = await dispatchTrpg1462LiveOneShot({
      mode: "live",
      requestId: "A",
      root,
      fetchImpl,
      transport: "live",
      executionSha: TRPG_1462_MOCK_OPERATOR_EXECUTION_SHA,
      approval: createTrpg1462TestApproval(),
      apiKey: TRPG_1462_TEST_API_KEY,
    });
    assert.equal(result.blocked, true);
    assert.equal(result.reason, "TEST_ONLY_NETWORK_FORBIDDEN");
    assert.equal(result.posts, 0);
    assert.equal(count.n, 0);
  });

  it("3. MOCK_LIVE_GATE cannot enter LIVE dispatch", async () => {
    const root = tempRoot();
    const { fetchImpl, count } = countingUntaggedFetch();
    const result = await dispatchTrpg1462LiveOneShot({
      mode: "live",
      requestId: "A",
      root,
      fetchImpl,
      transport: "live",
      executionSha: TRPG_1462_MOCK_OPERATOR_EXECUTION_SHA,
      approval: createTrpg1462MockLiveApproval(),
      apiKey: TRPG_1462_TEST_API_KEY,
    });
    assert.equal(result.blocked, true);
    assert.equal(result.reason, "LIVE_APPROVAL_NOT_OPERATOR");
    assert.equal(result.posts, 0);
    assert.equal(count.n, 0);
  });

  it("4. arbitrary grantedBy or false execution SHA send 0", async () => {
    const root = tempRoot();
    const mock = createTrpg1462MockFetch({ mode: "success" });
    const arbitrary = await dispatchTrpg1462LiveOneShot({
      mode: "mock-verify",
      requestId: "A",
      root,
      fetchImpl: mock.fetchImpl,
      executionSha: TRPG_1462_MOCK_OPERATOR_EXECUTION_SHA,
      approval: createTrpg1462MockLiveApproval({ grantedBy: "anyone" }),
      apiKey: TRPG_1462_TEST_API_KEY,
    });
    assert.equal(arbitrary.reason, "LIVE_APPROVAL_NOT_OPERATOR");
    assert.equal(arbitrary.posts, 0);
    assert.equal(mock.log.count, 0);

    const shaMock = createTrpg1462MockFetch({ mode: "success" });
    const wrongSha = await dispatchTrpg1462LiveOneShot({
      mode: "mock-verify",
      requestId: "A",
      root,
      fetchImpl: shaMock.fetchImpl,
      executionSha: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      approval: createTrpg1462MockOperatorApproval(),
      apiKey: TRPG_1462_TEST_API_KEY,
    });
    assert.equal(wrongSha.reason, "EXECUTION_SHA_MISMATCH");
    assert.equal(wrongSha.posts, 0);
    assert.equal(shaMock.log.count, 0);
  });

  it("5. wrong request-body SHA sends 0", async () => {
    const root = tempRoot();
    const mock = createTrpg1462MockFetch({ mode: "success" });
    const approval = createTrpg1462MockOperatorApproval();
    approval.requestBodySha256.A = "0".repeat(64);
    const result = await dispatchTrpg1462LiveOneShot({
      mode: "mock-verify",
      requestId: "A",
      root,
      fetchImpl: mock.fetchImpl,
      executionSha: TRPG_1462_MOCK_OPERATOR_EXECUTION_SHA,
      approval,
      apiKey: TRPG_1462_TEST_API_KEY,
    });
    assert.equal(result.reason, "APPROVAL_MISMATCH");
    assert.equal(result.posts, 0);
    assert.equal(mock.log.count, 0);
  });

  it("6. unapproved case ID sends 0", async () => {
    const root = tempRoot();
    const mock = createTrpg1462MockFetch({ mode: "success" });
    const result = await dispatchTrpg1462LiveOneShot({
      mode: "mock-verify",
      requestId: "OPENING",
      root,
      fetchImpl: mock.fetchImpl,
      executionSha: TRPG_1462_MOCK_OPERATOR_EXECUTION_SHA,
      approval: createTrpg1462MockOperatorApproval(),
      apiKey: TRPG_1462_TEST_API_KEY,
    });
    assert.equal(result.reason, "UNAPPROVED_CASE_ID");
    assert.equal(result.posts, 0);
    assert.equal(mock.log.count, 0);
  });

  it("7. runs only the approved subset of IDs", async () => {
    const root = tempRoot();
    const approval = createTrpg1462MockOperatorApproval({ approvedCaseIds: ["A"] });
    const allowed = createTrpg1462MockFetch({ mode: "success" });
    const posted = await dispatchTrpg1462LiveOneShot({
      mode: "mock-verify",
      requestId: "A",
      root,
      fetchImpl: allowed.fetchImpl,
      executionSha: TRPG_1462_MOCK_OPERATOR_EXECUTION_SHA,
      approval,
      apiKey: TRPG_1462_TEST_API_KEY,
    });
    assert.equal(posted.ok, true);
    assert.equal(posted.posts, 1);
    const denied = createTrpg1462MockFetch({ mode: "success" });
    const blocked = await dispatchTrpg1462LiveOneShot({
      mode: "mock-verify",
      requestId: "B",
      root,
      fetchImpl: denied.fetchImpl,
      executionSha: TRPG_1462_MOCK_OPERATOR_EXECUTION_SHA,
      approval,
      apiKey: TRPG_1462_TEST_API_KEY,
    });
    assert.equal(blocked.reason, "APPROVAL_MISMATCH");
    assert.equal(blocked.posts, 0);
    assert.equal(denied.log.count, 0);
  });

  it("8. verifies all six sealed case IDs and hashes", () => {
    const approval = createTrpg1462MockOperatorApproval();
    const ids = verifyTrpg1462OperatorApprovedCases(approval);
    assert.deepEqual(ids, [...TRPG_1462_NEW_BENCHMARK_REQUEST_IDS]);
    for (const id of TRPG_1462_NEW_BENCHMARK_REQUEST_IDS) {
      assert.equal(approval.requestBodySha256[id], TRPG_1462_PINNED_REQUEST_HASHES[id].requestBodySha256);
    }
  });

  it("9. blocks when approved maxCalls is consumed", async () => {
    const root = tempRoot();
    const approval = createTrpg1462MockOperatorApproval({ maxCalls: 1 });
    const first = createTrpg1462MockFetch({ mode: "success" });
    const posted = await dispatchTrpg1462LiveOneShot({
      mode: "mock-verify",
      requestId: "A",
      root,
      fetchImpl: first.fetchImpl,
      executionSha: TRPG_1462_MOCK_OPERATOR_EXECUTION_SHA,
      approval,
      apiKey: TRPG_1462_TEST_API_KEY,
    });
    assert.equal(posted.ok, true);
    const second = createTrpg1462MockFetch({ mode: "success" });
    const blocked = await dispatchTrpg1462LiveOneShot({
      mode: "mock-verify",
      requestId: "B",
      root,
      fetchImpl: second.fetchImpl,
      executionSha: TRPG_1462_MOCK_OPERATOR_EXECUTION_SHA,
      approval,
      apiKey: TRPG_1462_TEST_API_KEY,
    });
    assert.equal(blocked.reason, "APPROVAL_MAX_CALLS");
    assert.equal(blocked.posts, 0);
    assert.equal(second.log.count, 0);
  });

  it("10. distinguishes published estimate from usage-based measured cost", async () => {
    const root = tempRoot();
    const mock = createTrpg1462MockFetch({ mode: "success" });
    const result = await dispatchTrpg1462LiveOneShot({
      mode: "mock-verify",
      requestId: "A",
      root,
      fetchImpl: mock.fetchImpl,
      executionSha: TRPG_1462_MOCK_OPERATOR_EXECUTION_SHA,
      approval: createTrpg1462MockOperatorApproval(),
      apiKey: TRPG_1462_TEST_API_KEY,
    });
    assert.equal(result.ok, true);
    assert.equal(result.cost.estimatedUsd, TRPG_1462_PUBLISHED_SIX_CALL_ESTIMATE_USD);
    assert.equal(result.cost.costCapGuaranteed, false);
    assert.equal(result.cost.measuredUsd, measureTrpg1462UsageCostUsd(12, 8));
    assert.notEqual(result.cost.measuredUsd, result.cost.estimatedUsd);
    assert.equal(estimateTrpg1462PublishedCostUsd(6), TRPG_1462_PUBLISHED_SIX_CALL_ESTIMATE_USD);
    const overBudget = await dispatchTrpg1462LiveOneShot({
      mode: "mock-verify",
      requestId: "B",
      root: tempRoot(),
      fetchImpl: createTrpg1462MockFetch({ mode: "success" }).fetchImpl,
      executionSha: TRPG_1462_MOCK_OPERATOR_EXECUTION_SHA,
      approval: createTrpg1462MockOperatorApproval({ estimatedCostUsd: 1, maxCostUsd: 0.03 }),
      apiKey: TRPG_1462_TEST_API_KEY,
    });
    assert.equal(overBudget.reason, "COST_POLICY_EXCEEDED");
    assert.equal(overBudget.posts, 0);
  });

  it("11. fails closed when the private API key is missing", async () => {
    const root = tempRoot();
    const mock = createTrpg1462MockFetch({ mode: "success" });
    const result = await dispatchTrpg1462LiveOneShot({
      mode: "mock-verify",
      requestId: "A",
      root,
      fetchImpl: mock.fetchImpl,
      executionSha: TRPG_1462_MOCK_OPERATOR_EXECUTION_SHA,
      approval: createTrpg1462MockOperatorApproval(),
      apiKey: "",
    });
    assert.equal(result.reason, "AUTH_MISSING");
    assert.equal(result.posts, 0);
    assert.equal(mock.log.count, 0);
    assert.equal(existsSync(trpg1462PrecallJournalPath(root)), false);
  });

  it("12. blocks duplicate and concurrent dispatch of the same ID", async () => {
    const root = tempRoot();
    const first = createTrpg1462MockFetch({ mode: "success" });
    await dispatchTrpg1462LiveOneShot({
      mode: "mock-verify",
      requestId: "C_1480",
      root,
      fetchImpl: first.fetchImpl,
      executionSha: TRPG_1462_MOCK_OPERATOR_EXECUTION_SHA,
      approval: createTrpg1462MockOperatorApproval(),
      apiKey: TRPG_1462_TEST_API_KEY,
    });
    const replay = createTrpg1462MockFetch({ mode: "success" });
    const blocked = await dispatchTrpg1462LiveOneShot({
      mode: "mock-verify",
      requestId: "C_1480",
      root,
      fetchImpl: replay.fetchImpl,
      executionSha: TRPG_1462_MOCK_OPERATOR_EXECUTION_SHA,
      approval: createTrpg1462MockOperatorApproval(),
      apiKey: TRPG_1462_TEST_API_KEY,
    });
    assert.match(blocked.reason ?? "", /ONE_SHOT_BLOCKED/);
    assert.equal(blocked.posts, 0);
    assert.equal(replay.log.count, 0);

    const raceRoot = tempRoot();
    const [left, right] = await Promise.all([
      spawnChild({ TRPG_1462_ONESHOT_ROOT: raceRoot, TRPG_1462_ONESHOT_ID: "D_1480", TRPG_1462_ONESHOT_FETCH: "success" }),
      spawnChild({ TRPG_1462_ONESHOT_ROOT: raceRoot, TRPG_1462_ONESHOT_ID: "D_1480", TRPG_1462_ONESHOT_FETCH: "success" }),
    ]);
    const rows = [left, right].map((row) => JSON.parse(row.stdout) as { mockPosts?: number; blocked?: boolean });
    assert.equal(rows.reduce((sum, row) => sum + (row.mockPosts ?? 0), 0), 1);
    assert.equal(rows.filter((row) => row.blocked).length, 1);
  });

  it("13. does not retransmit after 5xx or timeout", async () => {
    const httpRoot = tempRoot();
    const http = createTrpg1462MockFetch({ mode: "http", status: 503 });
    const failed = await dispatchTrpg1462LiveOneShot({
      mode: "mock-verify",
      requestId: "A",
      root: httpRoot,
      fetchImpl: http.fetchImpl,
      executionSha: TRPG_1462_MOCK_OPERATOR_EXECUTION_SHA,
      approval: createTrpg1462MockOperatorApproval(),
      apiKey: TRPG_1462_TEST_API_KEY,
    });
    assert.equal(failed.status, "http_error");
    assert.equal(http.log.count, 1);
    const replay = createTrpg1462MockFetch({ mode: "success" });
    const blocked = await dispatchTrpg1462LiveOneShot({
      mode: "mock-verify",
      requestId: "A",
      root: httpRoot,
      fetchImpl: replay.fetchImpl,
      executionSha: TRPG_1462_MOCK_OPERATOR_EXECUTION_SHA,
      approval: createTrpg1462MockOperatorApproval(),
      apiKey: TRPG_1462_TEST_API_KEY,
    });
    assert.equal(blocked.posts, 0);
    assert.equal(replay.log.count, 0);

    const timeoutRoot = tempRoot();
    const hang = createTrpg1462MockFetch({ mode: "hang" });
    const timeout = await dispatchTrpg1462LiveOneShot({
      mode: "mock-verify",
      requestId: "B",
      root: timeoutRoot,
      fetchImpl: hang.fetchImpl,
      executionSha: TRPG_1462_MOCK_OPERATOR_EXECUTION_SHA,
      approval: createTrpg1462MockOperatorApproval(),
      apiKey: TRPG_1462_TEST_API_KEY,
      timeoutMs: 30,
    });
    assert.equal(timeout.status, "timeout");
    assert.equal(loadTrpg1462AttemptJournal(trpg1462PrecallJournalPath(timeoutRoot)).cases.B.status, "timeout");
  });

  it("rejects a mock operator record on the live transport path", async () => {
    const root = tempRoot();
    const { fetchImpl, count } = countingUntaggedFetch();
    const result = await dispatchTrpg1462LiveOneShot({
      mode: "live",
      requestId: "A",
      root,
      fetchImpl,
      transport: "live",
      executionSha: TRPG_1462_MOCK_OPERATOR_EXECUTION_SHA,
      approval: createTrpg1462MockOperatorApproval(),
      apiKey: TRPG_1462_TEST_API_KEY,
    });
    assert.equal(result.reason, "LIVE_APPROVAL_NOT_GRANTED");
    assert.equal(result.posts, 0);
    assert.equal(count.n, 0);
    assert.equal(existsSync(trpg1462PrecallJournalPath(root)), false);
  });

  it("keeps production DB writes at 0 on a successful mock dispatch", async () => {
    const root = tempRoot();
    const mock = createTrpg1462MockFetch({ mode: "success" });
    await dispatchTrpg1462LiveOneShot({
      mode: "mock-verify",
      requestId: "A",
      root,
      fetchImpl: mock.fetchImpl,
      executionSha: TRPG_1462_MOCK_OPERATOR_EXECUTION_SHA,
      approval: createTrpg1462MockOperatorApproval(),
      apiKey: TRPG_1462_TEST_API_KEY,
    });
    assert.equal(loadTrpg1462AttemptJournal(trpg1462PrecallJournalPath(root)).productionDbWrites, 0);
    assert.equal(JSON.stringify(mock.log).includes(TRPG_1462_TEST_API_KEY), false);
  });
});

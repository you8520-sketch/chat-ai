import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const POST_DEPLOY_ORIGIN = "https://hav.chat";
export const POST_DEPLOY_EVIDENCE_PREFIX = "post-deploy-verification ";
export const POST_DEPLOY_REQUEST_TIMEOUT_MS = 5_000;
export const POST_DEPLOY_MAX_ATTEMPTS = 4;
export const POST_DEPLOY_RETRY_DELAY_MS = 2_000;
export const POST_DEPLOY_TOTAL_BUDGET_MS = 45_000;
export const POST_DEPLOY_WORKFLOW_PATH = ".github/workflows/post-deploy-verification.yml";

export type PostDeployVerificationState = "VERIFIED" | "FAILED" | "UNVERIFIED" | "SUPERSEDED";

export type PostDeployEvidence = {
  state: Exclude<PostDeployVerificationState, "SUPERSEDED">;
  targetSha: string;
  observedGitCommit: string | null;
  reason: string | null;
  checkedAt: string;
  attempts: number;
};

export type RailwayDeploymentEvent = {
  deployment_status?: { state?: unknown };
  deployment?: {
    sha?: unknown;
    ref?: unknown;
    environment?: unknown;
    task?: unknown;
  };
};

const RETRYABLE_HTTP = new Set([502, 503, 504]);
const SHA_RE = /^[0-9a-f]{7,40}$/i;

export function isProductionEnvironmentName(environment: string): boolean {
  const parts = environment
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts[parts.length - 1]?.toLowerCase() === "production";
}

export function normalizeDeploymentSha(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const sha = value.trim().toLowerCase();
  return SHA_RE.test(sha) ? sha : null;
}

export function gitCommitMatchesDeployment(
  gitCommit: string | null,
  targetSha: string
): boolean {
  const commit = normalizeDeploymentSha(gitCommit);
  const target = normalizeDeploymentSha(targetSha);
  if (!commit || !target) return false;
  return target.startsWith(commit) || commit.startsWith(target);
}

export function isRailwayProductionSuccessEvent(event: RailwayDeploymentEvent): {
  accept: boolean;
  sha: string | null;
} {
  const state = typeof event.deployment_status?.state === "string"
    ? event.deployment_status.state.trim().toLowerCase()
    : "";
  const task = typeof event.deployment?.task === "string"
    ? event.deployment.task.trim().toLowerCase()
    : "";
  const environment = typeof event.deployment?.environment === "string"
    ? event.deployment.environment
    : "";
  const sha = normalizeDeploymentSha(event.deployment?.sha);
  const accept =
    state === "success" &&
    task === "deploy" &&
    isProductionEnvironmentName(environment) &&
    sha != null;
  return { accept, sha };
}

export function parsePostDeployEvidence(message: string): PostDeployEvidence | null {
  const trimmed = message.trim();
  if (!trimmed.startsWith(POST_DEPLOY_EVIDENCE_PREFIX)) return null;
  try {
    const parsed = JSON.parse(trimmed.slice(POST_DEPLOY_EVIDENCE_PREFIX.length)) as Partial<PostDeployEvidence>;
    if (
      parsed.state !== "VERIFIED" &&
      parsed.state !== "FAILED" &&
      parsed.state !== "UNVERIFIED"
    ) {
      return null;
    }
    const targetSha = normalizeDeploymentSha(parsed.targetSha) ?? "";
    const observed = parsed.observedGitCommit == null
      ? null
      : normalizeDeploymentSha(parsed.observedGitCommit);
    if (parsed.observedGitCommit != null && observed == null) return null;
    return {
      state: parsed.state,
      targetSha,
      observedGitCommit: observed,
      reason: typeof parsed.reason === "string" && parsed.reason ? parsed.reason.slice(0, 80) : null,
      checkedAt: typeof parsed.checkedAt === "string" ? parsed.checkedAt : "",
      attempts: typeof parsed.attempts === "number" && parsed.attempts >= 0 ? parsed.attempts : 0,
    };
  } catch {
    return null;
  }
}

type ProbeOutcome =
  | { kind: "verified"; gitCommit: string }
  | { kind: "failed"; reason: string; gitCommit: string | null }
  | { kind: "retry"; reason: string }
  | { kind: "unverified"; reason: string };

async function readResponse(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number
): Promise<{ status: number | null; body: unknown | null; problem: "timeout" | "json" | "http" | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (response.status >= 300 && response.status < 400) {
      return { status: response.status, body: null, problem: "http" };
    }
    const text = await response.text();
    if (!text.trim()) return { status: response.status, body: null, problem: response.ok ? "json" : "http" };
    try {
      return { status: response.status, body: JSON.parse(text) as unknown, problem: null };
    } catch {
      return { status: response.status, body: null, problem: "json" };
    }
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return { status: null, body: null, problem: aborted ? "timeout" : "http" };
  } finally {
    clearTimeout(timer);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function classifyAttempt(
  health: { status: number | null; body: unknown | null; problem: "timeout" | "json" | "http" | null },
  api: { status: number | null; body: unknown | null; problem: "timeout" | "json" | "http" | null },
  targetSha: string
): ProbeOutcome {
  if (health.problem === "timeout" || api.problem === "timeout") {
    return { kind: "unverified", reason: "request_timeout" };
  }
  if (health.problem === "json" || api.problem === "json") {
    return { kind: "failed", reason: "invalid_json", gitCommit: null };
  }
  if (
    (health.status != null && RETRYABLE_HTTP.has(health.status)) ||
    (api.status != null && RETRYABLE_HTTP.has(api.status))
  ) {
    return { kind: "retry", reason: "health_unavailable" };
  }
  if (health.status == null || api.status == null) {
    return { kind: "unverified", reason: "request_failed" };
  }
  if (health.status !== 200 || api.status !== 200) {
    return { kind: "failed", reason: `health_http_${health.status}_${api.status}`, gitCommit: null };
  }
  const healthBody = asRecord(health.body);
  const apiBody = asRecord(api.body);
  if (!healthBody || !apiBody) return { kind: "failed", reason: "invalid_json", gitCommit: null };
  if (healthBody.status !== "ok") return { kind: "failed", reason: "health_contract", gitCommit: null };
  if (apiBody.ok !== true || typeof apiBody.service !== "string" || !apiBody.service.trim()) {
    return { kind: "failed", reason: "api_health_contract", gitCommit: null };
  }
  const gitCommit = typeof apiBody.gitCommit === "string" ? apiBody.gitCommit : null;
  if (!normalizeDeploymentSha(gitCommit)) {
    return { kind: "failed", reason: "git_commit_missing", gitCommit: null };
  }
  if (!gitCommitMatchesDeployment(gitCommit, targetSha)) {
    return { kind: "failed", reason: "sha_mismatch", gitCommit: normalizeDeploymentSha(gitCommit) };
  }
  return { kind: "verified", gitCommit: normalizeDeploymentSha(gitCommit)! };
}

export async function verifyOfficialDeployment(input: {
  targetSha: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  budgetMs?: number;
  maxAttempts?: number;
  timeoutMs?: number;
  retryDelayMs?: number;
}): Promise<PostDeployEvidence> {
  const now = input.now ?? (() => new Date());
  const started = now().getTime();
  const budgetMs = input.budgetMs ?? POST_DEPLOY_TOTAL_BUDGET_MS;
  const maxAttempts = input.maxAttempts ?? POST_DEPLOY_MAX_ATTEMPTS;
  const timeoutMs = input.timeoutMs ?? POST_DEPLOY_REQUEST_TIMEOUT_MS;
  const retryDelayMs = input.retryDelayMs ?? POST_DEPLOY_RETRY_DELAY_MS;
  const fetchImpl = input.fetchImpl ?? fetch;
  const sleep =
    input.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const targetSha = normalizeDeploymentSha(input.targetSha) ?? "";
  const checkedAt = () => now().toISOString();
  if (!targetSha) {
    return {
      state: "UNVERIFIED",
      targetSha: "",
      observedGitCommit: null,
      reason: "target_sha_missing",
      checkedAt: checkedAt(),
      attempts: 0,
    };
  }

  let attempts = 0;
  let lastRetry: string | null = null;
  let lastIncomplete: string | null = null;
  while (attempts < maxAttempts && now().getTime() - started < budgetMs) {
    attempts += 1;
    const health = await readResponse(fetchImpl, `${POST_DEPLOY_ORIGIN}/health`, timeoutMs);
    const api = await readResponse(fetchImpl, `${POST_DEPLOY_ORIGIN}/api/health`, timeoutMs);
    const outcome = classifyAttempt(health, api, targetSha);
    if (outcome.kind === "verified") {
      return {
        state: "VERIFIED",
        targetSha,
        observedGitCommit: outcome.gitCommit,
        reason: null,
        checkedAt: checkedAt(),
        attempts,
      };
    }
    if (outcome.kind === "failed") {
      return {
        state: "FAILED",
        targetSha,
        observedGitCommit: outcome.gitCommit,
        reason: outcome.reason,
        checkedAt: checkedAt(),
        attempts,
      };
    }
    if (outcome.kind === "unverified" && outcome.reason === "request_timeout") {
      return {
        state: "UNVERIFIED",
        targetSha,
        observedGitCommit: null,
        reason: outcome.reason,
        checkedAt: checkedAt(),
        attempts,
      };
    }
    if (outcome.kind === "retry") lastRetry = outcome.reason;
    else lastIncomplete = outcome.reason;
    if (attempts >= maxAttempts || now().getTime() - started >= budgetMs) break;
    await sleep(retryDelayMs);
  }
  return {
    state: lastRetry ? "FAILED" : "UNVERIFIED",
    targetSha,
    observedGitCommit: null,
    reason: lastRetry ?? lastIncomplete ?? "verification_incomplete",
    checkedAt: checkedAt(),
    attempts,
  };
}

export type ParsedPostDeployRun = {
  runId: number;
  htmlUrl: string;
  createdAt: string;
  evidence: PostDeployEvidence | null;
};

export type DeploymentSuccessRef = {
  sha: string;
  createdAt: string;
};

export type PostDeployVerificationHeadline = {
  state: PostDeployVerificationState;
  targetSha: string;
  observedGitCommit: string | null;
  checkedAt: string;
  reason: string | null;
  htmlUrl: string;
  currentDeployment: boolean;
};

export type PostDeployVerificationView = {
  status: "OK" | "UNAVAILABLE";
  error: string | null;
  latest: PostDeployVerificationHeadline | null;
  superseded: PostDeployVerificationHeadline | null;
};

export function projectPostDeployVerification(input: {
  runs: readonly ParsedPostDeployRun[];
  latestSuccess: DeploymentSuccessRef | null;
  readError?: string | null;
}): PostDeployVerificationView {
  if (input.readError) {
    return { status: "UNAVAILABLE", error: input.readError, latest: null, superseded: null };
  }
  const evidenced = input.runs
    .filter((run) => run.evidence)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latestSuccess = input.latestSuccess
    ? {
        sha: normalizeDeploymentSha(input.latestSuccess.sha) ?? "",
        createdAt: input.latestSuccess.createdAt,
      }
    : null;
  const supersededOf = (currentSha: string): PostDeployVerificationHeadline | null => {
    const previous = evidenced.find((run) => run.evidence && run.evidence.targetSha !== currentSha);
    if (!previous?.evidence) return null;
    return {
      state: "SUPERSEDED",
      targetSha: previous.evidence.targetSha,
      observedGitCommit: previous.evidence.observedGitCommit,
      checkedAt: previous.evidence.checkedAt || previous.createdAt,
      reason: "later_deployment_succeeded",
      htmlUrl: previous.htmlUrl,
      currentDeployment: false,
    };
  };
  if (latestSuccess?.sha) {
    const match = evidenced.find((run) => run.evidence?.targetSha === latestSuccess.sha);
    if (match?.evidence) {
      return {
        status: "OK",
        error: null,
        latest: {
          state: match.evidence.state,
          targetSha: match.evidence.targetSha,
          observedGitCommit: match.evidence.observedGitCommit,
          checkedAt: match.evidence.checkedAt || match.createdAt,
          reason: match.evidence.reason,
          htmlUrl: match.htmlUrl,
          currentDeployment: true,
        },
        superseded: supersededOf(latestSuccess.sha),
      };
    }
    return {
      status: "OK",
      error: null,
      latest: {
        state: "UNVERIFIED",
        targetSha: latestSuccess.sha,
        observedGitCommit: null,
        checkedAt: latestSuccess.createdAt,
        reason: "awaiting_verification",
        htmlUrl: "",
        currentDeployment: true,
      },
      superseded: supersededOf(latestSuccess.sha),
    };
  }
  const newest = evidenced[0];
  if (!newest?.evidence) {
    return {
      status: "OK",
      error: null,
      latest: {
        state: "UNVERIFIED",
        targetSha: "",
        observedGitCommit: null,
        checkedAt: "",
        reason: "no_verification_evidence",
        htmlUrl: newest?.htmlUrl ?? "",
        currentDeployment: false,
      },
      superseded: null,
    };
  }
  return {
    status: "OK",
    error: null,
    latest: {
      state: newest.evidence.state,
      targetSha: newest.evidence.targetSha,
      observedGitCommit: newest.evidence.observedGitCommit,
      checkedAt: newest.evidence.checkedAt || newest.createdAt,
      reason: newest.evidence.reason,
      htmlUrl: newest.htmlUrl,
      currentDeployment: false,
    },
    superseded: null,
  };
}

function shaAncestry(sha: string): "on_main" | "not_on_main" | "unproven" {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"], { stdio: "ignore" });
    return "on_main";
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error
      ? Number((error as { status?: unknown }).status)
      : 1;
    return status === 1 ? "not_on_main" : "unproven";
  }
}

function emitEvidence(evidence: PostDeployEvidence): void {
  const json = JSON.stringify(evidence);
  writeFileSync("post-deploy-verification.json", `${json}\n`, "utf8");
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `\n\`\`\`json\n${json}\n\`\`\`\n`, "utf8");
  if (process.env.GITHUB_ACTIONS === "true") {
    const safe = `${POST_DEPLOY_EVIDENCE_PREFIX}${json}`
      .replace(/%/g, "%25")
      .replace(/\r/g, "%0D")
      .replace(/\n/g, "%0A");
    console.log(`::notice title=post-deploy-verification::${safe}`);
  }
  console.log(json);
}

async function runCli(): Promise<number> {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  let event: RailwayDeploymentEvent = {};
  if (eventPath) {
    try {
      event = JSON.parse(readFileSync(eventPath, "utf8")) as RailwayDeploymentEvent;
    } catch {
      event = {};
    }
  }
  const decision = isRailwayProductionSuccessEvent(event);
  const now = new Date().toISOString();
  if (!decision.accept || !decision.sha) {
    const evidence: PostDeployEvidence = {
      state: "UNVERIFIED",
      targetSha: decision.sha ?? "",
      observedGitCommit: null,
      reason: "deployment_event_not_eligible",
      checkedAt: now,
      attempts: 0,
    };
    emitEvidence(evidence);
    return 1;
  }
  const ancestry = shaAncestry(decision.sha);
  if (ancestry !== "on_main") {
    const evidence: PostDeployEvidence = {
      state: ancestry === "not_on_main" ? "FAILED" : "UNVERIFIED",
      targetSha: decision.sha,
      observedGitCommit: null,
      reason: ancestry === "not_on_main" ? "sha_not_on_main" : "main_ancestry_unproven",
      checkedAt: now,
      attempts: 0,
    };
    emitEvidence(evidence);
    return 1;
  }
  const evidence = await verifyOfficialDeployment({ targetSha: decision.sha });
  emitEvidence(evidence);
  return evidence.state === "VERIFIED" ? 0 : 1;
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (invokedDirectly) {
  void runCli().then((code) => {
    process.exitCode = code;
  });
}

import type Database from "better-sqlite3";
import { classifyDeepSeekProviderFailure } from "@/lib/deepseekProviderFailover";
import { isRetryableRemoteSchemaError } from "@/lib/libsqlErrors";

export type ProductionRequestSubsystem = "http" | "provider" | "db" | "auth" | "stream";

export type ProductionRequestIncidentInput = {
  routeTemplate: string;
  subsystem: ProductionRequestSubsystem;
  httpStatus?: number | null;
  error?: unknown;
};

export type OpsRequestIncidentRow = {
  signature: string;
  route_template: string;
  subsystem: string;
  http_status: number | null;
  error_class: string;
  first_seen_at: string;
  last_seen_at: string;
  occurrence_count: number;
  first_deployment_sha: string;
  latest_deployment_sha: string;
};

type RecordedIncident = {
  record: true;
  signature: string;
  routeTemplate: string;
  subsystem: ProductionRequestSubsystem;
  errorClass: string;
  httpStatus: number | null;
};

type SkippedIncident = { record: false };

const PRODUCT_PATH_ERROR_NAMES = new Set([
  "DegenerationAbortError",
  "MetaLeakageAbortError",
  "GeminiTrafficOverloadError",
  "MemoryCanonicalityEditNotSupportedError",
]);

const OPERATIONAL_PROVIDER_CLASSES = new Set([
  "headers_timeout",
  "first_visible_timeout",
  "body_timeout",
  "timeout",
  "UND_ERR_SOCKET",
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "socket_hang_up",
  "fetch_failed",
  "socket",
  "malformed_provider_response",
]);

const DB_FAILURE_RE =
  /SQLITE_|unable to open database file|database disk image is malformed|disk I\/O error|no such table|database is locked/i;

const UPSERT_SQL = `
  INSERT INTO ops_request_incidents (
    signature, route_template, subsystem, http_status, error_class,
    first_seen_at, last_seen_at, occurrence_count,
    first_deployment_sha, latest_deployment_sha
  ) VALUES (
    @signature, @route_template, @subsystem, @http_status, @error_class,
    @seen_at, @seen_at, 1,
    @deployment_sha, @deployment_sha
  )
  ON CONFLICT(signature) DO UPDATE SET
    last_seen_at = excluded.last_seen_at,
    occurrence_count = ops_request_incidents.occurrence_count + 1,
    latest_deployment_sha = CASE
      WHEN excluded.latest_deployment_sha != '' THEN excluded.latest_deployment_sha
      ELSE ops_request_incidents.latest_deployment_sha
    END,
    http_status = COALESCE(excluded.http_status, ops_request_incidents.http_status)
`;

let observeDepth = 0;

function stableToken(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value) ? value : null;
}

function boundedStatus(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < 100 || value > 599) return null;
  return value;
}

export function normalizeOpsRouteTemplate(route: string): string {
  const withoutQuery = route.trim().split(/[?#]/, 1)[0] ?? "";
  const prefixed = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  const segments = prefixed.split("/").map((segment) => {
    if (segment.length === 0) return segment;
    if (/^\d+$/.test(segment)) return ":id";
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)
    ) {
      return ":id";
    }
    if (/^[0-9a-f]{16,64}$/i.test(segment)) return ":id";
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(segment)) return ":param";
    return segment;
  });
  const joined = segments.join("/") || "/";
  return joined.length > 160 ? joined.slice(0, 160) : joined;
}

export function readRailwayDeploymentSha(
  env: NodeJS.ProcessEnv = process.env
): string {
  const raw = env.RAILWAY_GIT_COMMIT_SHA?.trim() ?? "";
  return /^[0-9a-f]{7,40}$/i.test(raw) ? raw.toLowerCase() : "";
}

export function displayDeploymentSha(sha: string): string {
  return sha ? sha.slice(0, 7) : "unknown";
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "";
}

function readAttachedFailure(error: unknown): {
  failureClass: string | null;
  httpStatus: number | null;
} {
  if (!error || typeof error !== "object") {
    return { failureClass: null, httpStatus: null };
  }
  const record = error as {
    failureClass?: unknown;
    primaryFailureClass?: unknown;
    httpStatus?: unknown;
    primaryHttpStatus?: unknown;
  };
  const failureClass =
    typeof record.failureClass === "string"
      ? record.failureClass
      : typeof record.primaryFailureClass === "string"
        ? record.primaryFailureClass
        : null;
  const httpStatus = boundedStatus(record.httpStatus) ?? boundedStatus(record.primaryHttpStatus);
  return { failureClass: stableToken(failureClass), httpStatus };
}

function isDatabaseFailure(error: unknown): boolean {
  if (isRetryableRemoteSchemaError(error)) return true;
  const message = error instanceof Error ? error.message : "";
  return DB_FAILURE_RE.test(message);
}

function resolveProviderFailure(
  error: unknown,
  callerStatus: number | null
): { failureClass: string; httpStatus: number | null } {
  const attached = readAttachedFailure(error);
  if (attached.failureClass) {
    return {
      failureClass: attached.failureClass,
      httpStatus: attached.httpStatus ?? callerStatus,
    };
  }
  const classified = classifyDeepSeekProviderFailure({
    httpStatus: callerStatus,
    error,
  });
  return {
    failureClass: stableToken(classified.failureClass) ?? "deterministic",
    httpStatus: classified.httpStatus ?? callerStatus,
  };
}

function providerDecision(
  routeTemplate: string,
  failureClass: string,
  httpStatus: number | null
): RecordedIncident | SkippedIncident {
  if (httpStatus != null && httpStatus >= 400 && httpStatus < 500) return { record: false };
  if (failureClass === "malformed_provider_response") {
    return recorded(
      routeTemplate,
      "provider",
      failureClass,
      httpStatus != null && httpStatus >= 500 ? httpStatus : null
    );
  }
  if (httpStatus != null && httpStatus >= 500 && failureClass.startsWith("http_")) {
    return recorded(routeTemplate, "provider", failureClass, httpStatus);
  }
  if ((httpStatus == null || httpStatus >= 500) && OPERATIONAL_PROVIDER_CLASSES.has(failureClass)) {
    return recorded(
      routeTemplate,
      "provider",
      failureClass,
      httpStatus != null && httpStatus >= 500 ? httpStatus : null
    );
  }
  return { record: false };
}

function recorded(
  routeTemplate: string,
  subsystem: ProductionRequestSubsystem,
  errorClass: string,
  httpStatus: number | null
): RecordedIncident {
  return {
    record: true,
    routeTemplate,
    subsystem,
    errorClass,
    httpStatus: httpStatus != null && httpStatus >= 500 ? httpStatus : null,
    signature: `${routeTemplate}|${subsystem}|${errorClass}`,
  };
}

function looksLikeProviderError(error: unknown): boolean {
  const name = errorName(error);
  if (name.startsWith("DeepSeek")) return true;
  return readAttachedFailure(error).failureClass != null;
}

export function classifyProductionRequestIncident(
  input: ProductionRequestIncidentInput
): RecordedIncident | SkippedIncident {
  const routeTemplate = normalizeOpsRouteTemplate(input.routeTemplate);
  const name = errorName(input.error);
  if (PRODUCT_PATH_ERROR_NAMES.has(name)) return { record: false };

  const callerStatus = boundedStatus(input.httpStatus);
  if (callerStatus != null && callerStatus >= 400 && callerStatus < 500) return { record: false };

  if (name === "AbortError") {
    const provider = resolveProviderFailure(input.error, callerStatus);
    if (
      provider.failureClass === "timeout" ||
      provider.failureClass === "headers_timeout" ||
      provider.failureClass === "first_visible_timeout" ||
      provider.failureClass === "body_timeout"
    ) {
      return providerDecision(routeTemplate, provider.failureClass, provider.httpStatus);
    }
    return { record: false };
  }

  if (input.subsystem === "provider" || looksLikeProviderError(input.error)) {
    const provider = resolveProviderFailure(input.error, callerStatus);
    const decision = providerDecision(routeTemplate, provider.failureClass, provider.httpStatus);
    if (decision.record || input.subsystem === "provider") return decision;
  }

  if (isDatabaseFailure(input.error)) {
    return recorded(
      routeTemplate,
      "db",
      "db_failure",
      callerStatus != null && callerStatus >= 500 ? callerStatus : null
    );
  }

  switch (input.subsystem) {
    case "auth":
      if (callerStatus != null && callerStatus >= 500) {
        return recorded(routeTemplate, "auth", "auth_server_failure", callerStatus);
      }
      return { record: false };
    case "stream":
      if (callerStatus != null && callerStatus >= 500) {
        return recorded(routeTemplate, "stream", `http_${callerStatus}`, callerStatus);
      }
      return recorded(routeTemplate, "stream", "sse_pipeline", null);
    case "db":
    case "http":
      if (callerStatus != null && callerStatus >= 500) {
        return recorded(routeTemplate, "http", `http_${callerStatus}`, callerStatus);
      }
      return { record: false };
    default: {
      const _exhaustive: never = input.subsystem;
      void _exhaustive;
      return { record: false };
    }
  }
}

export function ensureOpsRequestIncidentsSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ops_request_incidents (
      signature TEXT PRIMARY KEY,
      route_template TEXT NOT NULL,
      subsystem TEXT NOT NULL,
      http_status INTEGER,
      error_class TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      occurrence_count INTEGER NOT NULL,
      first_deployment_sha TEXT NOT NULL DEFAULT '',
      latest_deployment_sha TEXT NOT NULL DEFAULT ''
    );
  `);
}

export function listOpsRequestIncidentRows(db: Database.Database): OpsRequestIncidentRow[] {
  ensureOpsRequestIncidentsSchema(db);
  return db
    .prepare(
      `SELECT signature, route_template, subsystem, http_status, error_class,
              first_seen_at, last_seen_at, occurrence_count,
              first_deployment_sha, latest_deployment_sha
         FROM ops_request_incidents
        ORDER BY last_seen_at DESC, signature ASC
        LIMIT 100`
    )
    .all() as OpsRequestIncidentRow[];
}

export function observeProductionRequestIncident(
  db: Database.Database,
  input: ProductionRequestIncidentInput,
  now: Date = new Date()
): void {
  if (observeDepth > 0) return;
  observeDepth += 1;
  try {
    const decision = classifyProductionRequestIncident(input);
    if (!decision.record) return;
    const seenAt = Number.isFinite(now.getTime()) ? now.toISOString() : new Date().toISOString();
    ensureOpsRequestIncidentsSchema(db);
    db.prepare(UPSERT_SQL).run({
      signature: decision.signature,
      route_template: decision.routeTemplate,
      subsystem: decision.subsystem,
      http_status: decision.httpStatus,
      error_class: decision.errorClass,
      seen_at: seenAt,
      deployment_sha: readRailwayDeploymentSha(),
    });
  } catch {
    // The original request result stays unchanged when observation fails.
  } finally {
    observeDepth -= 1;
  }
}

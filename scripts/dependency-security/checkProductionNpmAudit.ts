import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type NpmAuditAdvisory = {
  source?: number;
  name?: string;
  dependency?: string;
  title?: string;
  url?: string;
  severity?: string;
  range?: string;
};

export type NpmAuditVulnerability = {
  name: string;
  severity: string;
  via: Array<string | NpmAuditAdvisory>;
};

export type NpmAuditReport = {
  auditReportVersion?: number;
  vulnerabilities?: Record<string, NpmAuditVulnerability>;
  metadata?: {
    vulnerabilities?: {
      critical?: number;
      high?: number;
      moderate?: number;
      low?: number;
      total?: number;
    };
  };
};

export type BaselineEntry = {
  id: string;
  source?: number;
  package?: string;
  url?: string;
  vulnerableRange?: string;
  note?: string;
};

export type ProductionAuditBaseline = {
  version: number;
  acceptedHigh: BaselineEntry[];
};

export type ParsedAdvisory = {
  id: string;
  source?: number;
  package: string;
  severity: string;
  url?: string;
  title?: string;
  range?: string;
};

export type CheckResult = {
  ok: boolean;
  exitCode: number;
  summary: {
    critical: number;
    high: number;
    moderate: number;
    low: number;
    newCritical: ParsedAdvisory[];
    newHigh: ParsedAdvisory[];
    staleBaseline: BaselineEntry[];
    reportedModerate: ParsedAdvisory[];
    reportedLow: ParsedAdvisory[];
  };
  messages: string[];
};

const GHSA_PATTERN = /GHSA-[a-z0-9-]+/i;

export function advisoryIdFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const match = url.match(GHSA_PATTERN);
  return match ? match[0].toUpperCase() : null;
}

export function advisoryIdentity(advisory: NpmAuditAdvisory, packageName: string): string {
  const fromUrl = advisoryIdFromUrl(advisory.url);
  if (fromUrl) return fromUrl;
  if (advisory.source != null) return `npm-advisory:${advisory.source}`;
  throw new Error(
    `Cannot identify advisory for package ${packageName}: missing GHSA URL and npm advisory source`
  );
}

export function parseAuditReport(raw: unknown): NpmAuditReport {
  if (raw == null || typeof raw !== "object") {
    throw new Error("npm audit output is not a JSON object");
  }
  const report = raw as NpmAuditReport;
  if (report.auditReportVersion == null) {
    throw new Error("npm audit output missing auditReportVersion");
  }
  if (report.vulnerabilities == null || typeof report.vulnerabilities !== "object") {
    throw new Error("npm audit output missing vulnerabilities object");
  }
  return report;
}

export function extractProductionAdvisories(report: NpmAuditReport): ParsedAdvisory[] {
  const advisories: ParsedAdvisory[] = [];
  const seen = new Set<string>();

  for (const [packageName, entry] of Object.entries(report.vulnerabilities ?? {})) {
    for (const via of entry.via ?? []) {
      if (typeof via === "string") continue;
      const severity = (via.severity ?? entry.severity ?? "").toLowerCase();
      if (!severity) continue;

      const id = advisoryIdentity(via, packageName);
      const key = `${id}:${packageName}:${severity}`;
      if (seen.has(key)) continue;
      seen.add(key);

      advisories.push({
        id,
        source: via.source,
        package: packageName,
        severity,
        url: via.url,
        title: via.title,
        range: via.range,
      });
    }
  }

  return advisories;
}

export function loadBaseline(raw: unknown): ProductionAuditBaseline {
  if (raw == null || typeof raw !== "object") {
    throw new Error("baseline is not a JSON object");
  }
  const baseline = raw as ProductionAuditBaseline;
  if (!Array.isArray(baseline.acceptedHigh)) {
    throw new Error("baseline missing acceptedHigh array");
  }
  for (const entry of baseline.acceptedHigh) {
    if (!entry.id || typeof entry.id !== "string") {
      throw new Error("baseline entry missing stable id");
    }
  }
  return baseline;
}

export function checkProductionNpmAudit(
  report: NpmAuditReport,
  baseline: ProductionAuditBaseline
): CheckResult {
  const advisories = extractProductionAdvisories(report);
  const acceptedIds = new Set(baseline.acceptedHigh.map((entry) => entry.id.toUpperCase()));
  const presentHighIds = new Set(
    advisories.filter((adv) => adv.severity === "high").map((adv) => adv.id.toUpperCase())
  );

  const newCritical = advisories.filter((adv) => adv.severity === "critical");
  const newHigh = advisories.filter(
    (adv) => adv.severity === "high" && !acceptedIds.has(adv.id.toUpperCase())
  );
  const staleBaseline = baseline.acceptedHigh.filter(
    (entry) => !presentHighIds.has(entry.id.toUpperCase())
  );
  const reportedModerate = advisories.filter((adv) => adv.severity === "moderate");
  const reportedLow = advisories.filter((adv) => adv.severity === "low");

  const messages: string[] = [];
  messages.push(
    `Production npm audit: critical=${newCritical.length} high=${advisories.filter((a) => a.severity === "high").length} moderate=${reportedModerate.length} low=${reportedLow.length}`
  );

  if (newCritical.length > 0) {
    for (const adv of newCritical) {
      messages.push(`NEW CRITICAL: ${adv.id} (${adv.package}) ${adv.url ?? ""}`.trim());
    }
  }

  if (newHigh.length > 0) {
    for (const adv of newHigh) {
      messages.push(`NEW HIGH: ${adv.id} (${adv.package}) ${adv.url ?? ""}`.trim());
    }
  }

  if (staleBaseline.length > 0) {
    for (const entry of staleBaseline) {
      messages.push(`STALE BASELINE (removable): ${entry.id} (${entry.package ?? "unknown"})`);
    }
  }

  if (reportedModerate.length > 0) {
    messages.push(`REPORT moderate (${reportedModerate.length}): ${reportedModerate.map((a) => a.id).join(", ")}`);
  }

  if (reportedLow.length > 0) {
    messages.push(`REPORT low (${reportedLow.length}): ${reportedLow.map((a) => a.id).join(", ")}`);
  }

  const ok = newCritical.length === 0 && newHigh.length === 0;
  if (ok) {
    messages.push("PASS: no new production Critical/High advisories beyond baseline");
  } else {
    messages.push("FAIL: new production Critical/High advisories detected");
  }

  return {
    ok,
    exitCode: ok ? 0 : 1,
    summary: {
      critical: newCritical.length,
      high: advisories.filter((a) => a.severity === "high").length,
      moderate: reportedModerate.length,
      low: reportedLow.length,
      newCritical,
      newHigh,
      staleBaseline,
      reportedModerate,
      reportedLow,
    },
    messages,
  };
}

export function runCheckFromFiles(auditJsonPath: string, baselineJsonPath: string): CheckResult {
  let auditRaw: unknown;
  let baselineRaw: unknown;

  try {
    auditRaw = JSON.parse(readFileSync(auditJsonPath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read audit JSON (${auditJsonPath}): ${String(error)}`);
  }

  try {
    baselineRaw = JSON.parse(readFileSync(baselineJsonPath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read baseline JSON (${baselineJsonPath}): ${String(error)}`);
  }

  const report = parseAuditReport(auditRaw);
  const baseline = loadBaseline(baselineRaw);
  return checkProductionNpmAudit(report, baseline);
}

function main(): void {
  const auditPath = process.argv[2] ?? "/dev/stdin";
  const baselinePath =
    process.argv[3] ??
    resolve(dirname(fileURLToPath(import.meta.url)), "production-audit-baseline.json");

  try {
    const result = runCheckFromFiles(auditPath, baselinePath);
    for (const line of result.messages) {
      console.log(line);
    }
    process.exit(result.exitCode);
  } catch (error) {
    console.error(`FAIL CLOSED: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

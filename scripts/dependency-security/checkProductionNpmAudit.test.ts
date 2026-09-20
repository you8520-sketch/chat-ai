import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  checkProductionNpmAudit,
  loadBaseline,
  parseAuditReport,
  runCheckFromFiles,
} from "./checkProductionNpmAudit.ts";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const BASELINE_PATH = join(dirname(fileURLToPath(import.meta.url)), "production-audit-baseline.json");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8"));
}

describe("checkProductionNpmAudit", () => {
  const baseline = loadBaseline(JSON.parse(readFileSync(BASELINE_PATH, "utf8")));

  it("passes when only known baseline high advisories are present", () => {
    const report = parseAuditReport(loadFixture("baseline-high-only.json"));
    const result = checkProductionNpmAudit(report, baseline);
    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
    assert.equal(result.summary.newCritical.length, 0);
    assert.equal(result.summary.newHigh.length, 0);
  });

  it("fails when a new high advisory appears", () => {
    const report = parseAuditReport(loadFixture("new-high.json"));
    const result = checkProductionNpmAudit(report, baseline);
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 1);
    assert.equal(result.summary.newHigh.length, 1);
    assert.equal(result.summary.newHigh[0]?.id, "GHSA-NEWHIGH-AAAA-BBBB");
  });

  it("fails when a new critical advisory appears", () => {
    const report = parseAuditReport(loadFixture("new-critical.json"));
    const result = checkProductionNpmAudit(report, baseline);
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 1);
    assert.equal(result.summary.newCritical.length, 1);
    assert.equal(result.summary.newCritical[0]?.id, "GHSA-2XP9-VWfh-VXW4".toUpperCase());
  });

  it("passes with stale baseline notice when a baselined high disappears", () => {
    const report = parseAuditReport(loadFixture("baseline-removed.json"));
    const result = checkProductionNpmAudit(report, baseline);
    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
    assert.ok(result.summary.staleBaseline.length >= 2);
    assert.ok(result.messages.some((line) => line.includes("STALE BASELINE")));
  });

  it("passes when only moderate advisories are present", () => {
    const report = parseAuditReport(loadFixture("moderate-only.json"));
    const result = checkProductionNpmAudit(report, baseline);
    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
    assert.equal(result.summary.reportedModerate.length, 1);
    assert.equal(result.summary.newHigh.length, 0);
  });

  it("fails closed on invalid audit JSON shape", () => {
    assert.throws(() => parseAuditReport({}), /missing auditReportVersion/);
    assert.throws(() => parseAuditReport({ auditReportVersion: 2 }), /missing vulnerabilities/);
  });

  it("fails closed when runCheckFromFiles receives malformed audit JSON", () => {
    assert.throws(
      () => runCheckFromFiles(join(FIXTURE_DIR, "invalid-audit.json"), BASELINE_PATH),
      /Failed to read audit JSON/
    );
  });
});

/**
 * PRECALL-only report emitter. Never POSTs to a paid provider.
 */
import { writeFileSync } from "node:fs";

import {
  RP_QUALITY_PRECALL_PAID_STATUS,
  artifactContainsSecret,
  buildRpQualityPrecallReport,
  startRpQualityPrecallPaidExecution,
} from "../src/lib/rpQualityPrecall";

const report = buildRpQualityPrecallReport();
const denied = startRpQualityPrecallPaidExecution();
if (report.liveProof.status !== "NOT_PROVIDED") {
  throw new Error("default PRECALL report must fail-close without injected live proof");
}
if (report.classification !== "NOT_REPRODUCIBLE" || report.precallReady) {
  throw new Error("default PRECALL report must stay NOT_REPRODUCIBLE");
}

if (report.providerPosts !== 0) {
  throw new Error("PRECALL report claimed a provider POST");
}
if (denied.providerPosts !== 0 || denied.started) {
  throw new Error("PRECALL start gate issued a provider POST");
}
if (artifactContainsSecret(report)) {
  throw new Error("PRECALL report contained a secret-shaped value");
}

const payload = {
  paidExecutionStatus: RP_QUALITY_PRECALL_PAID_STATUS,
  providerPosts: 0,
  startDenied: denied,
  report,
};

if (process.argv.includes("--write-artifact")) {
  writeFileSync(
    "/opt/cursor/artifacts/rp-quality-precall-report.json",
    JSON.stringify(payload, null, 2),
    "utf8"
  );
}

process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);

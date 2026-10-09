import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  OPENSCALE_KEY_ENV,
  redactSecretText,
  runOpenScaleRpPilot,
} from "./lib/openscaleDeepseekV41FlashRpPilot";

async function main() {
  const outputDir =
    process.env.OPENSCALE_RP_PILOT_OUTPUT_DIR?.trim() ||
    "output/openscale-deepseek-v41-flash-rp-pilot";
  const report = await runOpenScaleRpPilot();
  let json = JSON.stringify(
    {
      ...report,
      executedSourceSha: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      auditMainSha: execFileSync("git", ["rev-parse", "origin/main"], {
        encoding: "utf8",
      }).trim(),
      sourceTreeDirty: Boolean(
        execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()
      ),
    },
    null,
    2
  );
  const secrets = [process.env[OPENSCALE_KEY_ENV] ?? ""];
  json = redactSecretText(json, secrets);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, "report.json"), `${json}\n`, "utf8");
  const status = typeof report.status === "string" ? report.status : "UNKNOWN";
  writeFileSync(
    join(outputDir, "README.md"),
    `# OpenScale DeepSeek V4.1 Flash RP pilot\n\nStatus: **${status}**\n\nProvider inference POSTs: ${String(report.providerInferencePosts)}. Production route changes: 0.\n\nThis local artifact is not committed. The sanitized audit report lives under docs/audits/openscale-deepseek-v41-flash-rp-pilot-2026-10-09/.\n`,
    "utf8"
  );
  console.log(
    JSON.stringify({
      status,
      providerInferencePosts: report.providerInferencePosts,
      stopReason: report.stopReason ?? null,
      outputDir,
    })
  );
  if (status === "PREVALIDATION_FAILED" || status === "LIVE_FAILED") {
    process.exitCode = 1;
  }
}

main().catch(() => {
  console.error(
    JSON.stringify({
      status: "LIVE_FAILED",
      providerInferencePosts: null,
      reason: "contract_or_transport_error",
    })
  );
  process.exitCode = 1;
});

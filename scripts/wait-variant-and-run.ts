/**
 * Wait for Railway canary variant to match, then run audit harness.
 * Usage: EXPECTED_VARIANT=ds_display_grouping_bypass VARIANT_LABEL=... OUT_DIR=... MAX_WAIT_MS=900000 node --import tsx scripts/wait-variant-and-run.ts
 */
import { execSync } from "node:child_process";

const EXPECTED = process.env.EXPECTED_VARIANT!;
const MAX_WAIT = Number(process.env.MAX_WAIT_MS ?? "900000");
const INTERVAL = Number(process.env.POLL_MS ?? "30000");

if (!EXPECTED) {
  console.error("EXPECTED_VARIANT required");
  process.exit(1);
}

const start = Date.now();
while (Date.now() - start < MAX_WAIT) {
  try {
    execSync(`node --import tsx scripts/probe-canary-variant.ts`, {
      stdio: "pipe",
      env: { ...process.env, EXPECTED_VARIANT: EXPECTED },
    });
    console.log(`variant ${EXPECTED} ready — starting harness`);
    execSync(`node --import tsx scripts/deepseek-common-root-audit.ts`, {
      stdio: "inherit",
      env: {
        ...process.env,
        EXPECTED_VARIANT: EXPECTED,
        VARIANT_LABEL: process.env.VARIANT_LABEL ?? EXPECTED,
        RUNS: process.env.RUNS ?? "2",
        MAX_TURNS: process.env.MAX_TURNS ?? "2",
        MODEL_UI: "deepseek-v4-pro",
      },
    });
    process.exit(0);
  } catch (err) {
    let current: string | null = null;
    try {
      const out = execSync(`node --import tsx scripts/probe-canary-variant.ts`, {
        stdio: "pipe",
        env: { ...process.env, EXPECTED_VARIANT: EXPECTED },
      }).toString();
      const parsed = JSON.parse(out) as { variant?: string | null };
      current = parsed.variant ?? null;
    } catch (probeErr) {
      const msg =
        probeErr instanceof Error && "stdout" in probeErr
          ? String((probeErr as { stdout?: Buffer }).stdout ?? "")
          : "";
      try {
        const parsed = JSON.parse(msg) as { variant?: string | null };
        current = parsed.variant ?? null;
      } catch {
        current = null;
      }
    }
    console.log(
      `waiting for variant ${EXPECTED} (current=${current ?? "unknown"})... (${Math.round((Date.now() - start) / 1000)}s)`
    );
    execSync(`sleep ${Math.ceil(INTERVAL / 1000)}`);
  }
}
console.error(`TIMEOUT waiting for variant ${EXPECTED}`);
process.exit(2);

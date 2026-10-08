/**
 * Default paid-runner CLI. Always PREPARE.
 * First import is the PRECALL egress guard. This process cannot POST.
 */
import "./lib/rpQualityPrecallEgressGuard";

import { precallEgressAttempts, precallUnexpectedEgressAttempts } from "./lib/rpQualityPrecallEgressGuard";
import {
  RP_QUALITY_PAID_RUNNER_DEFAULT_MODE,
  paidRunnerRegistrySnapshot,
  paidRunnerSoftAimUncapped,
} from "@/lib/rpQualityPaidRunner";

const unauthorized = process.argv.includes("--authorized") || process.argv.includes("--execute");

process.stdout.write(
  `${JSON.stringify(
    {
      ok: !unauthorized,
      mode: RP_QUALITY_PAID_RUNNER_DEFAULT_MODE,
      providerPosts: 0,
      networkAttempts: 0,
      dbWrites: 0,
      sealed: false,
      reason: unauthorized ? "WRONG_ENTRYPOINT_USE_AUTHORIZED_CLI" : "PREPARE_DEFAULT_NO_NETWORK",
      registry: paidRunnerRegistrySnapshot(),
      length: paidRunnerSoftAimUncapped(),
      egress: {
        attemptsBlocked: precallEgressAttempts().length,
        unexpectedAttempts: precallUnexpectedEgressAttempts().length,
      },
    },
    null,
    2
  )}\n`
);
if (unauthorized) process.exitCode = 2;

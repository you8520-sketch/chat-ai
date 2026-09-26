/**
 * Regular-test egress policy owner (canonical).
 *
 * Loaded via `--import` by the canonical regular-test command so every test
 * process starts from the same credential posture as keyless CI:
 *
 * - Default (regular tests): ambient paid-provider credentials are removed
 *   before any test file loads. Background/scheduler paths then fail closed
 *   with the same NO_*_KEY errors as keyless CI — no paid egress, no
 *   behavior fork between key-bearing developer VMs and CI.
 * - Explicit live opt-in (`REGULAR_TEST_REAL_PROVIDER_CALLS=1`): credentials
 *   are kept for manual live probes (which additionally require their
 *   probe-specific flag and the benchmark-only credential).
 *
 * Production blast radius is zero: production never loads this module, and
 * no resolver/transport/scheduler/billing code is touched. Tests that need
 * credentials set explicit fixture keys themselves (exactly like keyless CI
 * expects); stubbed transports never reach the network either way.
 *
 * No app imports — environment only, so `--import` ordering is safe.
 */
const LIVE_OPT_IN = process.env.REGULAR_TEST_REAL_PROVIDER_CALLS === "1";

if (!LIVE_OPT_IN) {
  delete process.env.CHEAPER_INFERENCE_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENAI_API_KEY;
}

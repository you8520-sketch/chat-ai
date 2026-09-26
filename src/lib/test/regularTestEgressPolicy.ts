/**
 * Regular-test egress policy owner (canonical).
 *
 * Loaded via `--import` by `npm run test:regular` so every test process starts
 * from the same credential posture as keyless CI:
 *
 * - Production paid-provider credentials
 *   (`CHEAPER_INFERENCE_API_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`)
 *   are ALWAYS removed when this module loads — including when
 *   `REGULAR_TEST_REAL_PROVIDER_CALLS=1`. That flag only gates manual live-probe
 *   eligibility (together with a probe-specific flag and
 *   `CHEAPER_INFERENCE_BENCHMARK_API_KEY`); it never unlocks production keys.
 * - The benchmark-only credential is left untouched.
 *
 * Production blast radius is zero: production never loads this module, and
 * no resolver/transport/scheduler/billing code is touched. Tests that need
 * credentials set explicit fixture keys themselves (exactly like keyless CI
 * expects); stubbed transports never reach the network either way.
 *
 * No app imports — environment only, so `--import` ordering is safe.
 */
delete process.env.CHEAPER_INFERENCE_API_KEY;
delete process.env.OPENROUTER_API_KEY;
delete process.env.OPENAI_API_KEY;

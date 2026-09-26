/**
 * Subprocess child for regularTestEgressPolicy matrix D/E/F.
 * Prints env + resolveOptInTestCheaperInferenceApiKey after policy --import.
 * Zero network — env/resolver only.
 */
import { resolveOptInTestCheaperInferenceApiKey } from "../../../scripts/lib/benchmarkCheaperInferenceCredential";

const probeFlag = process.env.__MATRIX_PROBE_FLAG ?? "REAL_TRPG_GM_PROVIDER_PROBE";

console.log(
  JSON.stringify({
    ci: process.env.CHEAPER_INFERENCE_API_KEY ?? null,
    or: process.env.OPENROUTER_API_KEY ?? null,
    oai: process.env.OPENAI_API_KEY ?? null,
    bench: process.env.CHEAPER_INFERENCE_BENCHMARK_API_KEY ?? null,
    resolved: resolveOptInTestCheaperInferenceApiKey(probeFlag),
  })
);

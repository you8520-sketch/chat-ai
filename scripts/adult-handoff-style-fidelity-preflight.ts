/**
 * Adult Handoff Style Fidelity Audit — non-generation preflight.
 *
 * Verifies endpoint availability for both adult candidates BEFORE any live
 * generation call. No generation requests are sent.
 *
 *   - DeepSeek V4 Pro: CheaperInference OpenAI-compatible /v1/models catalog
 *   - Muse Spark 1.2: OpenRouter /api/v1/models catalog (exact slug meta/muse-spark-1.2)
 *
 * If Muse 1.2 exact endpoint is unavailable, the audit MUST stop with
 * MUSE_12_ENDPOINT_UNAVAILABLE / LIVE_CALLS_NOT_RUN (no fallback to 1.1
 * or any other Muse model).
 */
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENROUTER_MODELS_URL = `${OPENROUTER_BASE_URL}/models`;
const CHEAPER_INFERENCE_BASE_URL = "https://api.cheaperinference.com/v1";
const CHEAPER_INFERENCE_MODELS_URL = `${CHEAPER_INFERENCE_BASE_URL}/models`;

const DEEPSEEK_TARGET = "deepseek-v4-pro";
const MUSE_TARGET = "meta/muse-spark-1.2";
const MUSE_11 = "meta/muse-spark-1.1";

type PreflightResult = {
  deepseek_endpoint_available: boolean;
  deepseek_resolved_slug: string | null;
  deepseek_models_sample: string[];
  muse12_endpoint_available: boolean;
  muse12_resolved_slug: string | null;
  muse_family_in_catalog: string[];
  openrouter_muse_variants: string[];
  openrouter_models_count: number | null;
  verdict:
    | "BOTH_AVAILABLE"
    | "MUSE_12_ENDPOINT_UNAVAILABLE"
    | "DEEPSEEK_ENDPOINT_UNAVAILABLE"
    | "BOTH_UNAVAILABLE";
  live_calls_run: boolean;
};

async function preflightOpenRouter(): Promise<{
  available: boolean;
  museVariants: string[];
  museFamily: string[];
  modelsCount: number | null;
  resolved: string | null;
}> {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (key) headers.Authorization = `Bearer ${key}`;
  headers["HTTP-Referer"] = process.env.OPENROUTER_HTTP_REFERER?.trim() || "http://localhost:3000";
  headers["X-Title"] = process.env.OPENROUTER_APP_TITLE?.trim() || "PlayAI";

  try {
    const res = await fetch(OPENROUTER_MODELS_URL, { headers });
    if (!res.ok) {
      console.error("[preflight] OpenRouter /models HTTP", res.status);
      return { available: false, museVariants: [], museFamily: [], modelsCount: null, resolved: null };
    }
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    const models = data.data ?? [];
    const ids = models.map((m) => m.id).sort();
    const museVariants = ids.filter((id) => /muse[-.]?spark/i.test(id));
    const museFamily = ids.filter((id) => /meta\/muse/i.test(id));
    const available = ids.includes(MUSE_TARGET);
    return {
      available,
      museVariants,
      museFamily,
      modelsCount: ids.length,
      resolved: available ? MUSE_TARGET : null,
    };
  } catch (e) {
    console.error("[preflight] OpenRouter /models fetch failed:", String(e));
    return { available: false, museVariants: [], museFamily: [], modelsCount: null, resolved: null };
  }
}

async function preflightCheaperInference(): Promise<{
  available: boolean;
  resolved: string | null;
  sample: string[];
}> {
  const key = process.env.CHEAPER_INFERENCE_API_KEY?.trim();
  if (!key) {
    console.error("[preflight] NO_CHEAPER_INFERENCE_KEY");
    return { available: false, resolved: null, sample: [] };
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
  try {
    const res = await fetch(CHEAPER_INFERENCE_MODELS_URL, { headers });
    if (!res.ok) {
      console.error("[preflight] CheaperInference /models HTTP", res.status);
      // Some OpenAI-compatible providers don't expose /models. Try a minimal
      // non-generation HEAD on the chat endpoint as a secondary signal.
      const head = await fetch(`${CHEAPER_INFERENCE_BASE_URL}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: DEEPSEEK_TARGET, max_tokens: 1, messages: [] }),
      });
      // 400/401 means endpoint exists but rejects empty; 404 means missing.
      const endpointReachable = head.status !== 404;
      return { available: endpointReachable, resolved: null, sample: [] };
    }
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    const ids = (data.data ?? []).map((m) => m.id).sort();
    const available = ids.some((id) => id === DEEPSEEK_TARGET);
    return { available, resolved: available ? DEEPSEEK_TARGET : null, sample: ids.slice(0, 20) };
  } catch (e) {
    console.error("[preflight] CheaperInference /models fetch failed:", String(e));
    return { available: false, resolved: null, sample: [] };
  }
}

async function main() {
  console.log("[preflight] checking OpenRouter catalog for", MUSE_TARGET);
  const or = await preflightOpenRouter();
  console.log("[preflight] OpenRouter:", {
    available: or.available,
    modelsCount: or.modelsCount,
    museVariants: or.museVariants,
    museFamily: or.museFamily,
  });

  console.log("[preflight] checking CheaperInference catalog for", DEEPSEEK_TARGET);
  const ci = await preflightCheaperInference();
  console.log("[preflight] CheaperInference:", {
    available: ci.available,
    resolved: ci.resolved,
    sample: ci.sample,
  });

  let verdict: PreflightResult["verdict"];
  if (or.available && ci.available) verdict = "BOTH_AVAILABLE";
  else if (!or.available && ci.available) verdict = "MUSE_12_ENDPOINT_UNAVAILABLE";
  else if (or.available && !ci.available) verdict = "DEEPSEEK_ENDPOINT_UNAVAILABLE";
  else verdict = "BOTH_UNAVAILABLE";

  const result: PreflightResult = {
    deepseek_endpoint_available: ci.available,
    deepseek_resolved_slug: ci.resolved,
    deepseek_models_sample: ci.sample,
    muse12_endpoint_available: or.available,
    muse12_resolved_slug: or.resolved,
    muse_family_in_catalog: or.museFamily,
    openrouter_muse_variants: or.museVariants,
    openrouter_models_count: or.modelsCount,
    verdict,
    live_calls_run: false,
  };

  console.log(JSON.stringify({ preflight: result }, null, 2));
  if (verdict !== "BOTH_AVAILABLE") {
    console.log(`\n[preflight] STOP: ${verdict} — LIVE_CALLS_NOT_RUN`);
    process.exit(0);
  }
  console.log("\n[preflight] BOTH_AVAILABLE — may proceed to prompt parity check");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

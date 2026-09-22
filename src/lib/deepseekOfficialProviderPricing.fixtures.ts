/**
 * Deterministic DeepSeek official pricing page fixtures (Phase B1).
 * Source shape mirrors https://api-docs.deepseek.com/quick_start/pricing/
 */

function pricingTableBody(params: {
  flashPeak: { cacheHit: string; cacheMiss: string; output: string };
  flashOffPeak: { cacheHit: string; cacheMiss: string; output: string };
  proPeak: { cacheHit: string; cacheMiss: string; output: string };
  proOffPeak: { cacheHit: string; cacheMiss: string; output: string };
  flashModelId?: string;
  proModelId?: string;
  flashVersion?: string;
  proVersion?: string;
}): string {
  const flashModelId = params.flashModelId ?? "deepseek-flash";
  const proModelId = params.proModelId ?? "deepseek-v4-pro";
  const flashVersion = params.flashVersion ?? "DeepSeek-V4.1-Flash";
  const proVersion = params.proVersion ?? "DeepSeek-V4-Pro-0813";
  return `<div style="font-size:14px"><b><table style="text-align:center">
<tr><td colspan="3" style="text-align:center">MODEL</td><td>${flashModelId}<sup>(1)</sup></td><td>${proModelId}</td></tr>
<tr><td colspan="3">MODEL VERSION</td><td>${flashVersion}</td><td>${proVersion}</td></tr>
<tr><td rowspan="6">PRICING<sup>(2)</sup></td><td rowspan="2">1M INPUT TOKENS<br>(CACHE HIT)</td><td>OFF-PEAK</td><td>${params.flashOffPeak.cacheHit}</td><td>${params.proOffPeak.cacheHit}</td></tr>
<tr><td>PEAK</td><td>${params.flashPeak.cacheHit}</td><td>${params.proPeak.cacheHit}</td></tr>
<tr><td rowspan="2">1M INPUT TOKENS<br>(CACHE MISS)</td><td>OFF-PEAK</td><td>${params.flashOffPeak.cacheMiss}</td><td>${params.proOffPeak.cacheMiss}</td></tr>
<tr><td>PEAK</td><td>${params.flashPeak.cacheMiss}</td><td>${params.proPeak.cacheMiss}</td></tr>
<tr><td rowspan="2">1M OUTPUT TOKENS</td><td>OFF-PEAK</td><td>${params.flashOffPeak.output}</td><td>${params.proOffPeak.output}</td></tr>
<tr><td>PEAK</td><td>${params.flashPeak.output}</td><td>${params.proPeak.output}</td></tr>
</table></b></div>`;
}

/** P1 — current official V4 Pro PEAK/OFF-PEAK (live docs contract). */
export const DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P1 = pricingTableBody({
  flashPeak: { cacheHit: "$0.006", cacheMiss: "$0.3", output: "$1.2" },
  flashOffPeak: { cacheHit: "$0.003", cacheMiss: "$0.15", output: "$0.6" },
  proPeak: { cacheHit: "$0.044", cacheMiss: "$1.32", output: "$3.96" },
  proOffPeak: { cacheHit: "$0.022", cacheMiss: "$0.66", output: "$1.98" },
});

/** P2 — PEAK changed; OFF-PEAK unchanged. */
export const DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P2 = pricingTableBody({
  flashPeak: { cacheHit: "$0.006", cacheMiss: "$0.3", output: "$1.2" },
  flashOffPeak: { cacheHit: "$0.003", cacheMiss: "$0.15", output: "$0.6" },
  proPeak: { cacheHit: "$0.05", cacheMiss: "$1.5", output: "$4.5" },
  proOffPeak: { cacheHit: "$0.022", cacheMiss: "$0.66", output: "$1.98" },
});

/** P3 — OFF-PEAK only changed; PEAK unchanged. */
export const DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P3 = pricingTableBody({
  flashPeak: { cacheHit: "$0.006", cacheMiss: "$0.3", output: "$1.2" },
  flashOffPeak: { cacheHit: "$0.003", cacheMiss: "$0.15", output: "$0.6" },
  proPeak: { cacheHit: "$0.044", cacheMiss: "$1.32", output: "$3.96" },
  proOffPeak: { cacheHit: "$0.01", cacheMiss: "$0.33", output: "$0.99" },
});

/** P4 — malformed official source (no pricing table). */
export const DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P4 = `<html><body><h1>Pricing unavailable</h1></body></html>`;

/** P5 — missing cache-hit row for V4 Pro (no synthetic fallback). */
export const DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P5 = `<div style="font-size:14px"><b><table style="text-align:center">
<tr><td colspan="3">MODEL</td><td>deepseek-flash</td><td>deepseek-v4-pro</td></tr>
<tr><td colspan="3">MODEL VERSION</td><td>DeepSeek-V4.1-Flash</td><td>DeepSeek-V4-Pro-0813</td></tr>
<tr><td rowspan="4">PRICING</td><td rowspan="2">1M INPUT TOKENS<br>(CACHE MISS)</td><td>OFF-PEAK</td><td>$0.15</td><td>$0.66</td></tr>
<tr><td>PEAK</td><td>$0.3</td><td>$1.32</td></tr>
<tr><td rowspan="2">1M OUTPUT TOKENS</td><td>OFF-PEAK</td><td>$0.6</td><td>$1.98</td></tr>
<tr><td>PEAK</td><td>$1.2</td><td>$3.96</td></tr>
</table></b></div>`;

/** Markup-tolerant variant — tbody, classes, th cells, no inline table style. */
export const DEEPSEEK_OFFICIAL_PRICING_FIXTURE_MARKUP_VARIANT = `<div class="pricing-doc">
<table class="model-pricing-table">
<tbody>
<tr><th colspan="3">MODEL</th><th>deepseek-flash<sup>(1)</sup></th><th>deepseek-v4-pro</th></tr>
<tr><td colspan="3">MODEL VERSION</td><td>DeepSeek-V4.1-Flash</td><td>DeepSeek-V4-Pro-0813</td></tr>
<tr class="pricing-row"><td rowspan="6">PRICING<sup>(2)</sup></td><td rowspan="2">1M INPUT TOKENS (CACHE HIT)</td><td>OFF-PEAK</td><td>$0.003</td><td>$0.022</td></tr>
<tr><td>PEAK</td><td>$0.006</td><td>$0.044</td></tr>
<tr><td rowspan="2">1M INPUT TOKENS (CACHE MISS)</td><td>OFF-PEAK</td><td>$0.15</td><td>$0.66</td></tr>
<tr><td>PEAK</td><td>$0.3</td><td>$1.32</td></tr>
<tr><td rowspan="2">1M OUTPUT TOKENS</td><td>OFF-PEAK</td><td>$0.6</td><td>$1.98</td></tr>
<tr><td>PEAK</td><td>$1.2</td><td>$3.96</td></tr>
</tbody>
</table>
</div>`;

/** P6 — unknown official model identity (version label mismatch). */
export const DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P6 = pricingTableBody({
  flashPeak: { cacheHit: "$0.006", cacheMiss: "$0.3", output: "$1.2" },
  flashOffPeak: { cacheHit: "$0.003", cacheMiss: "$0.15", output: "$0.6" },
  proPeak: { cacheHit: "$0.044", cacheMiss: "$1.32", output: "$3.96" },
  proOffPeak: { cacheHit: "$0.022", cacheMiss: "$0.66", output: "$1.98" },
  proVersion: "DeepSeek-V4-Pro-UNKNOWN",
});

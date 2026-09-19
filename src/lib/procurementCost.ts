/**
 * Canonical CheaperInference procurement-cost owner (admin/shadow only).
 * CI current/effective rates = normal procurement cost — never site promotion.
 */

import { convertUsdToKrw } from "@/lib/exchangeRate";
import {
  resolveCatalogRatesForPrompt,
  resolveCheaperInferenceCatalogPricing,
  type CheaperInferenceCatalogPricing,
  type ResolvedCatalogRates,
} from "@/lib/cheaperInferenceCatalogPricing";

export type ProcurementCostSnapshot = {
  procurementCostUsd: number;
  procurementCostKrw: number;
  /** CI reference list cost (undiscounted) — informational only */
  providerListCostUsd: number;
  providerListCostKrw: number;
  discountPercent: number | null;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  referenceInputUsdPerMillion: number | null;
  referenceOutputUsdPerMillion: number | null;
};

function usageUsdFromResolvedRates(
  rates: ResolvedCatalogRates,
  promptTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0
): number {
  const prompt = Math.max(0, promptTokens);
  const output = Math.max(0, outputTokens);
  const cacheRead = Math.min(Math.max(0, cacheReadTokens), prompt);
  const cacheWrite = Math.min(Math.max(0, cacheWriteTokens), Math.max(0, prompt - cacheRead));
  const standardInput = Math.max(0, prompt - cacheRead - cacheWrite);
  const readRate = rates.cacheReadUsdPerMillion ?? rates.inputUsdPerMillion;
  const writeRate = rates.cacheWriteUsdPerMillion ?? rates.inputUsdPerMillion;
  return (
    (standardInput / 1_000_000) * rates.inputUsdPerMillion +
    (cacheRead / 1_000_000) * readRate +
    (cacheWrite / 1_000_000) * writeRate +
    (output / 1_000_000) * rates.outputUsdPerMillion
  );
}

function usageUsdFromCurrentRates(
  catalog: CheaperInferenceCatalogPricing,
  promptTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0
): number {
  const rates = resolveCatalogRatesForPrompt(catalog, promptTokens);
  return usageUsdFromResolvedRates(
    rates,
    promptTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens
  );
}

function usageUsdFromReferenceRates(
  catalog: CheaperInferenceCatalogPricing,
  promptTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0
): number | null {
  const rates = resolveCatalogRatesForPrompt(catalog, promptTokens);
  const inputRef = rates.referenceInputUsdPerMillion ?? rates.inputUsdPerMillion;
  const outputRef = rates.referenceOutputUsdPerMillion ?? rates.outputUsdPerMillion;
  if (inputRef == null || outputRef == null) return null;
  return usageUsdFromResolvedRates(
    {
      ...rates,
      inputUsdPerMillion: inputRef,
      outputUsdPerMillion: outputRef,
      cacheReadUsdPerMillion: rates.referenceCacheReadUsdPerMillion ?? inputRef,
      cacheWriteUsdPerMillion: rates.referenceCacheWriteUsdPerMillion ?? inputRef,
    },
    promptTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens
  );
}

/** Resolve procurement cost from CI catalog current rates (never reference). */
export function resolveProcurementCostFromCatalog(opts: {
  modelId: string;
  promptTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  effectiveKrwPerUsd: number;
  catalog?: CheaperInferenceCatalogPricing | null;
}): ProcurementCostSnapshot | null {
  const catalog =
    opts.catalog ?? resolveCheaperInferenceCatalogPricing(opts.modelId);
  if (!catalog) return null;

  const promptTokens = Math.max(0, opts.promptTokens);
  const outputTokens = Math.max(0, opts.outputTokens);
  const cacheReadTokens = Math.max(0, opts.cacheReadTokens ?? 0);
  const cacheWriteTokens = Math.max(0, opts.cacheWriteTokens ?? 0);

  const procurementCostUsd = usageUsdFromCurrentRates(
    catalog,
    promptTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens
  );
  const providerListCostUsd =
    usageUsdFromReferenceRates(
      catalog,
      promptTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens
    ) ?? procurementCostUsd;

  const rates = resolveCatalogRatesForPrompt(catalog, promptTokens);

  return {
    procurementCostUsd,
    procurementCostKrw: convertUsdToKrw(procurementCostUsd, opts.effectiveKrwPerUsd),
    providerListCostUsd,
    providerListCostKrw: convertUsdToKrw(providerListCostUsd, opts.effectiveKrwPerUsd),
    discountPercent: catalog.discountPercent ?? null,
    inputUsdPerMillion: rates.inputUsdPerMillion,
    outputUsdPerMillion: rates.outputUsdPerMillion,
    referenceInputUsdPerMillion: rates.referenceInputUsdPerMillion ?? null,
    referenceOutputUsdPerMillion: rates.referenceOutputUsdPerMillion ?? null,
  };
}

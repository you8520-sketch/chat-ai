import {
  MAIN_RP_MODEL_IDS,
  type SelectedAI,
} from "@/lib/chatModels";
import type { MainRpSupplyRadarReport } from "./mainRpSupplyRadar";

export const DIRECT_SUPPLIER_RADAR_VERSION = 1;
export const DIRECT_SUPPLIER_PUBLIC_STABILITY_FLOOR_PERCENT = 99.8;
export const DIRECT_SUPPLIER_FETCH_TIMEOUT_MS = 20_000;

export type DirectSupplierId = "onemux" | "aireiter" | "dit";
export type DirectSupplierProtocol =
  | "openai_compatible"
  | "anthropic_compatible"
  | "google_compatible"
  | "unknown";

export type DirectSupplierScreeningStatus =
  | "READY_FOR_CREDENTIALLED_LIVE_QUALIFICATION"
  | "NO_PRICE_ADVANTAGE"
  | "HOLD_PUBLIC_STABILITY_BELOW_FLOOR"
  | "HOLD_PUBLIC_STABILITY_UNVERIFIED"
  | "HOLD_PROTOCOL_CHANGE_REQUIRED"
  | "HOLD_PRICE_UNPARSEABLE"
  | "FETCH_FAILED";

export type DirectSupplierEvidence = {
  supplier: DirectSupplierId;
  modelId: SelectedAI;
  sourceUrl: string;
  fetchedAt: string;
  httpStatus: number | null;
  inputUsdPerMillion: number | null;
  outputUsdPerMillion: number | null;
  cacheReadUsdPerMillion: number | null;
  protocol: DirectSupplierProtocol;
  activeRoutes: number | null;
  publicSuccess30dPercent: number | null;
  currentInputUsdPerMillion: number | null;
  currentOutputUsdPerMillion: number | null;
  inputDeltaPercentVsCurrent: number | null;
  outputDeltaPercentVsCurrent: number | null;
  cheaperOnInputAndOutput: boolean | null;
  screeningStatus: DirectSupplierScreeningStatus;
  screeningReasons: string[];
  liveQualificationStatus: "NOT_RUN_MISSING_CREDENTIAL";
  error: string | null;
};

export type MainRpDirectSupplierRadarReport = {
  version: number;
  generatedAt: string;
  activeModelIds: readonly SelectedAI[];
  providerGenerationCalls: 0;
  evidence: DirectSupplierEvidence[];
  notes: string[];
};

type FetchLike = typeof fetch;

function slugForPublicPage(modelId: SelectedAI): string {
  return modelId.replaceAll(".", "-");
}

function ditVendor(modelId: SelectedAI): "deepseek" | "google" | "openai" | "anthropic" {
  if (modelId.startsWith("deepseek-")) return "deepseek";
  if (modelId.startsWith("gemini-")) return "google";
  if (modelId.startsWith("gpt-")) return "openai";
  return "anthropic";
}

export function directSupplierSourceUrl(
  supplier: DirectSupplierId,
  modelId: SelectedAI
): string {
  const slug = slugForPublicPage(modelId);
  if (supplier === "onemux") return `https://onemux.net/models/${slug}`;
  if (supplier === "aireiter") return `https://aireiter.com/chat/${slug}`;
  return `https://dit.ai/models/${ditVendor(modelId)}/${slug}`;
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&dollar;|&#36;/gi, "$")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

export function normalizeSupplierHtmlText(html: string): string {
  return decodeBasicEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function numeric(match: RegExpMatchArray | null, group = 1): number | null {
  if (!match?.[group]) return null;
  const parsed = Number(match[group]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseProtocol(text: string): DirectSupplierProtocol {
  if (/openai\s+(?:sdk\s+)?compatible|openai\s+chat\s+completions/i.test(text)) {
    return "openai_compatible";
  }
  if (/anthropic\s+(?:messages\s+)?compatible|protocol\s+anthropic/i.test(text)) {
    return "anthropic_compatible";
  }
  if (/google\s+compatible|protocol\s+google/i.test(text)) {
    return "google_compatible";
  }
  return "unknown";
}

export function parseDirectSupplierPublicPage(
  supplier: DirectSupplierId,
  html: string
): {
  inputUsdPerMillion: number | null;
  outputUsdPerMillion: number | null;
  cacheReadUsdPerMillion: number | null;
  protocol: DirectSupplierProtocol;
  activeRoutes: number | null;
  publicSuccess30dPercent: number | null;
} {
  const text = normalizeSupplierHtmlText(html);
  let input: number | null = null;
  let output: number | null = null;
  let cacheRead: number | null = null;

  if (supplier === "onemux") {
    const pair = text.match(
      /Input\s*\/\s*1M\s*\$([0-9.]+)[\s\S]{0,220}?Output\s*\/\s*1M\s*\$([0-9.]+)/i
    );
    input = numeric(pair, 1);
    output = numeric(pair, 2);
    cacheRead = numeric(
      text.match(/Cache\s*read(?:\s*\/\s*1M)?[\s\S]{0,100}?\$([0-9.]+)/i)
    );
  } else if (supplier === "aireiter") {
    const inputMatch = text.match(
      /Input[\s\S]{0,240}?AIReiter\s*\$([0-9.]+)(?:\s*per\s*1M\s*tokens)?/i
    );
    const outputMatch = text.match(
      /Output[\s\S]{0,240}?AIReiter\s*\$([0-9.]+)(?:\s*per\s*1M\s*tokens)?/i
    );
    input = numeric(inputMatch);
    output = numeric(outputMatch);
    cacheRead = numeric(
      text.match(/Cache\s*read[\s\S]{0,240}?AIReiter\s*\$([0-9.]+)/i)
    );
  } else {
    const pair = text.match(
      /DIT\s+in\s*\/\s*out\s*\$([0-9.]+)\s*\/\s*\$([0-9.]+)/i
    );
    input = numeric(pair, 1);
    output = numeric(pair, 2);
    cacheRead = numeric(
      text.match(/DIT[\s\S]{0,180}?cache(?:d)?\s+(?:input|read)?[\s\S]{0,100}?\$([0-9.]+)/i)
    );
  }

  return {
    inputUsdPerMillion: input,
    outputUsdPerMillion: output,
    cacheReadUsdPerMillion: cacheRead,
    protocol: parseProtocol(text),
    activeRoutes: numeric(
      text.match(/(?:availability\s*)?(\d+)\s+active\s+routes?/i)
    ),
    publicSuccess30dPercent: numeric(
      text.match(/([0-9.]+)%\s*30-day(?:\s+eligible\s+request)?\s+success/i)
    ),
  };
}

function delta(candidate: number | null, current: number | null): number | null {
  if (candidate == null || current == null || current <= 0) return null;
  return (candidate - current) / current;
}

function classifyEvidence(input: {
  inputUsdPerMillion: number | null;
  outputUsdPerMillion: number | null;
  protocol: DirectSupplierProtocol;
  publicSuccess30dPercent: number | null;
  currentInputUsdPerMillion: number | null;
  currentOutputUsdPerMillion: number | null;
  fetchFailed: boolean;
}): { status: DirectSupplierScreeningStatus; reasons: string[] } {
  if (input.fetchFailed) {
    return { status: "FETCH_FAILED", reasons: ["public_model_page_fetch_failed"] };
  }
  if (input.inputUsdPerMillion == null || input.outputUsdPerMillion == null) {
    return {
      status: "HOLD_PRICE_UNPARSEABLE",
      reasons: ["canonical_model_page_price_unparseable"],
    };
  }

  const hasBaseline =
    input.currentInputUsdPerMillion != null &&
    input.currentOutputUsdPerMillion != null;
  const cheaperBoth =
    hasBaseline &&
    input.inputUsdPerMillion < input.currentInputUsdPerMillion! &&
    input.outputUsdPerMillion < input.currentOutputUsdPerMillion!;
  if (!cheaperBoth) {
    return {
      status: "NO_PRICE_ADVANTAGE",
      reasons: [hasBaseline ? "not_cheaper_on_both_input_and_output" : "current_procurement_baseline_missing"],
    };
  }

  if (input.protocol !== "openai_compatible") {
    return {
      status: "HOLD_PROTOCOL_CHANGE_REQUIRED",
      reasons: [`protocol=${input.protocol}`, "current_main_rp_transport_parity_unproven"],
    };
  }

  if (input.publicSuccess30dPercent == null) {
    return {
      status: "HOLD_PUBLIC_STABILITY_UNVERIFIED",
      reasons: ["no_public_measured_30d_success_evidence"],
    };
  }
  if (
    input.publicSuccess30dPercent <
    DIRECT_SUPPLIER_PUBLIC_STABILITY_FLOOR_PERCENT
  ) {
    return {
      status: "HOLD_PUBLIC_STABILITY_BELOW_FLOOR",
      reasons: [
        `public_30d_success=${input.publicSuccess30dPercent}`,
        `required>=${DIRECT_SUPPLIER_PUBLIC_STABILITY_FLOOR_PERCENT}`,
      ],
    };
  }

  return {
    status: "READY_FOR_CREDENTIALLED_LIVE_QUALIFICATION",
    reasons: ["price_better_on_input_and_output", "public_30d_success_floor_met"],
  };
}

export function buildDirectSupplierEvidence(input: {
  supplier: DirectSupplierId;
  modelId: SelectedAI;
  sourceUrl: string;
  fetchedAt: string;
  httpStatus: number | null;
  html: string | null;
  currentInputUsdPerMillion: number | null;
  currentOutputUsdPerMillion: number | null;
  error?: string | null;
}): DirectSupplierEvidence {
  const parsed = input.html
    ? parseDirectSupplierPublicPage(input.supplier, input.html)
    : {
        inputUsdPerMillion: null,
        outputUsdPerMillion: null,
        cacheReadUsdPerMillion: null,
        protocol: "unknown" as const,
        activeRoutes: null,
        publicSuccess30dPercent: null,
      };
  const classification = classifyEvidence({
    ...parsed,
    currentInputUsdPerMillion: input.currentInputUsdPerMillion,
    currentOutputUsdPerMillion: input.currentOutputUsdPerMillion,
    fetchFailed: input.html == null,
  });
  const inputDeltaPercentVsCurrent = delta(
    parsed.inputUsdPerMillion,
    input.currentInputUsdPerMillion
  );
  const outputDeltaPercentVsCurrent = delta(
    parsed.outputUsdPerMillion,
    input.currentOutputUsdPerMillion
  );
  const cheaperOnInputAndOutput =
    inputDeltaPercentVsCurrent == null || outputDeltaPercentVsCurrent == null
      ? null
      : inputDeltaPercentVsCurrent < 0 && outputDeltaPercentVsCurrent < 0;

  return {
    supplier: input.supplier,
    modelId: input.modelId,
    sourceUrl: input.sourceUrl,
    fetchedAt: input.fetchedAt,
    httpStatus: input.httpStatus,
    ...parsed,
    currentInputUsdPerMillion: input.currentInputUsdPerMillion,
    currentOutputUsdPerMillion: input.currentOutputUsdPerMillion,
    inputDeltaPercentVsCurrent,
    outputDeltaPercentVsCurrent,
    cheaperOnInputAndOutput,
    screeningStatus: classification.status,
    screeningReasons: classification.reasons,
    liveQualificationStatus: "NOT_RUN_MISSING_CREDENTIAL",
    error: input.error ?? null,
  };
}

export async function collectDirectSupplierPublicEvidence(input: {
  currentRadar: MainRpSupplyRadarReport;
  fetchImpl?: FetchLike;
  now?: () => Date;
}): Promise<MainRpDirectSupplierRadarReport> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? (() => new Date());
  const suppliers: DirectSupplierId[] = ["onemux", "aireiter", "dit"];
  const evidence: DirectSupplierEvidence[] = [];

  for (const modelId of MAIN_RP_MODEL_IDS) {
    const model = input.currentRadar.models.find((row) => row.modelId === modelId);
    const currentInputUsdPerMillion =
      model?.currentProcurement?.inputUsdPerMillion ?? null;
    const currentOutputUsdPerMillion =
      model?.currentProcurement?.outputUsdPerMillion ?? null;

    for (const supplier of suppliers) {
      const sourceUrl = directSupplierSourceUrl(supplier, modelId);
      const fetchedAt = now().toISOString();
      try {
        const response = await fetchImpl(sourceUrl, {
          method: "GET",
          headers: {
            Accept: "text/html,application/xhtml+xml",
            "User-Agent": "PlayAI-SupplyRadar/1.0",
          },
          signal: AbortSignal.timeout(DIRECT_SUPPLIER_FETCH_TIMEOUT_MS),
        });
        if (!response.ok) {
          evidence.push(
            buildDirectSupplierEvidence({
              supplier,
              modelId,
              sourceUrl,
              fetchedAt,
              httpStatus: response.status,
              html: null,
              currentInputUsdPerMillion,
              currentOutputUsdPerMillion,
              error: `HTTP ${response.status}`,
            })
          );
          continue;
        }
        evidence.push(
          buildDirectSupplierEvidence({
            supplier,
            modelId,
            sourceUrl,
            fetchedAt,
            httpStatus: response.status,
            html: await response.text(),
            currentInputUsdPerMillion,
            currentOutputUsdPerMillion,
          })
        );
      } catch (error) {
        evidence.push(
          buildDirectSupplierEvidence({
            supplier,
            modelId,
            sourceUrl,
            fetchedAt,
            httpStatus: null,
            html: null,
            currentInputUsdPerMillion,
            currentOutputUsdPerMillion,
            error: error instanceof Error ? error.message : String(error),
          })
        );
      }
    }
  }

  return {
    version: DIRECT_SUPPLIER_RADAR_VERSION,
    generatedAt: now().toISOString(),
    activeModelIds: MAIN_RP_MODEL_IDS,
    providerGenerationCalls: 0,
    evidence,
    notes: [
      "READ_ONLY_PUBLIC_EVIDENCE: no direct-supplier generation calls are made.",
      "Only canonical per-model detail pages are fetched; supplier blogs/marketing articles are not price owners.",
      "A cheaper public sticker price never changes production routing.",
      "Missing measured 30-day success evidence fails closed as stability-unverified.",
      "Non-OpenAI-compatible public protocols are held until a transport/control-parity design is explicitly reviewed.",
      "Credentialled live qualification remains NOT_RUN until a dedicated benchmark key exists for that supplier.",
    ],
  };
}

function pct(value: number | null): string {
  return value == null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

export function renderDirectSupplierRadarMarkdown(
  report: MainRpDirectSupplierRadarReport
): string {
  const lines = [
    "# Direct Supplier Public Evidence",
    "",
    `- generated: ${report.generatedAt}`,
    `- provider generation calls: **${report.providerGenerationCalls}**`,
    `- active models: ${report.activeModelIds.join(", ")}`,
    "",
    "| Model | Supplier | In/M | Out/M | Δ input | Δ output | Protocol | 30d success | Routes | Screening |",
    "|---|---|---:|---:|---:|---:|---|---:|---:|---|",
  ];
  for (const row of report.evidence) {
    lines.push(
      `| ${row.modelId} | ${row.supplier} | ${row.inputUsdPerMillion ?? "n/a"} | ${row.outputUsdPerMillion ?? "n/a"} | ${pct(row.inputDeltaPercentVsCurrent)} | ${pct(row.outputDeltaPercentVsCurrent)} | ${row.protocol} | ${row.publicSuccess30dPercent ?? "n/a"} | ${row.activeRoutes ?? "n/a"} | ${row.screeningStatus} |`
    );
  }
  lines.push("", "## Interpretation boundary", "");
  for (const note of report.notes) lines.push(`- ${note}`);
  lines.push("");
  return lines.join("\n");
}

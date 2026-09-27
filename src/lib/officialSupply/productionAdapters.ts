import "server-only";

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { getDataDir } from "@/lib/dataDir";
import { OpenAiImageError } from "@/lib/openAiImageEdit";
import {
  callOpenAiImageEditWithSafetyFallback,
  OpenAiImageGenerationError,
  aggregateKnownProviderCostUsd,
} from "@/lib/openAiImageSafetyFallback";
import { recordBackgroundProviderCost } from "@/lib/providerCostLedger";
import { storeUpload } from "@/lib/uploadStorage";
import { analyzeAssetImage } from "@/lib/vision";
import { recordVisionCostAttempts } from "@/lib/visionCost";
import { prepareOfficialImageReferences } from "@/lib/officialSupply/referencePreparation";
import {
  OfficialImageTransportError,
  type OfficialAssetModerator,
  type OfficialAssetSpool,
  type OfficialAssetStorage,
  type OfficialImageOps,
  type OfficialImageTransport,
} from "@/lib/officialSupply/runner";

const OFFICIAL_ASSET_REQUEST_KIND = "official-character-asset-image";

function recordLedger(model: string, costUsd: number | null, providerRequestId: string | null, outcome: "success" | "failed_with_usage" | "failed_without_usage") {
  recordBackgroundProviderCost({
    provider: "openai",
    model,
    requestKind: OFFICIAL_ASSET_REQUEST_KIND,
    costCenter: "image",
    upstreamCostUsd: costUsd ?? undefined,
    usageEstimated: costUsd == null,
    providerRequestId,
    outcome,
  });
}

/**
 * Platform-funded transport over the canonical OpenAI image owner
 * (`callOpenAiImageEditWithSafetyFallback`: same endpoint, safety fallback and
 * cost parsing as user chat images). No user points, no creator reward, no
 * chat/persona linkage — spend is written to the shared provider cost ledger
 * as `platform_funded` / cost center `image`.
 */
export const openAiOfficialImageTransport: OfficialImageTransport = {
  async generate(input) {
    const references = await prepareOfficialImageReferences(input.references);
    try {
      const result = await callOpenAiImageEditWithSafetyFallback({
        model: input.model,
        primaryPrompt: input.primaryPrompt,
        strictFallbackPrompt: input.strictFallbackPrompt,
        references,
        size: input.size,
        quality: input.quality,
        outputCompression: input.outputCompression,
        templateId: input.templateId,
        mode: "official_character_asset",
      });
      const providerRequestId =
        [...result.providerAttempts].reverse().find((a) => a.providerRequestId)?.providerRequestId ?? null;
      recordLedger(input.model, result.knownProviderCostUsd, providerRequestId, "success");
      return {
        buffer: result.buffer,
        costUsd: result.knownProviderCostUsd,
        hasUnknownAttemptCost: result.hasUnknownAttemptCost,
        providerRequestId,
      };
    } catch (error) {
      if (error instanceof OpenAiImageGenerationError) {
        const cost = aggregateKnownProviderCostUsd(error.providerAttempts);
        recordLedger(input.model, cost, null, cost != null ? "failed_with_usage" : "failed_without_usage");
        throw new OfficialImageTransportError(error.message, cost, cost == null);
      }
      if (error instanceof OpenAiImageError) {
        throw new OfficialImageTransportError(error.message, null, true);
      }
      throw error;
    }
  },
};

export const sharpOfficialImageOps: OfficialImageOps = {
  async inspect(buffer) {
    try {
      const meta = await sharp(buffer, { failOn: "none" }).metadata();
      return meta.width && meta.height ? { width: meta.width, height: meta.height } : null;
    } catch {
      return null;
    }
  },
};

export const uploadOfficialAssetStorage: OfficialAssetStorage = {
  async store(filename, buffer) {
    const stored = await storeUpload(filename, buffer, "image/webp");
    return { url: stored.url };
  },
};

/**
 * Canonical asset moderation — the same vision owner as creator uploads. The
 * vision auto-tag is ignored (the planned semantic tag stays authoritative).
 * When vision could not run, the result is explicitly `unavailable`.
 */
export const visionOfficialAssetModerator: OfficialAssetModerator = {
  async moderate(url) {
    const result = await analyzeAssetImage(url);
    recordVisionCostAttempts(result.costAttempts);
    if (result.estimated) return { status: "unavailable", reason: "asset vision moderation unavailable" };
    return {
      status: "checked",
      adultFlagged: result.adultFlagged,
      moderationReject: result.moderationReject,
      reason: result.moderationReason,
    };
  },
};

export function fileOfficialAssetSpool(dir = path.join(getDataDir(), "official-supply-spool")): OfficialAssetSpool {
  const file = (key: string) => path.join(dir, `${key}.webp`);
  return {
    async save(key, buffer) {
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(file(key), buffer);
    },
    async load(key) {
      try {
        return await fs.promises.readFile(file(key));
      } catch {
        return null;
      }
    },
    async remove(key) {
      await fs.promises.rm(file(key), { force: true });
    },
  };
}

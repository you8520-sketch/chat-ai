export const MAIN_RP_SUPPLY_AUTO_DRAFT_VERSION = 1;
export const MAIN_RP_SUPPLY_AUTO_DRAFT_MAX_PER_RUN = 3;

export type AutoDraftPatchInput = {
  source: string;
  openRouterModelId: string;
  expectedCurrentProviderSlug: string;
  candidateProviderSlug: string;
};

export type AutoDraftPatchResult = {
  source: string;
  previousProviderSlug: string;
  candidateProviderSlug: string;
  changed: boolean;
};

const PROVIDER_SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
}

export function validateProviderSlug(value: string): string {
  const slug = value.trim();
  if (!PROVIDER_SLUG_RE.test(slug)) {
    throw new Error("Unsafe OpenRouter provider slug: " + JSON.stringify(value));
  }
  return slug;
}

export function safeBranchComponent(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  if (!normalized) throw new Error("Empty branch component");
  return normalized;
}

export function patchMainRpOpenRouterProvider(
  input: AutoDraftPatchInput
): AutoDraftPatchResult {
  const modelId = input.openRouterModelId.trim();
  if (!modelId) throw new Error("Missing OpenRouter model id");
  const expected = validateProviderSlug(input.expectedCurrentProviderSlug);
  const candidate = validateProviderSlug(input.candidateProviderSlug);

  const model = escapeRegExp(modelId);
  const pattern = new RegExp(
    "(\\\"" + model +
      "\\\"\\s*:\\s*\\{[\\s\\S]{0,240}?providerSlug:\\s*\\\")([^\\\"]+)(\\\")",
    "g"
  );
  const matches = [...input.source.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(
      "Expected exactly one route-policy row for " + modelId +
        ", found " + matches.length
    );
  }

  const actual = matches[0]?.[2]?.trim() ?? "";
  if (actual !== expected) {
    throw new Error(
      "Route provider drift for " + modelId +
        ": expected " + expected + ", found " + actual
    );
  }
  if (actual === candidate) {
    return {
      source: input.source,
      previousProviderSlug: actual,
      candidateProviderSlug: candidate,
      changed: false,
    };
  }

  const source = input.source.replace(
    pattern,
    (_match, before, _old, after) => before + candidate + after
  );
  if (source === input.source) {
    throw new Error("Route provider patch produced no change for " + modelId);
  }

  const rowPattern = new RegExp(
    "\\\"" + model +
      "\\\"\\s*:\\s*\\{[\\s\\S]{0,300}?providerSlug:\\s*\\\"" +
      escapeRegExp(candidate) +
      "\\\"[\\s\\S]{0,180}?serviceTier:\\s*\\\"flex\\\"[\\s\\S]{0,80}?\\}"
  );
  if (!rowPattern.test(source)) {
    throw new Error(
      "Patched route lost canonical Flex service tier for " + modelId
    );
  }

  return {
    source,
    previousProviderSlug: actual,
    candidateProviderSlug: candidate,
    changed: true,
  };
}

export function autoDraftMarker(modelId: string, providerSlug: string): string {
  return "<!-- main-rp-supply-auto:" + modelId + ":" + providerSlug + " -->";
}

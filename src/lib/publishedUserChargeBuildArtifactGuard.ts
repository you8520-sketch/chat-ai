/**
 * Fail-closed build artifact guard for Published user-charge compiled owner.
 * Discovers owners by semantic anchors — never by chunk filename or webpack module id.
 */

import fs from "node:fs";
import path from "node:path";

/** Anchors that identify the publishedUserCharge compiled owner across builds. */
export const PUBLISHED_BUILD_SEMANTIC_ANCHORS = [
  "incomplete_usage_coverage",
  "unknown_usage_coverage",
  "model_pricing_identity_mismatch",
  "exact_published_catalog",
  "unsupported_model",
] as const;

export function fileContainsAllPublishedBuildAnchors(content: string): boolean {
  return PUBLISHED_BUILD_SEMANTIC_ANCHORS.every((anchor) => content.includes(anchor));
}

/** True when compiled core retains the complete Published return path. */
export function hasPublishedCompletePathReturn(content: string): boolean {
  if (!fileContainsAllPublishedBuildAnchors(content)) {
    return false;
  }
  return /status:"complete",snapshot/.test(content);
}

function listServerChunkFiles(nextServerRoot: string): string[] {
  const files: string[] = [];
  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".js")) {
        files.push(fullPath);
      }
    }
  }
  walk(nextServerRoot);
  return files;
}

export function findPublishedBuildOwnerFiles(nextServerRoot: string): string[] {
  if (!fs.existsSync(nextServerRoot)) {
    throw new Error(
      `BUILD_GUARD_FAILS_CLOSED: missing ${nextServerRoot} — run npm run build before build-artifact guard`
    );
  }

  return listServerChunkFiles(nextServerRoot).filter((filePath) =>
    fileContainsAllPublishedBuildAnchors(fs.readFileSync(filePath, "utf8"))
  );
}

export type PublishedBuildArtifactGuardResult = {
  buildGuardFailsClosed: true;
  matchedPublishedBuildOwnerCount: number;
  completePathReturnPresent: boolean;
  matchedFiles: string[];
};

export function auditPublishedBuildArtifactGuard(
  nextServerRoot = path.join(process.cwd(), ".next/server")
): PublishedBuildArtifactGuardResult {
  const matchedFiles = findPublishedBuildOwnerFiles(nextServerRoot);
  const matchedPublishedBuildOwnerCount = matchedFiles.length;
  const completePathReturnPresent =
    matchedPublishedBuildOwnerCount === 1 &&
    hasPublishedCompletePathReturn(fs.readFileSync(matchedFiles[0]!, "utf8"));

  return {
    buildGuardFailsClosed: true,
    matchedPublishedBuildOwnerCount,
    completePathReturnPresent,
    matchedFiles,
  };
}

export function assertPublishedBuildArtifactGuard(
  nextServerRoot = path.join(process.cwd(), ".next/server")
): PublishedBuildArtifactGuardResult {
  const result = auditPublishedBuildArtifactGuard(nextServerRoot);

  if (result.matchedPublishedBuildOwnerCount === 0) {
    throw new Error(
      "BUILD_GUARD: MATCHED_PUBLISHED_BUILD_OWNER_COUNT=0 — published user-charge owner not found in .next/server"
    );
  }
  if (result.matchedPublishedBuildOwnerCount > 1) {
    throw new Error(
      `BUILD_GUARD: MATCHED_PUBLISHED_BUILD_OWNER_COUNT=${result.matchedPublishedBuildOwnerCount} — ambiguous owners: ${result.matchedFiles.join(", ")}`
    );
  }
  if (!result.completePathReturnPresent) {
    throw new Error(
      "BUILD_GUARD: COMPLETE_PATH_RETURN_PRESENT=false — compiled complete Published path truncated or missing"
    );
  }

  return result;
}

/** Pre-fix production bundle sample — truncated core after switch(usageCoverage). */
export const PRE_FIX_TRUNCATED_PUBLISHED_CORE_SAMPLE = [
  'function i(a,b,c,f,g,h,i){',
  'if(!(0,e.g)(c))return{status:"blocked",reason:"invalid_usage",finalPoints:null};',
  'switch(f){case"partial":return{status:"blocked",reason:"incomplete_usage_coverage",finalPoints:null};',
  'case"unknown":default:return{status:"blocked",reason:"unknown_usage_coverage",finalPoints:null};',
  'case"complete":}}',
  'function j(a){return{status:"blocked",reason:"unsupported_model",finalPoints:null};',
  'chargeSnapshotOrigin:"exact_published_catalog",reason:"model_pricing_identity_mismatch"}',
].join("");

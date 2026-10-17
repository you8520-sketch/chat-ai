import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

import { filenameFromUploadUrl, resolveExistingUploadPath } from "@/lib/uploadStorage";
import { parseOfficialApprovedAssetReference } from "@/lib/officialSupply/generationReferences";
import { CLUSTER_B_PRIMARY_STYLE_PATH } from "@/lib/officialSupply/userOwnedRofanStyleRefs";
import { OfficialImageTransportError } from "@/lib/officialSupply/runner";

const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
const PLATFORM_STYLE_SEED_PREFIX = "/official-supply/style-seeds/";
const REVIEW_CANDIDATE_SCHEME = "official-review-candidate:";
const REVIEW_CANDIDATE_ROOT = "docs/official-supply/reviews/assets";
const SHA256_HEX = /^[a-f0-9]{64}$/;
const REVIEW_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Limited review-candidate reference. Callers name one file under
 * `docs/official-supply/reviews/assets/` and the SHA-256 of its raw bytes.
 * Preparation reads that file only after both checks pass.
 */
export function officialReviewCandidateReference(relativePath: string, sha256: string): string {
  const digest = sha256.trim().toLowerCase();
  if (!SHA256_HEX.test(digest)) {
    throw new Error("review candidate sha256 must be 64 lowercase hex characters");
  }
  if (!isConfinedReviewAssetPath(relativePath)) {
    throw new Error("review candidate path is outside the review asset root");
  }
  return `${REVIEW_CANDIDATE_SCHEME}${digest}:${relativePath}`;
}

function isConfinedReviewAssetPath(relativePath: string): boolean {
  if (relativePath.includes("\\") || relativePath.includes("\0") || path.isAbsolute(relativePath)) {
    return false;
  }
  const prefix = `${REVIEW_CANDIDATE_ROOT}/`;
  if (!relativePath.startsWith(prefix)) return false;
  const parts = relativePath.slice(prefix.length).split("/");
  return parts.length > 0 && parts.every((part) => REVIEW_PATH_SEGMENT.test(part));
}

function parseReviewCandidate(source: string): { sha256: string; relativePath: string } {
  const rest = source.slice(REVIEW_CANDIDATE_SCHEME.length);
  const separator = rest.indexOf(":");
  if (separator !== 64) throw new Error("invalid review candidate reference");
  const sha256 = rest.slice(0, separator);
  const relativePath = rest.slice(separator + 1);
  if (!SHA256_HEX.test(sha256) || !isConfinedReviewAssetPath(relativePath)) {
    throw new Error("invalid review candidate reference");
  }
  return { sha256, relativePath };
}

async function readReviewCandidate(source: string): Promise<Buffer> {
  const parsed = parseReviewCandidate(source);
  const root = path.resolve(process.cwd(), REVIEW_CANDIDATE_ROOT);
  const resolved = path.resolve(process.cwd(), parsed.relativePath);
  const rootWithSep = `${root}${path.sep}`;
  if (!resolved.startsWith(rootWithSep)) {
    throw new Error("review candidate escaped the review asset root");
  }

  let realFile: string;
  try {
    realFile = await fs.promises.realpath(resolved);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new Error(`reference not found: ${parsed.relativePath}`);
    throw error;
  }
  const realRoot = await fs.promises.realpath(root);
  if (!realFile.startsWith(`${realRoot}${path.sep}`)) {
    throw new Error("review candidate escaped the review asset root");
  }

  const buffer = await fs.promises.readFile(realFile);
  if (buffer.length > MAX_REFERENCE_BYTES) throw new Error("reference too large");
  const digest = createHash("sha256").update(buffer).digest("hex");
  if (digest !== parsed.sha256) throw new Error("review candidate hash mismatch");
  return buffer;
}

function configuredPlatformOrigins(env: NodeJS.ProcessEnv): Set<string> {
  const origins = new Set<string>();
  for (const raw of [env.NEXTAUTH_URL, env.RAILWAY_STATIC_URL, env.RAILWAY_PUBLIC_DOMAIN]) {
    const value = raw?.trim();
    if (!value) continue;
    try {
      const normalized = /^https?:\/\//i.test(value) ? value : `https://${value}`;
      origins.add(new URL(normalized).origin);
    } catch {
      // Deployment metadata that is unrelated or malformed is not a reference owner.
    }
  }
  return origins;
}

function platformPublicReferencePath(source: string, env: NodeJS.ProcessEnv): string | null {
  if (!/^https:\/\//i.test(source)) return null;
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return null;
  }
  if (!configuredPlatformOrigins(env).has(url.origin)) return null;
  if (!url.pathname.startsWith(PLATFORM_STYLE_SEED_PREFIX)) return null;

  const publicRoot = path.resolve(process.cwd(), "public");
  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const local = path.resolve(publicRoot, relative);
  if (local !== publicRoot && !local.startsWith(`${publicRoot}${path.sep}`)) {
    throw new Error("platform reference escaped public root");
  }
  return local;
}

async function readReference(source: string, env: NodeJS.ProcessEnv): Promise<Buffer> {
  if (source.startsWith(REVIEW_CANDIDATE_SCHEME)) return readReviewCandidate(source);
  const approved = parseOfficialApprovedAssetReference(source);
  if (approved) {
    const buffer = await readReference(approved.url, env);
    const digest = createHash("sha256").update(buffer).digest("hex");
    if (digest !== approved.sha256) throw new Error("approved asset hash mismatch");
    return buffer;
  }

  const uploadName = filenameFromUploadUrl(source);
  if (uploadName) {
    const local = resolveExistingUploadPath(uploadName);
    if (!local) throw new Error(`reference not found: ${source}`);
    return fs.promises.readFile(local);
  }

  const localPublic = platformPublicReferencePath(source, env);
  if (localPublic) return fs.promises.readFile(localPublic);

  if (/^https:\/\//i.test(source)) {
    let url: URL;
    try {
      url = new URL(source);
    } catch {
      throw new Error(`unsupported reference source: ${source}`);
    }
    if (url.pathname === CLUSTER_B_PRIMARY_STYLE_PATH) {
      throw new Error("Cluster B primary STYLE must resolve from platform public storage");
    }
    const response = await fetch(source, { headers: { Accept: "image/*" } });
    if (!response.ok) throw new Error(`reference fetch failed: ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_REFERENCE_BYTES) throw new Error("reference too large");
    return buffer;
  }
  throw new Error(`unsupported reference source: ${source}`);
}

async function referenceToDataUrl(source: string, env: NodeJS.ProcessEnv): Promise<string> {
  const optimized = await sharp(await readReference(source, env), {
    failOn: "none",
    animated: false,
  })
    .rotate()
    .resize({ width: 1536, height: 1536, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 90, effort: 4 })
    .toBuffer();
  return `data:image/webp;base64,${optimized.toString("base64")}`;
}

/**
 * Canonical preparation owner for official image references. This completes
 * before any provider request starts; failures are therefore known zero-cost.
 */
export async function prepareOfficialImageReferences(
  sources: string[],
  env: NodeJS.ProcessEnv = process.env
): Promise<string[]> {
  try {
    return await Promise.all(sources.map((source) => referenceToDataUrl(source, env)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new OfficialImageTransportError(
      `reference preparation failed: ${message}`,
      0,
      false,
      false
    );
  }
}

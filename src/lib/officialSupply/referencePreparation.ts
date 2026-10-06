import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

import { filenameFromUploadUrl, resolveExistingUploadPath } from "@/lib/uploadStorage";
import { CLUSTER_B_PRIMARY_STYLE_PATH } from "@/lib/officialSupply/userOwnedRofanStyleRefs";
import { OfficialImageTransportError } from "@/lib/officialSupply/runner";

const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
const PLATFORM_STYLE_SEED_PREFIX = "/official-supply/style-seeds/";

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

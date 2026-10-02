/**
 * Canonical media storage owner.
 * New character-asset originals live under getDataDir()/media/private.
 * Safe public renditions and blur previews live under media/public.
 * Does not use BLOB_READ_WRITE_TOKEN or any new paid object store.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { getDataDir } from "@/lib/dataDir";
import { resolveExistingUploadPath, sanitizeUploadFilename } from "@/lib/uploadStorage";

const PRIVATE_DIR_NAME = "media/private";
const PUBLIC_DIR_NAME = "media/public";
const SAFE_NAME_RE = /^[a-zA-Z0-9._-]+$/;
const PUBLIC_MAX_EDGE = 720;
const BLUR_EDGE = 48;

export type StoredPrivateMedia = {
  mediaId: string;
  url: string;
  publicRenditionUrl: string;
  blurPreviewUrl: string;
  localPath: string;
};

export type MediaManifest = {
  uploadedBy: number;
  createdAt: string;
  contentType: string;
  adultFlagged?: boolean;
  moderationReject?: boolean;
  moderationReason?: string;
};

export function mediaPrivateDir(): string {
  return path.join(getDataDir(), PRIVATE_DIR_NAME);
}

export function mediaPublicDir(): string {
  return path.join(getDataDir(), PUBLIC_DIR_NAME);
}

export function sanitizeMediaFilename(name: string): string | null {
  const base = path.basename(name);
  if (!base || base !== name) return null;
  if (!SAFE_NAME_RE.test(base)) return null;
  return base;
}

export function privateMediaUrl(filename: string): string {
  return `/media/private/${filename}`;
}

export function publicMediaUrl(filename: string): string {
  return `/media/public/${filename}`;
}

export function filenameFromPrivateMediaUrl(url: string): string | null {
  const base = url.split("?")[0] ?? "";
  if (!base.startsWith("/media/private/")) return null;
  return sanitizeMediaFilename(base.slice("/media/private/".length));
}

export function filenameFromPublicMediaUrl(url: string): string | null {
  if (!url.startsWith("/media/public/")) return null;
  return sanitizeMediaFilename(url.slice("/media/public/".length));
}

export function isPublicBlurFilename(filename: string): boolean {
  return filename.startsWith("legacy-blur-") || filename.endsWith("-blur.webp");
}

export function isPublicRenditionFilename(filename: string): boolean {
  return filename.endsWith("-public.webp");
}

export function mediaIdFromPublicRenditionFilename(filename: string): string | null {
  const safe = sanitizeMediaFilename(filename);
  if (!safe || !isPublicRenditionFilename(safe)) return null;
  const stem = safe.slice(0, -"-public.webp".length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stem)
    ? stem
    : null;
}

export async function ensureApprovedPublicRendition(mediaId: string): Promise<string | null> {
  const publicName = `${mediaId}-public.webp`;
  const existing = resolveExistingPublicMediaPath(publicName);
  if (existing) return publicMediaUrl(publicName);
  const privatePath = resolveExistingPrivateMediaPath(`${mediaId}.webp`);
  if (!privatePath) return null;
  const input = await fs.promises.readFile(privatePath);
  await writeWebpRendition(input, path.join(mediaPublicDir(), publicName), {
    maxEdge: PUBLIC_MAX_EDGE,
    quality: 70,
  });
  return publicMediaUrl(publicName);
}

export function mediaIdFromPrivateFilename(filename: string): string | null {
  const safe = sanitizeMediaFilename(filename);
  if (!safe) return null;
  const stem = safe.replace(/\.[a-zA-Z0-9]+$/, "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stem)
    ? stem
    : null;
}

function manifestPathFor(filename: string): string {
  return path.join(mediaPrivateDir(), `${filename}.json`);
}

export async function writeMediaManifest(filename: string, manifest: MediaManifest): Promise<void> {
  await fs.promises.mkdir(mediaPrivateDir(), { recursive: true });
  await fs.promises.writeFile(manifestPathFor(filename), JSON.stringify(manifest), "utf8");
}

export function readMediaManifest(filename: string): MediaManifest | null {
  try {
    const raw = fs.readFileSync(manifestPathFor(filename), "utf8");
    const parsed = JSON.parse(raw) as Partial<MediaManifest>;
    const uploadedBy = Number(parsed.uploadedBy);
    if (!Number.isInteger(uploadedBy) || uploadedBy <= 0) return null;
    return {
      uploadedBy,
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : "",
      contentType: typeof parsed.contentType === "string" ? parsed.contentType : "image/webp",
      ...(typeof parsed.adultFlagged === "boolean" ? { adultFlagged: parsed.adultFlagged } : {}),
      ...(typeof parsed.moderationReject === "boolean"
        ? { moderationReject: parsed.moderationReject }
        : {}),
      ...(typeof parsed.moderationReason === "string" && parsed.moderationReason.trim()
        ? { moderationReason: parsed.moderationReason.trim().slice(0, 200) }
        : {}),
    };
  } catch {
    return null;
  }
}

export function resolveExistingPrivateMediaPath(filename: string): string | null {
  const safe = sanitizeMediaFilename(filename);
  if (!safe) return null;
  const localPath = path.join(mediaPrivateDir(), safe);
  if (fs.existsSync(localPath) && fs.statSync(localPath).isFile()) return localPath;
  return null;
}

export function resolveExistingPublicMediaPath(filename: string): string | null {
  const safe = sanitizeMediaFilename(filename);
  if (!safe) return null;
  const localPath = path.join(mediaPublicDir(), safe);
  if (fs.existsSync(localPath) && fs.statSync(localPath).isFile()) return localPath;
  return null;
}

async function writeWebpRendition(
  input: Buffer,
  outPath: string,
  opts: { maxEdge: number; quality: number; blur?: number }
): Promise<void> {
  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
  let pipeline = sharp(input, { failOn: "error", pages: 1 }).rotate();
  pipeline = pipeline.resize({
    width: opts.maxEdge,
    height: opts.maxEdge,
    fit: "inside",
    withoutEnlargement: true,
  });
  if (opts.blur && opts.blur > 0) {
    pipeline = pipeline.blur(opts.blur);
  }
  await pipeline.webp({ quality: opts.quality, effort: 4 }).toFile(outPath);
}

export async function storePrivateMedia(
  body: Buffer,
  contentType: string,
  uploadedBy: number
): Promise<StoredPrivateMedia> {
  const mediaId = crypto.randomUUID();
  const filename = `${mediaId}.webp`;
  const privateDir = mediaPrivateDir();
  const publicDir = mediaPublicDir();
  await fs.promises.mkdir(privateDir, { recursive: true });
  await fs.promises.mkdir(publicDir, { recursive: true });

  const localPath = path.join(privateDir, filename);
  const publicName = `${mediaId}-public.webp`;
  const blurName = `${mediaId}-blur.webp`;
  const blurPath = path.join(publicDir, blurName);

  await fs.promises.writeFile(localPath, body);
  try {
    await writeWebpRendition(body, blurPath, { maxEdge: BLUR_EDGE, quality: 36, blur: 16 });
  } catch (error) {
    await fs.promises.unlink(localPath).catch(() => undefined);
    await fs.promises.unlink(blurPath).catch(() => undefined);
    throw error;
  }

  await writeMediaManifest(filename, {
    uploadedBy,
    createdAt: new Date().toISOString(),
    contentType,
  });

  return {
    mediaId,
    url: privateMediaUrl(filename),
    publicRenditionUrl: publicMediaUrl(publicName),
    blurPreviewUrl: publicMediaUrl(blurName),
    localPath,
  };
}

export async function ensureLegacyBlurPreviewFromPublicName(publicName: string): Promise<string | null> {
  const safe = sanitizeMediaFilename(publicName);
  if (!safe || !safe.startsWith("legacy-blur-") || !safe.endsWith(".webp")) return null;
  const stem = safe.slice("legacy-blur-".length, -".webp".length);
  for (const ext of [".webp", ".png", ".jpg", ".jpeg", ".gif"]) {
    const generated = await ensureLegacyBlurPreview(`${stem}${ext}`);
    if (generated) return generated;
  }
  return null;
}

export async function ensureLegacyBlurPreview(uploadFilename: string): Promise<string | null> {
  const safe = sanitizeUploadFilename(uploadFilename);
  if (!safe) return null;
  const source = resolveExistingUploadPath(safe);
  if (!source) return null;
  const stem = safe.replace(/\.[a-zA-Z0-9]+$/, "");
  const outName = `legacy-blur-${stem}.webp`;
  const outPath = path.join(mediaPublicDir(), outName);
  if (fs.existsSync(outPath) && fs.statSync(outPath).isFile()) {
    return publicMediaUrl(outName);
  }
  const input = await fs.promises.readFile(source);
  await writeWebpRendition(input, outPath, { maxEdge: BLUR_EDGE, quality: 36, blur: 16 });
  return publicMediaUrl(outName);
}

import fs from "fs";
import path from "path";
import { put } from "@vercel/blob";
import { getDataDir } from "@/lib/dataDir";

const UPLOADS_DIR_NAME = "uploads";
const SAFE_UPLOAD_NAME_RE = /^[a-zA-Z0-9._-]+$/;

export type StoredUpload = {
  url: string;
  localPath: string | null;
};

export function uploadsDataDir(): string {
  return path.join(getDataDir(), UPLOADS_DIR_NAME);
}

export function uploadsLegacyPublicDir(): string {
  return path.join(process.cwd(), "public", UPLOADS_DIR_NAME);
}

export function sanitizeUploadFilename(name: string): string | null {
  const base = path.basename(name);
  if (!base || base !== name) return null;
  if (!SAFE_UPLOAD_NAME_RE.test(base)) return null;
  return base;
}

export function uploadPublicUrl(filename: string): string {
  return `/${UPLOADS_DIR_NAME}/${filename}`;
}

export async function storeUpload(
  filename: string,
  body: Buffer,
  contentType: string,
): Promise<StoredUpload> {
  const safe = sanitizeUploadFilename(filename);
  if (!safe) throw new Error("Invalid upload filename");

  if (process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
    const blob = await put(`${UPLOADS_DIR_NAME}/${safe}`, body, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType,
    });
    return { url: blob.url, localPath: null };
  }

  const dir = uploadsDataDir();
  await fs.promises.mkdir(dir, { recursive: true });
  const localPath = path.join(dir, safe);
  await fs.promises.writeFile(localPath, body);
  return { url: uploadPublicUrl(safe), localPath };
}

export function uploadPathCandidates(filename: string): string[] {
  const safe = sanitizeUploadFilename(filename);
  if (!safe) return [];
  return [
    path.join(uploadsDataDir(), safe),
    path.join(uploadsLegacyPublicDir(), safe),
  ];
}

export function resolveExistingUploadPath(filename: string): string | null {
  for (const candidate of uploadPathCandidates(filename)) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

export function filenameFromUploadUrl(url: string): string | null {
  if (!url.startsWith("/uploads/")) return null;
  return sanitizeUploadFilename(url.slice("/uploads/".length));
}

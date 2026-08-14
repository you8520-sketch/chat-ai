const UPLOADS_PATH_PREFIX = "/uploads/";
const VERCEL_PUBLIC_BLOB_HOST_RE =
  /^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/i;

export function isVercelPublicBlobUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === "https:" &&
      VERCEL_PUBLIC_BLOB_HOST_RE.test(url.hostname) &&
      url.pathname.startsWith(UPLOADS_PATH_PREFIX)
    );
  } catch {
    return false;
  }
}

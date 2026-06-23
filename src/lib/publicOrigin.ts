/** Browser-facing origin for OAuth redirects — Google rejects `0.0.0.0`. */
export function resolvePublicOrigin(req: Request): string {
  const configured =
    process.env.GOOGLE_OAUTH_ORIGIN?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    process.env.APP_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      /* invalid env URL — fall through */
    }
  }

  const url = new URL(req.url);
  const forwardedHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (forwardedHost && process.env.NODE_ENV === "production") {
    const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
    return `${proto}://${forwardedHost}`;
  }

  const hostHeader = req.headers.get("host");
  if (hostHeader && hostHeader.split(":")[0] !== "0.0.0.0") {
    return `${url.protocol}//${hostHeader}`;
  }

  if (url.hostname === "0.0.0.0" || url.hostname === "[::]") {
    const port = url.port;
    const portSuffix = !port || port === "80" || port === "443" ? "" : `:${port}`;
    return `${url.protocol}//localhost${portSuffix}`;
  }

  return url.origin;
}

export function googleOAuthCallbackUrl(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/auth/google/callback`;
}

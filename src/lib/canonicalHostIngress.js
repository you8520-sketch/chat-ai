/**
 * Canonical-host ingress owner.
 *
 * src/lib/publicOrigin.ts owns the configured public origin used to build
 * URLs, including the Google OAuth callback. This module owns the HTTP door
 * in server.js: a browser that enters on the Railway public hostname is sent
 * to https://hav.chat before Next.js, auth, or session code runs.
 *
 * OAuth state cookies stay host-only. This redirect does not share them
 * across hosts and does not relax callback state checks.
 *
 * Railway deploy healthchecks request Host healthcheck.railway.app and path
 * /health (railway.toml). /health is answered by this process unchanged so a
 * healthcheck is never turned into a redirect.
 */

const CANONICAL_PUBLIC_ORIGIN = "https://hav.chat";
const ALTERNATE_PUBLIC_HOST = "chat-ai-production-4275.up.railway.app";
const HEALTHCHECK_PATH = "/health";

function headerValue(headers, name) {
  if (!headers) return undefined;
  if (headers[name] != null) return headers[name];
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  return key ? headers[key] : undefined;
}

function firstHeaderValue(value) {
  if (Array.isArray(value)) return firstHeaderValue(value[0]);
  if (typeof value !== "string") return "";
  return value.split(",")[0].trim();
}

function hostnameFromHeader(value) {
  const raw = firstHeaderValue(value).toLowerCase().replace(/\.+$/, "");
  if (!raw || /[\s/\\]/.test(raw)) return "";
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    return end === -1 ? "" : raw.slice(1, end);
  }
  const host = raw.split(":")[0];
  return /^[a-z0-9.-]+$/.test(host) ? host : "";
}

/** Browser-facing host. A proxy's X-Forwarded-Host wins over the bind address. */
function observedPublicHost(headers) {
  const forwarded = hostnameFromHeader(headerValue(headers, "x-forwarded-host"));
  if (forwarded) return forwarded;
  return hostnameFromHeader(headerValue(headers, "host"));
}

function requestTarget(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) return "/";
  if (!rawUrl.startsWith("/") || rawUrl.startsWith("//") || /[\r\n\0\\]/.test(rawUrl)) return "/";
  return rawUrl;
}

function pathnameOf(target) {
  const queryAt = target.indexOf("?");
  return queryAt === -1 ? target : target.slice(0, queryAt);
}

function canonicalHostDecision(req) {
  const target = requestTarget(req && req.url);
  if (pathnameOf(target) === HEALTHCHECK_PATH) return { action: "pass" };
  if (observedPublicHost(req && req.headers) !== ALTERNATE_PUBLIC_HOST) return { action: "pass" };
  return {
    action: "redirect",
    status: 308,
    location: `${CANONICAL_PUBLIC_ORIGIN}${target}`,
  };
}

function canonicalHostRedirect(req, res) {
  const decision = canonicalHostDecision(req);
  if (decision.action !== "redirect") return false;
  res.writeHead(decision.status, { Location: decision.location });
  res.end();
  return true;
}

module.exports = {
  ALTERNATE_PUBLIC_HOST,
  CANONICAL_PUBLIC_ORIGIN,
  HEALTHCHECK_PATH,
  canonicalHostDecision,
  canonicalHostRedirect,
};

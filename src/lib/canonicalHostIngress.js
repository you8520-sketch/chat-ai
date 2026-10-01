/**
 * Canonical-host ingress owner.
 *
 * Redirect target comes from getConfiguredPublicOrigin() in publicOrigin.ts,
 * the same owner used for OAuth callback and metadata URLs. Production start
 * is `tsx server.js`, which can require that module directly.
 *
 * The alternate hostname comes from Railway's RAILWAY_PUBLIC_DOMAIN. When that
 * variable is empty, this process does not redirect.
 *
 * OAuth state cookies stay host-only. This redirect does not share them
 * across hosts and does not relax callback state checks.
 *
 * Railway deploy healthchecks request Host healthcheck.railway.app and path
 * /health (railway.toml). /health is answered by this process unchanged so a
 * healthcheck is never turned into a redirect.
 */

const { getConfiguredPublicOrigin } = require("./publicOrigin.ts");

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

function railwayPublicHost() {
  const raw = process.env.RAILWAY_PUBLIC_DOMAIN;
  if (typeof raw !== "string" || !raw.trim()) return "";
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      return new URL(trimmed).hostname.toLowerCase();
    } catch {
      return "";
    }
  }
  return hostnameFromHeader(trimmed);
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

  const alternate = railwayPublicHost();
  if (!alternate || observedPublicHost(req && req.headers) !== alternate) return { action: "pass" };

  const canonical = getConfiguredPublicOrigin();
  if (!canonical) return { action: "pass" };
  let canonicalHost = "";
  try {
    canonicalHost = new URL(canonical).hostname.toLowerCase();
  } catch {
    return { action: "pass" };
  }
  if (!canonicalHost || canonicalHost === alternate) return { action: "pass" };

  return {
    action: "redirect",
    status: 308,
    location: `${canonical}${target}`,
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
  HEALTHCHECK_PATH,
  canonicalHostDecision,
  canonicalHostRedirect,
};

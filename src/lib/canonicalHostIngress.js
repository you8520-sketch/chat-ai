/**
 * Canonical-host ingress owner.
 *
 * Redirect target comes from getConfiguredPublicOrigin() in publicOrigin.ts,
 * the same owner used for OAuth callback and metadata URLs.
 *
 * Railway-provided RAILWAY_PUBLIC_DOMAIN may resolve to a customer domain when
 * a custom domain is attached, so it is not a reliable identifier for the
 * generated *.up.railway.app entrypoint. The ingress therefore classifies
 * Railway-generated hostnames by Railway's public-domain namespace instead of
 * duplicating a concrete generated hostname.
 *
 * OAuth state cookies stay host-only. This redirect does not share them
 * across hosts and does not relax callback state checks.
 *
 * Railway deploy healthchecks request path /health. /health is answered by
 * this process unchanged so a healthcheck is never turned into a redirect.
 */

const { getConfiguredPublicOrigin } = require("./publicOrigin.ts");

const HEALTHCHECK_PATH = "/health";
const RAILWAY_GENERATED_HOST_SUFFIX = ".up.railway.app";

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

function isRailwayGeneratedPublicHost(hostname) {
  return (
    typeof hostname === "string" &&
    hostname.length > RAILWAY_GENERATED_HOST_SUFFIX.length &&
    hostname.endsWith(RAILWAY_GENERATED_HOST_SUFFIX)
  );
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

  const canonical = getConfiguredPublicOrigin();
  if (!canonical) return { action: "pass" };

  let canonicalHost = "";
  try {
    canonicalHost = new URL(canonical).hostname.toLowerCase();
  } catch {
    return { action: "pass" };
  }

  const observed = observedPublicHost(req && req.headers);
  if (!observed || !canonicalHost || observed === canonicalHost) return { action: "pass" };
  if (!isRailwayGeneratedPublicHost(observed)) return { action: "pass" };

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
  RAILWAY_GENERATED_HOST_SUFFIX,
  canonicalHostDecision,
  canonicalHostRedirect,
  isRailwayGeneratedPublicHost,
};

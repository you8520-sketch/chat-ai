import path from "node:path";

export const CONFIG_KEEP_PACKAGES = new Set([
  "typescript",
  "tailwindcss",
  "@tailwindcss/postcss",
  "@playwright/test",
  "jsdom",
  "tsx",
  "next",
  "react",
  "react-dom",
  "server-only",
  "better-sqlite3",
  "sharp",
]);

const FRAMEWORK_BASENAMES = new Set([
  "page.tsx",
  "page.ts",
  "page.jsx",
  "page.js",
  "layout.tsx",
  "layout.ts",
  "route.ts",
  "route.tsx",
  "loading.tsx",
  "error.tsx",
  "not-found.tsx",
  "default.tsx",
  "template.tsx",
  "middleware.ts",
  "instrumentation.ts",
  "opengraph-image.tsx",
  "icon.tsx",
  "apple-icon.tsx",
  "robots.ts",
  "sitemap.ts",
  "manifest.ts",
]);

const FRAMEWORK_ROOT_FILES = new Set([
  "server.js",
  "server.ts",
  "next.config.ts",
  "next.config.js",
  "next.config.mjs",
  "postcss.config.mjs",
  "postcss.config.js",
  "playwright.config.ts",
  "tailwind.config.ts",
  "tsconfig.json",
  "tsconfig.app.json",
  "package.json",
  "package-lock.json",
]);

const NEXT_SPECIAL_EXPORTS = new Set([
  "default",
  "metadata",
  "generateMetadata",
  "generateStaticParams",
  "generateViewport",
  "viewport",
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "runtime",
  "dynamic",
  "revalidate",
  "preferredRegion",
  "maxDuration",
  "fetchCache",
  "dynamicParams",
  "unstable_prefetch",
]);

const STOP_PATH_RE =
  /(^|\/)(auth|adminAuth|isAdminUser|adult|billing|payout|payment|portone|pricing|chatModels|openRouterAdult|db)\b/i;

export function toPosix(relPath: string): string {
  return relPath.split(path.sep).join("/");
}

export function isIgnoredScanPath(relPath: string): boolean {
  const posix = toPosix(relPath);
  return (
    posix.startsWith("node_modules/") ||
    posix.startsWith(".next/") ||
    posix.startsWith(".next-dev/") ||
    posix.startsWith("data/") ||
    posix.startsWith(".git/") ||
    posix.startsWith("coverage/") ||
    posix.includes("/node_modules/") ||
    posix.endsWith(".png") ||
    posix.endsWith(".jpg") ||
    posix.endsWith(".webp") ||
    posix.endsWith(".db")
  );
}

export function isFrameworkEntry(relPath: string): boolean {
  const posix = toPosix(relPath);
  if (FRAMEWORK_ROOT_FILES.has(posix)) return true;
  return FRAMEWORK_BASENAMES.has(path.posix.basename(posix));
}

export function isSchedulerOnlyEntry(relPath: string): boolean {
  const posix = toPosix(relPath);
  return posix.startsWith("src/cron/") || posix === "src/lib/schedulerDefinitions.ts";
}

export function isScriptEntry(relPath: string): boolean {
  return toPosix(relPath).startsWith("scripts/");
}

export function isTestEntry(relPath: string): boolean {
  const posix = toPosix(relPath);
  return (
    /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(posix) ||
    posix.includes("/__tests__/") ||
    posix.includes("/__fixtures__/")
  );
}

export function isMigrationOrSchemaEntry(relPath: string): boolean {
  const posix = toPosix(relPath);
  return posix === "src/lib/db.ts" || /migration/i.test(posix);
}

export function isProviderAdapterEntry(relPath: string): boolean {
  const posix = toPosix(relPath);
  return (
    /Adapter/i.test(posix) ||
    posix.includes("openRouter") ||
    posix.includes("cheaperInference") ||
    posix.includes("provider")
  );
}

export function isWorkflowEntry(relPath: string): boolean {
  return toPosix(relPath).startsWith(".github/");
}

export function isKeepPath(relPath: string): boolean {
  return (
    isFrameworkEntry(relPath) ||
    isSchedulerOnlyEntry(relPath) ||
    isScriptEntry(relPath) ||
    isTestEntry(relPath) ||
    isMigrationOrSchemaEntry(relPath) ||
    isProviderAdapterEntry(relPath) ||
    isWorkflowEntry(relPath)
  );
}

export function isNextSpecialExport(name: string): boolean {
  return NEXT_SPECIAL_EXPORTS.has(name);
}

export function isProtectedBoundaryPath(relPath: string): boolean {
  return STOP_PATH_RE.test(toPosix(relPath));
}

export function isKeepPackage(name: string): boolean {
  if (name.startsWith("@types/")) return true;
  return CONFIG_KEEP_PACKAGES.has(name);
}

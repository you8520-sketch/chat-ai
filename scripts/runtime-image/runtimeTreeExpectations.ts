/** Root packages that must appear in `npm ls --omit=dev --depth=0` after prune. */
export const REQUIRED_ROOT_RUNTIME_PACKAGES = ["tsx", "next", "sharp"] as const;

/** Root packages that must NOT appear in `npm ls --omit=dev --depth=0` after prune. */
export const FORBIDDEN_ROOT_RUNTIME_PACKAGES = [
  "@playwright/test",
  "typescript",
  "tailwindcss",
  "@tailwindcss/postcss",
  "@types/node",
  "@types/react",
  "@types/react-dom",
  "@types/sharp",
  "@types/better-sqlite3",
  "@types/dompurify",
  "@types/node-cron",
  "@types/web-push",
] as const;

/** Directories that should not exist under node_modules after prune (build/test tooling). */
export const FORBIDDEN_NODE_MODULES_DIRS = [
  "typescript",
  "tailwindcss",
  "@tailwindcss/postcss",
] as const;

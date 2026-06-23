import type { NextConfig } from "next";

/** dev → .next-dev (build와 분리) · production build/start → .next */
const distDir =
  process.env.NEXT_DIST_DIR ??
  (process.env.NODE_ENV === "production" ? ".next" : ".next-dev");

const nextConfig: NextConfig = {
  distDir,
  serverExternalPackages: ["better-sqlite3"],
  allowedDevOrigins: ["127.0.0.1"],
};
export default nextConfig;

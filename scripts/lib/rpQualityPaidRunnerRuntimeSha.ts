/**
 * Independent runtime SHA observer. Reuses PRECALL's full-SHA rule and the
 * same Railway container env the production row loader already trusts.
 */
import { isFullGitSha } from "@/lib/rpQualityPrecall";

export function observePaidRunnerRuntimeSha(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const raw = env.RAILWAY_GIT_COMMIT_SHA?.trim().toLowerCase() ?? "";
  return isFullGitSha(raw) ? raw : null;
}

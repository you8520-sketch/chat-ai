/**
 * Prose style-section resolver — single slot: Legacy | VNext | Muse M1 | Shared Novel V2.
 *
 * Muse routing:
 *   1. M1 admin or M1 public rollout → MUSE_PROSE_M1_STYLE_SECTION
 *   2. VNext admin canary only → PROSE_VNEXT_STYLE_SECTION (controlled Muse×VNext test)
 *   3. VNext public rollout never applies to Muse
 *   4. otherwise → Legacy (undefined)
 *
 * Shared Novel Prose V2 (admin allowlist, exact 3 models):
 *   Luna gpt-5.6-luna, DeepSeek deepseek-v4-pro, Gemini google/gemini-3.6-flash.
 *   After the base route is chosen, if V2 gate is ON, swap to the V2 body for
 *   that same route family. Gate OFF → byte-identical to prior assembly.
 *   Muse is not in the V2 allowlist for this experiment phase.
 *
 * Non-Muse: PR #104 isProseVNextOn semantics unchanged when V2 is OFF.
 */

import { MUSE_PROSE_M1_STYLE_SECTION } from "@/lib/proseMuseM1";
import {
  isMuseM1EnabledForUser,
  isMuseM1RolloutEnabledForModel,
  isMuseSparkModel,
} from "@/lib/proseMuseM1Policy";
import { PROSE_VNEXT_STYLE_SECTION } from "@/lib/proseVNext";
import {
  isProseVNextEnabledForUser,
  isProseVNextOn,
} from "@/lib/proseVNextPolicy";
import { isSharedNovelProseV2EnabledForUser } from "@/lib/sharedNovelProseV2Policy";
import {
  MUSE_PROSE_M1_STYLE_SECTION_V2,
  PROSE_STYLE_SECTION_V2,
  PROSE_VNEXT_STYLE_SECTION_V2,
} from "@/lib/sharedNovelProseV2Styles";

type BaseRoute = "legacy" | "vnext" | "muse-m1";

function resolveBaseProseRoute(
  userId: number | null | undefined,
  modelId?: string | null | undefined
): BaseRoute {
  if (isMuseSparkModel(modelId)) {
    if (
      isMuseM1EnabledForUser(userId, modelId) ||
      isMuseM1RolloutEnabledForModel(modelId)
    ) {
      return "muse-m1";
    }
    if (isProseVNextEnabledForUser(userId, modelId)) {
      return "vnext";
    }
    return "legacy";
  }

  if (isProseVNextOn(userId, modelId)) {
    return "vnext";
  }
  return "legacy";
}

/**
 * Returns the prose style-section override, or undefined for legacy PROSE_STYLE_SECTION.
 */
export function resolveProseStyleSection(
  userId: number | null | undefined,
  modelId?: string | null | undefined
): string | undefined {
  const route = resolveBaseProseRoute(userId, modelId);
  const v2 = isSharedNovelProseV2EnabledForUser(userId, modelId);

  if (v2) {
    if (route === "muse-m1") return MUSE_PROSE_M1_STYLE_SECTION_V2;
    if (route === "vnext") return PROSE_VNEXT_STYLE_SECTION_V2;
    return PROSE_STYLE_SECTION_V2;
  }

  if (route === "muse-m1") return MUSE_PROSE_M1_STYLE_SECTION;
  if (route === "vnext") return PROSE_VNEXT_STYLE_SECTION;
  return undefined;
}

/** Test/audit helper — base route family before V2 body swap. */
export function resolveProseStyleRouteName(
  userId: number | null | undefined,
  modelId?: string | null | undefined
): BaseRoute {
  return resolveBaseProseRoute(userId, modelId);
}

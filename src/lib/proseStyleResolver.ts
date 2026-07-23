/**
 * Prose style-section resolver — single slot: Legacy | VNext | Muse M1.
 *
 * Muse routing:
 *   1. M1 admin or M1 public rollout → MUSE_PROSE_M1_STYLE_SECTION
 *   2. VNext admin canary only → PROSE_VNEXT_STYLE_SECTION (controlled Muse×VNext test)
 *   3. VNext public rollout never applies to Muse
 *   4. otherwise → Legacy (undefined)
 *
 * Non-Muse: PR #104 isProseVNextOn semantics unchanged.
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

/**
 * Returns the prose style-section override, or undefined for legacy PROSE_STYLE_SECTION.
 */
export function resolveProseStyleSection(
  userId: number | null | undefined,
  modelId?: string | null | undefined
): string | undefined {
  if (isMuseSparkModel(modelId)) {
    if (isMuseM1EnabledForUser(userId, modelId) || isMuseM1RolloutEnabledForModel(modelId)) {
      return MUSE_PROSE_M1_STYLE_SECTION;
    }
    if (isProseVNextEnabledForUser(userId, modelId)) {
      return PROSE_VNEXT_STYLE_SECTION;
    }
    return undefined;
  }

  if (isProseVNextOn(userId, modelId)) {
    return PROSE_VNEXT_STYLE_SECTION;
  }
  return undefined;
}

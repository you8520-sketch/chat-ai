/**
 * Public chat-body discovery inputs.
 * Authoritative payloads are ignored here — never execute from HTTP body.
 */

import { parseInvestigationExplicitActions } from "@/lib/investigationRequests";
import { parseKnowledgeTransferActions } from "@/lib/knowledgeTransferActions";
import type { PersonaSecretTransferAction } from "@/lib/knowledgeTransferTypes";
import type { InvestigationExplicitAction } from "@/lib/investigationTypes";
import { parseUserScenePresenceActions } from "@/lib/scenePresenceActions";
import type { ScenePresenceAction } from "@/lib/observerTypes";

export type PublicChatDiscoveryInputs = {
  knowledgeTransferActions: PersonaSecretTransferAction[];
  investigationActions: InvestigationExplicitAction[];
  scenePresenceActions: ScenePresenceAction[];
  /** Fields present on body but intentionally not executed. */
  ignoredAuthoritativeFields: string[];
};

const IGNORED_AUTHORITATIVE_FIELDS = [
  "knowledgeTransferAuthoritativeActions",
  "investigationOutcomes",
] as const;

/**
 * Extract only user-allowed discovery actions from a public chat request body.
 * SERVER/CREATOR/ADMIN source forgeries inside user arrays are dropped by parsers.
 */
export function extractPublicChatDiscoveryInputs(
  body: Record<string, unknown> | null | undefined
): PublicChatDiscoveryInputs {
  const b = body && typeof body === "object" ? body : {};
  const ignoredAuthoritativeFields = IGNORED_AUTHORITATIVE_FIELDS.filter(
    (k) => b[k] != null
  );

  return {
    knowledgeTransferActions: parseKnowledgeTransferActions(
      b.knowledgeTransferActions
    ),
    investigationActions: parseInvestigationExplicitActions(
      b.investigationActions
    ),
    scenePresenceActions: parseUserScenePresenceActions(b.scenePresenceActions),
    ignoredAuthoritativeFields: [...ignoredAuthoritativeFields],
  };
}

import {
  isPersonaSecretBoundaryEnabled,
  isPersonaSecretDiscoveryEnabled,
} from "@/lib/personaSecretBoundaryPolicy";

/** Safe owner capability contract. Environment and rollout details stay server-only. */
export type PersonaSecretSettingsCapability = {
  canEdit: boolean;
  discoveryActive: boolean;
};

export function getPersonaSecretSettingsCapability(userId: number): PersonaSecretSettingsCapability {
  const canEdit = isPersonaSecretBoundaryEnabled({ userId });
  return {
    canEdit,
    // Defense in depth: Discovery must never appear enabled ahead of Boundary.
    discoveryActive: canEdit && isPersonaSecretDiscoveryEnabled({ userId }),
  };
}

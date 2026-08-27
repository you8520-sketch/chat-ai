/**
 * Production rollout gate for the S4 same-generation live producer only.
 * Default-off: missing or any value other than exact "1" is disabled.
 */
export function isPersonaSecretS4LiveProducerEnabled(): boolean {
  return process.env.PERSONA_SECRET_S4_LIVE_PRODUCER_ENABLED === "1";
}

export type TrpgRoundSourceScene = {
  location: string;
  actions: ReadonlyArray<{ name: string; body: string }>;
  narration: string;
};

/**
 * Canonical raw structured source for a selected TRPG round. Single owner shared
 * by the TRPG illustration and TRPG comic production paths — no per-format
 * source fork. Consumers (illustration/comic prompt builders) apply their own
 * safe projection and content policy, not this composer.
 */
export function buildTrpgRoundSourceText(scene: TrpgRoundSourceScene): string {
  const lines: string[] = [];
  const location = scene.location.trim();
  if (location) lines.push(`장소: ${location}`);
  for (const action of scene.actions) {
    const body = action.body.trim();
    if (body) lines.push(`${action.name}: ${body}`);
  }
  const narration = scene.narration.trim();
  if (narration) lines.push(narration);
  return lines.join("\n");
}
export type TrpgBotActionContext = {
  characterName: string;
  personaPrompt: string;
  previousGmNarration: string;
  humanActions: Array<{ playerName: string; text: string }>;
};

/**
 * Flash (not the GM Pro call) drafts a bot action after humans have locked.
 * Host may replace the draft via host_fill if this generation fails.
 */
export function buildTrpgBotActionUserBlock(ctx: TrpgBotActionContext): string {
  const humans =
    ctx.humanActions.length === 0
      ? "(아직 다른 유저 행동 없음 — 직전 장면만 보고 행동)"
      : ctx.humanActions.map((a) => `- ${a.playerName}: ${a.text}`).join("\n");
  return [
    "[TRPG BOT ACTION — write ONLY this character's next in-world action. Korean.]",
    `[CHARACTER]\n${ctx.characterName}`,
    ctx.personaPrompt.trim() ? `[PERSONA]\n${ctx.personaPrompt.trim()}` : "",
    `[PREVIOUS GM SCENE]\n${ctx.previousGmNarration.trim() || "(캠페인 시작)"}`,
    `[HUMAN ACTIONS THIS ROUND — already locked]\n${humans}`,
    "Rules: stay in character. Do not roll dice. Do not declare success or failure. Do not control other PCs or NPCs. 50–400 characters.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function sanitizeBotActionText(raw: string, maxChars = 400): string {
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  const chars = Array.from(trimmed);
  return chars.length > maxChars ? chars.slice(0, maxChars).join("").trimEnd() : trimmed;
}

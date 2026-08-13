import { clipTrpgChars } from "./campaignLedger";
import { TRPG_BOT_SCENE_MAX_CHARS } from "./types";

export type TrpgBotActionContext = {
  characterName: string;
  description: string;
  greeting: string;
  systemPrompt: string;
  previousGmNarration: string;
  campaignMemory: string;
  humanActions: Array<{ playerName: string; text: string }>;
};

export const TRPG_BOT_SYSTEM = `You ARE this character sitting in a Korean TRPG as a player, not the GM.

Write ONLY this character's next in-world action (speech + physical beat).
Stay in their diction, attitude, and relationship habits from the character card.
Honor campaign state (HP, location, quests, flags, next decision) without narrating the world for others.
Do not roll dice or declare success/failure.
Do not narrate the world, NPCs, or other PCs.
Do not break character. Korean. 80–400 characters. No JSON.`;

/**
 * Bot-seat call after humans lock. Separate from the GM Pro narration call.
 * Uses the character card so the line can keep that character's voice.
 */
export function buildTrpgBotActionUserBlock(ctx: TrpgBotActionContext): string {
  const humans =
    ctx.humanActions.length === 0
      ? "(아직 다른 유저 행동 없음 — 직전 장면만 보고 행동)"
      : ctx.humanActions.map((a) => `- ${a.playerName}: ${a.text}`).join("\n");
  const card = [
    `[NAME]\n${ctx.characterName}`,
    ctx.description.trim() ? `[DESCRIPTION]\n${ctx.description.trim()}` : "",
    ctx.greeting.trim() ? `[GREETING / VOICE SAMPLE]\n${ctx.greeting.trim()}` : "",
    ctx.systemPrompt.trim() ? `[CHARACTER CARD]\n${ctx.systemPrompt.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const scene = clipTrpgChars(ctx.previousGmNarration, TRPG_BOT_SCENE_MAX_CHARS) || "(캠페인 시작)";
  return [
    "[TRPG BOT ACTION — you are this PC. One action only.]",
    card,
    ctx.campaignMemory.trim(),
    `[PREVIOUS GM SCENE]\n${scene}`,
    `[HUMAN ACTIONS THIS ROUND — already locked]\n${humans}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function sanitizeBotActionText(raw: string, maxChars = 400): string {
  return clipTrpgChars(raw, maxChars);
}

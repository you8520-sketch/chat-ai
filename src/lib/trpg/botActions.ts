import { clipTrpgChars } from "./campaignLedger";
import { TRPG_BOT_AIM_CHARS, TRPG_BOT_MIN_CHARS, TRPG_BOT_SCENE_MAX_CHARS } from "./types";

export type TrpgBotActionContext = {
  characterName: string;
  description: string;
  greeting: string;
  systemPrompt: string;
  exampleDialog?: string;
  world?: string;
  previousGmNarration: string;
  campaignMemory: string;
  humanActions: Array<{ playerName: string; text: string }>;
  companionActions?: Array<{ name: string; text: string }>;
  speakIndex?: number;
  speakCount?: number;
  relationshipBrief?: string;
};

export type TrpgBotSpeakOrder = { id: number; name: string };

export const TRPG_BOT_SYSTEM = `You ARE this character sitting in a Korean TRPG as a player, not the GM.

Write ONLY this character's next in-world action (speech + physical beat).
Stay in their diction, attitude, and relationship habits from the character card and PARTY RELATIONSHIPS.
Honor campaign state (HP, location, quests, flags, next decision) without narrating the world for others.
Do not roll dice or declare success/failure.
Do not narrate the world, NPCs, or other PCs as if you were the GM.
Do not break character. Korean. No JSON.

Length: write at least ${TRPG_BOT_MIN_CHARS} Korean characters, aim about ${TRPG_BOT_AIM_CHARS}. Include spoken lines and a physical beat — not a one-liner.

Turn order: the human already acted this round. If EARLIER COMPANION ACTIONS exist, those PCs already spoke. Do not shout the same warning at the human. Do not answer in chorus. React to what already happened, then take the next beat.`;

function nameAliases(name: string): string[] {
  const n = name.trim();
  if (!n) return [];
  const out = [n];
  if (/^[가-힣]{3,4}$/.test(n)) out.push(n.slice(1));
  return out;
}

function lastIndexOfAny(hay: string, aliases: readonly string[]): number {
  let best = -1;
  for (const alias of aliases) {
    if (!alias) continue;
    const idx = hay.lastIndexOf(alias);
    if (idx > best) best = idx;
  }
  return best;
}

/**
 * Who answers after the human: addressed by name first, else most recently
 * in the previous scene, else party slot order.
 */
export function orderTrpgBotsForRound(opts: {
  bots: readonly TrpgBotSpeakOrder[];
  humanActions: Array<{ playerName: string; text: string }>;
  previousGmNarration: string;
}): TrpgBotSpeakOrder[] {
  if (opts.bots.length <= 1) return [...opts.bots];
  const hayHuman = opts.humanActions.map((a) => a.text).join("\n");
  const scene = opts.previousGmNarration;
  return opts.bots
    .map((bot, slot) => {
      const aliases = nameAliases(bot.name);
      const inHuman = lastIndexOfAny(hayHuman, aliases);
      const inScene = lastIndexOfAny(scene, aliases);
      const score = inHuman >= 0 ? 1_000_000 + inHuman : inScene;
      return { bot, slot, score };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.slot - b.slot;
    })
    .map((row) => row.bot);
}

export function buildTrpgBotActionUserBlock(ctx: TrpgBotActionContext): string {
  const humans =
    ctx.humanActions.length === 0
      ? "(아직 다른 유저 행동 없음 — 직전 장면만 보고 행동)"
      : ctx.humanActions.map((a) => `- ${a.playerName}: ${a.text}`).join("\n");
  const companions = ctx.companionActions ?? [];
  const earlier =
    companions.length === 0
      ? "(없음 — 당신이 인간 다음 첫 번째 동료)"
      : companions.map((a) => `- ${a.name}: ${a.text}`).join("\n");
  const speakCount = ctx.speakCount ?? 1;
  const speakIndex = ctx.speakIndex ?? 1;
  const card = [
    `[NAME]\n${ctx.characterName}`,
    ctx.description.trim() ? `[DESCRIPTION]\n${ctx.description.trim()}` : "",
    ctx.greeting.trim() ? `[GREETING / VOICE SAMPLE]\n${ctx.greeting.trim()}` : "",
    ctx.exampleDialog?.trim() ? `[EXAMPLE DIALOG]\n${ctx.exampleDialog.trim()}` : "",
    ctx.world?.trim() ? `[WORLD / SETTING]\n${ctx.world.trim()}` : "",
    ctx.systemPrompt.trim() ? `[CHARACTER CARD]\n${ctx.systemPrompt.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const scene = clipTrpgChars(ctx.previousGmNarration, TRPG_BOT_SCENE_MAX_CHARS) || "(캠페인 시작)";
  return [
    "[TRPG BOT ACTION — you are this PC. One action only.]",
    `[LENGTH] At least ${TRPG_BOT_MIN_CHARS} Korean characters, aim ~${TRPG_BOT_AIM_CHARS}.`,
    `[SPEAK ORDER] Human already acted. You are companion ${speakIndex} of ${speakCount} this round. Do not talk over earlier companions.`,
    card,
    ctx.relationshipBrief?.trim()
      ? `[PARTY RELATIONSHIPS — how you know the human and other PCs]\n${ctx.relationshipBrief.trim()}`
      : "",
    ctx.campaignMemory.trim(),
    `[PREVIOUS GM SCENE]\n${scene}`,
    `[HUMAN ACTIONS THIS ROUND — already locked]\n${humans}`,
    `[EARLIER COMPANION ACTIONS THIS ROUND]\n${earlier}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function sanitizeBotActionText(raw: string, maxChars = TRPG_BOT_AIM_CHARS): string {
  return clipTrpgChars(raw, maxChars);
}

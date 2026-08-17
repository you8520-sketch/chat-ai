import { parseTrpgBotAction, TRPG_BOT_INTENT_OPEN } from "./botActionParse";
import { clipTrpgChars } from "./clip";
import { TRPG_MEMORY_BOT_CONTINUITY_BUDGET } from "./memoryHorizon";
import {
  TRPG_BOT_ACTION_MAX_CHARS,
  TRPG_BOT_AIM_CHARS,
  TRPG_BOT_MIN_CHARS,
  TRPG_BOT_SCENE_MAX_CHARS,
} from "./types";

export {
  parseTrpgBotAction,
  sanitizeBotActionText,
  finishAtSentenceBoundary,
  TRPG_BOT_INTENT_OPEN,
} from "./botActionParse";

export type TrpgBotActionContext = {
  characterName: string;
  description: string;
  greeting: string;
  systemPrompt: string;
  exampleDialog?: string;
  world?: string;
  campaignWorld?: string;
  previousGmNarration: string;
  campaignMemory: string;
  recentContinuity?: string;
  longTermMemories?: string;
  compactContinuity?: string;
  humanActions: Array<{ playerName: string; text: string }>;
  companionActions?: Array<{ name: string; text: string }>;
  speakIndex?: number;
  speakCount?: number;
  relationshipBrief?: string;
  scenarioAssetPrompt?: string;
};

export type TrpgBotSpeakOrder = { id: number; name: string };

export const TRPG_BOT_SYSTEM = `You ARE this character sitting in a Korean TRPG as a player, not the GM.

Write one finished novelistic beat: what you notice, how you react, how you move, and spoken lines only if this character actually talks.
Stay in their diction, attitude, example dialogue, and PARTY RELATIONSHIPS.
Honor campaign world, recent continuity, and campaign state (HP, location, quests, flags, next decision).
If CHARACTER CARD WORLD conflicts with CAMPAIGN WORLD, the current campaign world wins.
Honor [MY LONG-TERM MEMORIES] only as this character already knows them. They are past facts, not current HP or inventory.
You may describe the world only as THIS character perceives it. Do not decide other PCs' inner lives or actions. Do not resolve the round. Do not write a GM recap. Do not roll dice or declare success/failure. Korean. No JSON.

Length: ${TRPG_BOT_MIN_CHARS}–${TRPG_BOT_ACTION_MAX_CHARS} Korean characters (aim about ${TRPG_BOT_AIM_CHARS}). Stop on a finished sentence. Never cut a clause short. If you are near the cap, end the current sentence instead of starting a new one.

[PROSE LAYOUT]
Write Korean web-novel prose.
Narration and actual spoken dialogue are separate paragraphs.
If this character actually speaks:
- put the spoken line in double quotes
- give that spoken line its own paragraph
- do not place narration before or after it in the same paragraph
Use meaningful narration paragraphs rather than one giant wall of text.
Do not create a new paragraph for every sentence.
Keep the existing 300–800 character contract.

Turn order: the human already acted this round. If EARLIER COMPANION ACTIONS exist, those PCs already spoke. Do not shout the same warning at the human. Do not answer in chorus. React to what already happened, then take the next beat.

After the finished prose, end with exactly this marker and one third-person concrete attempt (subject + optional target + attempt). One line. Do not declare a finished result. Do not write only a quoted question.
${TRPG_BOT_INTENT_OPEN}
(한 줄: 이 캐릭터가 이번 라운드에 실제로 시도하는 행동. 예: 강이현은 렌의 팔을 잡아 잔해 뒤로 끌어당기려 했다.)`;

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
      : ctx.humanActions.map((a) => `- ${a.playerName}: ${clipTrpgChars(a.text, 220)}`).join("\n");
  const companions = ctx.companionActions ?? [];
  const earlier =
    companions.length === 0
      ? "(없음 — 당신이 인간 다음 첫 번째 동료)"
      : companions
          .map((a) => {
            const parsed = parseTrpgBotAction(a.text);
            const attempt = parsed.intent.trim() || clipTrpgChars(parsed.prose || a.text, 220);
            return `- ${a.name}: ${attempt}`;
          })
          .join("\n");
  const speakCount = ctx.speakCount ?? 1;
  const speakIndex = ctx.speakIndex ?? 1;
  const card = [
    `[NAME]\n${ctx.characterName}`,
    ctx.description.trim() ? `[DESCRIPTION]\n${ctx.description.trim()}` : "",
    ctx.greeting.trim() ? `[GREETING / VOICE SAMPLE]\n${ctx.greeting.trim()}` : "",
    ctx.exampleDialog?.trim() ? `[EXAMPLE DIALOG]\n${ctx.exampleDialog.trim()}` : "",
    ctx.world?.trim() ? `[CHARACTER CARD WORLD / BACKGROUND]\n${ctx.world.trim()}` : "",
    ctx.systemPrompt.trim() ? `[CHARACTER CARD]\n${ctx.systemPrompt.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const recent = ctx.recentContinuity?.trim() || ctx.compactContinuity?.trim() || "";
  const sceneBudget = recent
    ? Math.max(400, TRPG_MEMORY_BOT_CONTINUITY_BUDGET - Array.from(recent).length)
    : TRPG_BOT_SCENE_MAX_CHARS;
  const scene = clipTrpgChars(ctx.previousGmNarration, Math.min(TRPG_BOT_SCENE_MAX_CHARS, sceneBudget)) || "(캠페인 시작)";
  return [
    "[TRPG BOT ACTION — you are this PC. Finished beat, then INTENT.]",
    `[LENGTH] ${TRPG_BOT_MIN_CHARS}–${TRPG_BOT_ACTION_MAX_CHARS} Korean characters, aim ~${TRPG_BOT_AIM_CHARS}. Finish the last sentence. Do not exceed ${TRPG_BOT_ACTION_MAX_CHARS}. Then ${TRPG_BOT_INTENT_OPEN} and one third-person attempt, not a finished result.`,
    `[SPEAK ORDER] Human already acted. You are companion ${speakIndex} of ${speakCount} this round. Do not talk over earlier companions.`,
    card,
    ctx.campaignWorld?.trim()
      ? `[CAMPAIGN WORLD — current game canon; wins over character-card world]\n${ctx.campaignWorld.trim()}`
      : "",
    ctx.relationshipBrief?.trim()
      ? `[PARTY RELATIONSHIPS — how you know the human and other PCs]\n${ctx.relationshipBrief.trim()}`
      : "",
    ctx.campaignMemory.trim(),
    ctx.longTermMemories?.trim() ? `[MY LONG-TERM MEMORIES]\n${ctx.longTermMemories.trim()}` : "",
    recent
      ? `[RECENT CONTINUITY — who just did what; not full GM dumps]\n${recent}`
      : "",
    `[PREVIOUS GM SCENE]\n${scene}`,
    `[HUMAN ACTIONS THIS ROUND — already locked]\n${humans}`,
    `[EARLIER COMPANION ACTIONS THIS ROUND]\n${earlier}`,
    ctx.scenarioAssetPrompt?.trim() ?? "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

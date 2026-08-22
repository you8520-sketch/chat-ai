import {
  buildCheaperInferenceHeaders,
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  resolveCheaperInferenceApiKey,
} from "@/lib/cheaperInferenceConfig";
import { isMockApiMode } from "@/lib/mockApiMode";
import { executeDeepSeekBackgroundWithProviderFailover } from "@/lib/deepseekProviderFailover";
import { adaptTrpgReplySuggestionChatBody } from "./replySuggestions";
import type { MechanicsActorInput, TrpgOngoingEffect } from "./mechanicsTypes";
import { TRPG_MECHANICS_REFEREE_MODEL } from "./mechanicsTypes";
import type { TrpgSheetSnapshot } from "./types";

export const TRPG_MECHANICS_REFEREE_MAX_TOKENS = 900;
export const TRPG_MECHANICS_REFEREE_TIMEOUT_MS = 20_000;

export const TRPG_MECHANICS_REFEREE_SYSTEM = `You are a TRPG mechanics referee. JSON only. No prose.

Rules:
- Never change dice, success tier, or player intent.
- Never invent hidden events, enemies, or items.
- Never output final numeric damage or heal amounts.
- Classify only: NONE CHIP LIGHT MEDIUM HEAVY SEVERE CRITICAL.
- Use sourceParticipantId (actor) and targetParticipantId (HP/effect recipient).
- SELF_HEAL / ALLY_HEAL / SELF_TREAT / ALLY_TREAT are allowed. Unknown target is invalid.
- FAILURE is not automatically HP damage.
- Action type is not the damage gate. Harm needs a real threat (enemy, trap, hazard, gunfire) plus cause.
- Investigate/persuade/stealth in a safe room → NONE. No poison on safe SUCCESS.
- Stealth FAILURE under fire or investigate FAILURE on a trap may be harm.
- SUCCESS default is no harm. PARTIAL_SUCCESS may be tradeoff harm.
- Healing only when the action is treatment/support/item.
- V1 ongoing kinds: periodic_harm, control only. Never regen or debuff.
- Ongoing effects use durationBand SHORT|MEDIUM|LONG only.
- Do not invent persistent poison/curse without explicit public specialRules.
- Do not invent an item that is not in inventory or specialRules.
- One object per source→target classification.
Schema example:
{"effects":[{"sourceParticipantId":1,"targetParticipantId":2,"directEffect":"none","directClass":"NONE","cause":"none","ongoingAdd":[],"ongoingRemoveIds":[10],"ongoingReduceIds":[],"consumeItem":"해독제","reason":"ally antidote"}]}`;

export function buildMechanicsRefereeUserBlock(opts: {
  scene: string;
  resolutionOrder: string;
  actors: MechanicsActorInput[];
  sheets: TrpgSheetSnapshot[];
  effects: TrpgOngoingEffect[];
  specialRules?: string;
}): string {
  const actors = opts.actors
    .map((actor) =>
      [
        `participantId=${actor.participantId} name=${actor.name}`,
        `actionType=${actor.actionType ?? "free"}`,
        `intent=${(actor.intent ?? actor.body).slice(0, 240)}`,
        `d20=${actor.d20 ?? "-"} modifier=${actor.modifier ?? "-"} final=${actor.finalScore ?? "-"} DC=${actor.dc ?? "-"} tier=${actor.tier ?? "-"}`,
      ].join("\n")
    )
    .join("\n\n");
  const sheets = opts.sheets
    .map((sheet) =>
      [
        `${sheet.name} id=${sheet.participantId} HP ${sheet.hp}/${sheet.maxHp}`,
        `stats=${JSON.stringify(sheet.stats)}`,
        `conditions=${sheet.conditions.join(",") || "none"}`,
        `inventory=${sheet.inventory.join(",") || "none"}`,
      ].join("\n")
    )
    .join("\n\n");
  const effects = opts.effects.length
    ? opts.effects
        .map(
          (effect) =>
            `id=${effect.id} pc=${effect.participantId} ${effect.label} ${effect.kind} ${effect.severity} ticks=${effect.remainingTicks} recover=${effect.recoveryMode}/${effect.recoveryStat}`
        )
        .join("\n")
    : "none";
  return [
    opts.scene.trim() ? `[SCENE]\n${opts.scene.trim().slice(0, 1200)}` : "",
    opts.resolutionOrder.trim() ? opts.resolutionOrder.trim() : "",
    `[ACTORS]\n${actors || "none"}`,
    `[SHEETS]\n${sheets}`,
    `[ONGOING]\n${effects}`,
    opts.specialRules?.trim() ? `[PUBLIC SPECIAL RULES]\n${opts.specialRules.trim().slice(0, 800)}` : "",
    `Return {"effects":[...]} only.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function callTrpgMechanicsReferee(opts: {
  system: string;
  user: string;
}): Promise<{ text: string; model: string; latencyMs: number }> {
  const model = TRPG_MECHANICS_REFEREE_MODEL;
  const started = Date.now();
  if (isMockApiMode()) {
    return { text: `{"effects":[]}`, model, latencyMs: Date.now() - started };
  }
  const body = adaptTrpgReplySuggestionChatBody({
    model,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    stream: false,
    temperature: 0.2,
    max_tokens: TRPG_MECHANICS_REFEREE_MAX_TOKENS,
    response_format: { type: "json_object" },
  });
  const failover = await executeDeepSeekBackgroundWithProviderFailover({
    primary: {
      endpoint: CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
      headers: buildCheaperInferenceHeaders(resolveCheaperInferenceApiKey()),
      body,
    },
    timeoutMs: TRPG_MECHANICS_REFEREE_TIMEOUT_MS,
  });
  const res = failover.response;
  if (!res.ok) {
    throw new Error(`[TRPG mechanics] ${res.status}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: unknown } }[];
  };
  const text = typeof data.choices?.[0]?.message?.content === "string" ? data.choices[0].message.content : "";
  if (!text.trim()) throw new Error("[TRPG mechanics] empty completion");
  return { text, model, latencyMs: Date.now() - started };
}

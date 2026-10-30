import { TRPG_ACTION_TYPES, isTrpgActionType, type TrpgActionType } from "./actionTypes";
import {
  sanitizeBotActionText,
  TRPG_BOT_ACTION_TYPE_OPEN,
  TRPG_BOT_INTENT_OPEN,
} from "./botActionParse";
import { BOT_EXPLORATION_NO_MOVE } from "./explorationMap";
import { parseTrpgGmStructuredJson } from "./gmStructuredOutput";

/** Provider-native Bot wire format — same json_schema contract as GM. */
export type TrpgBotStructuredAction = {
  prose: string;
  actionType: TrpgActionType;
  intent: string;
  movePlan: string;
};

export function buildTrpgBotResponseFormat(movePlans: readonly string[]): {
  type: "json_schema";
  json_schema: {
    name: "trpg_bot_action";
    strict: true;
    schema: {
      type: "object";
      additionalProperties: false;
      required: ["prose", "actionType", "intent", "movePlan"];
      properties: {
        prose: { type: "string" };
        actionType: { type: "string"; enum: string[] };
        intent: { type: "string" };
        movePlan: { type: "string"; enum: string[] };
      };
    };
  };
} {
  const plans = movePlans.length > 0 ? [...movePlans] : [BOT_EXPLORATION_NO_MOVE];
  return {
    type: "json_schema",
    json_schema: {
      name: "trpg_bot_action",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["prose", "actionType", "intent", "movePlan"],
        properties: {
          prose: { type: "string" },
          actionType: { type: "string", enum: [...TRPG_ACTION_TYPES] },
          intent: { type: "string" },
          movePlan: { type: "string", enum: plans },
        },
      },
    },
  };
}

export function isTrpgBotStructuredShape(value: unknown): value is TrpgBotStructuredAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.prose === "string" &&
    typeof obj.intent === "string" &&
    typeof obj.movePlan === "string" &&
    typeof obj.actionType === "string" &&
    isTrpgActionType(obj.actionType)
  );
}

export function parseTrpgBotStructuredAction(raw: string): TrpgBotStructuredAction | null {
  const parsed = parseTrpgGmStructuredJson(raw);
  if (!isTrpgBotStructuredShape(parsed)) return null;
  return {
    prose: parsed.prose,
    actionType: parsed.actionType,
    intent: parsed.intent,
    movePlan: parsed.movePlan.trim(),
  };
}

export function formatTrpgBotStructuredAsBody(action: TrpgBotStructuredAction): string {
  return sanitizeBotActionText(
    [action.prose, `${TRPG_BOT_ACTION_TYPE_OPEN}\n${action.actionType}`, `${TRPG_BOT_INTENT_OPEN}\n${action.intent}`]
      .filter(Boolean)
      .join("\n\n")
  );
}

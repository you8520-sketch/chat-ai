import type { TrpgStateDelta } from "./types";

/** Provider-native GM wire format — single structural owner. */
export type TrpgGmStructuredOutput = {
  narration: string;
  delta: TrpgStateDelta;
};

export function buildTrpgGmStructuredWireText(
  narration: string,
  delta: Record<string, unknown> = {
    players: [],
    location: "문턱",
    next_round_context: "다음",
    campaign_finished: false,
  }
): string {
  return JSON.stringify({ narration, delta });
}

export const TRPG_GM_STRUCTURED_RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "trpg_gm_output",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["narration", "delta"],
      properties: {
        narration: { type: "string" },
        delta: {
          type: "object",
          additionalProperties: true,
          properties: {
            players: { type: "array" },
            location: { type: "string" },
            next_round_context: { type: "string" },
            campaign_finished: { type: "boolean" },
            questsAdd: { type: "array" },
            questsRemove: { type: "array" },
            npcsAdd: { type: "array" },
            npcsRemove: { type: "array" },
            flagsAdd: { type: "array" },
            flagsRemove: { type: "array" },
            localScene: { type: "object" },
            storyPhase: { type: "string" },
            threadsAdd: { type: "array" },
            threadsResolve: { type: "array" },
            endingConditionId: { type: "string" },
          },
        },
      },
    },
  },
};

export function buildTrpgGmResponseFormat(): typeof TRPG_GM_STRUCTURED_RESPONSE_FORMAT {
  return TRPG_GM_STRUCTURED_RESPONSE_FORMAT;
}

export function parseTrpgGmStructuredJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

export function isTrpgGmStructuredShape(value: unknown): value is TrpgGmStructuredOutput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.narration === "string" && obj.delta != null && typeof obj.delta === "object" && !Array.isArray(obj.delta);
}

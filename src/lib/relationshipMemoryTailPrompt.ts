import {
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_QWEN_37_MAX_MODEL,
  isDeepSeekV4ProModel,
  isQwenModel,
} from "@/lib/chatModels";

/** DeepSeek/Qwen main-model JSON tail for durable relationship memory only. */
export const RELATIONSHIP_MEMORY_SELF_EXTRACT_BLOCK = `[RELATIONSHIP MEMORY — SELF-EXTRACT]
After the RP prose, write exactly one JSON object on the next line.
{"items":[],"itemsRemove":[],"promisesAdd":[],"promisesRemove":[]}

Allowed auto extraction:
- Important items clearly exchanged, entrusted, received, or no longer owned between the user and character/NPC.
- Explicit promises, commitments, unresolved obligations, and promises that were resolved/cancelled this turn.

Forbidden auto extraction:
- Honorifics, nicknames, how characters call each other.
- NPC thoughts, inner_thoughts, emotions, mood, emotion temperature.
- Relationship stage, attachment, possessiveness, obedience, speech style, gender, current location, or atmospheric interpretation.

If uncertain, omit it and use an empty array.
The JSON is hidden from the user and separated by the server.`;

export function isMainModelRelationshipSelfExtractModel(modelId: string): boolean {
  return isDeepSeekV4ProModel(modelId) || isQwenModel(modelId);
}

export const RELATIONSHIP_SELF_EXTRACT_MODEL_IDS = [
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_QWEN_37_MAX_MODEL,
] as const;

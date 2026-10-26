import { isGemini4ArgonModel } from "@/lib/chatModels";

/** TRPG GM usage rows — canonical `gemini-4-argon` or OpenRouter wire `google/gemini-4-argon`. */
export function isTrpgGmBillableModel(modelId: string): boolean {
  return isGemini4ArgonModel(modelId);
}

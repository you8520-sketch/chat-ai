import { ASSISTANT_MESSAGE_MAX, CHAT_MESSAGE_MAX } from "@/lib/chatModels";
import { GREETING_LIMIT } from "@/lib/characterFormLimits";

export type EditableChatMessageKind = {
  role: string;
  model?: string | null;
};

export function isGreetingMessage(message: EditableChatMessageKind): boolean {
  return message.role === "assistant" && message.model === "greeting";
}

export function resolveChatMessageEditLimit(message: EditableChatMessageKind): number {
  if (isGreetingMessage(message)) return GREETING_LIMIT;
  return message.role === "assistant" ? ASSISTANT_MESSAGE_MAX : CHAT_MESSAGE_MAX;
}

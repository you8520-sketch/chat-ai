/** @deprecated openRouterAdult.ts 사용 — 하위 호환 re-export */
export {
  OPENROUTER_ADULT_MODEL as LLAMA_ADULT_MODEL,
  buildAdultSystemPrompt as buildLlamaAdultSystem,
  openRouterGenerationParams as llamaGenerationParams,
  streamOpenRouterAdult as streamLlama,
  streamOpenRouterAdultToClient as streamLlamaToClient,
  callOpenRouterAdult as callLlama,
  OpenRouterApiError,
  OpenRouterAdultError,
  buildOpenRouterMessages,
} from "./openRouterAdult";

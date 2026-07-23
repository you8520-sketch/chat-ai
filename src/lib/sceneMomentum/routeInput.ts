/**
 * Production route helper — assembles the COMMON SceneMomentumInput contract from
 * signals already available on `/api/chat`. No new data collection, no LLM.
 */
import type { ChatMsg } from "@/lib/ai";
import type { MemoryMeta } from "@/lib/chatMemory";
import { formatPromiseLabel } from "@/lib/chatMemory";
import { peelCreatorOpeningGreetingFromHistory } from "@/lib/deepseekOpeningSceneContext";
import type { SceneMomentumInput, SceneMomentumTurn } from "@/lib/sceneMomentum/types";
import { SCENE_MOMENTUM_RECENT_WINDOW } from "@/lib/sceneMomentum/types";

/** Map bounded chat history to role/content-only momentum evidence turns. */
export function toSceneMomentumTurns(history: ChatMsg[]): SceneMomentumTurn[] {
  return history
    .filter(
      (m): m is ChatMsg & { role: "user" | "assistant" } =>
        m.role === "user" || m.role === "assistant"
    )
    .map((m) => ({ role: m.role, content: m.content }));
}

export type BuildSceneMomentumRouteInputOpts = {
  /** Same bounded recent history as `shortTermHistory` on the chat route. */
  shortTermHistory: ChatMsg[];
  /**
   * Scene-local user cue for this turn — `policyUserMessage` / `displayUserMessage`,
   * NOT regenerate/continue system wrapper text.
   */
  currentUserMessage: string;
  /** Already-normalized relationship memory meta (not the formatted prompt string). */
  normalizedMemoryMeta?: MemoryMeta | null;
};

/**
 * Build the COMMON SceneMomentumInput passed through ContextBuildInput on `/api/chat`.
 * Opening greeting uses the same peel helper as contextBuilder (no second parser).
 */
export function buildSceneMomentumInputFromRoute(
  opts: BuildSceneMomentumRouteInputOpts
): SceneMomentumInput {
  const { openingGreeting } = peelCreatorOpeningGreetingFromHistory(opts.shortTermHistory);
  const recentHistory = toSceneMomentumTurns(opts.shortTermHistory).slice(
    -SCENE_MOMENTUM_RECENT_WINDOW
  );
  const meta = opts.normalizedMemoryMeta;
  const promises =
    meta?.promises?.length && meta.promises.length > 0
      ? meta.promises.map(formatPromiseLabel)
      : undefined;

  return {
    recentHistory,
    currentUserMessage: opts.currentUserMessage,
    currentLocation: meta?.currentLocation ?? null,
    promises,
    openingGreeting,
  };
}

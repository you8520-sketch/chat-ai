/**
 * Server-only Scene Planner caller. Reuses chatImageSceneBrief model routing.
 * Client UI must not import this file.
 */

import { callOpenRouterCompletion } from "@/lib/openRouterCompletion";
import {
  resolveChatImageSceneBriefFallbackModel,
  resolveChatImageSceneBriefModel,
} from "@/lib/chatImageSceneBrief";
import {
  SCENE_PLAN_MAX_PROVIDER_ATTEMPTS,
  buildDeterministicScenePlan,
  buildScenePlanPrompt,
  validateScenePlan,
  type ScenePlan,
  type ScenePlanIntent,
  type SceneSourceMessage,
  type SceneSpeakerContext,
} from "@/lib/chatImageScenePlan";
import type { ContentKind } from "@/lib/simulationMode";

export type ScenePlanCompleter = (opts: {
  system: string;
  prompt: string;
  model: string;
}) => Promise<string>;

function stripJsonFence(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

async function defaultComplete(opts: {
  system: string;
  prompt: string;
  model: string;
}): Promise<string> {
  const { text } = await callOpenRouterCompletion({
    system: opts.system,
    history: [{ role: "user", content: opts.prompt }],
    model: opts.model,
    temperature: 0.1,
    maxTokens: 2048,
    disableReasoning: true,
    requestKind: "background-chat-image-scene-brief",
    timeoutMs: 120_000,
  });
  return text;
}

export async function planChatImageScene(opts: {
  contentKind?: ContentKind;
  scenePlanIntent?: ScenePlanIntent;
  characterName: string;
  personaName: string;
  messages: readonly SceneSourceMessage[];
  speakerContext?: SceneSpeakerContext;
  complete?: ScenePlanCompleter;
}): Promise<{
  plan: ScenePlan;
  model: string;
  usedFallback: boolean;
  attempts: number;
}> {
  const messages = opts.messages.filter((message) => message.text.trim());
  if (!messages.length) {
    throw new Error("장면으로 만들 턴 내용이 없습니다.");
  }

  const speakerContext =
    opts.speakerContext ??
    (opts.personaName && opts.characterName
      ? {
          personaName: opts.personaName,
          characterName: opts.characterName,
        }
      : undefined);

  const prompt = buildScenePlanPrompt({
    contentKind: opts.contentKind,
    scenePlanIntent: opts.scenePlanIntent,
    characterName: opts.characterName,
    personaName: opts.personaName,
    messages,
    speakerContext,
  });
  const complete = opts.complete ?? defaultComplete;
  const primary = resolveChatImageSceneBriefModel();
  const fallback = resolveChatImageSceneBriefFallbackModel();
  const models = fallback && fallback !== primary ? [primary, fallback] : [primary];
  let attempts = 0;

  for (const model of models.slice(0, SCENE_PLAN_MAX_PROVIDER_ATTEMPTS)) {
    attempts += 1;
    const usedFallbackModel = model !== primary;
    try {
      const text = await complete({
        system:
          "You are a precise closed-book scene planner. Group server canonical events only. Never invent user dialogue. Never add, omit, reorder, or reclassify events. Reasoning: none.",
        prompt,
        model,
      });
      if (!text.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(stripJsonFence(text));
      } catch {
        continue;
      }
      const validated = validateScenePlan(parsed, messages, {
        allowUserEdits: false,
        personaName: opts.personaName,
        characterName: opts.characterName,
        knownSpeakerNames: speakerContext?.knownSpeakerNames,
        contentKind: opts.contentKind,
        scenePlanIntent: opts.scenePlanIntent,
      });
      if (validated.ok) {
        return {
          plan: validated.plan,
          model,
          usedFallback: usedFallbackModel,
          attempts,
        };
      }
    } catch {
      // Attempt failed — try the next model. No same-model retry.
    }
  }

  return {
    plan: buildDeterministicScenePlan(messages, undefined, speakerContext),
    model: "deterministic-fallback",
    usedFallback: true,
    attempts,
  };
}

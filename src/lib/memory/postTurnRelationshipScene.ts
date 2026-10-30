import { BACKGROUND_OPENROUTER_MODEL } from "@/lib/ai";
import type { AssistantGenerationScope } from "@/lib/assistantGenerationScope";
import type { MemoryPromise, RelationshipMetaDelta } from "@/lib/chatMemory";
import { buildPlatformAsyncTurnLedgerContext } from "@/lib/providerCostLedger";
import {
  buildRelationshipSceneProse,
  locateRelationshipScenes,
} from "@/lib/postTurnSharedInitial/relationshipScene";
import { runPostTurnRelationshipOnlyInitial } from "@/lib/postTurnSharedInitial/run";
import type { PostTurnSharedInitialRunResult } from "@/lib/postTurnSharedInitial/types";

/**
 * Distinct provider request kind for the conditional relationship scene call.
 * It must stay separate from the whole-turn shared-initial kind so the ledger
 * shows one row per physical call and the call-budget contract stays auditable.
 */
export const RELATIONSHIP_SCENE_REQUEST_KIND = "background-post-turn-relationship-scene";

export type RelationshipSceneFallbackInput = {
  memoryEnabled: boolean;
  /** The first shared initial relationship section parsed successfully. */
  baseUsable: boolean;
  baseDelta: RelationshipMetaDelta | null;
  assistantProse: string;
  userMessage: string;
  charName: string;
  personaName: string;
  activePromises: readonly string[];
  chatId: number;
  assistantMessageId: number;
  generationScope: AssistantGenerationScope;
};

type SceneRunner = typeof runPostTurnRelationshipOnlyInitial;

export type RelationshipSceneFallbackDeps = {
  run?: SceneRunner;
  locate?: typeof locateRelationshipScenes;
};

function normalizePromiseText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Merge only the scene call's promisesAdd into the canonical first-pass delta.
 * Items/removes stay owned by the first call: a narrow window is not allowed to
 * rewrite possessions or remove an active promise based on partial context.
 */
export function mergeScenePromiseAdds(
  base: RelationshipMetaDelta,
  sceneAdds: readonly MemoryPromise[],
  activePromises: readonly string[] = []
): RelationshipMetaDelta {
  const removed = new Set((base.promisesRemove ?? []).map(normalizePromiseText));
  const seen = new Set([
    ...(base.promisesAdd ?? []).map((p) => normalizePromiseText(p.text)),
    ...activePromises.map(normalizePromiseText),
  ]);
  const merged = [...(base.promisesAdd ?? [])];
  for (const promise of sceneAdds) {
    const text = promise.text.trim();
    const key = normalizePromiseText(text);
    if (!key || removed.has(key) || seen.has(key)) continue;
    seen.add(key);
    merged.push({ text, ...(promise.deadline?.trim() ? { deadline: promise.deadline.trim() } : {}) });
  }
  return {
    items: base.items ?? [],
    itemsRemove: base.itemsRemove ?? [],
    promisesAdd: merged,
    promisesRemove: base.promisesRemove ?? [],
  };
}

/**
 * Conditional B61 owner. The whole-turn shared initial stays the only physical
 * call on a normal turn. Only when it parsed, produced no promise, and the
 * current canonical prose contains an explicit commitment cue do we make ONE
 * isolated relationship-only call over the located window.
 *
 * This function never writes the DB. The canonical writer consumes the returned
 * delta with the same generation/source identity as the first pass.
 */
export async function augmentRelationshipDeltaWithScene(
  input: RelationshipSceneFallbackInput,
  deps: RelationshipSceneFallbackDeps = {}
): Promise<RelationshipMetaDelta> {
  const base = input.baseDelta ?? {};
  if (!input.memoryEnabled || !input.baseUsable) return base;
  if ((base.promisesAdd?.length ?? 0) > 0) return base;

  const locate = deps.locate ?? locateRelationshipScenes;
  const windows = locate(input.assistantProse);
  if (!windows.length) return base;

  const ledgerContext = buildPlatformAsyncTurnLedgerContext({
    chatId: input.chatId,
    assistantMessageId: input.assistantMessageId,
    generationSequence: input.generationScope.generationSequence,
    generationRequestId: input.generationScope.generationRequestId ?? null,
    family: "memory_relationship",
    jobAttemptOrdinal: 1,
    requestKind: RELATIONSHIP_SCENE_REQUEST_KIND,
  });

  const run = deps.run ?? runPostTurnRelationshipOnlyInitial;
  let result: PostTurnSharedInitialRunResult;
  try {
    result = await run(
      {
        charName: input.charName,
        personaName: input.personaName,
        userMessage: input.userMessage,
        assistantProse: buildRelationshipSceneProse(windows),
        primaryModelId: BACKGROUND_OPENROUTER_MODEL,
        requestKind: RELATIONSHIP_SCENE_REQUEST_KIND,
        includeSuggestions: false,
        includeRelationship: true,
        includeEpisodic: false,
        // Deliberately no previousAssistantMessage: the window is the new
        // canonical reply, not a rejected-draft comparison.
        activePromises: input.activePromises,
        relationshipSceneWindow: true,
      },
      undefined,
      ledgerContext
    );
  } catch (e) {
    console.warn("[relationship-scene] provider call threw", (e as Error).message);
    return base;
  }

  const section = result.parsed?.relationship;
  if (!result.transportOk || !section?.valid) {
    console.info("[relationship-scene] no usable section", {
      transportOk: result.transportOk,
      httpStatus: result.httpStatus,
      errorCode: result.errorCode,
      present: section?.present ?? false,
      valid: section?.valid ?? false,
    });
    return base;
  }

  const merged = mergeScenePromiseAdds(base, section.delta.promisesAdd ?? [], input.activePromises);
  if ((merged.promisesAdd?.length ?? 0) > (base.promisesAdd?.length ?? 0)) {
    console.info("[relationship-scene] added promise", {
      windows: windows.length,
      windowChars: windows.reduce((sum, w) => sum + w.text.length, 0),
      added: (merged.promisesAdd?.length ?? 0) - (base.promisesAdd?.length ?? 0),
    });
  }
  return merged;
}

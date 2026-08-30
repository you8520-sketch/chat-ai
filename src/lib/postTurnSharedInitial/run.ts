import { callBackgroundMemory } from "@/lib/ai";
import type { StatusWidgetExtractCaller } from "@/lib/statusWidget/extract";
import {
  buildPostTurnSharedInitialSystem,
  buildPostTurnSharedInitialUserBlock,
} from "./prompt";
import { parsePostTurnSharedInitialResponse } from "./parse";
import {
  POST_TURN_SHARED_INITIAL_REQUEST_KIND,
  type PostTurnSharedInitialInput,
  type PostTurnSharedInitialRunResult,
} from "./types";

/** Canonical owner — exactly one physical shared initial provider call per eligible turn. */
export async function runPostTurnSharedInitial(
  input: PostTurnSharedInitialInput,
  caller?: StatusWidgetExtractCaller
): Promise<PostTurnSharedInitialRunResult> {
  const invoke =
    caller ??
    (async (system, history, opts) =>
      callBackgroundMemory(system, history, undefined, opts.requestKind, {
        maxTokens: opts.maxTokens,
        temperature: opts.temperature,
        modelId: opts.modelId,
      }));

  const system = buildPostTurnSharedInitialSystem(input);
  const userBlock = buildPostTurnSharedInitialUserBlock(input);
  if (!userBlock.trim()) {
    return {
      consumed: false,
      transportOk: false,
      text: "",
      usage: null,
      parsed: null,
    };
  }

  try {
    const { text, usage } = await invoke(
      system,
      [{ role: "user", content: userBlock }],
      {
        requestKind: POST_TURN_SHARED_INITIAL_REQUEST_KIND,
        modelId: input.primaryModelId,
        maxTokens: undefined,
        temperature: 0.4,
      }
    );
    const parsed = parsePostTurnSharedInitialResponse(text ?? "", input);
    return {
      consumed: true,
      transportOk: true,
      text: text ?? "",
      usage: usage ?? null,
      parsed,
    };
  } catch (e) {
    console.error("[POST-TURN-SHARED-INITIAL] provider call failed", (e as Error).message);
    return {
      consumed: false,
      transportOk: false,
      text: "",
      usage: null,
      parsed: null,
    };
  }
}

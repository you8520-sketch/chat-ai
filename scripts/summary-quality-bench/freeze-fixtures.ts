/**
 * Freeze fixture source into immutable fixtures.json before any API calls.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Module from "node:module";
import { SUMMARY_FIXTURE_SOURCE } from "./fixture-source";
import { estimateTokens } from "../../src/lib/tokenEstimate";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

const OUT_DIR = join(process.cwd(), "docs/audits/4-model-korean-summary-quality");

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function main() {
  const rolling = await import("../../src/lib/memory/memory-rolling-summary");
  const { __formatBatchDialogueForTests, buildRollingSummaryLlmRequest } = rolling;

  if (SUMMARY_FIXTURE_SOURCE.length !== 20) {
    throw new Error(`Expected 20 fixtures, got ${SUMMARY_FIXTURE_SOURCE.length}`);
  }

  const frozenAt = new Date().toISOString();
  const fixtures = SUMMARY_FIXTURE_SOURCE.map((draft) => {
    const dialogue = __formatBatchDialogueForTests(
      draft.turns.map((t) => ({
        turnIndex: t.turn_index,
        turn: { user: t.user, assistant: t.assistant },
      })),
      draft.char_name
    );
    const request = buildRollingSummaryLlmRequest({
      dialogue,
      charName: draft.char_name,
      characterIdentity: draft.character_identity ?? null,
      userPersona: draft.user_persona ?? null,
      openingPrelude: draft.opening_prelude ?? null,
      startTurn: 1,
      endTurn: 5,
      sourceTurnIndexes: [1, 2, 3, 4, 5],
    });
    const inputText = `${request.system}\n\n${request.user}`;
    const estimatedInputTokens = estimateTokens(inputText);
    return {
      fixture_id: draft.fixture_id,
      tags: draft.tags,
      char_name: draft.char_name,
      character_identity: draft.character_identity ?? null,
      user_persona: draft.user_persona ?? null,
      opening_prelude: draft.opening_prelude ?? null,
      turns: draft.turns,
      production_style: {
        dialogue,
        system_prompt: request.system,
        user_prompt: request.user,
        start_turn: 1,
        end_turn: 5,
        source_turn_count: request.sourceTurnCount,
      },
      approximate_input_tokens_estimated: estimatedInputTokens,
      source_hash_sha256: sha256(inputText),
      frozen_at: frozenAt,
    };
  });

  const sizes = fixtures.map((f) => f.approximate_input_tokens_estimated);
  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, "fixtures.json");
  writeFileSync(outPath, JSON.stringify({ frozen_at: frozenAt, fixtures }, null, 2), "utf8");
  console.log(
    JSON.stringify({
      fixture_count: fixtures.length,
      min_estimated_input_tokens: Math.min(...sizes),
      max_estimated_input_tokens: Math.max(...sizes),
      out_path: outPath,
    })
  );
}

void main();

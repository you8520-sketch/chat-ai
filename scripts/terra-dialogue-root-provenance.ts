/**
 * Static production prompt provenance audit (code + health; no secrets).
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  TERRA_TERMINAL_LENGTH_OWNER_CONTRACT,
  TERRA_TERMINAL_LENGTH_OWNER_CONTRACT_CONTINUOUS_SCENE,
} from "../src/lib/terraTerminalLengthOwner";
import {
  DIALOGUE_LAYOUT_OWNER_KO_PRODUCTION,
  DIALOGUE_LAYOUT_OWNER_EN_PRODUCTION,
  V1_SCENE_PROGRESS_SENTENCE_PRODUCTION,
  V1_SCENE_PROGRESS_SENTENCE_RELATIONSHIP_AXIS,
} from "../src/lib/terraPromptCanary";
import {
  buildCompactTerminalLayoutRecencyLine,
  buildWebnovelOutputLayoutRecencyBlock,
  DIALOGUE_NARRATION_STRUCTURE_RULE,
  OUTPUT_LAYOUT_SEMANTIC_CORE,
} from "../src/lib/webnovelOutputFormat";
import { EURYALE_GENERATION_PARAMS } from "../src/lib/openRouterClient";

const OUT = process.env.OUT_DIR ?? "/opt/cursor/artifacts/terra-dialogue-root-final/00-production-provenance";
const BASE = process.env.PROD_BASE ?? "https://chat-ai-production-3e84.up.railway.app";

async function main() {
  mkdirSync(OUT, { recursive: true });
  const health = await (await fetch(`${BASE}/health`)).json();
  const layoutRecency = buildWebnovelOutputLayoutRecencyBlock();
  const compactLayout = buildCompactTerminalLayoutRecencyLine();

  const koDialogueOwnerCount = (
    (DIALOGUE_NARRATION_STRUCTURE_RULE.match(/대사는 독립 문단/g) ?? []).length +
    (layoutRecency.match(/대사는 독립 문단/g) ?? []).length +
    (compactLayout.match(/대사/g) ?? []).length
  );
  const enDialogueOwnerCount = (
    (OUTPUT_LAYOUT_SEMANTIC_CORE.match(/spoken dialogue = always its own paragraph/gi) ?? [])
      .length + (layoutRecency.match(/spoken dialogue = always its own paragraph/gi) ?? []).length
  );

  const report = {
    captured_at: new Date().toISOString(),
    production_base: BASE,
    health,
    terra_model_id: "gpt-5.6-terra",
    single_primary: "contentKind=character (non-simulation)",
    production_temperature: EURYALE_GENERATION_PARAMS.temperature,
    terra_terminal_length_owner: TERRA_TERMINAL_LENGTH_OWNER_CONTRACT,
    terra_terminal_continuous_candidate: TERRA_TERMINAL_LENGTH_OWNER_CONTRACT_CONTINUOUS_SCENE,
    scene_directive_v1_progress_production: V1_SCENE_PROGRESS_SENTENCE_PRODUCTION,
    scene_directive_relationship_axis: V1_SCENE_PROGRESS_SENTENCE_RELATIONSHIP_AXIS,
    webnovel_ko_dialogue_owner: DIALOGUE_LAYOUT_OWNER_KO_PRODUCTION,
    webnovel_en_dialogue_owner: DIALOGUE_LAYOUT_OWNER_EN_PRODUCTION,
    user_turn_compact_layout: compactLayout,
    layout_audit: {
      ko_independent_paragraph_owner_occurrences_estimate: koDialogueOwnerCount,
      en_spoken_dialogue_paragraph_owner_occurrences_estimate: enDialogueOwnerCount,
      dialogue_intent_unit_prior_canary: "tested — not primary per prior FINAL_REPORT",
      note: "No new layout model-call experiment unless unverified strong recency owner found in live payload",
    },
    creator_dialogue_assembly: {
      example_dialog: "route.ts resolveExampleDialogForPrompt → characterChunks [예시 대화]",
      speech_lock: "speech_profile JSON + buildCharacterSpeechRecencyTail (Patch D)",
      style_only_note: "injectExampleDialogStyleOnlyNote in contextBuilder",
      canary_scope: "injectDialogueReferenceScopeForCanary (dialogue_reference_scope variant only)",
      adult_imitate: "openRouterAdult.ts [대사 예시 — IMITATE / 최우선]",
      greeting: "chatSessionCreate resolveCanaryGreeting + route applyTerraPromptCanaryToHistory",
    },
    user_turn_order: [
      "user input",
      "relocated SceneDirective (relationship axis canary)",
      "Terra terminal layout line + length owner (absolute last)",
    ],
    target_length_floor_on_terra_path: "stripped — terraTerminalLengthOwner active",
  };

  writeFileSync(join(OUT, "provenance.json"), JSON.stringify(report, null, 2), "utf8");
  writeFileSync(
    join(OUT, "provenance.md"),
    `# Production prompt provenance\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`,
    "utf8"
  );
  console.log("wrote", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

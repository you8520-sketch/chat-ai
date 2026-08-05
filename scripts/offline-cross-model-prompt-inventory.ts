/**
 * Offline-only: hash exported prompt constants / serializer slices.
 * No live model calls.
 *
 * Requires a tree that includes the SceneDirective palette stack
 * (e.g. cursor/ds-dense-internal-confirm-6a91). Writes identical
 * PROMPT_HASHES.json under:
 *   /opt/cursor/artifacts/deepseek-common-root-audit/35-cross-model-inventory/
 *   /workspace/docs/audits/35-cross-model-inventory/
 */
import { createHash } from "crypto";
import { writeFileSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import path from "path";

import {
  SCENE_DIRECTIVE_VERSION,
  BASE_SCENE_ENGINE_RULE,
  BASE_SCENE_ENGINE_MOTION_CLAUSE,
  ACTIVE_DYAD_NEUTRALIZED_MOTION_CLAUSE,
  ACTIVE_DYAD_NEUTRALIZED_BASE_ENGINE_RULE,
} from "../src/lib/sceneDirective";
import {
  ACTIVE_DYAD_SCENE_ENGINE_MOTION,
  STALLING_SCENE_ENGINE_MOTION,
  ACTIVE_DYAD_PALETTE,
  ACTIVE_DYAD_CONCRETE_BEATS_PALETTE,
  STALLING_PALETTE,
  ACTIVE_DYAD_HINT_BY_TYPE,
  serializeConcreteActiveDyadNextBeatHint,
  buildConcreteActiveDyadBeats,
} from "../src/lib/sceneFocusPalette";
import {
  DEEPSEEK_BOTTOM_REMINDER,
  DEEPSEEK_SHORT_HISTORY_SUSTAIN_CLAUSE,
  DEEPSEEK_SHORT_HISTORY_SUSTAIN_CLAUSE_INTERNAL,
  DEEPSEEK_SHORT_HISTORY_SUSTAIN_CLAUSE_DENSE_INTERNAL,
  DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA,
  DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA_INTERNAL,
  DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA_DENSE_INTERNAL,
  DEEPSEEK_REGEN_LENGTH_BLOCK,
  DEEPSEEK_SHORT_USER_TURN_BLOCK,
  LTM_ABSOLUTE_FACTS_RULE,
  DEEPSEEK_XML_TAGS,
} from "../src/lib/deepseekPromptStructure";
import {
  DEEPSEEK_LENGTH_SAFETY_SENTENCE,
  DEEPSEEK_LENGTH_ARM_B_SENTENCE,
  DEEPSEEK_LENGTH_ARM_C_SENTENCE,
  buildDeepSeekLengthAdapterBlock,
  TERRA_TERMINAL_LENGTH_OWNER_CONTRACT,
} from "../src/lib/sharedNovelProseModelAdapters";
import {
  TERRA_TERMINAL_LENGTH_OWNER_ENUMERATION_PHRASE,
  TERRA_TERMINAL_LENGTH_OWNER_CONTINUOUS_SCENE_PHRASE,
  TERRA_TERMINAL_LENGTH_OWNER_CONTRACT_CONTINUOUS_SCENE,
} from "../src/lib/terraTerminalLengthOwner";
import { LUNA_TERMINAL_OUTPUT_CONTRACT } from "../src/lib/lunaSinglePrimaryAdapter";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "../src/lib/responseLength";
import {
  buildCompactTerminalLayoutRecencyLine,
  WEBNOVEL_OUTPUT_FORMAT_BLOCK,
  OUTPUT_LAYOUT_SEMANTIC_CORE,
  DIALOGUE_NARRATION_STRUCTURE_RULE,
} from "../src/lib/webnovelOutputFormat";
import { DEEPSEEK_APPEARANCE_VARIATION_RULE } from "../src/lib/appearanceCompiler";
import {
  SELECTED_AI_OPTIONS,
  DEFAULT_SELECTED_AI,
  USER_SELECTABLE_AI_OPTIONS,
} from "../src/lib/chatModels";
import { RP_DIAGNOSTIC_CANARY_VARIANTS } from "../src/lib/rpDiagnosticCanary";
import { SHARED_NOVEL_PROSE_CORE } from "../src/lib/sharedNovelProseCore";
import { IMMERSIVE_PROSE_BLOCK } from "../src/lib/advancedProseNsfwGuidelines";
import { MUSE_EXAMPLE_DIALOG_TRAP_PHRASES } from "../src/lib/museExampleDialogBoundary";

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

type HashEntry = {
  sha256: string;
  bytes: number;
  source: string;
  note?: string;
};

const hashes: Record<string, HashEntry> = {};

function add(key: string, value: string, source: string, note?: string) {
  hashes[key] = {
    sha256: sha256(value),
    bytes: Buffer.byteLength(value, "utf8"),
    source,
    ...(note ? { note } : {}),
  };
}

const concreteSources = [
  "USER_CUE_RESPONSE",
  "PRIMARY_INTERPRETATION",
  "PRIMARY_DECISION",
  "PRIMARY_ACTION",
  "RELATIONSHIP_MOVEMENT",
  "EXISTING_ENVIRONMENT",
] as const;

const concreteBeats = serializeConcreteActiveDyadNextBeatHint([...concreteSources]);
const beatsJoined = buildConcreteActiveDyadBeats([...concreteSources]).join("\n");

add(
  "common.scene_directive.version",
  SCENE_DIRECTIVE_VERSION,
  "src/lib/sceneDirective.ts#SCENE_DIRECTIVE_VERSION"
);
add(
  "common.scene_directive.base_scene_engine_rule",
  BASE_SCENE_ENGINE_RULE,
  "src/lib/sceneDirective.ts#BASE_SCENE_ENGINE_RULE"
);
add(
  "common.scene_directive.base_scene_engine_motion_clause",
  BASE_SCENE_ENGINE_MOTION_CLAUSE,
  "src/lib/sceneDirective.ts#BASE_SCENE_ENGINE_MOTION_CLAUSE"
);
add(
  "common.scene_directive.active_dyad_neutralized_motion_clause",
  ACTIVE_DYAD_NEUTRALIZED_MOTION_CLAUSE,
  "src/lib/sceneDirective.ts#ACTIVE_DYAD_NEUTRALIZED_MOTION_CLAUSE"
);
add(
  "common.scene_directive.active_dyad_neutralized_base_engine_rule",
  ACTIVE_DYAD_NEUTRALIZED_BASE_ENGINE_RULE,
  "src/lib/sceneDirective.ts#ACTIVE_DYAD_NEUTRALIZED_BASE_ENGINE_RULE"
);

add(
  "common.scene_focus.active_dyad_scene_engine_motion",
  ACTIVE_DYAD_SCENE_ENGINE_MOTION,
  "src/lib/sceneFocusPalette.ts#ACTIVE_DYAD_SCENE_ENGINE_MOTION",
  "diagnostic motion; not serialized under base-engine-preserved"
);
add(
  "common.scene_focus.stalling_scene_engine_motion",
  STALLING_SCENE_ENGINE_MOTION,
  "src/lib/sceneFocusPalette.ts#STALLING_SCENE_ENGINE_MOTION"
);
add(
  "common.scene_focus.active_dyad_palette_json",
  JSON.stringify(ACTIVE_DYAD_PALETTE),
  "src/lib/sceneFocusPalette.ts#ACTIVE_DYAD_PALETTE"
);
add(
  "common.scene_focus.active_dyad_concrete_beats_palette_json",
  JSON.stringify(ACTIVE_DYAD_CONCRETE_BEATS_PALETTE),
  "src/lib/sceneFocusPalette.ts#ACTIVE_DYAD_CONCRETE_BEATS_PALETTE"
);
add(
  "common.scene_focus.stalling_palette_json",
  JSON.stringify(STALLING_PALETTE),
  "src/lib/sceneFocusPalette.ts#STALLING_PALETTE"
);
add(
  "common.scene_focus.active_dyad_hint_by_type_json",
  JSON.stringify(ACTIVE_DYAD_HINT_BY_TYPE),
  "src/lib/sceneFocusPalette.ts#ACTIVE_DYAD_HINT_BY_TYPE"
);
add(
  "common.scene_focus.concrete_active_dyad_beats_joined",
  beatsJoined,
  "src/lib/sceneFocusPalette.ts#buildConcreteActiveDyadBeats"
);
add(
  "common.scene_focus.concrete_active_dyad_next_beat_hint",
  concreteBeats,
  "src/lib/sceneFocusPalette.ts#serializeConcreteActiveDyadNextBeatHint"
);

add(
  "common.terminal.user_tail_length_owner_sentence",
  USER_TAIL_LENGTH_OWNER_SENTENCE,
  "src/lib/responseLength.ts#USER_TAIL_LENGTH_OWNER_SENTENCE"
);
add(
  "common.terminal.layout_recency_line",
  buildCompactTerminalLayoutRecencyLine(),
  "src/lib/webnovelOutputFormat.ts#buildCompactTerminalLayoutRecencyLine"
);
add(
  "common.layout.webnovel_output_format_block",
  WEBNOVEL_OUTPUT_FORMAT_BLOCK,
  "src/lib/webnovelOutputFormat.ts#WEBNOVEL_OUTPUT_FORMAT_BLOCK"
);
add(
  "common.layout.output_layout_semantic_core",
  OUTPUT_LAYOUT_SEMANTIC_CORE,
  "src/lib/webnovelOutputFormat.ts#OUTPUT_LAYOUT_SEMANTIC_CORE"
);
add(
  "common.layout.dialogue_narration_structure_rule",
  DIALOGUE_NARRATION_STRUCTURE_RULE,
  "src/lib/webnovelOutputFormat.ts#DIALOGUE_NARRATION_STRUCTURE_RULE"
);
add(
  "common.prose.immersive_prose_block",
  IMMERSIVE_PROSE_BLOCK,
  "src/lib/advancedProseNsfwGuidelines.ts#IMMERSIVE_PROSE_BLOCK"
);
add(
  "common.prose.shared_novel_prose_core",
  SHARED_NOVEL_PROSE_CORE,
  "src/lib/sharedNovelProseCore.ts#SHARED_NOVEL_PROSE_CORE"
);

add(
  "adapter.deepseek.bottom_reminder",
  DEEPSEEK_BOTTOM_REMINDER,
  "src/lib/deepseekPromptStructure.ts#DEEPSEEK_BOTTOM_REMINDER"
);
add(
  "adapter.deepseek.ltm_absolute_facts_rule",
  LTM_ABSOLUTE_FACTS_RULE,
  "src/lib/deepseekPromptStructure.ts#LTM_ABSOLUTE_FACTS_RULE"
);
add(
  "adapter.deepseek.xml_tags_json",
  JSON.stringify(DEEPSEEK_XML_TAGS),
  "src/lib/deepseekPromptStructure.ts#DEEPSEEK_XML_TAGS"
);
add(
  "adapter.deepseek.short_history_sustain_clause",
  DEEPSEEK_SHORT_HISTORY_SUSTAIN_CLAUSE,
  "src/lib/deepseekPromptStructure.ts#DEEPSEEK_SHORT_HISTORY_SUSTAIN_CLAUSE"
);
add(
  "adapter.deepseek.short_history_sustain_clause_internal",
  DEEPSEEK_SHORT_HISTORY_SUSTAIN_CLAUSE_INTERNAL,
  "src/lib/deepseekPromptStructure.ts#DEEPSEEK_SHORT_HISTORY_SUSTAIN_CLAUSE_INTERNAL"
);
add(
  "adapter.deepseek.short_history_sustain_clause_dense_internal",
  DEEPSEEK_SHORT_HISTORY_SUSTAIN_CLAUSE_DENSE_INTERNAL,
  "src/lib/deepseekPromptStructure.ts#DEEPSEEK_SHORT_HISTORY_SUSTAIN_CLAUSE_DENSE_INTERNAL"
);
add(
  "adapter.deepseek.short_history_length_extra",
  DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA,
  "src/lib/deepseekPromptStructure.ts#DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA"
);
add(
  "adapter.deepseek.short_history_length_extra_internal",
  DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA_INTERNAL,
  "src/lib/deepseekPromptStructure.ts#DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA_INTERNAL"
);
add(
  "adapter.deepseek.short_history_length_extra_dense_internal",
  DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA_DENSE_INTERNAL,
  "src/lib/deepseekPromptStructure.ts#DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA_DENSE_INTERNAL"
);
add(
  "adapter.deepseek.regen_length_block",
  DEEPSEEK_REGEN_LENGTH_BLOCK,
  "src/lib/deepseekPromptStructure.ts#DEEPSEEK_REGEN_LENGTH_BLOCK"
);
add(
  "adapter.deepseek.short_user_turn_block",
  DEEPSEEK_SHORT_USER_TURN_BLOCK,
  "src/lib/deepseekPromptStructure.ts#DEEPSEEK_SHORT_USER_TURN_BLOCK"
);
add(
  "adapter.deepseek.appearance_variation_rule",
  DEEPSEEK_APPEARANCE_VARIATION_RULE,
  "src/lib/appearanceCompiler.ts#DEEPSEEK_APPEARANCE_VARIATION_RULE"
);
add(
  "adapter.deepseek.length_arm_b_block",
  buildDeepSeekLengthAdapterBlock("B")!,
  "src/lib/sharedNovelProseModelAdapters.ts#buildDeepSeekLengthAdapterBlock(B)",
  "experiment env SNPV2_DEEPSEEK_LENGTH_ARM=B"
);
add(
  "adapter.deepseek.length_arm_c_block",
  buildDeepSeekLengthAdapterBlock("C")!,
  "src/lib/sharedNovelProseModelAdapters.ts#buildDeepSeekLengthAdapterBlock(C)",
  "experiment env SNPV2_DEEPSEEK_LENGTH_ARM=C"
);
add(
  "adapter.deepseek.length_safety_sentence",
  DEEPSEEK_LENGTH_SAFETY_SENTENCE,
  "src/lib/sharedNovelProseModelAdapters.ts#DEEPSEEK_LENGTH_SAFETY_SENTENCE"
);
add(
  "adapter.deepseek.length_arm_b_sentence",
  DEEPSEEK_LENGTH_ARM_B_SENTENCE,
  "src/lib/sharedNovelProseModelAdapters.ts#DEEPSEEK_LENGTH_ARM_B_SENTENCE"
);
add(
  "adapter.deepseek.length_arm_c_sentence",
  DEEPSEEK_LENGTH_ARM_C_SENTENCE,
  "src/lib/sharedNovelProseModelAdapters.ts#DEEPSEEK_LENGTH_ARM_C_SENTENCE"
);

add(
  "adapter.terra.terminal_length_owner_contract",
  TERRA_TERMINAL_LENGTH_OWNER_CONTRACT,
  "src/lib/terraTerminalLengthOwner.ts#TERRA_TERMINAL_LENGTH_OWNER_CONTRACT"
);
add(
  "adapter.terra.terminal_length_owner_enumeration_phrase",
  TERRA_TERMINAL_LENGTH_OWNER_ENUMERATION_PHRASE,
  "src/lib/terraTerminalLengthOwner.ts#TERRA_TERMINAL_LENGTH_OWNER_ENUMERATION_PHRASE"
);
add(
  "adapter.terra.terminal_length_owner_continuous_scene_phrase",
  TERRA_TERMINAL_LENGTH_OWNER_CONTINUOUS_SCENE_PHRASE,
  "src/lib/terraTerminalLengthOwner.ts#TERRA_TERMINAL_LENGTH_OWNER_CONTINUOUS_SCENE_PHRASE"
);
add(
  "adapter.terra.terminal_length_owner_contract_continuous_scene",
  TERRA_TERMINAL_LENGTH_OWNER_CONTRACT_CONTINUOUS_SCENE,
  "src/lib/terraTerminalLengthOwner.ts#TERRA_TERMINAL_LENGTH_OWNER_CONTRACT_CONTINUOUS_SCENE"
);

add(
  "adapter.luna.terminal_output_contract",
  LUNA_TERMINAL_OUTPUT_CONTRACT,
  "src/lib/lunaSinglePrimaryAdapter.ts#LUNA_TERMINAL_OUTPUT_CONTRACT"
);

add(
  "adapter.muse.example_dialog_trap_phrases_json",
  JSON.stringify(MUSE_EXAMPLE_DIALOG_TRAP_PHRASES),
  "src/lib/museExampleDialogBoundary.ts#MUSE_EXAMPLE_DIALOG_TRAP_PHRASES",
  "retired model; policy/telemetry only"
);

let gitHead = "unknown";
try {
  gitHead = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
} catch {
  /* ignore */
}

const out = {
  meta: {
    generatedAt: new Date().toISOString(),
    gitHead,
    method:
      "sha256(utf8) of exported constant string values; JSON.stringify for structured constants; serializer output for concrete ACTIVE_DYAD beats",
    liveCalls: false,
    crossModelReady: false,
    gate:
      "Live cross-model matrix NOT ready until DeepSeek runtime + functional reconfirmation pass (see audit 33-dense-internal-confirm).",
  },
  registry: {
    selectedAiOptions: SELECTED_AI_OPTIONS.map((o) => ({
      id: o.id,
      label: o.label,
      provider: o.provider,
    })),
    defaultSelectedAi: DEFAULT_SELECTED_AI,
    userSelectableIds: USER_SELECTABLE_AI_OPTIONS.map((o) => o.id),
    rpDiagnosticCanaryVariants: [...RP_DIAGNOSTIC_CANARY_VARIANTS],
  },
  families: {
    common_scene_directive_stack: [
      "common.scene_directive.*",
      "common.scene_focus.*",
      "common.terminal.user_tail_length_owner_sentence",
      "common.terminal.layout_recency_line",
      "common.layout.*",
      "common.prose.*",
    ],
    deepseek_v4_pro_xml_extras: [
      "adapter.deepseek.bottom_reminder",
      "adapter.deepseek.ltm_absolute_facts_rule",
      "adapter.deepseek.xml_tags_json",
      "adapter.deepseek.short_history_*",
      "adapter.deepseek.regen_length_block",
      "adapter.deepseek.short_user_turn_block",
      "adapter.deepseek.appearance_variation_rule",
      "adapter.deepseek.length_arm_*",
    ],
    deepseek_v4_flash_minimal_extras: ["adapter.deepseek.appearance_variation_rule"],
    terra_terminal_owner: ["adapter.terra.*"],
    luna_terminal_owner: ["adapter.luna.terminal_output_contract"],
    muse_retired_policy: ["adapter.muse.example_dialog_trap_phrases_json"],
    common_terminal_default_models: [
      "claude-opus-5",
      "anthropic/claude-opus-4.5",
      "gemini-3.1-pro-preview",
      "google/gemini-3.6-flash",
    ],
  },
  hashes,
};

const artifactDirs = [
  path.resolve("/opt/cursor/artifacts/deepseek-common-root-audit/35-cross-model-inventory"),
  path.resolve("/workspace/docs/audits/35-cross-model-inventory"),
];

for (const dir of artifactDirs) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "PROMPT_HASHES.json"), JSON.stringify(out, null, 2) + "\n", "utf8");
}

console.log(
  JSON.stringify(
    {
      written: artifactDirs.map((d) => path.join(d, "PROMPT_HASHES.json")),
      hashKeyCount: Object.keys(hashes).length,
      keys: Object.keys(hashes).sort(),
    },
    null,
    2
  )
);

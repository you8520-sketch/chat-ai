/**
 * Step 3-1 — Production style layer ON/OFF ablation (harness-only; no src edits).
 */

import { PROSE_STYLE_SECTION } from "@/lib/advancedProseNsfwGuidelines";
import { buildLengthInstruction } from "@/lib/responseLength";
import { buildTurnHandoffAndPacingBlock } from "@/lib/turnHandoffAndPacing";
import { buildWebnovelOutputLayoutRecencyBlock } from "@/lib/webnovelOutputFormat";
import { parseCharacterSetting } from "@/utils/characterParser";
import type { ContextBuildInput } from "@/types";
import {
  buildProductionContextForScene,
  type ProductionValidationScene,
} from "./production-prompt-fixture";

export type StyleLayerId =
  | "proseStyle"
  | "fewShot"
  | "dialogueNarration"
  | "lengthControl"
  | "turnHandoff"
  | "genreTone"
  | "outputLayout"
  | "crossTurn";

export type StyleLayerDef = {
  id: StyleLayerId;
  label: string;
  labelKo: string;
  source: string;
  /** Static risk if layer were removed in production */
  defaultRisk: "Low" | "Medium" | "High";
  /** Known interactions with other layers (static audit) */
  staticInteractions: string[];
};

const LENGTH_BLOCK = buildLengthInstruction(3200, {
  statusWindowEveryTurn: false,
  htmlFlashOwned: true,
  proseStylePolicyOwnsSceneExpansion: true,
  statusWidgetActive: false,
});

const TURN_HANDOFF_BLOCK = buildTurnHandoffAndPacingBlock();
const OUTPUT_LAYOUT_BLOCK = buildWebnovelOutputLayoutRecencyBlock();

const CROSS_TURN_PATTERN = /\[CROSS-TURN VARIATION\][^\n]*(?:\n[^\n[]*)?/g;
const DNR_PATTERN = /\[DIALOGUE & NARRATION\][\s\S]*?(?=\n\[19\+ INTIMACY\]|\n\[PROSE STYLE\]|$)/;
const FEWSHOT_PATTERN = /\[예시 대화\][\s\S]*?(?=\n\[|$)/;

export const STYLE_LAYERS: StyleLayerDef[] = [
  {
    id: "proseStyle",
    label: "PROSE STYLE",
    labelKo: "PROSE STYLE",
    source: "src/lib/advancedProseNsfwGuidelines.ts",
    defaultRisk: "High",
    staticInteractions: [
      "LENGTH CONTROL — expansion craft vs numeric floor",
      "Genre Tone — emotion/show-dont-tell overlap",
      "CROSS-TURN — within-turn vs turn-span variation",
    ],
  },
  {
    id: "fewShot",
    label: "Few-shot",
    labelKo: "Few-shot (예시 대화)",
    source: "character chunks + narrationFewShotTemplates",
    defaultRisk: "Low",
    staticInteractions: [
      "OUTPUT LAYOUT — alternation visible only when quotes exist",
      "DIALOGUE & NARRATION — format exemplar vs rule",
    ],
  },
  {
    id: "dialogueNarration",
    label: "Dialogue & Narration",
    labelKo: "DIALOGUE & NARRATION",
    source: "src/lib/advancedProseNsfwGuidelines.ts",
    defaultRisk: "Medium",
    staticInteractions: [
      "OUTPUT LAYOUT — format vs semantic rhythm",
      "LENGTH CONTROL — pre/post dialogue expansion",
    ],
  },
  {
    id: "lengthControl",
    label: "LENGTH CONTROL",
    labelKo: "LENGTH CONTROL & SCENE EXPANSION",
    source: "src/lib/responseLength.ts + sceneExpansionPolicy.ts",
    defaultRisk: "High",
    staticInteractions: [
      "TURN HANDOFF — continuation + floor gate",
      "PROSE STYLE — sensation/emotion fill pressure",
      "OUTPUT LAYOUT — more narration without new quotes",
    ],
  },
  {
    id: "turnHandoff",
    label: "TURN HANDOFF",
    labelKo: "TURN HANDOFF & PACING",
    source: "src/lib/turnHandoffAndPacing.ts",
    defaultRisk: "Medium",
    staticInteractions: [
      "LENGTH CONTROL — MINIMUM_FLOOR + SCENE CONTINUATION",
      "PROSE STYLE — aftermath/body/atmosphere beats",
    ],
  },
  {
    id: "genreTone",
    label: "Genre Tone",
    labelKo: "Genre Tone ([genre_tone])",
    source: "src/lib/narrativeStyle.ts",
    defaultRisk: "Low",
    staticInteractions: [
      "PROSE STYLE — emotion/sensation channel hints",
      "Few-shot — genre-specific exemplar gap",
    ],
  },
  {
    id: "outputLayout",
    label: "OUTPUT LAYOUT",
    labelKo: "OUTPUT LAYOUT (recency)",
    source: "src/lib/webnovelOutputFormat.ts",
    defaultRisk: "Medium",
    staticInteractions: [
      "DIALOGUE & NARRATION — quote integrity",
      "Few-shot — paragraph break exemplar",
      "LENGTH — narration-only expansion path",
    ],
  },
  {
    id: "crossTurn",
    label: "Cross-turn",
    labelKo: "CROSS-TURN VARIATION",
    source: "src/lib/advancedProseNsfwGuidelines.ts",
    defaultRisk: "Medium",
    staticInteractions: [
      "PROSE STYLE — within-turn vs turn-span",
      "TURN HANDOFF — continuation without pattern repeat",
    ],
  },
];

function normalizePrompt(prompt: string): string {
  return prompt.replace(/\n{3,}/g, "\n\n");
}

function stripExactBlock(prompt: string, block: string): string {
  if (!block.trim() || !prompt.includes(block.slice(0, 40))) return prompt;
  return normalizePrompt(prompt.replace(block, ""));
}

export function applyLayerOff(prompt: string, layerId: StyleLayerId): string {
  let out = prompt;
  switch (layerId) {
    case "proseStyle":
      out = stripExactBlock(out, PROSE_STYLE_SECTION);
      break;
    case "fewShot":
      out = normalizePrompt(out.replace(FEWSHOT_PATTERN, ""));
      break;
    case "dialogueNarration":
      out = normalizePrompt(out.replace(DNR_PATTERN, ""));
      break;
    case "lengthControl":
      out = stripExactBlock(out, LENGTH_BLOCK);
      break;
    case "turnHandoff":
      out = stripExactBlock(out, TURN_HANDOFF_BLOCK);
      break;
    case "genreTone":
      out = normalizePrompt(out.replace(/\[genre_tone\][^\n]+\n?/g, ""));
      break;
    case "outputLayout":
      out = stripExactBlock(out, OUTPUT_LAYOUT_BLOCK);
      break;
    case "crossTurn":
      out = normalizePrompt(out.replace(CROSS_TURN_PATTERN, ""));
      break;
    default:
      break;
  }
  return out;
}

export function layerPromptDeltaChars(before: string, after: string): number {
  return after.length - before.length;
}

export function buildContextWithFewShotOff(
  scene: ProductionValidationScene
): ContextBuildInput {
  const base = buildProductionContextForScene(scene);
  const chunks = parseCharacterSetting({
    characterId: "prod-val-1",
    characterName: base.charName,
    gender: "male",
    systemPrompt: `# 성격
차분하고 관찰력이 뛰어나며, 감정을 겉으로 드러내지 않는다.

# 말투
- 평소: "~요", "~죠" 등 정중한 존댓말`,
    world: `# 세계관
현대 도시. 초자연적 존재와 일반인이 공존한다.`,
    exampleDialog: "",
    statusWindowPrompt: "",
  });
  return { ...base, chunks };
}

export function promptDiffSummary(before: string, after: string): {
  beforeChars: number;
  afterChars: number;
  deltaChars: number;
} {
  return {
    beforeChars: before.length,
    afterChars: after.length,
    deltaChars: after.length - before.length,
  };
}

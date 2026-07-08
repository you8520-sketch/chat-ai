/**
 * Static inventory — dialogue-rhythm-related prompt clauses per layer (read-only SoT audit).
 */
import { buildAdvancedProseNsfwGuidelines } from "@/lib/advancedProseNsfwGuidelines";
import { buildTurnHandoffAndPacingBlock, SCENE_CONTINUATION_PRIORITY_BLOCK } from "@/lib/turnHandoffAndPacing";
import { buildLengthInstruction } from "@/lib/responseLength";
import { buildWebnovelOutputLayoutRecencyBlock } from "@/lib/webnovelOutputFormat";
import {
  buildHandHeavyFewShot,
  buildSpaceSoundFewShot,
  NARRATION_FEWSHOT_PROFILES,
} from "@/lib/narrationFewShotTemplates";
import { PROSE_STYLE_SECTION } from "@/lib/advancedProseNsfwGuidelines";

export type RhythmMetricKey =
  | "dialogueLength"
  | "alternation"
  | "consecutiveNarration"
  | "questionResponseTempo"
  | "narrationWall";

export type LayerId =
  | "dialogueNarration"
  | "turnHandoff"
  | "lengthControl"
  | "outputLayout"
  | "fewShot"
  | "proseStyle";

export type LayerClause = {
  clause: string;
  file: string;
  influences: RhythmMetricKey[];
  direction: "helps" | "hurts" | "neutral" | "format-only";
  note: string;
};

export type LayerInventory = {
  id: LayerId;
  label: string;
  sourceFile: string;
  trackedSectionId: string;
  fullTextPreview: string;
  charCount: number;
  clauses: LayerClause[];
};

const METRIC_LABEL: Record<RhythmMetricKey, string> = {
  dialogueLength: "대사 길이",
  alternation: "대사↔지문 alternation",
  consecutiveNarration: "연속 지문 개수",
  questionResponseTempo: "질문↔응답 템포",
  narrationWall: "narration wall",
};

export { METRIC_LABEL };

function extractDialogueNarrationBlock(prose: string): string {
  const m = prose.match(/\[DIALOGUE & NARRATION\][\s\S]*?(?=\n\[|$)/);
  return m?.[0]?.trim() ?? "";
}

export function buildLayerInventories(): LayerInventory[] {
  const proseFull = buildAdvancedProseNsfwGuidelines({ nsfwEnabled: true });
  const dnrBlock = extractDialogueNarrationBlock(proseFull);
  const lengthFull = buildLengthInstruction(3200, {
    statusWindowEveryTurn: false,
    htmlFlashOwned: true,
    proseStylePolicyOwnsSceneExpansion: true,
    statusWidgetActive: false,
  });
  const layoutFull = buildWebnovelOutputLayoutRecencyBlock();
  const handoffFull = buildTurnHandoffAndPacingBlock();
  const formalFewShot = buildSpaceSoundFewShot(NARRATION_FEWSHOT_PROFILES[0]!);
  const handFewShot = buildHandHeavyFewShot(NARRATION_FEWSHOT_PROFILES[0]!);

  return [
    {
      id: "dialogueNarration",
      label: "DIALOGUE & NARRATION",
      sourceFile: "src/lib/advancedProseNsfwGuidelines.ts",
      trackedSectionId: "prose-style-xml-bundle / rule-advanced-prose-nsfw",
      fullTextPreview: dnrBlock,
      charCount: dnrBlock.length,
      clauses: [
        {
          clause: "하나의 발화는 하나의 인용문으로 유지",
          file: "advancedProseNsfwGuidelines.ts",
          influences: ["dialogueLength", "alternation"],
          direction: "format-only",
          note: "대사 분절 금지만 규정; alternation·비율·tempo 미규정",
        },
        {
          clause: "대사 중간에 지문을 끼워 넣어 발화를 분절하지 말 것",
          file: "advancedProseNsfwGuidelines.ts",
          influences: ["alternation", "questionResponseTempo"],
          direction: "helps",
          note: "티키타카 보호; 단 대사 자체를 늘리라는 지시 없음",
        },
      ],
    },
    {
      id: "turnHandoff",
      label: "TURN HANDOFF",
      sourceFile: "src/lib/turnHandoffAndPacing.ts",
      trackedSectionId: "turn-handoff-and-pacing",
      fullTextPreview: handoffFull,
      charCount: handoffFull.length,
      clauses: [
        {
          clause: "Never end immediately after a seemingly complete moment",
          file: "turnHandoffAndPacing.ts",
          influences: ["consecutiveNarration", "narrationWall"],
          direction: "hurts",
          note: "emotional aftermath·body language·atmosphere 확장 → 지문 beat 추가 압력",
        },
        {
          clause: SCENE_CONTINUATION_PRIORITY_BLOCK.split("\n")[1] ?? "",
          file: "turnHandoffAndPacing.ts + sceneExpansionPolicy",
          influences: ["consecutiveNarration", "narrationWall"],
          direction: "hurts",
          note: "대사 삽입 없이 continuation 가능 — rhythm SoT 부재",
        },
        {
          clause: "MINIMUM_FLOOR 미달 전 조기 종료 금지",
          file: "turnHandoffAndPacing.ts",
          influences: ["narrationWall"],
          direction: "neutral",
          note: "분량 gate; rhythm과 간접 연동",
        },
      ],
    },
    {
      id: "lengthControl",
      label: "LENGTH CONTROL",
      sourceFile: "src/lib/responseLength.ts + sceneExpansionPolicy.ts",
      trackedSectionId: "rule-length-control",
      fullTextPreview: lengthFull.slice(0, 1200),
      charCount: lengthFull.length,
      clauses: [
        {
          clause: "각 대사 전·후에 행동·반응·감각·분위기를 서사적으로 전개",
          file: "responseLength.ts",
          influences: ["consecutiveNarration", "narrationWall", "questionResponseTempo"],
          direction: "hurts",
          note: "대사 beat당 지문 2겹 확장 유도 — alternation without new quotes",
        },
        {
          clause: "지문과 대사를 한 문단에 병합하라는 뜻이 아니다",
          file: "responseLength.ts",
          influences: ["alternation"],
          direction: "helps",
          note: "OUTPUT LAYOUT과 정합; 단 대사 block 생성은 강제하지 않음",
        },
        {
          clause: "[NARRATIVE DENSITY] 깊이를 속도보다 우선",
          file: "sceneExpansionPolicy.ts",
          influences: ["consecutiveNarration", "narrationWall"],
          direction: "hurts",
          note: "지문 밀도↑ — dialogue rhythm과 긴장",
        },
        {
          clause: "[MOMENT-TO-MOMENT] 끊지 말고 순간마다 이어 서술",
          file: "sceneExpansionPolicy.ts",
          influences: ["consecutiveNarration", "narrationWall"],
          direction: "hurts",
          note: "연속 서사 = 지문 wall primary driver 후보",
        },
        {
          clause: "TARGET_LENGTH / MINIMUM_FLOOR",
          file: "responseLength.ts",
          influences: ["dialogueLength", "narrationWall"],
          direction: "hurts",
          note: "3200+ chars 채우기 위해 지문 확장이 cheaper path",
        },
      ],
    },
    {
      id: "outputLayout",
      label: "OUTPUT LAYOUT",
      sourceFile: "src/lib/webnovelOutputFormat.ts",
      trackedSectionId: "rule-output-layout-recency",
      fullTextPreview: layoutFull,
      charCount: layoutFull.length,
      clauses: [
        {
          clause: 'Spoken dialogue in " " ALWAYS starts a new paragraph',
          file: "webnovelOutputFormat.ts",
          influences: ["alternation", "dialogueLength"],
          direction: "format-only",
          note: "Mechanical — 대사가 \"로 출력될 때만 alternation 측정 가능",
        },
        {
          clause: "NEVER append spoken dialogue to the end of a narration paragraph",
          file: "webnovelOutputFormat.ts",
          influences: ["alternation"],
          direction: "helps",
          note: "Recency tail — format SoT",
        },
        {
          clause: "do not change pacing or scene structure",
          file: "webnovelOutputFormat.ts",
          influences: ["alternation", "questionResponseTempo", "narrationWall"],
          direction: "neutral",
          note: "명시적 pacing 비소유 — rhythm SoT가 다른 곳에 있어야 함을 시사",
        },
        {
          clause: "Start a new paragraph when: different character speaks / dialogue follows narration",
          file: "webnovelOutputFormat.ts",
          influences: ["alternation"],
          direction: "helps",
          note: "Conditional on dialogue existing in \" form",
        },
      ],
    },
    {
      id: "fewShot",
      label: "Few-shot (example_dialog)",
      sourceFile: "character setting + narrationFewShotTemplates (flag OFF default)",
      trackedSectionId: "character chunks [예시 대화]",
      fullTextPreview: `${formalFewShot.slice(0, 400)}…\n--- hand baseline ---\n${handFewShot.slice(0, 200)}…`,
      charCount: formalFewShot.length,
      clauses: [
        {
          clause: "4-beat 유저/캐릭터 alternation (space or hand narration anchors)",
          file: "narrationFewShotTemplates.ts",
          influences: ["alternation", "questionResponseTempo", "consecutiveNarration"],
          direction: "helps",
          note: "Production default OFF — 대부분 turn에 rhythm anchor 없음",
        },
        {
          clause: "Quoted dialogue lines per beat (~1 per exchange)",
          file: "narrationFewShotTemplates.ts",
          influences: ["dialogueLength", "alternation"],
          direction: "helps",
          note: "존재 시 모범 alternation; coverage 낮음",
        },
      ],
    },
    {
      id: "proseStyle",
      label: "PROSE STYLE",
      sourceFile: "src/lib/advancedProseNsfwGuidelines.ts [PROSE STYLE]",
      trackedSectionId: "prose-style-xml-bundle",
      fullTextPreview: PROSE_STYLE_SECTION,
      charCount: PROSE_STYLE_SECTION.length,
      clauses: [
        {
          clause: "지문 craft만. 대사·말투·줄바꿈·분량은 각 전담 블록 SoT",
          file: "advancedProseNsfwGuidelines.ts",
          influences: ["alternation", "dialogueLength", "questionResponseTempo"],
          direction: "neutral",
          note: "Dialogue rhythm을 명시적으로 다른 블록에 위임 — 그러나 rhythm SoT 미정",
        },
        {
          clause: "[RHYTHM] 문장 길이·밀도·시작형 다양성 (지문 내)",
          file: "advancedProseNsfwGuidelines.ts",
          influences: ["consecutiveNarration"],
          direction: "neutral",
          note: "Within-narration sentence rhythm ≠ dialogue alternation",
        },
        {
          clause: "[WEBNOVEL BREATH] 전환·여운 지문 한 겹",
          file: "advancedProseNsfwGuidelines.ts",
          influences: ["consecutiveNarration", "narrationWall"],
          direction: "hurts",
          note: "대사 없이 breath pad 추가 가능",
        },
      ],
    },
  ];
}

export type ResponsibilityCell = {
  layer: LayerId;
  metric: RhythmMetricKey;
  influence: "primary" | "secondary" | "none" | "conflict";
  summary: string;
};

export function buildResponsibilityMatrix(inventories: LayerInventory[]): ResponsibilityCell[] {
  const cells: ResponsibilityCell[] = [];
  const primaryMap: Record<RhythmMetricKey, LayerId[]> = {
    dialogueLength: ["outputLayout", "dialogueNarration"],
    alternation: ["outputLayout", "dialogueNarration"],
    consecutiveNarration: ["lengthControl", "turnHandoff", "proseStyle"],
    questionResponseTempo: ["dialogueNarration", "lengthControl"],
    narrationWall: ["lengthControl", "turnHandoff"],
  };

  for (const inv of inventories) {
    for (const metric of Object.keys(METRIC_LABEL) as RhythmMetricKey[]) {
      const relevant = inv.clauses.filter((c) => c.influences.includes(metric));
      if (relevant.length === 0) {
        cells.push({
          layer: inv.id,
          metric,
          influence: "none",
          summary: "명시 규칙 없음",
        });
        continue;
      }
      const hurts = relevant.filter((c) => c.direction === "hurts").length;
      const helps = relevant.filter((c) => c.direction === "helps").length;
      const isPrimary = primaryMap[metric]?.includes(inv.id);
      let influence: ResponsibilityCell["influence"] = "secondary";
      if (hurts > 0 && helps > 0) influence = "conflict";
      else if (isPrimary && (helps > 0 || relevant.some((c) => c.direction === "format-only")))
        influence = "primary";
      else if (hurts > 0) influence = "conflict";

      cells.push({
        layer: inv.id,
        metric,
        influence,
        summary: relevant.map((c) => c.clause.slice(0, 60)).join("; "),
      });
    }
  }
  return cells;
}

export type SotRecommendation = {
  semanticRhythmSoT: string;
  formatSoT: string;
  mustDefer: string[];
  rationale: string[];
  gaps: string[];
};

export function recommendDialogueRhythmSoT(inventories: LayerInventory[]): SotRecommendation {
  return {
    semanticRhythmSoT: "[DIALOGUE & NARRATION] (advancedProseNsfwGuidelines.ts)",
    formatSoT: "[OUTPUT LAYOUT] (webnovelOutputFormat.ts — recency tail)",
    mustDefer: [
      "[LENGTH CONTROL & SCENE EXPANSION] — beat ratio·alternation은 DNR SoT 참조, 지문-only expansion cap",
      "<TURN_HANDOFF_AND_PACING> — continuation은 DNR beat pattern 준수 후",
      "[PROSE STYLE] [RHYTHM] — 지문 문장 리듬만; dialogue alternation 비소유",
    ],
    rationale: [
      "OUTPUT LAYOUT은 \"do not change pacing\"으로 semantic rhythm을 명시적으로 비소유",
      "LENGTH+MOMENT-TO-MOMENT+NARRATIVE DENSITY가 narration wall primary pressure (audit empirical)",
      "DNR는 현재 2줄뿐이나 PROSE STYLE header가 dialogue rhythm을 '전담 블록'으로 위임 — DNR이 semantic SoT로 승격해야 함",
      "Few-shot은 rhythm anchor 가능하나 default OFF → SoT는 prompt rule이어야 함",
    ],
    gaps: [
      "목표 dialogueCharShare / max consecutive narration — 어디에도 없음",
      "질문↔응답 max gap — 미규정",
      "inline dialogue without quotes (『』·말했다) — DNR/OUTPUT LAYOUT enforcement gap",
    ],
  };
}

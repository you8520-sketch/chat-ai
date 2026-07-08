/**
 * Step 1.9b — craft candidate OFF transforms (harness-only; no src rule edits).
 */

import {
  MOMENT_TO_MOMENT_WRITING_BLOCK,
  NARRATIVE_DENSITY_BLOCK,
} from "@/lib/sceneExpansionPolicy";
import { SCENE_CONTINUATION_PRIORITY_BLOCK } from "@/lib/turnHandoffAndPacing";

export type CraftCandidateId = "M-04" | "M-05" | "M-06" | "M-09" | "M-10" | "M-11";

export type CraftCandidateDef = {
  id: CraftCandidateId;
  label: string;
  source: string;
  responsibility: string;
  correctSoT: string;
  /** Exact or regex patterns removed when candidate is OFF */
  offPatterns: RegExp[];
  /** Human-readable lines removed (for diff display) */
  removedLines: string[];
  /** Lines intentionally kept when OFF */
  keptLines: string[];
};

const M04_LINE =
  "- 각 대사 전·후에 행동·반응·감각·분위기를 서사적으로 전개한다 — 장면 흐름을 채우라는 뜻이며, 지문과 대사를 한 문단에 병합하라는 뜻이 아니다";

/** SCENE CONTINUATION with craft stripped (M-10 OFF) — pacing only */
const SCENE_CONTINUATION_PACING_ONLY = `[SCENE CONTINUATION PRIORITY]
Never stop at the first satisfying ending.
새 상호작용까지 이어간다.
Expand through progression.`;

/** TURN HANDOFF with craft bullets removed (M-09 OFF) */
const TURN_HANDOFF_PACING_ONLY = `<TURN_HANDOFF_AND_PACING>
[조기 종료 금지]
- MINIMUM_FLOOR 미달 전 조기 종료·관찰자 붕괴 결말 금지

[TURN HANDOFF]
Never end immediately after a seemingly complete moment.
Continue through:
- new interaction
Return the scene naturally to the user.
</TURN_HANDOFF_AND_PACING>`;

export const CRAFT_CANDIDATES: CraftCandidateDef[] = [
  {
    id: "M-04",
    label: "대사 전후 감각·분위기 전개",
    source: "LENGTH CONTROL",
    responsibility: "sensation, emotion, expansion",
    correctSoT: "PROSE EMOTION/SENSATION/BREATH",
    offPatterns: [new RegExp(M04_LINE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")],
    removedLines: [M04_LINE],
    keptLines: [
      "TARGET_LENGTH / MINIMUM_FLOOR",
      "NO INPUT ECHO",
      "mirroring 금지 · 새 서사 비트 확장",
    ],
  },
  {
    id: "M-05",
    label: "NARRATIVE DENSITY craft",
    source: "LENGTH → NARRATIVE DENSITY",
    responsibility: "slomo, touch, atmosphere expansion",
    correctSoT: "PROSE EMOTION/SENSATION/RHYTHM",
    offPatterns: [
      new RegExp(
        NARRATIVE_DENSITY_BLOCK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\n/g, "\\n"),
        "g"
      ),
    ],
    removedLines: NARRATIVE_DENSITY_BLOCK.split("\n"),
    keptLines: ["LENGTH numeric targets", "NO INPUT ECHO", "mirroring / 새 서사 비트"],
  },
  {
    id: "M-06",
    label: "MOMENT-TO-MOMENT craft",
    source: "LENGTH → MOMENT-TO-MOMENT",
    responsibility: "moment chain, direct depiction",
    correctSoT: "PROSE RHYTHM/EMOTION + Pacing",
    offPatterns: [
      new RegExp(
        MOMENT_TO_MOMENT_WRITING_BLOCK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\n/g, "\\n"),
        "g"
      ),
    ],
    removedLines: MOMENT_TO_MOMENT_WRITING_BLOCK.split("\n"),
    keptLines: ["LENGTH targets", "SCENE CONTINUATION (pacing)"],
  },
  {
    id: "M-09",
    label: "TURN HANDOFF body/atmosphere",
    source: "TURN HANDOFF",
    responsibility: "aftermath, body language, atmosphere",
    correctSoT: "PROSE EMOTION/BREATH",
    offPatterns: [
      /- emotional aftermath\n- body language\n- atmosphere change\n/,
      /<TURN_HANDOFF_AND_PACING>[\s\S]*?<\/TURN_HANDOFF_AND_PACING>/,
    ],
    removedLines: [
      "- emotional aftermath",
      "- body language",
      "- atmosphere change",
    ],
    keptLines: [
      "Never end immediately",
      "- new interaction",
      "Return the scene naturally to the user",
      "MINIMUM_FLOOR 조기 종료 금지",
    ],
  },
  {
    id: "M-10",
    label: "SCENE CONTINUATION 몸짓·분위기",
    source: "SCENE CONTINUATION PRIORITY",
    responsibility: "몸짓, 분위기, never repetition",
    correctSoT: "PROSE EMOTION/BREATH + CROSS-TURN",
    offPatterns: [
      new RegExp(
        SCENE_CONTINUATION_PRIORITY_BLOCK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\n/g, "\\n"),
        "g"
      ),
    ],
    removedLines: SCENE_CONTINUATION_PRIORITY_BLOCK.split("\n"),
    keptLines: SCENE_CONTINUATION_PACING_ONLY.split("\n"),
  },
  {
    id: "M-11",
    label: "genre_tone craft",
    source: "genre_tone (narrativeStyle)",
    responsibility: "show-dont-tell, 시선·호흡·감각",
    correctSoT: "PROSE EMOTION/SENSATION/RHYTHM/REGISTER",
    offPatterns: [/\[genre_tone\][^\n]+\n?/g],
    removedLines: ["[genre_tone] … (craft hints per genre)"],
    keptLines: ["[possession_mode]", "LENGTH", "PROSE bundle"],
  },
];

export function applyCandidateOff(prompt: string, candidateId: CraftCandidateId): string {
  const def = CRAFT_CANDIDATES.find((c) => c.id === candidateId);
  if (!def) return prompt;

  let out = prompt;
  if (candidateId === "M-09") {
    out = out.replace(
      /<TURN_HANDOFF_AND_PACING>[\s\S]*?<\/TURN_HANDOFF_AND_PACING>/,
      TURN_HANDOFF_PACING_ONLY
    );
    return out.replace(/\n{3,}/g, "\n\n");
  }
  if (candidateId === "M-10") {
    out = out.replace(
      new RegExp(
        SCENE_CONTINUATION_PRIORITY_BLOCK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\n/g, "\\n"),
        "g"
      ),
      SCENE_CONTINUATION_PACING_ONLY
    );
    return out.replace(/\n{3,}/g, "\n\n");
  }

  for (const re of def.offPatterns) {
    out = out.replace(re, "");
  }
  return out.replace(/\n{3,}/g, "\n\n");
}

export function promptDiffSummary(before: string, after: string): {
  beforeChars: number;
  afterChars: number;
  deltaChars: number;
  removedSnippets: string[];
} {
  const removedSnippets: string[] = [];
  if (before.length > after.length) {
    for (const line of before.split("\n")) {
      const t = line.trim();
      if (t.length > 8 && !after.includes(line)) removedSnippets.push(line);
    }
  }
  return {
    beforeChars: before.length,
    afterChars: after.length,
    deltaChars: after.length - before.length,
    removedSnippets: removedSnippets.slice(0, 30),
  };
}

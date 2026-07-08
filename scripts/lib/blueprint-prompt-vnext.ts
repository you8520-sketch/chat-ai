/**
 * Step 4.1 — Blueprint prompt architecture (harness-only; no src edits).
 * Replaces PROSE 5 craft sections + duplicated LENGTH/HANDOFF/genre craft with FLOW layer.
 */

import { GENERATION_PROCESS_BEAT_FLOW_BLOCK } from "@/lib/generationProcessBeatFlow";
import { PROSE_STYLE_SECTION } from "@/lib/advancedProseNsfwGuidelines";
import { primaryCharacterGenre, type CharacterGenre } from "@/lib/characterGenres";
import { buildLengthInstruction } from "@/lib/responseLength";
import { buildTurnHandoffAndPacingBlock } from "@/lib/turnHandoffAndPacing";
import { buildWebnovelOutputLayoutRecencyBlock } from "@/lib/webnovelOutputFormat";
import { NO_INPUT_ECHO_RULE } from "@/lib/sceneExpansionPolicy";

export const REGISTER_VNEXT = `[REGISTER]
해체(-다/-했다/-이었다). 번역투·명사 단편·...... 금지.
말줄임 ... 은 실제 망설임·끊김·여운에만.`;

export const FLOW_PROCESS_VNEXT = GENERATION_PROCESS_BEAT_FLOW_BLOCK;

export const STYLE_CONTENT_VNEXT = `[STYLE — content constraints only]
지문 craft. 대사·줄바꿈·분량·리듬은 FLOW/LAYOUT SoT.
감정 라벨("슬프다") 지문 금지. 현재 장면 무관 설정 나열 금지.
Stage-direction/meta narration 금지. 순간 요약 금지.
Turn 간 동일 반응 패턴·문장 구조 재사용 금지.`;

export const DIALOGUE_INTEGRITY_VNEXT = `[DIALOGUE INTEGRITY]
- one utterance = one "
- no mid-quote narration split`;

export const BLUEPRINT_PROSE_STYLE_VNEXT = `[PROSE STYLE]
${REGISTER_VNEXT}

${FLOW_PROCESS_VNEXT}

${STYLE_CONTENT_VNEXT}`;

const DNR_PATTERN =
  /\[DIALOGUE & NARRATION\][\s\S]*?(?=\n\[19\+ INTIMACY\]|\n\[PROSE STYLE\]|$)/;

const NO_STAGE_PATTERN = /\[NO STAGE DIRECTIONS\][\s\S]*?(?=\n\[|$)/;
const NO_ABSTRACT_PATTERN = /\[NO ABSTRACT SUMMARIES\][\s\S]*?(?=\n\[|$)/;
const CROSS_TURN_PATTERN = /\[CROSS-TURN VARIATION\][^\n]*(?:\n[^\n[]*)?/g;
const GENRE_TONE_PATTERN = /\[genre_tone\][^\n]+\n?/g;
const LENGTH_BLOCK_PATTERN = /\[LENGTH CONTROL[\s\S]*?(?=\n\[|\n<|$)/;

const SCENE_MODE_BY_GENRE: Partial<Record<CharacterGenre, "calm" | "tension" | "combat">> = {
  "공포/추리": "tension",
  "코믹/액션": "combat",
  "판타지/SF": "calm",
  "로맨스 판타지": "calm",
  "현대 판타지": "calm",
  "무협/시대극": "tension",
  인외: "tension",
  "현대/일상": "calm",
  "학원/스포츠": "calm",
  시뮬레이션: "calm",
  로맨스: "calm",
  BL: "calm",
  GL: "calm",
};

function normalizePrompt(prompt: string): string {
  return prompt.replace(/\n{3,}/g, "\n\n").trim();
}

function stripExactBlock(prompt: string, block: string): string {
  if (!block.trim() || !prompt.includes(block.slice(0, 40))) return prompt;
  return normalizePrompt(prompt.replace(block, ""));
}

function extractLengthTargets(prompt: string): { aim: string; min: string } {
  const aim = prompt.match(/TARGET_LENGTH:\s*([\d,]+)/)?.[1] ?? "3,200";
  const min = prompt.match(/MINIMUM_FLOOR:\s*([\d,]+)/)?.[1] ?? "2,400";
  return { aim, min };
}

export function buildLengthControlVNext(aim: string, min: string): string {
  return `[LENGTH CONTROL]
TARGET_LENGTH: ${aim}+ · MINIMUM_FLOOR: ${min}+
${NO_INPUT_ECHO_RULE}
- mirroring 금지; 새 서사 비트로 확장
- 분량은 [GENERATION PROCESS] loop count로 충족; narration-only stack 금지`;
}

export function buildTurnHandoffVNext(): string {
  return `<TURN_HANDOFF>
MINIMUM_FLOOR 미달 조기 종료 금지.
Turn ends at handoff phase (step 7); hook must stay partially open.`;
}

export function buildSceneModeSelect(genres?: CharacterGenre[]): string {
  const primary = primaryCharacterGenre(genres ?? []);
  const mode = SCENE_MODE_BY_GENRE[primary] ?? "calm";
  return `[SCENE MODE SELECT]
${primary} → ${mode} (see [SCENE MODE] in FLOW).`;
}

function injectDialogueIntegrity(prompt: string): string {
  if (prompt.includes("[DIALOGUE INTEGRITY]")) return prompt;
  const layoutBlock = buildWebnovelOutputLayoutRecencyBlock();
  if (prompt.includes(layoutBlock.slice(0, 30))) {
    return prompt.replace(layoutBlock, `${layoutBlock}\n\n${DIALOGUE_INTEGRITY_VNEXT}`);
  }
  return `${prompt}\n\n${DIALOGUE_INTEGRITY_VNEXT}`;
}

function injectSceneModeSelect(prompt: string, block: string): string {
  const cleaned = prompt.replace(GENRE_TONE_PATTERN, "");
  if (cleaned.includes("[SCENE MODE SELECT]")) {
    return cleaned.replace(/\[SCENE MODE SELECT\][^\n]*(?:\n[^\n[]*)?/, block);
  }
  const handoffIdx = cleaned.indexOf("<TURN_HANDOFF");
  if (handoffIdx >= 0) {
    return `${cleaned.slice(0, handoffIdx).trimEnd()}\n\n${block}\n\n${cleaned.slice(handoffIdx)}`;
  }
  return `${cleaned}\n\n${block}`;
}

/** Transform production-assembled system prompt → Blueprint vNext (harness only). */
export function applyBlueprintArchitecture(
  systemPrompt: string,
  opts?: { genres?: CharacterGenre[] }
): string {
  const { aim, min } = extractLengthTargets(systemPrompt);
  const lengthProduction = buildLengthInstruction(
    Number.parseInt(aim.replace(/,/g, ""), 10) || 3200,
    {
      statusWindowEveryTurn: false,
      htmlFlashOwned: true,
      proseStylePolicyOwnsSceneExpansion: true,
      statusWidgetActive: false,
    }
  );
  const handoffProduction = buildTurnHandoffAndPacingBlock();

  let out = systemPrompt;

  out = normalizePrompt(out.replace(NO_STAGE_PATTERN, ""));
  out = normalizePrompt(out.replace(NO_ABSTRACT_PATTERN, ""));
  out = normalizePrompt(out.replace(CROSS_TURN_PATTERN, ""));
  out = normalizePrompt(out.replace(DNR_PATTERN, ""));

  if (out.includes(PROSE_STYLE_SECTION.slice(0, 40))) {
    out = out.replace(PROSE_STYLE_SECTION, BLUEPRINT_PROSE_STYLE_VNEXT);
  } else {
    out = `${out}\n\n${BLUEPRINT_PROSE_STYLE_VNEXT}`;
  }

  out = stripExactBlock(out, lengthProduction);
  out = out.replace(LENGTH_BLOCK_PATTERN, buildLengthControlVNext(aim, min));

  out = stripExactBlock(out, handoffProduction);
  if (out.includes("<TURN_HANDOFF_AND_PACING>")) {
    out = out.replace(/<TURN_HANDOFF_AND_PACING>[\s\S]*?<\/TURN_HANDOFF_AND_PACING>/, buildTurnHandoffVNext());
  } else if (!out.includes("<TURN_HANDOFF>")) {
    out = `${out}\n\n${buildTurnHandoffVNext()}`;
  } else {
    out = out.replace(/<TURN_HANDOFF>[\s\S]*?(?=\n\[|\n<|$)/, buildTurnHandoffVNext());
  }

  if (opts?.genres?.length) {
    out = injectSceneModeSelect(out, buildSceneModeSelect(opts.genres));
  } else {
    out = out.replace(GENRE_TONE_PATTERN, "");
  }

  out = injectDialogueIntegrity(out);

  return normalizePrompt(out);
}

export function blueprintPromptDiffSummary(before: string, after: string): {
  beforeChars: number;
  afterChars: number;
  deltaChars: number;
  removedSections: string[];
} {
  const removed: string[] = [];
  if (before.includes("[RHYTHM]")) removed.push("PROSE [RHYTHM]");
  if (before.includes("[SENSATION]")) removed.push("PROSE [SENSATION]");
  if (before.includes("[EMOTION]")) removed.push("PROSE [EMOTION]");
  if (before.includes("[MOVEMENT & SPACE]")) removed.push("PROSE [MOVEMENT & SPACE]");
  if (before.includes("[WEBNOVEL BREATH]")) removed.push("PROSE [WEBNOVEL BREATH]");
  if (before.includes("[NARRATIVE DENSITY]")) removed.push("LENGTH [NARRATIVE DENSITY]");
  if (before.includes("[MOMENT-TO-MOMENT")) removed.push("LENGTH [MOMENT-TO-MOMENT]");
  if (before.includes("[SCENE CONTINUATION PRIORITY]")) removed.push("LENGTH [SCENE CONTINUATION]");
  if (before.includes("각 대사 전·후")) removed.push("LENGTH pre/post dialogue craft");
  if (before.includes("[genre_tone]")) removed.push("genre_tone craft");
  if (before.includes("emotional aftermath")) removed.push("TURN HANDOFF craft bullets");

  return {
    beforeChars: before.length,
    afterChars: after.length,
    deltaChars: after.length - before.length,
    removedSections: removed,
  };
}

/**
 * STEP C2-R — experiment-only prose ablation arms (NOT production).
 *
 * Arms:
 *   A  = production PROSE_STYLE_SECTION (byte-identical)
 *   M1 = short-sentence / translationese family merge only
 *   M2 = quiet-scene anti-summary relocation/merge only
 *   AB = M1 + M2 (= C2-Micro candidate)
 *
 * Production buildAdvancedProseNsfwGuidelines() is untouched.
 */
import { createHash } from "node:crypto";
import {
  IMMERSIVE_PROSE_BLOCK,
  PROSE_STYLE_SECTION,
  buildAdvancedProseNsfwGuidelines,
  type AdvancedProseNsfwOpts,
} from "@/lib/advancedProseNsfwGuidelines";
import { SCENE_FLOW_BLOCK } from "@/lib/generationProcessBeatFlow";

export type C2rArm = "A" | "M1" | "M2" | "AB";

/** Exact baseline clauses (production). */
export const C2R_BASELINE = {
  narrationTranslationese:
    "번역투·명사 단편 행·쉼표 나열로 이어 붙인 문장 금지.",
  rhythmShortSentence:
    "짧은 문장·파편은 강조·긴장·충격에 이득일 때만 쓰고 습관적 연타를 피한다. 평서 지문은 한국어 흐름으로 관련 생각을 완결 문장에 묶고, 「하지만 그것도 찰나.」「아직은.」「그건 아니었다.」「천천히.」형 번역체 단문을 연속으로 늘어놓지 않는다.",
  sceneFlowQuiet:
    "평온한 장면도 짧게 요약하지 않고 인물·관계·대화·내면·분위기·주변 상황의 변화로 전개한다.",
  immersiveQuiet:
    "평온한 장면도 대화·내면·관계·분위기·결과로 전개하되 미세 행동·반복 해설로 분량을 채우지 않는다.",
} as const;

/** M1 owner — sole RHYTHM short-sentence / translationese line. */
export const C2R_M1_RHYTHM_OWNER =
  "번역투식 단문·명사 파편·쉼표 나열·짧은 문장의 습관적 연타를 피한다. 짧은 문장·파편은 충격·결정·감각의 절정처럼 실제 강조가 필요할 때만 쓰고, 평서 지문은 한국어 흐름으로 관련 생각을 완결 문장에 묶는다(「하지만 그것도 찰나.」「아직은.」「그건 아니었다.」「천천히.」형 연속 금지).";

/** M2 SCENE FLOW primary (quiet-scene owner after merge). */
export const SCENE_FLOW_BLOCK_C2R_M2 = `[SCENE FLOW]
장면의 성격에 맞춰 속도를 조절하되 calm/tension/combat는 분량 수준을 의미하지 않는다.
평온한 장면도 짧게 요약하지 말고 인물·관계·대화·내면·분위기·주변 상황의 변화로 실제로 전개하되, 미세 행동·반복 해설로 분량을 채우지 않는다.`;

/**
 * M2 IMMERSIVE = production IMMERSIVE with quiet-scene paragraph removed.
 * (Position change: quiet-scene meaning moves earlier into SCENE FLOW.)
 * Collapse the gap so paragraph spacing matches surrounding blocks.
 */
export const IMMERSIVE_PROSE_BLOCK_C2R_M2 = IMMERSIVE_PROSE_BLOCK.split("\n")
  .filter((line) => line !== C2R_BASELINE.immersiveQuiet)
  .join("\n")
  .replace(/\n{3,}/g, "\n\n");

export const C2R_M2_CHANGE_KIND = {
  wording_change: true,
  position_change: true,
  recency_order_change:
    "quiet-scene clause moves earlier (SCENE FLOW before IMMERSIVE); OUTPUT-LAYOUT recency line unchanged",
} as const;

function applyM1(section: string): string {
  if (!section.includes(C2R_BASELINE.narrationTranslationese)) {
    throw new Error("applyM1: narration translationese baseline missing");
  }
  if (!section.includes(C2R_BASELINE.rhythmShortSentence)) {
    throw new Error("applyM1: rhythm short-sentence baseline missing");
  }
  return section
    .replace(`${C2R_BASELINE.narrationTranslationese}\n`, "")
    .replace(C2R_BASELINE.rhythmShortSentence, C2R_M1_RHYTHM_OWNER);
}

function applyM2(section: string): string {
  if (!section.includes(SCENE_FLOW_BLOCK)) {
    throw new Error("applyM2: SCENE_FLOW_BLOCK baseline missing");
  }
  if (!section.includes(IMMERSIVE_PROSE_BLOCK)) {
    throw new Error("applyM2: IMMERSIVE_PROSE_BLOCK baseline missing");
  }
  // When composing after M1, IMMERSIVE is still the production block.
  return section
    .replace(SCENE_FLOW_BLOCK, SCENE_FLOW_BLOCK_C2R_M2)
    .replace(IMMERSIVE_PROSE_BLOCK, IMMERSIVE_PROSE_BLOCK_C2R_M2);
}

export const PROSE_STYLE_SECTION_C2R_A = PROSE_STYLE_SECTION;
export const PROSE_STYLE_SECTION_C2R_M1 = applyM1(PROSE_STYLE_SECTION);
export const PROSE_STYLE_SECTION_C2R_M2 = applyM2(PROSE_STYLE_SECTION);
export const PROSE_STYLE_SECTION_C2R_AB = applyM2(applyM1(PROSE_STYLE_SECTION));

/** Composition must be commutative on disjoint regions. */
const AB_ALT = applyM1(applyM2(PROSE_STYLE_SECTION));
if (AB_ALT !== PROSE_STYLE_SECTION_C2R_AB) {
  throw new Error("C2-R AB composition non-commutative — regions overlap?");
}

export const C2R_ARM_PROSE: Record<C2rArm, string> = {
  A: PROSE_STYLE_SECTION_C2R_A,
  M1: PROSE_STYLE_SECTION_C2R_M1,
  M2: PROSE_STYLE_SECTION_C2R_M2,
  AB: PROSE_STYLE_SECTION_C2R_AB,
};

export const C2R_ARM_MARKER: Record<C2rArm, string> = {
  A: "[C2R_ARM_A]",
  M1: "[C2R_ARM_M1]",
  M2: "[C2R_ARM_M2]",
  AB: "[C2R_ARM_AB]",
};

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length * 0.9));
}

/** First / last UTF-16 code unit offset where `a` differs from `b`. */
export function diffByteOffsets(
  a: string,
  b: string
): { first: number | null; last: number | null } {
  if (a === b) return { first: null, last: null };
  const max = Math.max(a.length, b.length);
  let first: number | null = null;
  let last: number | null = null;
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) {
      if (first == null) first = i;
      last = i;
    }
  }
  return { first, last };
}

export type C2rFingerprint = {
  arm: C2rArm;
  sha256: string;
  chars: number;
  estimated_tokens: number;
  changed_clause_ids: string[];
  first_changed_offset_vs_A: number | null;
  last_changed_offset_vs_A: number | null;
};

export function fingerprintArm(arm: C2rArm): C2rFingerprint {
  const prose = C2R_ARM_PROSE[arm];
  const offsets = diffByteOffsets(PROSE_STYLE_SECTION, prose);
  const changed: string[] = [];
  if (arm === "M1" || arm === "AB") {
    changed.push("P02_NARRATION_TRANSLATIONESE", "P07_RHYTHM_SHORT_SENTENCE");
  }
  if (arm === "M2" || arm === "AB") {
    changed.push("P05_SCENE_FLOW_QUIET", "P18_IMMERSIVE_QUIET");
  }
  return {
    arm,
    sha256: sha256Hex(prose),
    chars: prose.length,
    estimated_tokens: estimateTokens(prose),
    changed_clause_ids: changed,
    first_changed_offset_vs_A: offsets.first,
    last_changed_offset_vs_A: offsets.last,
  };
}

/**
 * Assert regional isolation:
 * - M1 changes only NARRATION/RHYTHM family (SCENE FLOW + IMMERSIVE + SENSATION + BREATH identical to A)
 * - M2 changes only SCENE FLOW + IMMERSIVE quiet ownership
 * - AB = exact composition of M1 + M2
 */
export function assertC2rRegionalIsolation(): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const A = PROSE_STYLE_SECTION_C2R_A;
  const M1 = PROSE_STYLE_SECTION_C2R_M1;
  const M2 = PROSE_STYLE_SECTION_C2R_M2;
  const AB = PROSE_STYLE_SECTION_C2R_AB;

  if (A !== PROSE_STYLE_SECTION) {
    errors.push("A must be byte-identical to production PROSE_STYLE_SECTION");
  }

  // M1: SCENE FLOW / IMMERSIVE / SENSATION / BREATH must match A
  if (!M1.includes(SCENE_FLOW_BLOCK)) {
    errors.push("M1 must keep production SCENE_FLOW_BLOCK");
  }
  if (!M1.includes(IMMERSIVE_PROSE_BLOCK)) {
    errors.push("M1 must keep production IMMERSIVE_PROSE_BLOCK");
  }
  if (M1.includes(C2R_BASELINE.narrationTranslationese)) {
    errors.push("M1 must remove narration translationese orphan line");
  }
  if (!M1.includes(C2R_M1_RHYTHM_OWNER)) {
    errors.push("M1 must contain M1 rhythm owner");
  }
  if (M1.includes(C2R_BASELINE.rhythmShortSentence)) {
    errors.push("M1 must replace baseline rhythm short-sentence line");
  }
  if (M1.includes(SCENE_FLOW_BLOCK_C2R_M2)) {
    errors.push("M1 must not include M2 scene-flow wording");
  }

  // M2: NARRATION translationese + RHYTHM baseline must remain
  if (!M2.includes(C2R_BASELINE.narrationTranslationese)) {
    errors.push("M2 must keep narration translationese baseline");
  }
  if (!M2.includes(C2R_BASELINE.rhythmShortSentence)) {
    errors.push("M2 must keep rhythm short-sentence baseline");
  }
  if (!M2.includes(SCENE_FLOW_BLOCK_C2R_M2)) {
    errors.push("M2 must use M2 scene-flow block");
  }
  if (M2.includes(C2R_BASELINE.immersiveQuiet)) {
    errors.push("M2 must remove immersive quiet-scene line");
  }
  if (M2.includes(C2R_M1_RHYTHM_OWNER)) {
    errors.push("M2 must not include M1 rhythm owner");
  }

  // AB composition
  if (AB !== applyM2(applyM1(A))) {
    errors.push("AB must equal applyM2(applyM1(A))");
  }
  if (!AB.includes(C2R_M1_RHYTHM_OWNER) || !AB.includes(SCENE_FLOW_BLOCK_C2R_M2)) {
    errors.push("AB must include both M1 owner and M2 scene-flow");
  }
  if (AB.includes(C2R_BASELINE.narrationTranslationese)) {
    errors.push("AB must not keep narration orphan");
  }
  if (AB.includes(C2R_BASELINE.immersiveQuiet)) {
    errors.push("AB must not keep immersive quiet line");
  }

  // Frozen owners present in all arms
  for (const [name, prose] of [
    ["A", A],
    ["M1", M1],
    ["M2", M2],
    ["AB", AB],
  ] as const) {
    if (!prose.includes("[SENSATION]")) errors.push(`${name}: missing SENSATION`);
    if (!prose.includes("[WEBNOVEL BREATH]")) {
      errors.push(`${name}: missing WEBNOVEL BREATH`);
    }
    // M3 keep separate markers
    if (!prose.includes("다른 비유·정의·대비로 반복 증명하지 말고")) {
      errors.push(`${name}: M3 repetition owner missing`);
    }
    if (!prose.includes("추상 판정·정답 해설로 다시 쓰지 않는다")) {
      errors.push(`${name}: M3 tell-after-show owner missing`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function replaceProseStyleSectionWithC2rArm(
  systemPrompt: string,
  arm: C2rArm
): string {
  const marker = C2R_ARM_MARKER[arm];
  if (systemPrompt.includes(marker)) return systemPrompt;
  if (!systemPrompt.includes(PROSE_STYLE_SECTION)) {
    throw new Error(
      `replaceProseStyleSectionWithC2rArm(${arm}): production PROSE_STYLE_SECTION not found`
    );
  }
  const next = C2R_ARM_PROSE[arm];
  return systemPrompt.split(PROSE_STYLE_SECTION).join(`${next}\n${marker}`);
}

export function buildAdvancedProseNsfwGuidelinesC2r(
  arm: C2rArm,
  opts: AdvancedProseNsfwOpts
): string {
  return buildAdvancedProseNsfwGuidelines({
    ...opts,
    proseStyleSection: C2R_ARM_PROSE[arm],
  });
}

/**
 * Register-pattern classifier for the auto-tag pipeline (Step 2/3 of the
 * pass-through + periodic batch design).
 *
 * Heuristic pre-pass first; LLM escalation ONLY for ambiguous cases.
 *
 * Evidence priority (verified against the 4 production characters):
 *   1. Existing bracket tags in example_dialog with 2+ distinct buckets
 *      → scene_based_multi (레온).
 *   2. Card speech-section context split (공적:/사적: register map) →
 *      scene_based_multi.
 *   3. Register distribution of actual example dialogue lines:
 *      all one family → single_* (칼리안). Mixed families with no scene
 *      evidence → AMBIGUOUS → LLM (하유진: 감정 기반 비꼼존대↔반말).
 *   4. No dialogue lines at all → forbidden_speech_patterns fallback
 *      (에쉬: "반말·하대" 금지 → single polite).
 *      NOTE: forbidden lists are shared platform defaults — 칼리안도
 *      "반말 금지" 블록을 갖고 있으므로 라인 증거가 있으면 라인이 이긴다.
 *
 * Confidence gate (fixed): confidence < 0.8 OR emotion_based_multi →
 * force single [사적] tagging (no register-map spread).
 */

import {
  classifyLineRegister,
  type ExpectedRegister,
} from "@/lib/characterRegisterCompliance";
import { stripLeadingContextTag, normalizeSpeechContextTag } from "@/lib/exampleDialogSceneFilter";
import { parseCardRegisterMap } from "./autoTagExampleDialog";

export type RegisterPattern =
  | "single_haeyo"
  | "single_banmal"
  | "single_formal"
  | "scene_based_multi"
  | "emotion_based_multi"
  | "unknown";

export type ClassificationMethod = "heuristic" | "llm" | "llm_unavailable";

export type RegisterPatternClassification = {
  pattern: RegisterPattern;
  confidence: number;
  method: ClassificationMethod;
  reason: string;
};

export const CONFIDENCE_GATE_THRESHOLD = 0.8;

export type ClassifierInput = {
  exampleDialog: string;
  speechSection: string;
  forbiddenSpeechPatterns: string[];
};

const USER_LINE_RE = /^(?:유저|user|나|당신)\s*[:：]/i;
const SECTION_HEADER_RE = /^\[[^\]]+\]\s*$/;

/** Dialogue lines only (user lines, metadata headers/sections excluded). */
export function extractDialogueLinesForClassification(exampleDialog: string): string[] {
  const out: string[] = [];
  let inMetadataSection = false;

  for (const raw of exampleDialog.replace(/\r\n/g, "\n").split("\n")) {
    let line = raw.trim();
    if (!line) continue;

    if (SECTION_HEADER_RE.test(line)) {
      // [예시 대사]/[예시 대화] re-enters dialogue; other headers are metadata.
      inMetadataSection = !/^\[예시\s*(?:대사|대화)\]$/.test(line);
      continue;
    }
    if (inMetadataSection) continue;

    line = stripLeadingContextTag(line).rest;
    if (!line || USER_LINE_RE.test(line)) continue;
    // char-prefixed pair line → strip the speaker prefix
    line = line.replace(/^[^\s:：]{1,16}\s*[:：]\s*/, "");
    if (line) out.push(line);
  }
  return out;
}

function existingTagBuckets(exampleDialog: string): Set<string> {
  const buckets = new Set<string>();
  for (const raw of exampleDialog.replace(/\r\n/g, "\n").split("\n")) {
    const { tag } = stripLeadingContextTag(raw.trim());
    if (!tag) continue;
    const norm = normalizeSpeechContextTag(tag);
    if (norm) buckets.add(norm);
  }
  return buckets;
}

type RegisterFamily = "polite" | "banmal";

function registerFamily(reg: ExpectedRegister): RegisterFamily {
  return reg === "banmal" ? "banmal" : "polite";
}

const FORBIDDEN_BANMAL_BAN_RE = /반말.*(?:하대|금지)|반말·하대/;
const FORBIDDEN_POLITE_BAN_RE = /존댓말\s*금지|경어\s*금지/;

export function classifyRegisterPatternHeuristic(
  input: ClassifierInput
): RegisterPatternClassification | null {
  // 1. Existing tags across 2+ buckets → the creator already declared scenes.
  const buckets = existingTagBuckets(input.exampleDialog);
  if (buckets.size >= 2) {
    return {
      pattern: "scene_based_multi",
      confidence: 0.95,
      method: "heuristic",
      reason: `existing bracket tags span ${buckets.size} buckets (${[...buckets].join(", ")})`,
    };
  }

  // 2. Card declares a context split (공적: 다나까 / 사적: 해요체 …).
  const cardMap = parseCardRegisterMap(input.speechSection);
  if (cardMap.hasContextSplit) {
    return {
      pattern: "scene_based_multi",
      confidence: 0.9,
      method: "heuristic",
      reason: `card speech section declares context split (public=${cardMap.publicRegister}, private=${cardMap.privateRegister})`,
    };
  }

  // 3. Register distribution of actual dialogue lines — lines beat forbidden
  //    lists (platform default forbidden blocks are shared across characters).
  const lines = extractDialogueLinesForClassification(input.exampleDialog);
  const registers = lines
    .map((l) => classifyLineRegister(l))
    .filter((r): r is ExpectedRegister => r !== "other");

  if (registers.length >= 2) {
    const families = new Set(registers.map(registerFamily));
    if (families.size === 1) {
      const fam = [...families][0]!;
      if (fam === "banmal") {
        return {
          pattern: "single_banmal",
          confidence: 0.9,
          method: "heuristic",
          reason: `${registers.length} classified lines all banmal family`,
        };
      }
      const hasFormal = registers.some((r) => r === "formal" || r === "danakka");
      const hasHaeyo = registers.some((r) => r === "haeyo");
      if (hasFormal && !hasHaeyo) {
        return {
          pattern: "single_formal",
          confidence: 0.9,
          method: "heuristic",
          reason: `${registers.length} classified lines all formal/danakka`,
        };
      }
      if (hasHaeyo && !hasFormal) {
        return {
          pattern: "single_haeyo",
          confidence: 0.9,
          method: "heuristic",
          reason: `${registers.length} classified lines all haeyo`,
        };
      }
      // haeyo+formal mixed within polite family — still polite-single but
      // which register anchors is unclear → ambiguous.
      return null;
    }
    // Mixed polite/banmal with no scene evidence — emotion-based switching
    // candidate (하유진류). Heuristic cannot decide the axis → escalate.
    return null;
  }

  // 4. No usable dialogue lines → forbidden-pattern fallback (에쉬 케이스).
  const forbidden = input.forbiddenSpeechPatterns.join("\n");
  const bansBanmal = FORBIDDEN_BANMAL_BAN_RE.test(forbidden);
  const bansPolite = FORBIDDEN_POLITE_BAN_RE.test(forbidden);
  if (bansBanmal && !bansPolite) {
    return {
      pattern: "single_haeyo",
      confidence: 0.85,
      method: "heuristic",
      reason: "no dialogue lines; forbidden patterns ban banmal → polite single register",
    };
  }
  if (bansPolite && !bansBanmal) {
    return {
      pattern: "single_banmal",
      confidence: 0.85,
      method: "heuristic",
      reason: "no dialogue lines; forbidden patterns ban polite forms → banmal single register",
    };
  }

  return null;
}

/* ------------------------------------------------------------------ *
 * LLM escalation + confidence gate
 * ------------------------------------------------------------------ */

export type LlmRegisterClassifier = (
  input: ClassifierInput
) => Promise<{ pattern: RegisterPattern; confidence: number; reason: string }>;

export async function classifyRegisterPattern(
  input: ClassifierInput,
  llm?: LlmRegisterClassifier
): Promise<RegisterPatternClassification> {
  const heuristic = classifyRegisterPatternHeuristic(input);
  if (heuristic) return heuristic;

  if (!llm) {
    return {
      pattern: "unknown",
      confidence: 0,
      method: "llm_unavailable",
      reason: "heuristic ambiguous and no LLM classifier provided — confidence gate forces single [사적]",
    };
  }

  const r = await llm(input);
  return { ...r, method: "llm" };
}

export type TagPlan = {
  /** force_private = confidence gate tripped → every untagged line gets [사적]. */
  mode: "register_map" | "force_private";
  gateTripped: boolean;
  gateReason: string | null;
};

/** Confidence gate: <0.8 OR emotion_based_multi → single [사적], no exceptions. */
export function resolveTagPlan(c: RegisterPatternClassification): TagPlan {
  if (c.pattern === "emotion_based_multi") {
    return {
      mode: "force_private",
      gateTripped: true,
      gateReason: `emotion_based_multi → single [사적] (confidence=${c.confidence.toFixed(2)})`,
    };
  }
  if (c.confidence < CONFIDENCE_GATE_THRESHOLD) {
    return {
      mode: "force_private",
      gateTripped: true,
      gateReason: `confidence ${c.confidence.toFixed(2)} < ${CONFIDENCE_GATE_THRESHOLD} → single [사적]`,
    };
  }
  return { mode: "register_map", gateTripped: false, gateReason: null };
}

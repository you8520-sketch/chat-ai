import {
  sanitizeChatTurnForIllustrationPrompt,
  stripPromptMarkupOnly,
} from "@/lib/chatImageIllustrationSanitizer";
import {
  collectApprovedComicText,
  DEFAULT_SCENE_PRESENTATION_VISIBILITY,
  formatApprovedScenePlanForIllustration,
  type ScenePlan,
  type ScenePresentationVisibility,
} from "@/lib/chatImageScenePlan";

export { ILLUSTRATION_SAFE_DEPICTION } from "@/lib/chatImageIllustrationSanitizer";

export type SafeVisualReasonCategory =
  | "adult_explicit"
  | "graphic_violence"
  | "self_harm"
  | "other";

export type SafeVisualProjectionContext = {
  /** When true, explicit adult source may map to non-explicit adult intimacy. Default false. */
  adultGrounded?: boolean;
  /** When true, risky lines are omitted instead of rewritten as spoken dialogue. */
  isDialogue?: boolean;
};

export type SafeVisualProjectionResult = {
  text: string;
  applied: boolean;
  omitFromImage: boolean;
  reasonCategories: SafeVisualReasonCategory[];
};

/** Strong explicit sexual terms — sufficient alone. */
const STRONG_EXPLICIT_ADULT =
  /(?:섹스|성관계|성행위|삽입|체위|절정|오르가즘|성기|보지|자지|페니스|질내|정액)/iu;

/** Ambiguous action verbs — require co-occurring sexual context. */
const AMBIGUOUS_SEXUAL_ACTION =
  /(?:겹치(?:며|고)|벌리(?:고|며)|쑤셔|박(?:아|혀)|허리(?:를|를)?\s*흔(?:들)?|애무|핥(?:아|으며)|빨(?:아|며)|(?:그녀|그|상대)\s*위에서)/iu;

/** Sexual/intimate context co-occurrence — not generic bedroom/time/location words alone. */
const SEXUAL_CONTEXT =
  /(?:성관계|섹스|성행위|성기|나체|노골|관계(?:를|를)?(?:맺|가)|삽입|체위|정액|보지|자지|페니스|질내|야(?:한|스)|키스(?:하(?:며|고))?|벗(?:기|어)|포개|겹치(?:며|고)|애무)/iu;

const INTIMATE_BEDROOM_CONTEXT =
  /(?:침대\s*(?:에서|위(?:에서)?)|이불(?:\s*(?:속|아래|위|밑))?|시트(?:\s*(?:아래|위))?)/iu;

const GRAPHIC_VIOLENCE_RAW =
  /(?:피(?:가|를)?\s*(?:흘|분|튀|나)|찔(?:러|렸|르)|베(?:어|었)|절단|내장|목(?:을|을)?(?:끊|조|누르)|시체|사지(?:를|가)\s*(?:잘|떨))/iu;

const SELF_HARM_RAW =
  /(?:self[-\s]?harm|자해|자살|목(?:을|을)?\s*매|손목(?:을|을)?\s*긋)/iu;

const NON_EXPLICIT_ADULT_INTIMACY =
  "Close adult intimacy: the same characters together in the same location, affectionate proximity, emotional tension, faces and upper bodies readable, covered or softly framed composition, non-explicit depiction. Preserve relationship warmth and mood without depicting explicit sexual acts or exposed genitals.";

const NEUTRAL_EMOTIONAL_PROJECTION =
  "Same characters in the same location, close emotional tension visible through expression and posture, modest covered framing, non-sexual composition.";

const NON_EXPLICIT_BEDROOM_REST =
  "Private bedroom aftermath: the same characters resting close together, covered by sheets or clothing, tender expressions, disheveled but modest attire, warm lighting, non-explicit framing.";

const NON_GRAPHIC_AFTERMATH =
  "Emotional aftermath scene: concern and fatigue visible through expression and posture, no graphic injury, no blood, no weapons in frame.";

function uniqueCategories(categories: readonly SafeVisualReasonCategory[]): SafeVisualReasonCategory[] {
  return [...new Set(categories)];
}

/** Classify visual risk on semantic raw text before destructive sanitization. */
export function classifyRawVisualRisk(raw: string): SafeVisualReasonCategory[] {
  const text = stripPromptMarkupOnly(raw);
  if (!text) return [];

  const categories: SafeVisualReasonCategory[] = [];

  const strongExplicit = STRONG_EXPLICIT_ADULT.test(text);
  const ambiguousAct = AMBIGUOUS_SEXUAL_ACTION.test(text);
  const sexualContext = SEXUAL_CONTEXT.test(text);
  const intimateBedroom = INTIMATE_BEDROOM_CONTEXT.test(text);

  if (strongExplicit || (ambiguousAct && sexualContext) || (ambiguousAct && intimateBedroom)) {
    categories.push("adult_explicit");
  }

  if (GRAPHIC_VIOLENCE_RAW.test(text)) {
    categories.push("graphic_violence");
  }

  if (SELF_HARM_RAW.test(text)) {
    categories.push("self_harm");
  }

  return uniqueCategories(categories);
}

function narrationSubstitute(
  categories: readonly SafeVisualReasonCategory[],
  context: SafeVisualProjectionContext
): string {
  if (categories.includes("adult_explicit")) {
    return context.adultGrounded ? NON_EXPLICIT_ADULT_INTIMACY : NEUTRAL_EMOTIONAL_PROJECTION;
  }
  if (categories.includes("graphic_violence")) {
    return NON_GRAPHIC_AFTERMATH;
  }
  if (categories.includes("self_harm")) {
    return sanitizeChatTurnForIllustrationPrompt(
      "같은 장소에서 감정적 고통과 긴장이 표정과 자세로 드러나는 장면."
    );
  }
  return sanitizeChatTurnForIllustrationPrompt("");
}

/**
 * Deterministic image-only text projection. Does not mutate canonical scene data.
 * Pipeline: raw markup strip → risk classification → policy → output sanitization.
 */
export function projectSceneTextForSafeImageGeneration(
  raw: string,
  context: SafeVisualProjectionContext = {}
): SafeVisualProjectionResult {
  const rawTrimmed = String(raw ?? "").trim();
  const reasonCategories = classifyRawVisualRisk(rawTrimmed);

  if (!reasonCategories.length) {
    const sanitized = sanitizeChatTurnForIllustrationPrompt(rawTrimmed);
    return {
      text: sanitized,
      applied: sanitized !== rawTrimmed,
      omitFromImage: false,
      reasonCategories: [],
    };
  }

  if (context.isDialogue) {
    return {
      text: "",
      applied: true,
      omitFromImage: true,
      reasonCategories,
    };
  }

  const substitute = narrationSubstitute(reasonCategories, context);
  return {
    text: substitute,
    applied: true,
    omitFromImage: false,
    reasonCategories,
  };
}

export function projectSceneBlockForSafeImageGeneration(
  raw: string,
  context: SafeVisualProjectionContext = {}
): SafeVisualProjectionResult {
  const rawTrimmed = String(raw ?? "").trim();
  if (!rawTrimmed) {
    return {
      text: "",
      applied: false,
      omitFromImage: false,
      reasonCategories: [],
    };
  }

  const blockCategories = classifyRawVisualRisk(rawTrimmed);
  if (blockCategories.length) {
    const substitute = narrationSubstitute(blockCategories, context);
    return {
      text: substitute,
      applied: true,
      omitFromImage: false,
      reasonCategories: blockCategories,
    };
  }

  const lines = rawTrimmed
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const categories: SafeVisualReasonCategory[] = [];
  let applied = false;
  const projected = lines.map((line) => {
    const result = projectSceneTextForSafeImageGeneration(line, context);
    if (result.applied) applied = true;
    categories.push(...result.reasonCategories);
    return result.omitFromImage ? null : result.text;
  });
  return {
    text: projected.filter(Boolean).join("\n"),
    applied,
    omitFromImage: projected.every((line) => line == null),
    reasonCategories: uniqueCategories(categories),
  };
}

/** Korean high-signal source phrases that must not appear in projected image prompts. */
const RAW_SOURCE_LEAK_PATTERNS = [
  /성관계/u,
  /성행위/u,
  /(?:^|[\s,.])섹스(?:$|[\s,.])/u,
  /손목(?:을|을)?\s*긋/u,
  /피(?:가|를)?\s*흘/u,
  /(?:^|[\s])자해(?:$|[\s,.])/u,
] as const;

/** Detects whether raw risky Korean source phrases remain in an image-bound prompt. */
export function containsRawRiskySourceLeak(text: string): boolean {
  const haystack = String(text ?? "");
  if (!haystack.trim()) return false;
  return RAW_SOURCE_LEAK_PATTERNS.some((pattern) => pattern.test(haystack));
}

/** @deprecated Use containsRawRiskySourceLeak for final-prompt audits. */
export function isExplicitSourceTextForImageLeak(text: string): boolean {
  return containsRawRiskySourceLeak(text);
}

export function shouldOmitDialogueFromImageProjection(text: string): boolean {
  return classifyRawVisualRisk(text).length > 0;
}

export function projectTextForSafeImagePrompt(
  text: string,
  context: SafeVisualProjectionContext = {}
): string {
  const projected = projectSceneTextForSafeImageGeneration(text, context);
  return projected.omitFromImage ? "" : projected.text;
}

export function formatApprovedScenePlanForSafeImageGeneration(
  plan: ScenePlan,
  visibility: ScenePresentationVisibility = DEFAULT_SCENE_PRESENTATION_VISIBILITY,
  context: SafeVisualProjectionContext = {}
): { formatted: string; applied: boolean; reasonCategories: SafeVisualReasonCategory[] } {
  const reasonCategories = new Set<SafeVisualReasonCategory>();
  let applied = false;
  const formatted = formatApprovedScenePlanForIllustration(plan, visibility, {
    projectText: (text, kind) => {
      const projected = projectSceneTextForSafeImageGeneration(text, {
        ...context,
        isDialogue: kind === "dialogue",
      });
      if (projected.applied) applied = true;
      for (const category of projected.reasonCategories) reasonCategories.add(category);
      return projected.omitFromImage ? "" : projected.text;
    },
    omitDialogueText: shouldOmitDialogueFromImageProjection,
  });
  return {
    formatted,
    applied,
    reasonCategories: [...reasonCategories],
  };
}

export function collectApprovedComicTextForSafeImageGeneration(
  plan: ScenePlan,
  visibility: ScenePresentationVisibility = DEFAULT_SCENE_PRESENTATION_VISIBILITY
): { texts: string[]; applied: boolean; reasonCategories: SafeVisualReasonCategory[] } {
  const reasonCategories = new Set<SafeVisualReasonCategory>();
  let applied = false;
  const texts = collectApprovedComicText(plan, visibility, {
    omitText: (text) => {
      if (!text.trim()) return true;
      const categories = classifyRawVisualRisk(text);
      if (categories.length) {
        applied = true;
        for (const category of categories) reasonCategories.add(category);
        return true;
      }
      return false;
    },
  });
  return {
    texts,
    applied,
    reasonCategories: [...reasonCategories],
  };
}

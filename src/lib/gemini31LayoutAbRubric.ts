import type { LayoutAbParagraphMetrics } from "@/lib/gemini31LayoutAbMetrics";

export type RubricGrade = "PASS" | "MINOR" | "FAIL";

export type LayoutAbQualityRubric = {
  readsLikeNovel: RubricGrade;
  dialogueNarrationSeparation: RubricGrade;
  noExcessiveOneLineParagraphs: RubricGrade;
  sceneBreathingMaintained: RubricGrade;
  actionNotFragmented: RubricGrade;
  multiSpeakerClarity: RubricGrade;
  webnovelRhythm: RubricGrade;
  notWorseThanProduction: RubricGrade;
  overall: RubricGrade;
  notes: string[];
};

function gradeDelta(
  b: number,
  a: number,
  failRatio: number,
  minorRatio: number,
  higherIsBad: boolean
): RubricGrade {
  if (a <= 0 && b <= 0) return "PASS";
  const ratio = a > 0 ? b / a : b > 0 ? 2 : 1;
  if (higherIsBad) {
    if (ratio >= failRatio) return "FAIL";
    if (ratio >= minorRatio) return "MINOR";
    return "PASS";
  }
  if (ratio <= 1 / failRatio) return "FAIL";
  if (ratio <= 1 / minorRatio) return "MINOR";
  return "PASS";
}

/** Heuristic rubric — B compared to A (production current) on same fixture. */
export function scoreLayoutAbQualityRubric(opts: {
  fixtureId: string;
  metricsA: LayoutAbParagraphMetrics;
  metricsB: LayoutAbParagraphMetrics;
  visibleCharsA: number;
  visibleCharsB: number;
  metaLeakB: boolean;
}): LayoutAbQualityRubric {
  const notes: string[] = [];
  const { metricsA: a, metricsB: b, fixtureId } = opts;

  if (b.extremeFragmentationFlag && !a.extremeFragmentationFlag) {
    notes.push("B extreme fragmentation flag set, A clear");
  }
  if (b.mixedDialogueNarrationParagraphs > a.mixedDialogueNarrationParagraphs + 1) {
    notes.push(`mixed paragraphs B=${b.mixedDialogueNarrationParagraphs} vs A=${a.mixedDialogueNarrationParagraphs}`);
  }

  const dialogueNarrationSeparation =
    b.mixedDialogueNarrationParagraphs > a.mixedDialogueNarrationParagraphs + 2
      ? "FAIL"
      : b.mixedDialogueNarrationParagraphs > a.mixedDialogueNarrationParagraphs
        ? "MINOR"
        : "PASS";

  const noExcessiveOneLineParagraphs = b.extremeFragmentationFlag
    ? "FAIL"
    : gradeDelta(b.oneSentenceParagraphRatio, a.oneSentenceParagraphRatio, 1.35, 1.15, true);

  const actionNotFragmented =
    fixtureId === "Q2"
      ? b.oneSentenceParagraphRatio > Math.max(a.oneSentenceParagraphRatio * 1.3, 0.45)
        ? "FAIL"
        : b.oneSentenceParagraphRatio > a.oneSentenceParagraphRatio * 1.15
          ? "MINOR"
          : "PASS"
      : gradeDelta(b.oneSentenceParagraphRatio, a.oneSentenceParagraphRatio, 1.4, 1.2, true);

  const multiSpeakerClarity =
    fixtureId === "Q4"
      ? b.speakerChangeWithoutParagraphBreak > a.speakerChangeWithoutParagraphBreak + 2
        ? "FAIL"
        : b.speakerChangeWithoutParagraphBreak > a.speakerChangeWithoutParagraphBreak
          ? "MINOR"
          : "PASS"
      : b.speakerChangeWithoutParagraphBreak > a.speakerChangeWithoutParagraphBreak + 3
        ? "MINOR"
        : "PASS";

  const lengthRatio = opts.visibleCharsA > 0 ? opts.visibleCharsB / opts.visibleCharsA : 1;
  const sceneBreathingMaintained =
    lengthRatio < 0.75 ? "FAIL" : lengthRatio < 0.88 ? "MINOR" : "PASS";
  if (lengthRatio < 0.88) {
    notes.push(`visible chars B/A=${Math.round(lengthRatio * 1000) / 1000}`);
  }

  const webnovelRhythm =
    b.veryShortParagraphRatio > a.veryShortParagraphRatio * 1.35 ? "FAIL" : "PASS";

  const readsLikeNovel =
    opts.metaLeakB || b.totalParagraphs < 4
      ? "FAIL"
      : b.extremeFragmentationFlag
        ? "MINOR"
        : "PASS";

  const notWorseThanProduction = (() => {
    const grades = [
      dialogueNarrationSeparation,
      noExcessiveOneLineParagraphs,
      actionNotFragmented,
      multiSpeakerClarity,
      webnovelRhythm,
      sceneBreathingMaintained,
    ];
    if (grades.includes("FAIL")) return "FAIL";
    if (grades.filter((g) => g === "MINOR").length >= 2) return "MINOR";
    return "PASS";
  })();

  const overall = (() => {
    const all = [
      readsLikeNovel,
      dialogueNarrationSeparation,
      noExcessiveOneLineParagraphs,
      sceneBreathingMaintained,
      actionNotFragmented,
      multiSpeakerClarity,
      webnovelRhythm,
      notWorseThanProduction,
    ];
    if (all.includes("FAIL")) return "FAIL";
    if (all.includes("MINOR")) return "MINOR";
    return "PASS";
  })();

  return {
    readsLikeNovel,
    dialogueNarrationSeparation,
    noExcessiveOneLineParagraphs,
    sceneBreathingMaintained,
    actionNotFragmented,
    multiSpeakerClarity,
    webnovelRhythm,
    notWorseThanProduction,
    overall,
    notes,
  };
}

export function aggregateFixtureVerdict(
  rubrics: LayoutAbQualityRubric[]
): RubricGrade {
  if (rubrics.some((r) => r.overall === "FAIL")) return "FAIL";
  if (rubrics.some((r) => r.overall === "MINOR")) return "MINOR";
  return "PASS";
}

/**
 * Step 7.7 Group B — explanatory meta narration audit metrics (generation output).
 * Lower counts = better for explain-* metrics; higher = better for show-anchor metrics.
 */

export type GroupBMetaMetrics = {
  groupBMetaCount: number;
  explainContrastCount: number;
  voiceExplainCount: number;
  showAnchorCount: number;
  registerLabelInNarration: number;
};

/** Step 7.6c / 7.7 Group B structural meta (no register label token required). */
export const GROUP_B_META_RE =
  /(?:말투(?:가|는|을)?\s*(?:바뀌|변|달라|공손|부드러|거칠|높|낮|전환|섞|혼)|목소리(?:가|는)?\s*(?:달라|바뀌|낮|높|부드러|거칠|가라|거칠)|평소(?:의|처럼)?\s*(?:절제|냉정|건조|공손|격식|딱딱)|처음(?:이|으로|엔)\s*(?:이렇게|그렇게|이런|그런)|register|honorific|speech register)/gi;

/** Explanatory contrast — 평소 X vs 지금 Y framing. */
export const EXPLAIN_CONTRAST_RE =
  /(?:평소(?:의|엔|처럼)?|원래|늘|평소와|달리|와\s*달리|이전(?:과|엔)?|지금(?:은|만)?\s*(?:은|는)?\s*(?:다르|부드|거칠|낮|높|풀|없)|(?:절제|냉정|딱딱|격식)(?:도|는|가)?\s*(?:없|사라|풀|달|없어))/gi;

/** Voice-as-register-explanation (Group B, not Group A label). */
export const VOICE_EXPLAIN_RE =
  /목소리(?:가|는|도)?\s*(?:[^.\n]{0,20}(?:달라|바뀌|부드|거칠|낮|높|가라|달|달라졌|바뀌었))/gi;

/** Show-don't-tell body/space/sound anchors (Step 6 space axis, Leon private scenes). */
export const SHOW_ANCHOR_RE =
  /(?:입술|망설|시선|눈(?:동|꼬|빛)|어깨|턱|손끝|손등|숨|호흡|침묵|공기|거리|간격|불빛|어둠|떨림|이불|담요|침대\s*(?:끝|가)|그림자)/gi;

const REGISTER_LABEL_IN_NARRATION_RE =
  /(?:해요체|다나까(?:체)?|하십시오체|합니다체|하오체|반말|존댓말|군대식(?:\s*다나까)?(?:체)?|경어|높임말)/gi;

function stripDialogue(text: string): string {
  return text.replace(/"[^"]*"/g, " ").replace(/\s+/g, " ").trim();
}

function countRe(text: string, re: RegExp): number {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const g = new RegExp(re.source, flags);
  return [...stripDialogue(text).matchAll(g)].length;
}

export function analyzeGroupBMetaAudit(text: string): GroupBMetaMetrics {
  return {
    groupBMetaCount: countRe(text, GROUP_B_META_RE),
    explainContrastCount: countRe(text, EXPLAIN_CONTRAST_RE),
    voiceExplainCount: countRe(text, VOICE_EXPLAIN_RE),
    showAnchorCount: countRe(text, SHOW_ANCHOR_RE),
    registerLabelInNarration: countRe(text, REGISTER_LABEL_IN_NARRATION_RE),
  };
}

export type GroupBMetricDef = {
  key: keyof GroupBMetaMetrics;
  label: string;
  higherIsBetter: boolean;
};

export const GROUP_B_PRIMARY_METRIC_DEFS: GroupBMetricDef[] = [
  { key: "groupBMetaCount", label: "Group B meta narration hits", higherIsBetter: false },
  { key: "explainContrastCount", label: "Explain contrast (평소/달리/절제 없었다)", higherIsBetter: false },
  { key: "voiceExplainCount", label: "Voice change explanation", higherIsBetter: false },
  { key: "showAnchorCount", label: "Show anchors (body/space/sound)", higherIsBetter: true },
];

/** Side-effect checks — regression on any blocks apply. */
export const GROUP_B_SECONDARY_METRIC_DEFS: GroupBMetricDef[] = [
  { key: "registerLabelInNarration", label: "Register label in narration (Group A sanity)", higherIsBetter: false },
];

export const GROUP_B_METRIC_DEFS: GroupBMetricDef[] = [
  ...GROUP_B_PRIMARY_METRIC_DEFS,
  ...GROUP_B_SECONDARY_METRIC_DEFS,
];

export function groupBMetricValue(m: GroupBMetaMetrics, key: keyof GroupBMetaMetrics): number {
  return m[key];
}

export function countExplainLexInExample(text: string): number {
  return countRe(text, GROUP_B_META_RE) + countRe(text, EXPLAIN_CONTRAST_RE);
}

export function countShowLexInExample(text: string): number {
  return countRe(text, SHOW_ANCHOR_RE);
}

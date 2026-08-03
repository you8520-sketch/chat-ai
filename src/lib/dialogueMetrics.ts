/**
 * Dialogue fragmentation metrics for RP diagnostic canary.
 * Manual metrics follow conservative semantic-unit rules; auto metrics are heuristic fallbacks.
 */

export type DialogueMetricsInput = {
  text: string;
  primaryCharacterName?: string;
};

export type DialogueMetrics = {
  canonical_length_ws: number;
  canonical_length_no_ws: number;
  paragraph_count: number;
  /** Alias: raw_quote_blocks */
  quote_pair_count: number;
  raw_quote_blocks: number;
  dialogue_paragraph_count: number;
  narration_chars: number;
  dialogue_chars: number;
  narration_ratio_pct: number;
  quote_blocks: string[];
  semantic_utterance_units_auto: number;
  auto_semantic_units: number;
  manual_semantic_units: number;
  fragmentation_multiplier_auto: number;
  auto_fragmentation_multiplier: number;
  manual_fragmentation_multiplier: number;
  resume_transitions_auto: number;
  auto_resume_transitions: number;
  manual_resume_transitions: number;
  quote_blocks_per_1000_chars: number;
  raw_quote_blocks_per_1000_chars: number;
  resume_transitions_per_1000_chars: number;
  manual_resume_per_1000_chars: number;
  content_hash: string;
  content_hash_no_newlines: string;
  auto_metric_unreliable?: boolean;
};

function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}

export function extractQuoteBlocks(text: string): string[] {
  const blocks: string[] = [];
  const re = /"([^"\n]{1,1200})"|“([^”\n]{1,1200})”/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const q = (m[1] ?? m[2] ?? "").trim();
    if (q) blocks.push(q);
  }
  return blocks;
}

const MICRO_ACTION_RE =
  /(눈|시선|표정|미소|웃|입꼬리|고개|손|손가락|손목|어깨|자세|몸|피부|귀|입술|피식|가늘|쳐다|훑|은은|살짝|천천히|중얼|고개를|눈을|입꼬리|미동|숨|한숨|턱|매만|기울|꼈다|들썩|흔들|까딱|톡톡|스쳤|번졌)/;

const NEW_SEMANTIC_UNIT_RE =
  /(등록|접수|안내|발견|결정|요청|직원|스태프|윤태건|태건|신원|바이탈|확인실|관리부|메디컬|새로운|갑자기|그때|문득|이때|그러자|발걸음|전화|무전|훈련|임무|다가와|섰다|말을 잘랐|차갑게|냉랭|노려|안내할|바래다|체크 받|지원국|접수실|대기실|확인부터|명단|단말기|서류|차트|문진|진료|보호\s*대상|신입|가이드|센티넬\s*특유|코드네임|S급|등급)/;

/** Narration between quotes that does not start a new semantic purpose. */
export function isMicroActionNarration(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return true;
  if (t.length > 160) return false;
  if (NEW_SEMANTIC_UNIT_RE.test(t)) return false;
  if (/[?？!！]/.test(t) && t.length > 40) return false;
  if (MICRO_ACTION_RE.test(t)) return true;
  return t.length <= 72 && !/(그러|하지만|그런데|한편|잠시 후|이윽고|곧|결국|문득)/.test(t);
}

/** Manual semantic units: merge quote blocks separated only by micro-action narration. */
export function estimateManualSemanticMetrics(text: string): {
  manual_semantic_units: number;
  manual_resume_transitions: number;
  manual_fragmentation_multiplier: number;
} {
  const quote_blocks = extractQuoteBlocks(text);
  const nQuotes = quote_blocks.length;
  if (nQuotes === 0) {
    return {
      manual_semantic_units: 1,
      manual_resume_transitions: 0,
      manual_fragmentation_multiplier: 0,
    };
  }
  if (nQuotes === 1) {
    return {
      manual_semantic_units: 1,
      manual_resume_transitions: 0,
      manual_fragmentation_multiplier: 1,
    };
  }

  const quoteRe = /"[^"\n]{1,1200}"|“[^”\n]{1,1200}”/g;
  const matches = [...text.matchAll(quoteRe)];
  let units = 1;
  for (let i = 1; i < matches.length; i++) {
    const prev = matches[i - 1]!;
    const cur = matches[i]!;
    const between = text.slice(prev.index! + prev[0].length, cur.index!);
    const narrParas = between
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    const startsNewUnit =
      narrParas.length === 0
        ? false
        : narrParas.some((p) => !isMicroActionNarration(p));
    if (startsNewUnit) units += 1;
  }

  const manual_resume_transitions = Math.max(0, nQuotes - units);
  const manual_fragmentation_multiplier =
    units > 0 ? Math.round((nQuotes / units) * 100) / 100 : 0;

  return {
    manual_semantic_units: units,
    manual_resume_transitions,
    manual_fragmentation_multiplier,
  };
}

/** Heuristic auto semantic units: quote-only islands separated by narration = candidate units. */
export function estimateSemanticUtteranceUnits(text: string): {
  units: number;
  resumeTransitions: number;
} {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  let quoteIslands = 0;
  let inQuoteRun = false;
  let resumeTransitions = 0;

  for (const p of paras) {
    const quoteOnly = /^[“"][^”"\n]+[”"]$/.test(p);
    if (quoteOnly) {
      if (!inQuoteRun) {
        quoteIslands += 1;
        inQuoteRun = true;
      }
    } else {
      if (inQuoteRun) {
        resumeTransitions += 1;
      }
      inQuoteRun = false;
    }
  }

  const units = Math.max(1, quoteIslands);
  return { units, resumeTransitions: Math.max(0, quoteIslands - 1) };
}

export function isAutoMetricUnreliable(opts: {
  auto_resume: number;
  manual_resume: number;
  auto_fragmentation: number;
  manual_fragmentation: number;
}): boolean {
  const resumeBase = Math.max(opts.manual_resume, 1);
  const fragBase = Math.max(opts.manual_fragmentation, 0.01);
  const resumeDelta = Math.abs(opts.auto_resume - opts.manual_resume) / resumeBase;
  const fragDelta = Math.abs(opts.auto_fragmentation - opts.manual_fragmentation) / fragBase;
  return resumeDelta >= 0.25 || fragDelta >= 0.25;
}

export function computeDialogueMetrics(input: DialogueMetricsInput): DialogueMetrics {
  const text = input.text ?? "";
  const quote_blocks = extractQuoteBlocks(text);
  const raw_quote_blocks = quote_blocks.length;
  const dialogue_chars = quote_blocks.reduce((a, b) => a + b.length, 0);
  const canonical_length_ws = text.length;
  const canonical_length_no_ws = text.replace(/\s/g, "").length;
  const narration_chars = Math.max(0, canonical_length_ws - dialogue_chars);
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const { units, resumeTransitions } = estimateSemanticUtteranceUnits(text);
  const manual = estimateManualSemanticMetrics(text);
  const semantic_utterance_units_auto = units;
  const fragmentation_multiplier_auto =
    semantic_utterance_units_auto > 0
      ? Math.round((raw_quote_blocks / semantic_utterance_units_auto) * 100) / 100
      : 0;
  const auto_metric_unreliable = isAutoMetricUnreliable({
    auto_resume: resumeTransitions,
    manual_resume: manual.manual_resume_transitions,
    auto_fragmentation: fragmentation_multiplier_auto,
    manual_fragmentation: manual.manual_fragmentation_multiplier,
  });

  return {
    canonical_length_ws,
    canonical_length_no_ws,
    paragraph_count: paras.length,
    quote_pair_count: raw_quote_blocks,
    raw_quote_blocks,
    dialogue_paragraph_count: paras.filter((p) => /[“"]/.test(p)).length,
    narration_chars,
    dialogue_chars,
    narration_ratio_pct:
      canonical_length_ws > 0
        ? Math.round((narration_chars / canonical_length_ws) * 1000) / 10
        : 0,
    quote_blocks,
    semantic_utterance_units_auto,
    auto_semantic_units: semantic_utterance_units_auto,
    manual_semantic_units: manual.manual_semantic_units,
    fragmentation_multiplier_auto,
    auto_fragmentation_multiplier: fragmentation_multiplier_auto,
    manual_fragmentation_multiplier: manual.manual_fragmentation_multiplier,
    resume_transitions_auto: resumeTransitions,
    auto_resume_transitions: resumeTransitions,
    manual_resume_transitions: manual.manual_resume_transitions,
    quote_blocks_per_1000_chars:
      canonical_length_ws > 0
        ? Math.round((raw_quote_blocks / canonical_length_ws) * 100000) / 100
        : 0,
    raw_quote_blocks_per_1000_chars:
      canonical_length_ws > 0
        ? Math.round((raw_quote_blocks / canonical_length_ws) * 100000) / 100
        : 0,
    resume_transitions_per_1000_chars:
      canonical_length_ws > 0
        ? Math.round((resumeTransitions / canonical_length_ws) * 100000) / 100
        : 0,
    manual_resume_per_1000_chars:
      canonical_length_ws > 0
        ? Math.round((manual.manual_resume_transitions / canonical_length_ws) * 100000) / 100
        : 0,
    content_hash: hashString(text),
    content_hash_no_newlines: hashString(text.replace(/[\r\n\u00a0]+/g, " ")),
    auto_metric_unreliable,
  };
}

export function diffPipelineMetrics(
  before: DialogueMetrics,
  after: DialogueMetrics
): Record<string, number> {
  return {
    quote_pair_delta: after.quote_pair_count - before.quote_pair_count,
    dialogue_paragraph_delta: after.dialogue_paragraph_count - before.dialogue_paragraph_count,
    resume_transitions_delta: after.manual_resume_transitions - before.manual_resume_transitions,
    resume_transitions_auto_delta:
      after.resume_transitions_auto - before.resume_transitions_auto,
    fragmentation_multiplier_delta:
      after.manual_fragmentation_multiplier - before.manual_fragmentation_multiplier,
  };
}

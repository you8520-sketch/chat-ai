import { parseTrpgGmOutput } from "./gmPrompt";

export type GmResolutionFixtureAction = {
  participantId: number;
  name: string;
  body: string;
  intent?: string;
  tier?: string | null;
};

export type GmResolutionProbeInput = {
  narration: string;
  actions: readonly GmResolutionFixtureAction[];
  earlierSuccessNames?: readonly string[];
  rollOutcomes?: Array<{ name: string; tier: string }>;
};

export type GmResolutionProbeResult = {
  pcDialogueExactReplayCount: number;
  pcDialogueCloseRestagingCount: number;
  inventedPcDialogueCount: number;
  rawStatNumberProseCount: number;
  rawD20DcTierProseCount: number;
  ordinaryFailureIncompetenceSignals: number;
  ordinaryFailureCatastropheSignals: number;
  earlierSuccessErasureDetected: boolean;
  newConsequenceStart: boolean;
};

const QUOTED_DIALOGUE =
  /「([^」]{1,400})」|『([^』]{1,400})』|"([^"]{1,400})"|"([^"]{1,400})"/g;

const RAW_STAT_NUMBER_PATTERNS = [
  /(?:힘|민첩|체력|지능|지혜|매력|지각|의지|마력|속도|기술|직감|저항|집중|생존|이성|신앙|명중|가드|회복|체격|침착|존재감|명예|공감|인맥|오컬트)\s*\d+/g,
  /(?:힘|민첩|체력|지능|지혜|매력)\s*\d+\s*(?:의|만큼|수준)/g,
];

const RAW_D20_DC_TIER_PATTERNS = [
  /modifier\s*[+-]?\d+/gi,
  /(?:^|\s)d20\s*[=:]?\s*\d+/gi,
  /(?:^|\s)DC\s*[=:]?\s*\d+/gi,
  /\btier\s*[=:]?\s*(?:CRITICAL_|SEVERE_|PARTIAL_|GREAT_)?(?:FAILURE|SUCCESS)/gi,
];

const INCOMPETENCE_SIGNALS = [
  /무기(?:를|가)?\s*(?:떨어|놓|빠져|튕)/,
  /(?:넘어|비틀|발(?:이|을)?\s*(?:걸|헛))/,
  /(?:바보|멍청|우스꽝|개판)/,
  /기본(?:조차)?\s*(?:잊|틀)/,
  /허공을\s*(?:강타|내리)/,
];

const CATASTROPHE_SIGNALS = [
  /대재앙/,
  /전체(?:가)?\s*(?:활성|각성|폭주)/,
  /군체\s*전체/,
  /연쇄(?:적)?\s*(?:붕괴|폭발|악화)/,
  /아수라장/,
];

function extractSubmittedDialogue(body: string): string[] {
  const lines: string[] = [];
  for (const match of body.matchAll(QUOTED_DIALOGUE)) {
    const line = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? "").trim();
    if (line.length >= 4) lines.push(line);
  }
  return lines;
}

function countExactReplay(narration: string, dialogue: readonly string[]): number {
  let count = 0;
  for (const line of dialogue) {
    if (line.length < 4) continue;
    if (narration.includes(line)) count += 1;
  }
  return count;
}

function countCloseRestaging(narration: string, dialogue: readonly string[]): number {
  let count = 0;
  for (const line of dialogue) {
    if (line.length < 8) continue;
    if (narration.includes(line)) continue;
    const stem = line.slice(0, Math.min(12, line.length));
    if (stem.length >= 8 && narration.includes(stem)) count += 1;
  }
  return count;
}

function countInventedPcDialogue(narration: string, pcNames: readonly string[]): number {
  const names = new Set(pcNames.map((n) => n.trim()).filter(Boolean));
  let count = 0;
  for (const line of narration.split("\n")) {
    const trimmed = line.trim();
    const m = trimmed.match(/^([^:]{1,24}):\s*/);
    if (!m) continue;
    const speaker = m[1]!.trim();
    if (speaker === "GM") continue;
    if (names.has(speaker)) count += 1;
  }
  return count;
}

function countPatternMatches(text: string, patterns: readonly RegExp[]): number {
  let total = 0;
  for (const pattern of patterns) {
    const re = new RegExp(pattern.source, pattern.flags);
    total += [...text.matchAll(re)].length;
  }
  return total;
}

function countSignalMatches(text: string, patterns: readonly RegExp[]): number {
  let total = 0;
  for (const pattern of patterns) {
    if (pattern.test(text)) total += 1;
  }
  return total;
}

function narrationStartsWithNewConsequence(
  narration: string,
  submittedBodies: readonly string[]
): boolean {
  const first200 = narration.slice(0, 200).trim();
  if (!first200) return false;
  for (const body of submittedBodies) {
    const chunk = body.trim().slice(0, 48);
    if (chunk.length >= 16 && first200.includes(chunk)) return false;
  }
  return true;
}

function detectEarlierSuccessErasure(
  narration: string,
  earlierSuccessNames: readonly string[],
  rollOutcomes: Array<{ name: string; tier: string }>
): boolean {
  if (earlierSuccessNames.length === 0) return false;
  const successSet = new Set(
    rollOutcomes
      .filter((row) => /SUCCESS/i.test(row.tier))
      .map((row) => row.name)
  );
  for (const name of earlierSuccessNames) {
    if (!successSet.has(name)) continue;
    const erased = new RegExp(
      `${name}(?:의|이|가)?[^.\\n]{0,20}(?:성공|성과|확보|만든|파쇄|열어)[^.\\n]{0,20}(?:실패|무효|헛수고|없어|사라|무효화)`,
      "i"
    ).test(narration);
    if (erased) return true;
  }
  return false;
}

export function probeGmResolutionQuality(input: GmResolutionProbeInput): GmResolutionProbeResult {
  const narration = parseTrpgGmOutput(input.narration).narration;
  const pcNames = input.actions.map((a) => a.name);
  const submittedDialogue = input.actions.flatMap((a) => extractSubmittedDialogue(a.body));
  const submittedBodies = input.actions.map((a) => a.body);
  const rollOutcomes =
    input.rollOutcomes ?? input.actions.map((a) => ({ name: a.name, tier: a.tier ?? "SUCCESS" }));

  return {
    pcDialogueExactReplayCount: countExactReplay(narration, submittedDialogue),
    pcDialogueCloseRestagingCount: countCloseRestaging(narration, submittedDialogue),
    inventedPcDialogueCount: countInventedPcDialogue(narration, pcNames),
    rawStatNumberProseCount: countPatternMatches(narration, RAW_STAT_NUMBER_PATTERNS),
    rawD20DcTierProseCount: countPatternMatches(narration, RAW_D20_DC_TIER_PATTERNS),
    ordinaryFailureIncompetenceSignals: countSignalMatches(narration, INCOMPETENCE_SIGNALS),
    ordinaryFailureCatastropheSignals: countSignalMatches(narration, CATASTROPHE_SIGNALS),
    earlierSuccessErasureDetected: detectEarlierSuccessErasure(
      narration,
      input.earlierSuccessNames ?? [],
      rollOutcomes
    ),
    newConsequenceStart: narrationStartsWithNewConsequence(narration, submittedBodies),
  };
}

export function summarizeGmResolutionProbe(results: readonly GmResolutionProbeResult[]): {
  REAL_PROVIDER_CALLS: number;
  PC_DIALOGUE_EXACT_REPLAY: number;
  PC_DIALOGUE_CLOSE_RESTAGING: number;
  INVENTED_PC_DIALOGUE: number;
  RAW_STAT_NUMBER_PROSE: number;
  RAW_D20_DC_TIER_PROSE: number;
  ORDINARY_FAILURE_INCOMPETENCE: number;
  ORDINARY_FAILURE_CATASTROPHE_STACKING: number;
  EARLIER_SUCCESS_ERASURE: number;
  NEW_CONSEQUENCE_START: number;
} {
  return {
    REAL_PROVIDER_CALLS: results.length,
    PC_DIALOGUE_EXACT_REPLAY: results.reduce((n, r) => n + r.pcDialogueExactReplayCount, 0),
    PC_DIALOGUE_CLOSE_RESTAGING: results.reduce((n, r) => n + r.pcDialogueCloseRestagingCount, 0),
    INVENTED_PC_DIALOGUE: results.reduce((n, r) => n + r.inventedPcDialogueCount, 0),
    RAW_STAT_NUMBER_PROSE: results.reduce((n, r) => n + r.rawStatNumberProseCount, 0),
    RAW_D20_DC_TIER_PROSE: results.reduce((n, r) => n + r.rawD20DcTierProseCount, 0),
    ORDINARY_FAILURE_INCOMPETENCE: results.reduce((n, r) => n + r.ordinaryFailureIncompetenceSignals, 0),
    ORDINARY_FAILURE_CATASTROPHE_STACKING: results.reduce(
      (n, r) => n + r.ordinaryFailureCatastropheSignals,
      0
    ),
    EARLIER_SUCCESS_ERASURE: results.filter((r) => r.earlierSuccessErasureDetected).length,
    NEW_CONSEQUENCE_START: results.filter((r) => r.newConsequenceStart).length,
  };
}

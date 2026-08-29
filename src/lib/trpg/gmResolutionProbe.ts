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
  pcDialogueVerbatimReplayCount: number;
  pcSpeakerLineInventionCount: number;
  rawStatValueNarrationCount: number;
  rawD20DcNarrationCount: number;
  earlierSuccessPreserved: boolean;
  newConsequenceStart: boolean;
};

const QUOTED_DIALOGUE =
  /「([^」]{1,400})」|『([^』]{1,400})』|"([^"]{1,400})"|"([^"]{1,400})"/g;

const PC_SPEAKER_LINE = /^([^\n:]{1,24}):\s*["“”「『]/m;

const RAW_STAT_PATTERNS = [
  /(?:힘|민첩|체력|지능|지혜|매력|지각|의지|마력|속도|기술|직감|저항|집중|생존|이성|신앙|명중|가드|회복|체격|침착|존재감|명예|공감|인맥|오컬트)\s*\d+/g,
  /(?:힘|민첩|체력|지능|지혜|매력)\s*\d+\s*(?:의|만큼|수준)/g,
  /modifier\s*[+-]?\d+/gi,
  /(?:^|\s)d20\s*[=:]?\s*\d+/gi,
  /(?:^|\s)DC\s*[=:]?\s*\d+/gi,
  /\btier\s*[=:]?\s*(?:CRITICAL_|SEVERE_|PARTIAL_|GREAT_)?(?:FAILURE|SUCCESS)/gi,
];

function extractSubmittedDialogue(body: string): string[] {
  const lines: string[] = [];
  for (const match of body.matchAll(QUOTED_DIALOGUE)) {
    const line = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? "").trim();
    if (line.length >= 4) lines.push(line);
  }
  return lines;
}

function countVerbatimReplay(narration: string, dialogue: readonly string[]): number {
  let count = 0;
  for (const line of dialogue) {
    if (line.length < 4) continue;
    if (narration.includes(line)) count += 1;
  }
  return count;
}

function countPcSpeakerLines(narration: string, pcNames: readonly string[]): number {
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

function earlierSuccessStillReferenced(
  narration: string,
  earlierSuccessNames: readonly string[],
  rollOutcomes: Array<{ name: string; tier: string }>
): boolean {
  if (earlierSuccessNames.length === 0) return true;
  const successSet = new Set(
    rollOutcomes
      .filter((row) => /SUCCESS/i.test(row.tier))
      .map((row) => row.name)
  );
  for (const name of earlierSuccessNames) {
    if (!successSet.has(name)) continue;
    const erased = new RegExp(`${name}[^.\\n]{0,40}(?:실패|무효|헛수고|없어|사라)`, "i").test(narration);
    if (erased) return false;
  }
  return true;
}

export function probeGmResolutionQuality(input: GmResolutionProbeInput): GmResolutionProbeResult {
  const narration = parseTrpgGmOutput(input.narration).narration;
  const pcNames = input.actions.map((a) => a.name);
  const submittedDialogue = input.actions.flatMap((a) => extractSubmittedDialogue(a.body));
  const submittedBodies = input.actions.map((a) => a.body);

  return {
    pcDialogueVerbatimReplayCount: countVerbatimReplay(narration, submittedDialogue),
    pcSpeakerLineInventionCount: countPcSpeakerLines(narration, pcNames),
    rawStatValueNarrationCount: countPatternMatches(narration, RAW_STAT_PATTERNS.slice(0, 2)),
    rawD20DcNarrationCount: countPatternMatches(narration, RAW_STAT_PATTERNS.slice(2)),
    earlierSuccessPreserved: earlierSuccessStillReferenced(
      narration,
      input.earlierSuccessNames ?? [],
      input.rollOutcomes ?? input.actions.map((a) => ({ name: a.name, tier: a.tier ?? "SUCCESS" }))
    ),
    newConsequenceStart: narrationStartsWithNewConsequence(narration, submittedBodies),
  };
}

export function assertGmResolutionProbeClean(result: GmResolutionProbeResult): void {
  if (result.pcDialogueVerbatimReplayCount > 0) {
    throw new Error(`PC dialogue replay count ${result.pcDialogueVerbatimReplayCount}`);
  }
  if (result.pcSpeakerLineInventionCount > 0) {
    throw new Error(`PC speaker invention count ${result.pcSpeakerLineInventionCount}`);
  }
  if (result.rawStatValueNarrationCount > 0) {
    throw new Error(`raw stat narration count ${result.rawStatValueNarrationCount}`);
  }
  if (result.rawD20DcNarrationCount > 0) {
    throw new Error(`raw d20/dc narration count ${result.rawD20DcNarrationCount}`);
  }
}

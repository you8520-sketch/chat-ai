import { TRPG_ACTION_TYPES } from "@/lib/trpg/actionTypes";
import { parseTrpgBotAction } from "@/lib/trpg/botActions";
import { prepareTrpgBotActionBody } from "@/lib/trpg/botActions";

const VALID_ACTION = new Set<string>(TRPG_ACTION_TYPES);

export type StructuralCheckResult = {
  httpSuccess: boolean;
  nonEmptyOutput: boolean;
  parseSuccess: boolean;
  actionTypeValid: boolean;
  intentValid: boolean;
  fallbackBodyUsed: boolean;
  outputCharCount: number;
  outputTokenEstimate: number;
  userAgencyViolation: boolean;
  userAgencyNotes: string[];
  consequenceViolation: boolean;
  consequenceNotes: string[];
  parsedProse: string;
  parsedActionType: string;
  parsedIntent: string;
};

const USER_AGENCY_PATTERNS: Array<{ re: RegExp; note: string }> = [
  { re: /당신(?:은|이)\s*["「『][^"」』]{8,}/, note: "quotes human dialogue" },
  { re: /플레이(?:어|가)\s*(?:은|가)\s*["「『]/, note: "attributes quoted speech to player" },
  { re: /유저(?:는|가)\s*["「『]/, note: "attributes quoted speech to user" },
  { re: /당신(?:의|은)\s*(?:마음|생각|속마음)/, note: "invents player inner thoughts" },
  { re: /당신(?:은|이)\s*(?:거부|수락|동의|결정)했/, note: "decides player consent/refusal" },
  { re: /당신(?:은|이)\s*[^\n]{0,24}(?:성공|실패|쓰러|죽|살아)/, note: "resolves player major outcome" },
];

const CONSEQUENCE_PATTERNS: Array<{ re: RegExp; note: string }> = [
  { re: /d20\s*\d+/i, note: "claims d20 result" },
  { re: /주사위[^\n]{0,20}\d+\s*(?:이|가)\s*(?:나왔|떨어)/, note: "claims dice outcome" },
  { re: /(?:성공|실패|대성공|대실패)(?:했다|한다|했다\.)/, note: "declares success tier" },
  { re: /(?:데미지|피해)\s*\d+/, note: "claims damage number" },
  { re: /HP\s*\d+/, note: "claims HP change" },
  { re: /(?:쓰러|사망|즉사)/, note: "declares incapacitation/death" },
];

function estimateOutputTokens(text: string): number {
  return Math.max(1, Math.round(Array.from(text).length / 1.8));
}

export function runStructuralChecks(opts: {
  rawText: string;
  httpSuccess: boolean;
  fallbackName: string;
}): StructuralCheckResult {
  const raw = opts.rawText.trim();
  const parsed = parseTrpgBotAction(raw);
  const fallbackSnippet = `${opts.fallbackName}은 상황을 살피며 한 발 다가선다.`;
  const prepared = prepareTrpgBotActionBody(raw, fallbackSnippet);
  const fallbackBodyUsed =
    raw.length > 0 &&
    (prepared.trim() === fallbackSnippet.trim() ||
      (parsed.prose.trim().length < 40 && prepared.includes(fallbackSnippet.slice(0, 12))));

  const userAgencyNotes: string[] = [];
  for (const { re, note } of USER_AGENCY_PATTERNS) {
    if (re.test(raw)) userAgencyNotes.push(note);
  }

  const consequenceNotes: string[] = [];
  for (const { re, note } of CONSEQUENCE_PATTERNS) {
    if (re.test(raw)) consequenceNotes.push(note);
  }

  const intentValid = parsed.intent.trim().length >= 8;
  const actionTypeValid = VALID_ACTION.has(parsed.actionType);
  const proseValid = parsed.prose.trim().length >= 80;

  return {
    httpSuccess: opts.httpSuccess,
    nonEmptyOutput: raw.length > 0,
    parseSuccess: proseValid && (intentValid || raw.includes("<<<INTENT>>>")),
    actionTypeValid,
    intentValid,
    fallbackBodyUsed,
    outputCharCount: Array.from(raw).length,
    outputTokenEstimate: estimateOutputTokens(raw),
    userAgencyViolation: userAgencyNotes.length > 0,
    userAgencyNotes,
    consequenceViolation: consequenceNotes.length > 0,
    consequenceNotes,
    parsedProse: parsed.prose,
    parsedActionType: parsed.actionType,
    parsedIntent: parsed.intent,
  };
}

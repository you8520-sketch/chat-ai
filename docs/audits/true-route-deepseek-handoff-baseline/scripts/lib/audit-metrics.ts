export const PRIMARY_MEDIAN_VISIBLE_CHARS = 3323;
export const T3_GEMINI_GOLD_VISIBLE_CHARS = 2651;

export function paragraphs(text: string) {
  return String(text || "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function isDialogueParagraph(p: string) {
  return /["“”「」『』]/.test(p) || /^(?:[“"]|[가-힣A-Za-z].{0,12}[:：])/.test(p);
}

export function median(nums: number[]) {
  const a = [...nums].filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return 0;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

export function maxConsecutiveDialogue(paras: string[]) {
  let max = 0;
  let cur = 0;
  for (const p of paras) {
    if (isDialogueParagraph(p)) {
      cur += 1;
      max = Math.max(max, cur);
    } else {
      cur = 0;
    }
  }
  return max;
}

export function objectiveMetrics(text: string) {
  const paras = paragraphs(text);
  const dialogueParas = paras.filter(isDialogueParagraph);
  const narrationParas = paras.filter((p) => !isDialogueParagraph(p));
  const chars = String(text || "").length;
  const dialogueBlocks = dialogueParas.length;
  return {
    VISIBLE_CHARS: chars,
    PARAGRAPH_COUNT: paras.length,
    DIALOGUE_BLOCKS: dialogueBlocks,
    DIALOGUE_BLOCKS_PER_1000_CHARS:
      chars === 0 ? 0 : Number(((dialogueBlocks / chars) * 1000).toFixed(3)),
    DIALOGUE_PARAGRAPH_RATIO:
      paras.length === 0 ? 0 : Number((dialogueBlocks / paras.length).toFixed(3)),
    MAX_CONSECUTIVE_DIALOGUE: maxConsecutiveDialogue(paras),
    MEDIAN_PARAGRAPH_CHARS: median(paras.map((p) => p.length)),
    MEDIAN_NARRATION_PARAGRAPH_CHARS: median(narrationParas.map((p) => p.length)),
    MEDIAN_DIALOGUE_PARAGRAPH_CHARS: median(dialogueParas.map((p) => p.length)),
  };
}

export function alarmCandidates(text: string, finishReason?: string | null) {
  const t = String(text || "");
  return {
    META_LEAK: /(?:SYSTEM|SceneMode|routeTrigger|INTERNAL|OOC:)/i.test(t),
    EMPTY_OUTPUT: !t.trim(),
    NEW_USER_DIALOGUE_CANDIDATE: /(?:렌이\s*(?:말했|대답했|속삭였)|렌의\s*입에서)/.test(t),
    NEW_USER_ACTION_CANDIDATE: /(?:렌이\s*(?:일어섰|달려|문을\s*열|옷을\s*벗었))/.test(t),
    CANON_CONTRADICTION_CANDIDATE: /(?:미성년|고등학생|17살|18살 미만)/.test(t),
    REPETITION_CANDIDATE: (() => {
      const paras = paragraphs(t);
      const uniq = new Set(paras.map((p) => p.slice(0, 80)));
      return paras.length >= 6 && uniq.size <= Math.ceil(paras.length * 0.5);
    })(),
    TURN_ENDING_USER_CHECKPOINT_CANDIDATE: /(?:눈을\s*마주|이대로\s*조금만|잠깐만)/.test(
      t.slice(-400)
    ),
    REQUESTED_PROGRESSION_COMPLETED:
      /(?:삽입|성교|오르가슴|절정|사정|끝까지)/.test(t) && t.length > 200,
    FINISH_REASON_OBSERVED: finishReason ?? null,
  };
}

export type DialogueAttribution =
  | "SOURCE_USER_QUOTED_DIALOGUE"
  | "AI_CHARACTER_DIALOGUE_CANDIDATE"
  | "NEW_USER_PERSONA_DIALOGUE_CANDIDATE"
  | "UNATTRIBUTED_DIALOGUE";

export type DialogueBlockRecord = {
  paragraph_index: number;
  paragraph_preview: string;
  quoted_text: string;
  attribution: DialogueAttribution;
};

function normalizeQuote(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function extractQuotedStrings(text: string): string[] {
  const out: string[] = [];
  const patterns = [
    /[""]([^""]+)[""]/g,
    /「([^」]+)」/g,
    /『([^』]+)』/g,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const q = normalizeQuote(m[1] ?? "");
      if (q.length >= 2) out.push(q);
    }
  }
  return out;
}

function personaIsSpeaker(paragraph: string, personaName: string): boolean {
  const persona = personaName.trim();
  if (!persona) return false;
  if (paragraph.includes("[B]")) return true;
  const speakerRe = new RegExp(
    `${persona}(?:이|은|는|이)?\\s*(?:말했|속삭|대답|외친|입에서|말을|입술을|목소리로)?[^\\n.]{0,20}[""「]|^${persona}(?:이|은|는)?\\s*[""「]`,
    "i"
  );
  return speakerRe.test(paragraph);
}

function personaIsAddresseeInQuote(quote: string, personaName: string): boolean {
  const persona = personaName.trim();
  if (!persona) return false;
  return (
    new RegExp(`${persona}[.?"']\\s*$`).test(quote) ||
    quote.includes(`${persona},`) ||
    quote.includes(`${persona}.`)
  );
}

function characterAttributionNearQuote(
  paragraph: string,
  characterNames: string[]
): boolean {
  for (const name of characterNames) {
    const n = name.trim();
    if (!n) continue;
    const re = new RegExp(
      `(?:\\[A\\]|${n})(?:이|은|는|의|가|를|을|에게|한테)?[^\\n.]{0,24}[""「]`,
      "i"
    );
    if (re.test(paragraph) || paragraph.includes(`[A]`)) return true;
  }
  return false;
}

export function collectUserQuotedDialogue(userRaw: string): string[] {
  return extractQuotedStrings(userRaw);
}

export function attributeDialogueInResponse(input: {
  responseText: string;
  userRaw: string;
  personaName: string;
  characterNames: string[];
}): {
  blocks: DialogueBlockRecord[];
  NEW_USER_PERSONA_DIALOGUE_CANDIDATE_COUNT: number;
  NEW_USER_DIALOGUE_HUMAN_REVIEW_REQUIRED: boolean;
  by_attribution: Record<DialogueAttribution, DialogueBlockRecord[]>;
} {
  const paras = paragraphs(input.responseText);
  const userQuotes = collectUserQuotedDialogue(input.userRaw).map(normalizeQuote);
  const userQuoteSet = new Set(userQuotes);
  const blocks: DialogueBlockRecord[] = [];

  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    if (!isDialogueParagraph(p)) continue;
    const quotes = extractQuotedStrings(p);
    if (!quotes.length) {
      blocks.push({
        paragraph_index: i,
        paragraph_preview: p.slice(0, 120),
        quoted_text: "",
        attribution: "UNATTRIBUTED_DIALOGUE",
      });
      continue;
    }
    for (const q of quotes) {
      let attribution: DialogueAttribution = "UNATTRIBUTED_DIALOGUE";
      const norm = normalizeQuote(q);
      if (userQuoteSet.has(norm)) {
        attribution = "SOURCE_USER_QUOTED_DIALOGUE";
      } else if (personaIsAddresseeInQuote(norm, input.personaName)) {
        attribution = "AI_CHARACTER_DIALOGUE_CANDIDATE";
      } else if (personaIsSpeaker(p, input.personaName)) {
        attribution = "NEW_USER_PERSONA_DIALOGUE_CANDIDATE";
      } else if (characterAttributionNearQuote(p, input.characterNames)) {
        attribution = "AI_CHARACTER_DIALOGUE_CANDIDATE";
      } else if (/^[""「]/.test(p.trim())) {
        attribution = "AI_CHARACTER_DIALOGUE_CANDIDATE";
      } else if (p.includes("렌") && personaIsSpeaker(p, input.personaName)) {
        attribution = "NEW_USER_PERSONA_DIALOGUE_CANDIDATE";
      } else if (
        input.characterNames.some((n) => p.includes(n.trim())) ||
        /태형/.test(p)
      ) {
        attribution = "AI_CHARACTER_DIALOGUE_CANDIDATE";
      }
      blocks.push({
        paragraph_index: i,
        paragraph_preview: p.slice(0, 120),
        quoted_text: q,
        attribution,
      });
    }
  }

  const by_attribution: Record<DialogueAttribution, DialogueBlockRecord[]> = {
    SOURCE_USER_QUOTED_DIALOGUE: [],
    AI_CHARACTER_DIALOGUE_CANDIDATE: [],
    NEW_USER_PERSONA_DIALOGUE_CANDIDATE: [],
    UNATTRIBUTED_DIALOGUE: [],
  };
  for (const b of blocks) by_attribution[b.attribution].push(b);

  const personaCount = by_attribution.NEW_USER_PERSONA_DIALOGUE_CANDIDATE.length;
  return {
    blocks,
    NEW_USER_PERSONA_DIALOGUE_CANDIDATE_COUNT: personaCount,
    NEW_USER_DIALOGUE_HUMAN_REVIEW_REQUIRED: personaCount > 0,
    by_attribution,
  };
}

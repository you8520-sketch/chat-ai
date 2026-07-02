/** Step 7.3 — dialogue register + meta narration audit helpers (validation / reports). */

import type { CharacterGenre } from "@/lib/characterGenres";
import { primaryCharacterGenre } from "@/lib/characterGenres";
import { SPEECH_METADATA_INVISIBLE_RULE } from "@/lib/speechMetadataPolicy";
import { PROSE_STYLE_SECTION } from "@/lib/advancedProseNsfwGuidelines";
import { buildNarrativeStyleLayer } from "@/lib/narrativeStyle";

export type RegisterAuditKeyword =
  | "존댓말"
  | "공손"
  | "격식"
  | "귀족"
  | "기사"
  | "절제"
  | "품위"
  | "formal"
  | "polite"
  | "noble"
  | "court"
  | "historical"
  | "classical"
  | "하오"
  | "이오"
  | "합니다"
  | "register";

export type RegisterRuleRow = {
  file: string;
  owner: string;
  snippet: string;
  impact: "dialogue register" | "narration register" | "meta narration ban" | "speech metadata" | "validator";
  duplicateOf?: string;
};

/** Phase A — production prompt sources mentioning register / speech control */
export const REGISTER_AUDIT_SOURCES: RegisterRuleRow[] = [
  {
    file: "src/lib/speechMetadataPolicy.ts",
    owner: "SPEECH METADATA",
    snippet: SPEECH_METADATA_INVISIBLE_RULE.split("\n")[0] ?? "",
    impact: "meta narration ban",
  },
  {
    file: "src/lib/advancedProseNsfwGuidelines.ts",
    owner: "NARRATION REGISTER",
    snippet: "[NARRATION REGISTER] 해체(-다/-했다)",
    impact: "narration register",
    duplicateOf: "NOT dialogue — label clarified Step 7.3",
  },
  {
    file: "src/lib/narrativeStyle.ts",
    owner: "[genre_tone] + dialogue register",
    snippet: "장르별 대사 register 힌트",
    impact: "dialogue register",
  },
  {
    file: "src/lib/speechCreatorFields.ts",
    owner: "SPEECH CONSISTENCY + formatSpeechSectionAsMetadata",
    snippet: "examples win; NEVER NARRATE metadata",
    impact: "speech metadata",
  },
  {
    file: "src/lib/speechLock/patterns.ts",
    owner: "FORMALITY_KEYWORDS / GLOBAL_FORBIDDEN",
    snippet: "post-gen validator — hybrid honorific, archaic drift",
    impact: "validator",
  },
  {
    file: "src/lib/speechLock/deriveProfile.ts",
    owner: "SpeechProfile lockSummary",
    snippet: "stored profile — not injected in system prompt",
    impact: "validator",
  },
  {
    file: "src/lib/advancedProseNsfwGuidelines.ts",
    owner: "NO STAGE DIRECTIONS",
    snippet: "프롬프트·문체 설명 금지",
    impact: "meta narration ban",
    duplicateOf: "SPEECH METADATA (speech-specific)",
  },
  {
    file: "src/lib/advancedProseNsfwGuidelines.ts",
    owner: "EMOTION",
    snippet: "감정 라벨·속마음 해설 금지",
    impact: "meta narration ban",
  },
  {
    file: "src/lib/userPersonas.ts",
    owner: "USER_PERSONA speech",
    snippet: "유저 말투 — AI 캐릭터와 혼동 금지",
    impact: "dialogue register",
  },
];

const ARCHAIC_DIALOGUE_END =
  /(?:하오|하옵|이오|이옵|하였소|하리오|하리|소(?:[.!?…]|$)|(?:이|)오(?:[.!?…]|$)|인간이오|그렇소|하구나)(?:[.!?…]|$)/;
const MODERN_FORMAL_END = /(?:습니다|습니까|십니다|합니다|입니다|그렇습니다)(?:[.!?…]|$)/;
const HAeyo_END = /(?:해요|어요|아요|예요|세요|죠|네요|군요|래요|가요|까요)(?:[.!?…]|$)/;
const BANMAL_END = /(?:[^다]|^)(?:다|야|지|네|군|잖아|거야|냐|니|해|돼)(?:[.!?…]|$)/;

export const META_NARRATION_IN_NARRATION_RE =
  /(?:해요체|하십시오체|합니다체|하오체|다나까체|반말|존댓말|반존대|어조|말투)(?:로|을|가|는|은)?\s*(?:바뀌|변|사용|쓰|유지|공손|격식|부드러|거칠|낮추|높이|돌아|전환|섞|혼)/;

export const META_NARRATION_EXPLAIN_DIALOGUE_RE =
  /(?:말투|존댓말|반말|어조|register|honorific).{0,24}(?:말(?:했|하)|대답|입을\s*열|속삭|내뱉|던졌|이어)/i;

export const NARRATION_EXPLAINING_SPEECH_LABEL_RE =
  /(?:그(?:는|녀)|캐릭터(?:는|가)|[^"\n]{1,12}(?:은|는))\s+[^.\n]{0,40}(?:해요체|하십시오체|합니다체|하오체|존댓말|반말|공손(?:한|히)?\s*말투|격식(?:을|의)?)/;

const DIALOGUE_LINE_RE = /^"([^"]{1,400})"$/;

function classifyDialogueEnding(line: string): "archaic" | "formal" | "haeyo" | "banmal" | "other" {
  const t = line.trim();
  if (ARCHAIC_DIALOGUE_END.test(t)) return "archaic";
  if (MODERN_FORMAL_END.test(t)) return "formal";
  if (HAeyo_END.test(t)) return "haeyo";
  if (BANMAL_END.test(t)) return "banmal";
  return "other";
}

export function extractDialogueLines(text: string): string[] {
  const out: string[] = [];
  for (const block of text.replace(/\r\n/g, "\n").split(/\n{2,}/)) {
    for (const line of block.split("\n")) {
      const m = line.trim().match(DIALOGUE_LINE_RE);
      if (m?.[1]) out.push(m[1].trim());
    }
  }
  if (out.length === 0) {
    for (const m of text.matchAll(/"([^"\n]{2,400})"/g)) {
      if (m[1]) out.push(m[1].trim());
    }
  }
  return out;
}

export function detectRegisterSwitching(text: string): { fail: boolean; kinds: string[]; evidence: string[] } {
  const dialogues = extractDialogueLines(text);
  const kinds = new Set<string>();
  const evidence: string[] = [];
  for (const d of dialogues) {
    const k = classifyDialogueEnding(d);
    if (k !== "other") kinds.add(k);
  }
  const list = [...kinds];
  const fail = list.length > 1;
  if (fail) {
    for (const d of dialogues.slice(0, 8)) {
      const k = classifyDialogueEnding(d);
      if (k !== "other") evidence.push(`[${k}] ${d.slice(0, 60)}`);
    }
  }
  return { fail, kinds: list, evidence };
}

export function detectMetaNarration(text: string): { fail: boolean; hits: string[] } {
  const hits: string[] = [];
  const narration = text
    .replace(/"[^"]*"/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const re of [
    META_NARRATION_IN_NARRATION_RE,
    META_NARRATION_EXPLAIN_DIALOGUE_RE,
    NARRATION_EXPLAINING_SPEECH_LABEL_RE,
  ]) {
    const m = narration.match(re);
    if (m?.[0]) hits.push(m[0].slice(0, 120));
  }
  return { fail: hits.length > 0, hits: [...new Set(hits)] };
}

export function detectArchiacInModernGenre(text: string, genres: CharacterGenre[]): boolean {
  const primary = primaryCharacterGenre(genres);
  if (primary === "무협/시대극") return false;
  return extractDialogueLines(text).some((d) => classifyDialogueEnding(d) === "archaic");
}

export type Step73SampleVerdict = {
  id: string;
  registerSwitching: "PASS" | "FAIL";
  metaNarration: "PASS" | "FAIL";
  narrationExplainingDialogue: "PASS" | "FAIL";
  speechConsistency: "PASS" | "FAIL";
  characterVoiceConsistency: "PASS" | "FAIL";
  notes: string[];
};

export function evaluateStep73Sample(
  id: string,
  text: string,
  genres: CharacterGenre[]
): Step73SampleVerdict {
  const reg = detectRegisterSwitching(text);
  const meta = detectMetaNarration(text);
  const archaicLeak = detectArchiacInModernGenre(text, genres);

  const narrationExplaining =
    meta.fail && (META_NARRATION_EXPLAIN_DIALOGUE_RE.test(text) || NARRATION_EXPLAINING_SPEECH_LABEL_RE.test(text));

  const notes: string[] = [];
  if (reg.fail) notes.push(`register mix: ${reg.kinds.join("+")}`);
  if (meta.hits.length) notes.push(...meta.hits.map((h) => `meta: ${h}`));
  if (archaicLeak) notes.push("archaic dialogue in modern-genre scene");

  const speechConsistency: "PASS" | "FAIL" = archaicLeak || reg.fail ? "FAIL" : "PASS";

  return {
    id,
    registerSwitching: reg.fail ? "FAIL" : "PASS",
    metaNarration: meta.fail ? "FAIL" : "PASS",
    narrationExplainingDialogue: narrationExplaining ? "FAIL" : "PASS",
    speechConsistency,
    characterVoiceConsistency: reg.fail ? "FAIL" : "PASS",
    notes,
  };
}

export function collectRegisterKeywordHits(source: string, keyword: RegisterAuditKeyword): number {
  const re = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  return [...source.matchAll(re)].length;
}

export function buildProductionRegisterPromptSlice(genres: CharacterGenre[]): string {
  return [
    SPEECH_METADATA_INVISIBLE_RULE,
    PROSE_STYLE_SECTION,
    buildNarrativeStyleLayer({ genres, mode: "standard" }),
  ].join("\n\n");
}

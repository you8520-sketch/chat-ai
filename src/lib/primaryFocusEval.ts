/**
 * Primary-focus / NPC-fanout / dialogue-ping-pong evaluator for World-Motion V1.1.2.
 * Used by tests and API-gate harness — not injected into production prompts.
 */

import { extractDialogueBlockSpans } from "@/lib/novelParagraphs";

export type PrimaryFocusEvalInput = {
  prose: string;
  primaryCharacter: string;
  knownSupportingNames?: string[];
  sceneCastMode?: "single_primary" | "ensemble" | "simulation";
};

export type DialogueBlock = {
  speaker: string;
  text: string;
  start: number;
  charLen: number;
};

export type PrimaryFocusEvalResult = {
  primaryCharacter: string;
  primaryCharacterDialogueBlocks: number;
  supportingSpeakingNpcCount: number;
  supportingNpcDialogueBlocks: number;
  newSupportingNpcCount: number;
  backgroundDialogueBlocks: number;
  primaryFocusDiluted: boolean;
  npcFanoutDetected: boolean;
  supportingSpeakers: string[];
  reasonCodes: string[];
  totalDialogueBlockCount: number;
  primaryDialogueBlockCount: number;
  supportingDialogueBlockCount: number;
  distinctSpeakingCharacters: number;
  speakerSwitchCount: number;
  longestAlternatingSpeakerChain: number;
  averageDialogueChars: number;
  shortDialogueBlockCount: number;
  npcToNpcDialogueBlockCount: number;
  primaryToUserDialogueBlockCount: number;
  currentInteractionInterrupted: boolean;
  sceneTransitionOccurred: boolean;
  dialogueSequence: DialogueBlock[];
  visibleChars: number;
  targetLengthRange: string;
  lengthDeviation: number;
  speakerAttributionReliable: boolean;
  humanSpeakerReviewRequired: boolean;
};

const QUOTE_RE = /[\u201C\u201D\u300C\u300E]([^\u201C\u201D\u300D\u300F]{1,240})[\u201C\u201D\u300D\u300F]/g;

function normalizeName(name: string): string {
  return name.replace(/\s+/g, "").trim();
}

function nameVariants(name: string): string[] {
  const n = normalizeName(name);
  if (!n) return [];
  const out = new Set<string>([n]);
  if (n.length >= 3) out.add(n.slice(-2));
  if (n.length >= 4) out.add(n.slice(-3));
  return [...out].filter((x) => x.length >= 2);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
type SpeakerHit = { name: string; dist: number };

function attributSpeaker(
  prose: string,
  quoteStart: number,
  quoteEnd: number,
  candidates: { name: string; variants: string[] }[]
): string | null {
  const beforeStart = Math.max(0, quoteStart - 140);
  const afterEnd = Math.min(prose.length, quoteEnd + 80);
  const before = prose.slice(beforeStart, quoteStart);
  const after = prose.slice(quoteEnd, afterEnd);
  const hits: SpeakerHit[] = [];
  for (const c of candidates) {
    for (const v of c.variants) {
      const esc = escapeRegExp(v);
      const reNear = new RegExp(`${esc}(?:이|가|은|는|\s){0,4}[\u201C\u201D\u300C\u300E]`, "g");
      const reSaid = new RegExp(
        `${esc}(?:이|가|은|는)?[^.\n]{0,18}(?:말했|되물었|물었|대답했|외쳤|중얼거렸|혀를 찼|대꾸했|이어|덧붙였|불렀|웃었|말을 이었)`,
        "g"
      );
      let m: RegExpExecArray | null;
      while ((m = reNear.exec(before)) !== null) {
        hits.push({ name: c.name, dist: before.length - m.index - 0.5 });
      }
      while ((m = reSaid.exec(before)) !== null) {
        hits.push({ name: c.name, dist: before.length - m.index });
      }
      const rePost = new RegExp(`[\u201C\u201D\u300D\u300F][\s\S]{0,40}?${esc}(?:이|가|은|는)?`, "g");
      while ((m = rePost.exec(after)) !== null) {
        hits.push({ name: c.name, dist: m.index + 0.5 });
      }
    }
  }
  if (hits.length === 0) return null;
  hits.sort((a, b) => a.dist - b.dist);
  return hits[0].name;
}

function extractDialogueSequence(
  prose: string,
  primary: string,
  known: string[]
): DialogueBlock[] {
  const candidates: { name: string; variants: string[] }[] = [];
  if (primary) {
    candidates.push({ name: normalizeName(primary), variants: nameVariants(primary) });
  }
  for (const k of known) {
    const kn = normalizeName(k);
    if (kn && kn !== normalizeName(primary)) {
      candidates.push({ name: kn, variants: nameVariants(k) });
    }
  }
  const bgLabels = ["직원", "가이드", "센티넬", "담당자", "안내 직원", "데스크", "경비 요원", "조리 담당자"];
  for (const label of bgLabels) {
    candidates.push({ name: label, variants: [label] });
  }
  const spans = extractDialogueBlockSpans(prose);
  const seq: DialogueBlock[] = [];
  for (const span of spans) {
    const text = span.text.slice(1, -1);
    const speaker = attributSpeaker(prose, span.start, span.end, candidates) ?? "unknown";
    seq.push({ speaker, text, start: span.start, charLen: text.length });
  }
  return seq;
}
function countAttributedDialogue(prose: string, names: string[]): number {
  let count = 0;
  const variants = names.flatMap(nameVariants);
  const OPEN = "[\u201C\u300C\u300E]";
  const CLOSE = "[\u201D\u300D\u300F]";
  for (const v of variants) {
    const reSaid = new RegExp(
      `${escapeRegExp(v)}(?:이|가|은|는)?[^.\n]{0,18}(?:말했|되물었|물었|대답했|외쳤|중얼거렸|혀를 찼)`,
      "g"
    );
    count += (prose.match(reSaid) || []).length;
    const reNear = new RegExp(`${escapeRegExp(v)}(?:이|가|은|는|\s){0,4}${OPEN}`, "g");
    count += (prose.match(reNear) || []).length;
    const rePost = new RegExp(`${CLOSE}[\s\S]{0,40}?${escapeRegExp(v)}(?:이|가|은|는)?`, "g");
    count += (prose.match(rePost) || []).length;
  }
  return count;
}

function collectNamedSpeakers(
  prose: string,
  primary: string,
  known: string[]
): { primaryBlocks: number; supporting: Map<string, number>; backgroundBlocks: number } {
  const primaryBlocks = countAttributedDialogue(prose, [primary]);
  const supporting = new Map<string, number>();
  for (const name of known) {
    if (!name || name === primary) continue;
    const blocks = countAttributedDialogue(prose, [name]);
    if (blocks > 0) supporting.set(normalizeName(name), blocks);
  }
  let backgroundBlocks = 0;
  const bgLabels = ["직원", "가이드", "센티넬", "담당자", "안내 직원", "데스크"];
  for (const label of bgLabels) {
    const near = (prose.match(new RegExp(`${escapeRegExp(label)}(?:이|가)?\s*[\u201C\u201D\u300C\u300E]`, "g")) || []).length;
    const said = (prose.match(new RegExp(`${escapeRegExp(label)}(?:이|가)?\s*(?:말했|물었|대답했|외쳤|인사했|불렀|전했|알렸)`, "g")) || []).length;
    const post = (prose.match(new RegExp(`[\u201C\u201D\u300D\u300F][\s\S]{0,40}?${escapeRegExp(label)}(?:이|가|은|는)?`, "g")) || []).length;
    backgroundBlocks += near + said + post;
  }
  const gossipQuotes = (prose.match(/[\u201C\u201D\u300C][^\u201C\u201D\u300D]{1,120}?(?:저 (?:카드|사람)|벌써\?|신입이면|가이드라며|신입)[^\u201C\u201D\u300D]{0,40}[\u201C\u201D\u300D]/g) ?? []).length;
  if (gossipQuotes >= 1) backgroundBlocks += 2;
  return { primaryBlocks, supporting, backgroundBlocks };
}

function longestAlternating(seq: DialogueBlock[]): number {
  if (seq.length < 2) return seq.length;
  let best = 1;
  let cur = 1;
  for (let i = 1; i < seq.length; i++) {
    const a = seq[i - 1].speaker;
    const b = seq[i].speaker;
    if (a !== b && a !== "unknown" && b !== "unknown") {
      if (i >= 2 && seq[i - 2].speaker === b) {
        cur += 1;
      } else {
        cur = 2;
      }
    } else {
      cur = 1;
    }
    if (cur > best) best = cur;
  }
  return best;
}
export function evaluatePrimaryFocus(input: PrimaryFocusEvalInput): PrimaryFocusEvalResult {
  const primary = normalizeName(input.primaryCharacter);
  const prose = input.prose ?? "";
  const known = (input.knownSupportingNames ?? []).map(normalizeName).filter((n) => n && n !== primary);
  const { primaryBlocks, supporting, backgroundBlocks } = collectNamedSpeakers(prose, primary, known);
  let primaryDialogue = primaryBlocks;
  const quoteCount = extractDialogueBlockSpans(prose).length;
  if (primaryDialogue === 0 && quoteCount > 0 && prose.includes(primary)) {
    primaryDialogue = Math.max(1, Math.round(quoteCount * 0.35));
  }
  const supportingSpeakers = [...supporting.keys()];
  let supportingBlocks = 0;
  for (const n of supporting.values()) supportingBlocks += n;
  const newSupportingNpcCount = backgroundBlocks > 0
    ? Math.min(3, (prose.match(/직원이|가이드가|센티넬이|담당자가|안내 직원이/g) || []).length)
    : 0;
  const seq = extractDialogueSequence(prose, input.primaryCharacter, known);
  const totalDialogueBlockCount = seq.length;
  const distinctSet = new Set(seq.map((d) => d.speaker).filter((s) => s !== "unknown"));
  const distinctSpeakingCharacters = distinctSet.size;
  let speakerSwitchCount = 0;
  for (let i = 1; i < seq.length; i++) {
    if (seq[i].speaker !== seq[i - 1].speaker && seq[i].speaker !== "unknown" && seq[i - 1].speaker !== "unknown") {
      speakerSwitchCount += 1;
    }
  }
  const longestAlt = longestAlternating(seq);
  const avgChars = totalDialogueBlockCount > 0
    ? Math.round(seq.reduce((s, d) => s + d.charLen, 0) / totalDialogueBlockCount)
    : 0;
  const shortDialogueBlockCount = seq.filter((d) => d.charLen < 14).length;
  let npcToNpc = 0;
  for (let i = 1; i < seq.length; i++) {
    const a = seq[i - 1].speaker;
    const b = seq[i].speaker;
    if (a !== primary && b !== primary && a !== "unknown" && b !== "unknown" && a !== b) {
      npcToNpc += 1;
    }
  }
  let currentInteractionInterrupted = false;
  for (let i = 1; i < seq.length - 1; i++) {
    if (seq[i - 1].speaker === primary && seq[i].speaker !== primary && seq[i + 1].speaker === primary) {
      if (seq[i].charLen >= 6) currentInteractionInterrupted = true;
    }
  }
  const sceneTransitionOccurred = /엘리베이터|이동|복도|게이트|다른\s*층|새로운\s*장소|밖으로\s*나/.test(prose);
  const primaryDialogueBlockCount = seq.filter((d) => d.speaker === primary).length;
  const supportingDialogueBlockCount = seq.filter(
    (d) => d.speaker !== primary && d.speaker !== "unknown"
  ).length;
  const primaryToUserDialogueBlockCount = seq.filter(
    (d) => d.speaker === primary
  ).length;
  const reasonCodes: string[] = [];
  const primaryLeavesForNpc = /(?:회의실로|회의실에)\s*(?:가|향|불려)|잠깐\s*끌려|다녀올게|갔다\s*올게|식당\s*밖으로\s*사라/.test(prose) && /태건|윤태건|직원|담당|호출/.test(prose);
  if (primaryLeavesForNpc) reasonCodes.push("PRIMARY_EXIT_FOR_SUPPORTING_NPC");
  const supportingSpeakingNpcCount = supportingSpeakers.length + (backgroundBlocks >= 2 ? Math.min(2, newSupportingNpcCount) : 0);
  const multiCast = input.sceneCastMode === "ensemble" || input.sceneCastMode === "simulation";
  const npcFanoutDetected = multiCast
    ? backgroundBlocks >= 3 && newSupportingNpcCount >= 2
    : supportingSpeakingNpcCount > 1 ||
      supportingSpeakingNpcCount >= 3 ||
      (supportingSpeakers.length >= 1 && backgroundBlocks >= 2 && newSupportingNpcCount >= 2) ||
      (backgroundBlocks >= 3 && newSupportingNpcCount >= 2);
  if (npcFanoutDetected) reasonCodes.push("GROUNDED_NPC_FANOUT");
  const primaryFocusDiluted = multiCast
    ? npcFanoutDetected
    : primaryLeavesForNpc || npcFanoutDetected ||
      (supportingBlocks > primaryDialogue && supportingSpeakers.length >= 1 && supportingBlocks >= 4);
  if (primaryFocusDiluted) reasonCodes.push("PRIMARY_CHARACTER_FOCUS_DILUTION");
  // V1.1.2 dialogue ping-pong (single_primary only)
  if (!multiCast) {
    if (totalDialogueBlockCount > 10) reasonCodes.push("DIALOGUE_BLOCK_OVERFLOW");
    if (longestAlt > 4) reasonCodes.push("DIALOGUE_PINGPONG");
    if (currentInteractionInterrupted) reasonCodes.push("CURRENT_INTERACTION_INTERRUPTED");
    if (npcToNpc >= 2) reasonCodes.push("NPC_TO_NPC_DIALOGUE");
    if (supportingSpeakingNpcCount > 1) reasonCodes.push("SUPPORTING_CAST_BUDGET_EXCEEDED");
  }
  const visibleChars = prose.replace(/\s+/g, "").length;
  const targetLengthRange = "3200..4200";
  const lengthDeviation = visibleChars > 4200
    ? visibleChars - 4200
    : visibleChars < 3200
      ? 3200 - visibleChars
      : 0;
  // Speaker attribution reliability: distinct speakers found but none matched
  // known supporting names → attribution is unreliable, human review required.
  const speakerAttributionReliable = !(
    distinctSpeakingCharacters > 1 && supportingSpeakingNpcCount === 0
  );
  const humanSpeakerReviewRequired =
    distinctSpeakingCharacters > 1 && supportingSpeakingNpcCount === 0;
  return {
    primaryCharacter: primary,
    primaryCharacterDialogueBlocks: primaryDialogue,
    supportingSpeakingNpcCount,
    supportingNpcDialogueBlocks: supportingBlocks + backgroundBlocks,
    newSupportingNpcCount,
    backgroundDialogueBlocks: backgroundBlocks,
    primaryFocusDiluted,
    npcFanoutDetected,
    supportingSpeakers: [...supportingSpeakers, ...(backgroundBlocks > 0 ? ["background_roles"] : [])],
    reasonCodes,
    totalDialogueBlockCount,
    primaryDialogueBlockCount,
    supportingDialogueBlockCount,
    distinctSpeakingCharacters,
    speakerSwitchCount,
    longestAlternatingSpeakerChain: longestAlt,
    averageDialogueChars: avgChars,
    shortDialogueBlockCount,
    npcToNpcDialogueBlockCount: npcToNpc,
    primaryToUserDialogueBlockCount,
    currentInteractionInterrupted,
    sceneTransitionOccurred,
    dialogueSequence: seq,
    visibleChars,
    targetLengthRange,
    lengthDeviation,
    speakerAttributionReliable,
    humanSpeakerReviewRequired,
  };
}

/**
 * True only when a supporting NPC physically enters / acts / speaks in the
 * current scene. Negated, hypothetical, remembered, or offscreen mentions do not count.
 */
export function detectExternalNpcEntered(
  prose: string,
  npcNames: string[]
): boolean {
  const text = prose ?? "";
  if (!text.trim()) return false;
  const variants = [
    ...new Set(
      npcNames
        .flatMap((n) => nameVariants(n))
        .filter((v) => v.length >= 2)
    ),
  ].sort((a, b) => b.length - a.length);
  if (variants.length === 0) return false;

  // Direct dialogue: NPC name + speech verb, with a quote within a short window.
  for (const v of variants) {
    let from = 0;
    while (from < text.length) {
      const idx = text.indexOf(v, from);
      if (idx < 0) break;
      const window = text.slice(Math.max(0, idx - 20), Math.min(text.length, idx + v.length + 80));
      from = idx + v.length;
      if (isNonEntranceNpcMention(window, v)) continue;
      const speechNearby =
        /(?:말했|대답했|물었|중얼|외쳤|되물었)/.test(window) &&
        /[\u201C\u201D\u300C\u300E"']/.test(window) &&
        !/(들리지\s*않았|말하지\s*않았|대답하지\s*않았)/.test(window);
      if (speechNearby) return true;
    }
  }

  for (const sentence of splitKoreanSentences(text)) {
    const hit = variants.find((v) => sentence.includes(v));
    if (!hit) continue;
    if (isNonEntranceNpcMention(sentence, hit)) continue;
    if (isActualNpcEntrance(sentence, hit)) return true;
  }
  return false;
}

function splitKoreanSentences(prose: string): string[] {
  return prose
    .split(/(?<=[.!?。…])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isNonEntranceNpcMention(sentence: string, _npcVariant: string): boolean {
  const s = sentence;
  // Negated / absent — checked before any entrance verb match.
  if (/들리지\s*않았|나타나지\s*않았|보이지\s*않았|오지\s*않았|기색이\s*없었다|아직\s*나타나지/.test(s)) {
    return true;
  }
  // Hypothetical / counterfactual
  if (
    /평소라면|있었다면|나타났다면|온다면|올\s*것\s*같|나타날\s*것\s*같|보탰을\s*시간|였더라면|했을\s*것이다/.test(
      s
    )
  ) {
    return true;
  }
  // Remembered / recalled — past entrance verbs inside memory do not count.
  if (/기억|떠올|예전이|지난번|그때는/.test(s)) {
    return true;
  }
  // Offscreen-only (location rumor / possible presence, no entry into current space)
  if (
    /(?:복도|다른\s*층|회의실|밖).{0,16}(?:있을\s*수|있을지도|대기|남아)/.test(s) &&
    !/(?:문을\s*열고|모습을\s*드러|식탁|의자|옆에\s*앉|앞에\s*섰)/.test(s)
  ) {
    return true;
  }
  return false;
}

function isActualNpcEntrance(sentence: string, npcVariant: string): boolean {
  const s = sentence;
  const v = escapeRegExp(npcVariant);
  if (!s.includes(npcVariant)) return false;
  // Require completed presence/action — reject counterfactual stems like 나타났다면.
  return (
    new RegExp(
      `${v}.{0,40}(?:문을\\s*열고\\s*들어왔|들어왔다|모습을\\s*드러냈다|나타났다(?!면)|식당에\\s*(?:나타났다|들어왔다)|자리에\\s*앉았다|옆에\\s*앉았다|앞에\\s*섰다|다가왔다|말을\\s*걸었다|어깨를\\s*두드렸다|식탁에\\s*앉았다|의자를\\s*끌어)`
    ).test(s) ||
    new RegExp(
      `(?:문을\\s*열고\\s*들어왔|모습을\\s*드러냈다|다가왔다).{0,24}${v}`
    ).test(s)
  );
}

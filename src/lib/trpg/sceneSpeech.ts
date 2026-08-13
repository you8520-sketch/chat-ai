export type TrpgSpeechBeat = {
  speaker: string | null;
  text: string;
};

const SPEAKER_LINE = /^(.{1,24}?)[:：]\s+(\S[\s\S]*)$/;
const QUOTE_ONLY = /^(?:["“”「『][\s\S]+["“”」』])\s*$/u;
const BLOCKED_SPEAKERS = new Set([
  "시간",
  "장소",
  "주의",
  "참고",
  "메모",
  "dc",
  "hp",
  "mp",
  "note",
  "ps",
  "http",
  "https",
]);
const SPEECH_ATTR =
  /(?:의\s*목소리|[이가은는](?:\s+[^\s]{1,12}){0,4}\s*(?:말(?:했|하)|외쳤|물었|대꾸|대답|속삭|중얼|소리쳤|입을))/u;
/** Signs, notes, maps, letters — quoted lines here are writing, not speech. */
const WRITTEN_TEXT_CUE =
  /손글씨|손으로\s*그린|적혀\s*있|적혀\s*있었|씌어\s*있|쓰여\s*있|메모|쪽지|편지|낙서|약도|글씨|한\s*줄이\s*(?:더\s*)?적|기록되어|노트에|간판|표지판|문구가|각인|새겨\s*있|지도.{0,32}(?:적힌|적혀)/u;

function knownSet(names: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const name of names) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    out.add(trimmed);
    out.add(trimmed.toLowerCase());
  }
  return out;
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type NameAlias = { alias: string; canonical: string };

function expandKnownNames(names: readonly string[]): NameAlias[] {
  const out: NameAlias[] = [];
  const seen = new Set<string>();
  const push = (alias: string, canonical: string) => {
    const key = alias.trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ alias: key, canonical });
  };
  for (const name of names) {
    const n = name.trim();
    if (!n) continue;
    push(n, n);
    if (/^[가-힣]{3,4}$/.test(n)) push(n.slice(1), n);
  }
  push("GM", "GM");
  out.sort((a, b) => b.alias.length - a.alias.length);
  return out;
}

export function isTrpgSpeakerPrefix(name: string, rest: string, knownNames: readonly string[] = []): boolean {
  const n = name.trim();
  const body = rest.trim();
  if (!n || n.length > 24 || !body) return false;
  if (/^\d+$/.test(n)) return false;
  if (/https?:|www\./i.test(n)) return false;
  if (BLOCKED_SPEAKERS.has(n.toLowerCase())) return false;
  const known = knownSet(namesWithAliases(knownNames));
  if (known.has(n) || known.has(n.toLowerCase())) return true;
  if (/^["'“”「『]/.test(body)) return true;
  return /^[\p{L}\p{N}·]+$/u.test(n) && n.length <= 12;
}

function namesWithAliases(names: readonly string[]): string[] {
  return expandKnownNames(names).map((row) => row.alias);
}

function canonicalSpeaker(name: string, aliases: readonly NameAlias[]): string {
  const n = name.trim();
  const hit = aliases.find((row) => row.alias === n || row.alias.toLowerCase() === n.toLowerCase());
  return hit?.canonical ?? n;
}

function inferSpeaker(text: string, aliases: readonly NameAlias[]): string | null {
  let attributed: { canonical: string; index: number } | null = null;
  for (const { alias, canonical } of aliases) {
    if (alias.toLowerCase() === "gm") continue;
    const re = new RegExp(`${escapeRe(alias)}${SPEECH_ATTR.source}`, "gu");
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      if (!attributed || match.index >= attributed.index) {
        attributed = { canonical, index: match.index };
      }
    }
  }
  return attributed?.canonical ?? null;
}

function prefixedParts(line: string, knownNames: readonly string[], aliases: readonly NameAlias[]): { speaker: string; text: string } | null {
  const match = line.trim().match(SPEAKER_LINE);
  if (!match) return null;
  const speaker = match[1]!.trim();
  const text = match[2]!.trim();
  if (!isTrpgSpeakerPrefix(speaker, text, knownNames)) return null;
  return { speaker: canonicalSpeaker(speaker, aliases), text };
}

export function isTrpgQuotedSpeech(text: string): boolean {
  const t = text.trim();
  if (!QUOTE_ONLY.test(t)) return false;
  const inner = t.replace(/^["“”「『]+/, "").replace(/["“”」』]+\s*$/, "");
  return !/["“「『]/.test(inner);
}

function isQuoteOnly(text: string): boolean {
  return isTrpgQuotedSpeech(text);
}

const DIALOGUE_QUOTE = /(["“「『])([^"“”「『」』]+)(["”」』])/gu;

function graphemeCount(text: string): number {
  return Array.from(text).length;
}

function subjectSpeaker(lead: string, aliases: readonly NameAlias[]): string | null {
  let best: { canonical: string; index: number } | null = null;
  for (const { alias, canonical } of aliases) {
    if (alias.toLowerCase() === "gm") continue;
    const re = new RegExp(`${escapeRe(alias)}[은는이가]`, "gu");
    let match: RegExpExecArray | null;
    while ((match = re.exec(lead)) !== null) {
      if (!best || match.index >= best.index) best = { canonical, index: match.index };
    }
  }
  return best?.canonical ?? null;
}

function speakerAroundQuote(
  lead: string,
  trail: string,
  aliases: readonly NameAlias[]
): string | null {
  return (
    inferSpeaker(lead, aliases) ||
    subjectSpeaker(lead, aliases) ||
    inferSpeaker(trail, aliases) ||
    subjectSpeaker(trail, aliases)
  );
}

/** Pull spoken quotes out of a narration paragraph and label the speaker. */
function splitMixedQuotes(
  text: string,
  aliases: readonly NameAlias[],
  carriedSpeaker: string | null
): TrpgSpeechBeat[] {
  const matches = [...text.matchAll(DIALOGUE_QUOTE)];
  if (matches.length === 0) return [{ speaker: null, text }];
  const beats: TrpgSpeechBeat[] = [];
  let cursor = 0;
  let anySpeech = false;
  for (const match of matches) {
    const index = match.index ?? 0;
    const quoted = match[0];
    const inner = match[2] ?? "";
    const lead = text.slice(cursor, index);
    const trail = text.slice(index + quoted.length, index + quoted.length + 80);
    const local = speakerAroundQuote(lead, trail, aliases);
    const split = Boolean(local) || graphemeCount(inner.trim()) >= 12;
    if (!split) continue;
    if (lead.trim()) pushBeat(beats, null, [lead.trim()]);
    beats.push({ speaker: local || carriedSpeaker, text: quoted.trim() });
    anySpeech = true;
    cursor = index + quoted.length;
  }
  if (!anySpeech) return [{ speaker: null, text }];
  const tail = text.slice(cursor).trim();
  if (tail) pushBeat(beats, null, [tail]);
  return beats;
}

export function isTrpgWrittenTextCue(text: string): boolean {
  return WRITTEN_TEXT_CUE.test(text);
}

export function unwrapTrpgOuterQuotes(text: string): string {
  const t = text.replace(/\r\n/g, "\n").trim();
  if (!t) return "";
  const wrapped = t.match(/^["“”「『]+([\s\S]*?)["“”」』]+$/);
  if (wrapped) return wrapped[1]!.trim();
  return t.replace(/^["“”「『]+\s*/, "").replace(/\s*["“”」』]+$/, "").trim();
}

const GM_OPEN = /(^|\n)(GM(?:\s*[:：][ \t]*|\s*\n+))/gi;

/** Last `GM:` / `GM` aside — table-talk, kept as one block even with blank lines. */
export function splitTrailingGmTalk(narration: string): { scene: string; gmTalk: string } {
  const text = narration.replace(/\r\n/g, "\n");
  const matches = [...text.matchAll(GM_OPEN)];
  const last = matches.at(-1);
  if (!last || last.index == null) return { scene: text.trim(), gmTalk: "" };
  const at = last.index + last[1]!.length;
  const afterOpen = at + last[2]!.length;
  return {
    scene: text.slice(0, at).trim(),
    gmTalk: unwrapTrpgOuterQuotes(text.slice(afterOpen)),
  };
}

function pushBeat(out: TrpgSpeechBeat[], speaker: string | null, lines: string[]) {
  const text = lines.join("\n").trim();
  if (!text) return;
  out.push({ speaker, text });
}

/**
 * Split GM narration into named dialogue beats.
 * `이름: "대사"` and standalone quoted paragraphs become labeled speech.
 * Quoted writing (notes, maps, letters) stays unlabeled narration.
 * A trailing `GM:` aside is one table-talk beat, not character quotes.
 * Narration has no speaker — the UI must not invent a 「장면」 label.
 */
export function parseTrpgSceneSpeech(narration: string, knownNames: readonly string[] = []): TrpgSpeechBeat[] {
  const { scene, gmTalk } = splitTrailingGmTalk(narration);
  const aliases = expandKnownNames(knownNames);
  const out: TrpgSpeechBeat[] = [];
  let lastSpeaker: string | null = null;
  let writtenPending = false;
  const text = scene.trim();
  if (text) {
    for (const para of text.split(/\n{2,}/)) {
      const buf: string[] = [];
      for (const rawLine of para.split("\n")) {
        const prefixed = prefixedParts(rawLine, knownNames, aliases);
        if (prefixed) {
          const pending = buf.join("\n");
          const asWriting = writtenPending || isTrpgWrittenTextCue(pending);
          pushBeat(out, null, buf);
          buf.length = 0;
          if (asWriting) {
            out.push({ speaker: null, text: prefixed.text });
            lastSpeaker = null;
            writtenPending = false;
          } else {
            out.push({ speaker: prefixed.speaker, text: prefixed.text });
            lastSpeaker = prefixed.speaker;
          }
          continue;
        }
        buf.push(rawLine);
      }
      const leftover = buf.join("\n").trim();
      if (!leftover) continue;
      const nameOnly = aliases.find((row) => row.alias === leftover && row.alias.toLowerCase() !== "gm");
      if (nameOnly) {
        lastSpeaker = nameOnly.canonical;
        continue;
      }
      if (isQuoteOnly(leftover)) {
        out.push({
          speaker: writtenPending ? null : lastSpeaker,
          text: leftover,
        });
        if (writtenPending) lastSpeaker = null;
        writtenPending = false;
        continue;
      }
      if (isTrpgWrittenTextCue(leftover)) {
        writtenPending = true;
        lastSpeaker = null;
        pushBeat(out, null, buf);
        continue;
      }
      writtenPending = false;
      const mixed = splitMixedQuotes(leftover, aliases, lastSpeaker);
      for (const beat of mixed) out.push(beat);
      lastSpeaker = inferSpeaker(leftover, aliases);
    }
  }
  if (gmTalk) out.push({ speaker: "GM", text: gmTalk });
  return out;
}

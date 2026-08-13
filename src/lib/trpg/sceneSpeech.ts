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
  /(?:의\s*목소리|[이가은는]\s*(?:말(?:했|하)|외쳤|물었|대꾸|대답|속삭|중얼|소리쳤|입을))/u;

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
    if (alias === "GM") continue;
    const re = new RegExp(`${escapeRe(alias)}${SPEECH_ATTR.source}`, "gu");
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      if (!attributed || match.index >= attributed.index) {
        attributed = { canonical, index: match.index };
      }
    }
  }
  if (attributed) return attributed.canonical;
  let first: { canonical: string; index: number; len: number } | null = null;
  for (const { alias, canonical } of aliases) {
    if (alias === "GM") continue;
    const idx = text.indexOf(alias);
    if (idx < 0) continue;
    if (!first || idx < first.index || (idx === first.index && alias.length > first.len)) {
      first = { canonical, index: idx, len: alias.length };
    }
  }
  return first?.canonical ?? null;
}

function prefixedParts(line: string, knownNames: readonly string[], aliases: readonly NameAlias[]): { speaker: string; text: string } | null {
  const match = line.trim().match(SPEAKER_LINE);
  if (!match) return null;
  const speaker = match[1]!.trim();
  const text = match[2]!.trim();
  if (!isTrpgSpeakerPrefix(speaker, text, knownNames)) return null;
  return { speaker: canonicalSpeaker(speaker, aliases), text };
}

function isQuoteOnly(text: string): boolean {
  return QUOTE_ONLY.test(text.trim());
}

function pushBeat(out: TrpgSpeechBeat[], speaker: string | null, lines: string[]) {
  const text = lines.join("\n").trim();
  if (!text) return;
  out.push({ speaker, text });
}

/**
 * Split GM narration into named dialogue beats.
 * `이름: "대사"` and standalone quoted paragraphs become labeled speech.
 * Narration has no speaker — the UI must not invent a 「장면」 label.
 */
export function parseTrpgSceneSpeech(narration: string, knownNames: readonly string[] = []): TrpgSpeechBeat[] {
  const text = narration.replace(/\r\n/g, "\n").trim();
  if (!text) return [];
  const aliases = expandKnownNames(knownNames);
  const out: TrpgSpeechBeat[] = [];
  let lastSpeaker: string | null = null;
  for (const para of text.split(/\n{2,}/)) {
    const buf: string[] = [];
    let speaker: string | null = null;
    for (const rawLine of para.split("\n")) {
      const prefixed = prefixedParts(rawLine, knownNames, aliases);
      if (prefixed) {
        pushBeat(out, speaker, buf);
        buf.length = 0;
        out.push({ speaker: prefixed.speaker, text: prefixed.text });
        lastSpeaker = prefixed.speaker;
        speaker = null;
        continue;
      }
      buf.push(rawLine);
    }
    const leftover = buf.join("\n").trim();
    if (!leftover) continue;
    if (isQuoteOnly(leftover)) {
      out.push({ speaker: lastSpeaker, text: leftover });
      continue;
    }
    const inferred = inferSpeaker(leftover, aliases);
    if (inferred) lastSpeaker = inferred;
    pushBeat(out, null, buf);
  }
  return out;
}

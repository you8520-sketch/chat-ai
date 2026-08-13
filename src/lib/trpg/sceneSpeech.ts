export type TrpgSpeechBeat = {
  speaker: string | null;
  text: string;
};

const SPEAKER_LINE = /^(.{1,24}?)[:：]\s+(\S[\s\S]*)$/;
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

export function isTrpgSpeakerPrefix(name: string, rest: string, knownNames: readonly string[] = []): boolean {
  const n = name.trim();
  const body = rest.trim();
  if (!n || n.length > 24 || !body) return false;
  if (/^\d+$/.test(n)) return false;
  if (/https?:|www\./i.test(n)) return false;
  if (BLOCKED_SPEAKERS.has(n.toLowerCase())) return false;
  const known = knownSet(knownNames);
  if (known.has(n) || known.has(n.toLowerCase())) return true;
  if (/^["'“”「『]/.test(body)) return true;
  return /^[\p{L}\p{N}·]+$/u.test(n) && n.length <= 12;
}

function prefixedParts(line: string, knownNames: readonly string[]): { speaker: string; text: string } | null {
  const match = line.trim().match(SPEAKER_LINE);
  if (!match) return null;
  const speaker = match[1]!.trim();
  const text = match[2]!.trim();
  if (!isTrpgSpeakerPrefix(speaker, text, knownNames)) return null;
  return { speaker, text };
}

function pushBeat(out: TrpgSpeechBeat[], speaker: string | null, lines: string[]) {
  const text = lines.join("\n").trim();
  if (!text) return;
  out.push({ speaker, text });
}

/**
 * Split GM narration into named dialogue beats.
 * `이름: "대사"` (or `이름：`) on its own line becomes a labeled beat; everything else is 장면.
 */
export function parseTrpgSceneSpeech(narration: string, knownNames: readonly string[] = []): TrpgSpeechBeat[] {
  const text = narration.replace(/\r\n/g, "\n").trim();
  if (!text) return [];
  const out: TrpgSpeechBeat[] = [];
  for (const para of text.split(/\n{2,}/)) {
    const buf: string[] = [];
    let speaker: string | null = null;
    for (const rawLine of para.split("\n")) {
      const prefixed = prefixedParts(rawLine, knownNames);
      if (prefixed) {
        pushBeat(out, speaker, buf);
        buf.length = 0;
        out.push({ speaker: prefixed.speaker, text: prefixed.text });
        speaker = null;
        continue;
      }
      buf.push(rawLine);
    }
    pushBeat(out, speaker, buf);
  }
  return out;
}

import fs from "fs";
import path from "path";

const dumpPath = path.join(process.cwd(), "debug", "prompt_dump.txt");
const raw = fs.readFileSync(dumpPath, "utf8");
const lines = raw.split(/\r?\n/);

const headerEnd = lines.findIndex((l) => l.startsWith("### ["));
const header = lines.slice(0, headerEnd).join("\n").trim();

const histIdx = lines.findIndex((l) => l.startsWith("### HISTORY"));
const dupIdx = lines.findIndex(
  (l) => l === "DUPLICATES DETECTED" || l === "DUPLICATES: none detected"
);
const endIdx = histIdx >= 0 ? histIdx : dupIdx >= 0 ? dupIdx : lines.length;

const sectionBlock = lines.slice(headerEnd, endIdx).join("\n");
const sections = [];
const re = /^### \[([^\]]+)\] (.+) — chars=([\d,]+) tokens≈([\d,]+)$/;
const blockLines = sectionBlock.split(/\r?\n/);

for (let i = 0; i < blockLines.length; ) {
  const m = blockLines[i]?.match(re);
  if (!m) {
    i++;
    continue;
  }
  const [, id, label, chars, tokens] = m;
  i++;
  const textLines = [];
  while (i < blockLines.length) {
    if (blockLines[i]?.startsWith("---")) break;
    if (blockLines[i]?.match(re)) break;
    textLines.push(blockLines[i] ?? "");
    i++;
  }
  while (textLines.length && textLines[textLines.length - 1] === "") textLines.pop();
  sections.push({
    id,
    label,
    chars: Number(chars.replace(/,/g, "")),
    tokens: Number(tokens.replace(/,/g, "")),
    text: textLines.join("\n"),
  });
}

const systemPrompt = sections
  .map((s) => s.text.trim())
  .filter(Boolean)
  .join("\n\n");

const outDir = path.join(process.cwd(), "output");
fs.mkdirSync(outDir, { recursive: true });

const indexLines = sections.map(
  (s) => `  [${s.id}] ${s.label} — ${s.chars.toLocaleString()} chars / ~${s.tokens.toLocaleString()} tok`
);

const outPath = path.join(outDir, "leon-chat39-deepseek-system-prompt.txt");
const totalTok = sections.reduce((n, s) => n + s.tokens, 0);
const out = [
  header,
  "",
  `SECTION INDEX (${sections.length} blocks, assembled order):`,
  ...indexLines,
  "",
  "=".repeat(80),
  "ASSEMBLED SYSTEM PROMPT (exact injection text, sections joined)",
  "=".repeat(80),
  "",
  systemPrompt,
  "",
  "=".repeat(80),
  `Total: ${systemPrompt.length.toLocaleString()} chars · ~${totalTok.toLocaleString()} tok (section sum)`,
  "",
  "Note: user-turn overlays (regenerate anchor, 10b length tail, asset tag) are in HISTORY — not above.",
].join("\n");

fs.writeFileSync(outPath, out, "utf8");
console.log(`Wrote ${outPath}`);
console.log(`Sections: ${sections.length}, chars: ${systemPrompt.length}, ~${totalTok} tok`);

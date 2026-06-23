import Database from "better-sqlite3";
import path from "path";

const db = new Database(path.join(process.cwd(), "data", "app.db"));
const m = db.prepare("SELECT content FROM messages WHERE id=296").get() as { content: string };

const text = m.content;
for (const emoji of ["📅", "❤️", "🔥", "⏳"]) {
  let idx = -1;
  while ((idx = text.indexOf(emoji, idx + 1)) >= 0) {
    console.log(`${emoji} at ${idx}:`, JSON.stringify(text.slice(Math.max(0, idx - 20), idx + 80)));
  }
}

// Simulate extractLegacyStatusLines logic
const tail = text.slice(Math.max(0, text.length - 900));
const emojiStart = tail.search(/(?:📅|❤️|🔥|🛡️|💎|⚠️|📍|⏰)/u);
console.log("\ntail len", tail.length, "emojiStart in tail", emojiStart);
if (emojiStart >= 0) {
  const absStart = text.length - tail.length + emojiStart;
  console.log("absStart", absStart, "body would be", absStart, "chars");
  console.log("at absStart:", JSON.stringify(text.slice(absStart, absStart + 100)));
}

// Check bracket at end
const bracket = /\[([^\]]{4,400})\]\s*$/.exec(text);
console.log("\nbracket match:", bracket ? bracket[0].slice(0, 80) : null);

// Check header pattern
const headerPattern = /\n*[\[(?:Status Window|상태창)[\])][^\n]*\n([\s\S]*)$/iu;
const headerMatch = text.match(headerPattern);
console.log("header match:", headerMatch ? "yes at " + (headerMatch.index ?? "?") : "no");

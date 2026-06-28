import stringHash from "next/dist/compiled/string-hash/index.js";

const target = "2156059128";
const msg = "no such table: bookmarks";

for (let pageLine = 7000; pageLine <= 8000; pageLine++) {
  for (let chunkLine = 600; pageLine <= 800; chunkLine++) {
    const stack =
      `SqliteError: ${msg}\n    at b (/app/.next/server/chunks/4008.js:169:2448)\n    at n (/app/.next/server/chunks/4008.js:207:1084)\n    at p (/app/.next/server/chunks/${chunkLine}.js:638:36)\n    at v (/app/.next/server/chunks/845.js:35:12883)`;
    const d = String(stringHash(msg + stack));
    if (d === target) console.log("MATCH header variant", pageLine, chunkLine, d);
  }
}

for (let pageLine = 7000; pageLine <= 8000; pageLine++) {
  const stack =
    `SqliteError: ${msg}\n    at b (/app/.next/server/chunks/4008.js:169:2448)\n    at n (/app/.next/server/chunks/4008.js:207:1084)\n    at p (/app/.next/server/chunks/4008.js:744:6)\n    at t (/app/.next/server/app/page.js:1:${pageLine})\n    at stringify (<anonymous>)`;
  const d = String(stringHash(msg + stack));
  if (d === target) console.log("MATCH page line", pageLine, d);
}

const msg2 = "no such table: character_memories";
for (let pageLine = 7000; pageLine <= 8000; pageLine++) {
  const stack =
    `SqliteError: ${msg2}\n    at b (/app/.next/server/chunks/4008.js:169:2448)\n    at n (/app/.next/server/chunks/4008.js:207:1084)\n    at p (/app/.next/server/chunks/4008.js:744:6)\n    at t (/app/.next/server/app/page.js:1:${pageLine})\n    at stringify (<anonymous>)`;
  const d = String(stringHash(msg2 + stack));
  if (d === target) console.log("MATCH char_mem page", pageLine, d);
}

console.log("done");

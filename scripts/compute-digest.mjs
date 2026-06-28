import stringHash from "next/dist/compiled/string-hash/index.js";

const target = "2156059128";

function digest(msg, stack) {
  return String(stringHash(msg + stack));
}

const msg = "no such table: bookmarks";
const baseStack =
  "SqliteError: no such table: bookmarks\n    at b (/app/.next/server/chunks/4008.js:169:2448)\n    at n (/app/.next/server/chunks/4008.js:207:1084)\n    at p (/app/.next/server/chunks/4008.js:638:36)\n    at v (/app/.next/server/chunks/845.js:35:12883)";

console.log("header-style stack", digest(msg, baseStack));

const pageStack =
  "SqliteError: no such table: bookmarks\n    at b (/app/.next/server/chunks/4008.js:169:2448)\n    at n (/app/.next/server/chunks/4008.js:207:1084)\n    at p (/app/.next/server/chunks/4008.js:744:6)\n    at t (/app/.next/server/app/page.js:1:7216)\n    at stringify (<anonymous>)";
console.log("page-style stack", digest(msg, pageStack));

// local verified digests
const localPage =
  "SqliteError: no such table: bookmarks\n    at b (E:\\ai chat\\.next\\server\\chunks\\4008.js:169:2448)\n    at n (E:\\ai chat\\.next\\server\\chunks\\4008.js:207:1084)\n    at p (E:\\ai chat\\.next\\server\\chunks\\4008.js:744:6)\n    at t (E:\\ai chat\\.next\\server\\app\\page.js:1:7216)\n    at stringify (<anonymous>)";
console.log("local page verified", digest(msg, localPage), digest(msg, localPage) === "790722063");

for (let line = 7200; line <= 7250; line++) {
  const stack =
    "SqliteError: no such table: bookmarks\n    at b (/app/.next/server/chunks/4008.js:169:2448)\n    at n (/app/.next/server/chunks/4008.js:207:1084)\n    at p (/app/.next/server/chunks/4008.js:744:6)\n    at t (/app/.next/server/app/page.js:1:" +
    line +
    ":16)\n    at stringify (<anonymous>)";
  const d = digest(msg, stack);
  if (d === target) console.log("MATCH page line", line, d);
}

for (const chunk of ["4008", "4012", "4020", "4100", "845", "932"]) {
  const stack =
    "SqliteError: no such table: bookmarks\n    at b (/app/.next/server/chunks/" +
    chunk +
    ".js:169:2448)\n    at n (/app/.next/server/chunks/" +
    chunk +
    ".js:207:1084)\n    at p (/app/.next/server/chunks/" +
    chunk +
    ".js:638:36)\n    at v (/app/.next/server/chunks/845.js:35:12883)";
  const d = digest(msg, stack);
  if (d === target) console.log("MATCH chunk", chunk, d);
}

const msg2 = "no such table: character_memories";
const cmStack =
  "SqliteError: no such table: character_memories\n    at b (/app/.next/server/chunks/4008.js:169:2448)\n    at n (/app/.next/server/chunks/4008.js:207:1084)\n    at p (/app/.next/server/chunks/4008.js:638:36)\n    at v (/app/.next/server/chunks/845.js:35:12883)";
console.log("character_memories header", digest(msg2, cmStack));

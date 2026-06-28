import stringHash from "next/dist/compiled/string-hash/index.js";
import fs from "fs";

const log = fs.readFileSync(
  "C:/Users/ray/.cursor/projects/e-ai-chat/terminals/483777.txt",
  "utf8"
);

const target = "2156059128";

// Extract SqliteError blocks with digest from server log
const re = /SqliteError: ([^\n]+)\n([\s\S]*?)digest: '(\d+)'/g;
let m;
while ((m = re.exec(log)) !== null) {
  const msg = m[1].trim();
  const stackBody = m[2].trim();
  const loggedDigest = m[3];
  const stack = `SqliteError: ${msg}\n${stackBody.split("\n").filter((l) => !l.includes("code:")).join("\n").trim()}`;
  const computed = String(stringHash(msg + stack));
  console.log("logged", loggedDigest, "computed", computed, "match", loggedDigest === computed);
  console.log("msg", msg);
  if (loggedDigest === target) console.log("PROD TARGET STACK:\n", stack);
}

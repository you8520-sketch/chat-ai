/**
 * Re-runs the production 5-turn summary call (real background model) on the B7
 * synthetic turns stored in a snapshot copy (chat 1) and reports who the summary says supported whom (T32: 렌
 * supports 태형). Uses the production formatter and summarizeTurnBatch, so the
 * same probe measures the code before and after a change.
 *
 * Usage (DATA_DIR = a disposable snapshot copy; ledger rows land there):
 *   DATA_DIR=<copy> N=5 IDENTITY=none|char START=31 END=35 \
 *     node --conditions=react-server --import tsx summary-probe.mts
 */
import { callBackgroundMemory } from "@/lib/ai";
import { formatCharacterIdentityForBackground } from "@/lib/characterGender";
import { getDb } from "@/lib/db";
import {
  __formatBatchDialogueForTests,
  __setSummarizeTurnBatchCallerForTests,
  summarizeTurnBatch,
} from "@/lib/memory/memory-rolling-summary";

const CHAR_NAME = "라이크";
const PERSONA_NAME = "렌";
const n = Number(process.env.N ?? 5);
const start = Number(process.env.START ?? 31);
const end = Number(process.env.END ?? 35);
const characterIdentity =
  process.env.IDENTITY === "char" ? formatCharacterIdentityForBackground(CHAR_NAME, "male") : null;

const db = getDb();
const rows = db
  .prepare("SELECT role, content FROM messages WHERE chat_id=1 AND role IN ('user','assistant') ORDER BY id")
  .all() as Array<{ role: "user" | "assistant"; content: string }>;
const turns: Array<{ user: string; assistant: string }> = [];
const firstUser = rows.findIndex((row) => row.role === "user");
for (let i = firstUser; i + 1 < rows.length; i += 2) {
  if (rows[i]!.role !== "user" || rows[i + 1]!.role !== "assistant") throw new Error(`unpaired row at ${i}`);
  turns.push({ user: rows[i]!.content, assistant: rows[i + 1]!.content });
}
const entries = turns.slice(start - 1, end).map((turn, i) => ({ turnIndex: start + i, turn }));
const dialogue = __formatBatchDialogueForTests(entries, CHAR_NAME);

const REVERSED = /렌을\s*(?:\S+\s*){0,2}부축/u;
const CORRECT = /(?:렌(?:이|은|는)[^.]{0,60}부축|(?:태형|라이크|그)(?:을|를)\s*(?:\S+\s*){0,2}부축)/u;

function classify(summary: string): string {
  if (!summary.includes("부축")) return "OMITTED";
  if (REVERSED.test(summary)) return "REVERSED";
  if (CORRECT.test(summary)) return "CORRECT";
  return "UNCLEAR";
}

const ledgerStart = (db.prepare("SELECT COALESCE(MAX(id),0) id FROM api_cost_ledger").get() as { id: number }).id;

__setSummarizeTurnBatchCallerForTests((system, history, turnTrace, requestKind) =>
  callBackgroundMemory(system, history, turnTrace, requestKind)
);

console.log(`--- dialogue label preview (T${start}) ---`);
console.log(dialogue.split("\n").slice(0, 3).join("\n").slice(0, 240));
const tally: Record<string, number> = {};
for (let i = 1; i <= n; i++) {
  const summary = await summarizeTurnBatch({
    dialogue,
    charName: CHAR_NAME,
    characterIdentity,
    startTurn: start,
    endTurn: end,
    sourceTurnIndexes: entries.map((e) => e.turnIndex),
    userPersona: PERSONA_NAME,
  });
  const verdict = classify(summary);
  tally[verdict] = (tally[verdict] ?? 0) + 1;
  const sentence = summary.split(/(?<=[.。])\s+/u).find((s) => s.includes("부축")) ?? "";
  console.log(`#${i} ${verdict} | ${sentence}`);
  console.log(`   full: ${summary}`);
}
__setSummarizeTurnBatchCallerForTests(null);

const cost = db
  .prepare(
    "SELECT COUNT(*) calls, ROUND(COALESCE(SUM(cost_krw),0),3) krw FROM api_cost_ledger WHERE id > ?"
  )
  .get(ledgerStart) as { calls: number; krw: number };
console.log(JSON.stringify({ start, end, identity: process.env.IDENTITY ?? "none", n, tally, ...cost }));

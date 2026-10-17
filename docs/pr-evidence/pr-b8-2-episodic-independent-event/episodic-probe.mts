/**
 * Provider-free Episodic selection probe on a B7 replay snapshot (read-only).
 *
 * Runs the production `getEpisodicMemoryForPrompt` for one question, lexical
 * lanes only (no query embedding: zero provider calls), and prints where each
 * matching event row ends up (CANDIDATE_MISS / RECONCILED_OUT / DROPPED(...) /
 * INJECTED#rank), the final Episodic block, candidate and selection counts,
 * prepared DB statements and runtime. Long-term and relationship memory text
 * come from the B7 memory block so higher-priority dedupe matches the run.
 *
 * Usage:
 *   node --conditions=react-server --import tsx episodic-probe.mts \
 *     <app.db> <question> <event regex> [memory-block.txt]
 */
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import {
  fetchEpisodicMemoryCandidatesForDebug,
  getEpisodicMemoryForPrompt,
} from "@/lib/episodicMemoryFacts";

console.info = () => {};

const [dbPath, question, eventPattern, blockPath] = process.argv.slice(2);
if (!dbPath || !question || !eventPattern) {
  throw new Error("usage: episodic-probe.mts <app.db> <question> <event regex> [memory-block.txt]");
}
const env = {
  MEMORY_FEATURE_ENABLED: "1",
  EPISODIC_MEMORY_RECALL_ENABLED: "1",
  MEMORY_5PLUS4_ENABLED: "true",
} as NodeJS.ProcessEnv;

const block = blockPath ? readFileSync(blockPath, "utf8") : "";
const episodicStart = block.indexOf("[EPISODIC MEMORY");
const longTermMemoryText = block.slice(0, episodicStart < 0 ? undefined : episodicStart).replace("[Memory]\n", "");
const relationshipStart = block.indexOf("[Memory — 참고");
const relationshipMemoryText = relationshipStart >= 0 ? block.slice(relationshipStart) : "";

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
let prepared = 0;
const prepare = db.prepare.bind(db);
db.prepare = ((sql: string) => {
  prepared += 1;
  return prepare(sql);
}) as typeof db.prepare;

const completed = (
  db.prepare("SELECT COUNT(*) n FROM messages WHERE chat_id=1 AND role='assistant' AND user_message_id IS NOT NULL").get() as { n: number }
).n;
const recent = db
  .prepare("SELECT content FROM messages WHERE chat_id=1 AND role IN ('user','assistant') ORDER BY id DESC LIMIT 8")
  .all() as Array<{ content: string }>;
const input = {
  chatId: 1,
  characterId: 18,
  userId: 1,
  currentTurn: completed + 1,
  currentUserMessage: question,
  semanticQuery: null,
  recentChatText: recent.reverse().map((row) => row.content).join("\n"),
  longTermMemoryText,
  relationshipMemoryText,
};

const cands = fetchEpisodicMemoryCandidatesForDebug(db, input, env);
prepared = 0;
const started = performance.now();
const final = getEpisodicMemoryForPrompt(db, input, env);
const firstMs = performance.now() - started;
const preparedPerCall = prepared;
const RUNS = 50;
const loopStart = performance.now();
for (let i = 0; i < RUNS; i++) getEpisodicMemoryForPrompt(db, input, env);
const avgMs = (performance.now() - loopStart) / RUNS;

const eventRe = new RegExp(eventPattern, "u");
const eventRows = (
  db
    .prepare("SELECT id, source_turn, category, subject, attribute, fact_text FROM episodic_memory_facts WHERE chat_id=1 ORDER BY source_turn, id")
    .all() as Array<{ id: number; source_turn: number; category: string; subject: string; attribute: string; fact_text: string }>
).filter((row) => eventRe.test(`${row.attribute} ${row.fact_text}`));

function stage(id: number): string {
  const d = final.debug.find((x) => x.id === id);
  if (final.facts.some((f) => f.id === id)) return `INJECTED#${d?.final_rank}`;
  if (!(cands.laneById.get(id) ?? []).length) return "CANDIDATE_MISS";
  if (!d) return "RECONCILED_OUT";
  return `DROPPED(${d.budget_reason ?? d.duplicate_reason ?? (d.relevance_pass === false ? "no_relevance" : "unranked")})`;
}

console.log(
  JSON.stringify({
    question,
    currentTurn: input.currentTurn,
    candidates: cands.rows.length,
    lanes: cands.stats.laneCounts,
    resolved: final.debug.length,
    ranked: final.debug.filter((d) => d.final_rank != null).length,
    injected: final.facts.length,
    blockChars: final.promptBlock.length,
    preparedStatementsPerCall: preparedPerCall,
    firstCallMs: Number(firstMs.toFixed(2)),
    avgMsOver50: Number(avgMs.toFixed(2)),
  })
);
for (const row of eventRows) {
  console.log(`T${row.source_turn}\t${stage(row.id)}\t${row.category}:${row.subject}:${row.attribute}\t${row.fact_text}`);
}
console.log("-- final Episodic block");
console.log(final.promptBlock);
db.close();

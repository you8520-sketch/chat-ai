/**
 * Read-only Episodic selection probe on a copy of a replay snapshot.
 *
 * Re-runs the production selection (`getEpisodicMemoryForPrompt`) for one
 * evaluated question with the run's own long-term memory text (Global +
 * Medium) and raw history, and prints where the rows of one event end up:
 * CANDIDATE_MISS / RECONCILED_OUT / DROPPED(<budget|duplicate|blocked>) / INJECTED#rank.
 * The semantic query is embedded exactly as the chat route does (one bge-m3
 * embedding call).
 *
 * Usage:
 *   DATA_DIR=<copy of snapshot> node --conditions=react-server --import tsx rank-probe.mts \
 *     <qid> <memory-block.txt> <prompt_dump.txt> <event regex>
 */
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import {
  fetchEpisodicMemoryCandidatesForDebug,
  getEpisodicMemoryForPrompt,
  hasEpisodicSemanticIndexInScope,
} from "../../../src/lib/episodicMemoryFacts";
import { resolveEpisodicSemanticRuntime } from "../../../src/lib/memory/memory-episodic-semantic-config";
import { resolveEpisodicSemanticQuery } from "../../../src/lib/memory/memory-episodic-semantic-jobs";
import { LONG_QUESTIONS, QUESTIONS } from "./scenario.mts";

const [qid, blockPath, dumpPath, eventPattern] = process.argv.slice(2);
const dataDir = process.env.DATA_DIR;
if (!qid || !blockPath || !dumpPath || !eventPattern || !dataDir) {
  throw new Error("usage: DATA_DIR=<dir> rank-probe.mts <qid> <memory-block> <prompt_dump> <event regex>");
}
const eventRe = new RegExp(eventPattern);
const longQ = LONG_QUESTIONS.find((q) => qid.endsWith(`-${q.id}`));
const message = (QUESTIONS.find((q) => q.id === qid) ?? longQ)?.message;
if (!message) throw new Error(`unknown qid ${qid}`);

const block = readFileSync(blockPath, "utf8");
const memoryStart = block.indexOf("[Memory]\n");
const episodicStart = block.indexOf("[EPISODIC MEMORY");
const longTermMemoryText = block.slice(0, episodicStart < 0 ? undefined : episodicStart).replace("[Memory]\n", "");
const relationshipStart = block.indexOf("[Memory — 참고");
const relationshipMemoryText = relationshipStart >= 0 ? block.slice(relationshipStart) : "";

const dump = readFileSync(dumpPath, "utf8");
const recentChatText = [...dump.matchAll(/\[SECTION message-\d+-(?:user|assistant)\] role=(?:user|assistant)(?![^\n]*HIDDEN)[\s\S]*?<<<BEGIN EXACT TEXT>>>\n([\s\S]*?)<<<END EXACT TEXT>>>/g)]
  .map((m) => m[1])
  .filter((t) => !t.startsWith("[CURRENT USER INPUT]"))
  .join("\n");

const db = new Database(`${dataDir}/app.db`, { readonly: true, fileMustExist: true });
const completed = (db.prepare("SELECT COUNT(*) n FROM messages WHERE chat_id=1 AND role='assistant' AND user_message_id IS NOT NULL").get() as { n: number }).n;
const scope = { chatId: 1, characterId: 18, userId: 1, currentTurn: completed + 1 };
const runtime = resolveEpisodicSemanticRuntime();
const semantic = await resolveEpisodicSemanticQuery({
  query: message,
  contentRoute: "safe",
  usableIndex: (model) => hasEpisodicSemanticIndexInScope(db, scope, model),
  runtime,
});
const input = {
  ...scope,
  currentUserMessage: message,
  semanticQuery: semantic.query,
  recentChatText,
  longTermMemoryText,
  relationshipMemoryText,
};
const cands = fetchEpisodicMemoryCandidatesForDebug(db, input);
const final = getEpisodicMemoryForPrompt(db, input);

const eventRows = db
  .prepare("SELECT id, source_turn, category, subject, attribute, value, fact_text, metadata FROM episodic_memory_facts WHERE chat_id=1 ORDER BY source_turn")
  .all()
  .filter((r: any) => eventRe.test(`${r.subject} ${r.attribute} ${r.value} ${r.fact_text} ${r.metadata ?? ""}`)) as any[];

function stage(id: number): string {
  const d = final.debug.find((x) => x.id === id);
  if (final.facts.some((f) => f.id === id)) return `INJECTED#${d?.final_rank}`;
  if (!(cands.laneById.get(id) ?? []).length) return "CANDIDATE_MISS";
  if (!d) return "RECONCILED_OUT";
  return `DROPPED(${d.budget_reason ?? d.duplicate_reason ?? d.blocked_reason ?? "unranked"})`;
}

console.log(JSON.stringify({ qid, currentTurn: scope.currentTurn, semantic_reason: semantic.reason, candidates: cands.rows.length, lanes: cands.stats.laneCounts, injected: final.facts.length }));
for (const r of eventRows) {
  const d = final.debug.find((x) => x.id === r.id);
  console.log(
    `T${r.source_turn}\t${stage(r.id)}\tlanes=${(cands.laneById.get(r.id) ?? []).join("+") || "-"}\tcomposite=${d?.composite_score?.toFixed(3) ?? "-"}\trel=${d?.relevance_score?.toFixed(3) ?? "-"}\tsem=${d?.semantic_similarity?.toFixed(3) ?? "-"}\t${r.category}:${r.subject}:${r.attribute}\t${String(r.fact_text).slice(0, 70)}`
  );
}
console.log("-- injected");
for (const f of final.facts) {
  const d = final.debug.find((x) => x.id === f.id);
  console.log(`#${d?.final_rank}\tT${f.source_turn}\tlanes=${(d?.candidate_lanes ?? []).join("+")}\tcomposite=${d?.composite_score?.toFixed(3)}\trel=${d?.relevance_score?.toFixed(3)}\tsem=${d?.semantic_similarity?.toFixed(3) ?? "-"}\t${String(f.fact_text).slice(0, 70)}`);
}
db.close();

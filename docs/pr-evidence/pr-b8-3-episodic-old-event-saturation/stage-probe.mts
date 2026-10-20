/**
 * Provider-free B8-3 stage probe on a (rebuilt) B7 snapshot, read-only.
 *
 * For one question it separates the Episodic stages for every stored row that matches an
 * event regex: stored row (key, temporal nature as the pipeline sees it, with the stored
 * evidence type attached) -> where each query word matched (content vs verbatim quote only)
 * -> candidate lanes -> state reconciliation (survival in the production resolved set, and
 * the number of state-like candidate keys against the 25-key cap) -> final ranking
 * (relevance, composite, rank, budget reason) -> final Episodic block. It also prints how
 * many in-scope rows contain each query word (and the word weight when the revision has
 * one), and the top ranked rows. Lexical lanes only.
 *
 * Usage:
 *   node --conditions=react-server --import tsx stage-probe.mts \
 *     <app.db> <question> <event regex> [memory-block.txt]
 */
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import {
  buildEpisodicCandidateScope,
  evaluateEpisodicRetrievalGuard,
  fetchEpisodicMemoryCandidatesForDebug,
  getEpisodicMemoryForPrompt,
  inspectLexicalRelevanceForDebug,
  reconcileGlobalStateLikeFacts,
  type EpisodicMemoryFactRecord,
} from "@/lib/episodicMemoryFacts";
import { classifyEpisodicFactTemporalNature } from "@/lib/episodicMemoryTemporal";

console.info = () => {};

const [dbPath, question, eventPattern, blockPath] = process.argv.slice(2);
if (!dbPath || !question || !eventPattern) {
  throw new Error("usage: stage-probe.mts <app.db> <question> <event regex> [memory-block.txt]");
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

function pipelineNature(row: EpisodicMemoryFactRecord) {
  const evidenceType = (JSON.parse(row.metadata || "{}") as { memory_evidence_type?: string }).memory_evidence_type;
  return classifyEpisodicFactTemporalNature(evidenceType ? { ...row, evidence_type: evidenceType } : row);
}

function matchSites(row: EpisodicMemoryFactRecord, tokens: string[]) {
  const content = `${row.subject} ${row.attribute} ${row.value} ${row.fact_text}`.toLowerCase();
  const quote = String((JSON.parse(row.metadata || "{}") as { evidence?: { quote?: string } }).evidence?.quote ?? "").toLowerCase();
  const inContent = tokens.filter((token) => content.includes(token.toLowerCase()));
  const quoteOnly = tokens.filter((token) => !content.includes(token.toLowerCase()) && quote.includes(token.toLowerCase()));
  return `content=[${inContent.join(",")}] quote-only=[${quoteOnly.join(",")}]`;
}

const all = db
  .prepare("SELECT * FROM episodic_memory_facts WHERE chat_id=1 ORDER BY source_turn, id")
  .all() as EpisodicMemoryFactRecord[];
const eventRe = new RegExp(eventPattern, "u");
const targets = all.filter((row) => eventRe.test(`${row.attribute} ${row.fact_text} ${row.metadata}`));

console.log(`== question: ${question}`);
console.log(`currentTurn=${input.currentTurn} storedRows=${all.length}`);

console.log("-- query words: stored rows containing the word (any form)");
const words = inspectLexicalRelevanceForDebug({ subject: "", attribute: "", value: "", fact_text: "" }, question).relevanceLaneTokens;
const cands = fetchEpisodicMemoryCandidatesForDebug(db, input, env);
const lexicon = (cands as unknown as { lexicon?: { words: string[][]; weights: number[] } }).lexicon;
for (const token of words) {
  const df = all.filter((row) => inspectLexicalRelevanceForDebug(row, token).relevanceScore > 0).length;
  const group = lexicon?.words.findIndex((forms) => forms.includes(token)) ?? -1;
  const weight = group >= 0 ? `\tweight=${lexicon!.weights[group]!.toFixed(3)}` : "";
  console.log(`  ${token}\t${df}${weight}`);
}

console.log("-- 1. stored rows");
for (const row of targets) {
  console.log(
    `  #${row.id}\tT${row.source_turn}\t${row.category}:${row.subject}:${row.attribute}\t${pipelineNature(row)}\tguard=${evaluateEpisodicRetrievalGuard(row).allowed ? "allowed" : evaluateEpisodicRetrievalGuard(row).blockedReason}\t${row.fact_text}\n\t\t\tquote: ${(JSON.parse(row.metadata || "{}") as { evidence?: { quote?: string } }).evidence?.quote ?? "-"}\n\t\t\t${matchSites(row, words)}`
  );
}

console.log(`-- 2. candidates: ${cands.rows.length} ${JSON.stringify(cands.stats.laneCounts)}`);
for (const row of targets) {
  const lanes = cands.laneById.get(row.id) ?? [];
  console.log(`  #${row.id}\tT${row.source_turn}\t${lanes.length ? lanes.join("+") : "CANDIDATE_MISS"}\tlex=${inspectLexicalRelevanceForDebug(row, question).relevanceScore}`);
}

const final = getEpisodicMemoryForPrompt(db, input, env);
const stateLikeCandidates = cands.rows.filter(
  (row) => evaluateEpisodicRetrievalGuard(row).allowed && !["historical_event", "clearly_temporary"].includes(pipelineNature(row))
).length;
console.log(
  `-- 3. state reconciliation: ${stateLikeCandidates} state-like allowed candidate rows (key cap ${25}); a row absent from the production resolved set was reconciled out, blocked or deduped`
);
for (const row of targets) {
  if (!cands.laneById.has(row.id)) continue;
  console.log(`  #${row.id}\tT${row.source_turn}\t${pipelineNature(row)}\t${final.debug.some((d) => d.id === row.id) ? "in resolved set" : "NOT_IN_RESOLVED_SET"}`);
}

console.log(`-- 4. final ranking: resolved=${final.debug.length} ranked=${final.debug.filter((d) => d.final_rank != null).length} injected=${final.facts.length}`);
for (const row of targets) {
  const d = final.debug.find((x) => x.id === row.id);
  if (!d) continue;
  const stage = final.facts.some((f) => f.id === row.id)
    ? `INJECTED#${d.final_rank}`
    : `DROPPED(${d.budget_reason ?? d.duplicate_reason ?? (d.relevance_pass === false ? "no_relevance" : "unranked")})`;
  console.log(
    `  #${row.id}\tT${row.source_turn}\t${stage}\trank=${d.final_rank ?? "-"}\trel=${d.relevance_score?.toFixed(3) ?? "-"}\tcomposite=${d.composite_score?.toFixed(3) ?? "-"}`
  );
}
console.log("  top ranked:");
for (const d of final.debug.filter((x) => x.final_rank != null).slice(0, 10)) {
  console.log(
    `  rank=${d.final_rank}\tT${d.source_turn}\trel=${d.relevance_score?.toFixed(3)}\tcomposite=${d.composite_score?.toFixed(3)}\t${d.budget_reason ?? (d.would_inject ? "injected" : "")}\t${d.fact_text}`
  );
}
console.log(`-- 5. final Episodic block (${final.promptBlock.length} chars)`);
console.log(
  final.promptBlock
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .join("\n")
);
db.close();

/**
 * Rebuilds a B7 snapshot provider-free, because the original B7 replay DBs were not kept.
 *
 * Inputs come from the B7 evidence branch (`origin/cursor/b7-real-rp-memory-eval-c504`):
 * - `scenario.mts` + `filler.mts`: the exact scripted user/assistant text of T1..T500
 *   (the replay inserted these verbatim; no Main RP generation was involved);
 * - `audit/stored-T<N>.json`: every stored Episodic row of that snapshot (turn, category,
 *   attribute, importance, fact_text, evidence type/role/authority).
 *
 * The audit export did not keep `subject`, `value` or the evidence quote. Subject comes from
 * the committed B7/B8 probe logs (`known-keys.json`, `category:subject:attribute` per
 * fact_text) and otherwise from the fact's leading name; value is a per-row placeholder
 * (ASCII, so it never matches a Korean query). The quote is the original model quote when a
 * committed final block preserved one for that turn (`known-quotes.json`), otherwise the
 * sentence or utterance of the evidence-role message with the highest character-bigram
 * overlap with fact_text. Each turn's facts are
 * then saved through the production `reconcileEpisodicMemoryFactsForGeneration`, which
 * re-verifies the evidence against the stored message. Zero provider calls.
 *
 * Usage:
 *   node --conditions=react-server --import tsx rebuild-b7-snapshot.mts \
 *     <b7 dir> <N> <known-keys.json> <known-quotes.json> <out app.db>
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import Database from "better-sqlite3";
import { ensureEpisodicMemoryFactsTable, reconcileEpisodicMemoryFactsForGeneration } from "@/lib/episodicMemoryFacts";
import { parseSharedEpisodicSection } from "@/lib/memory/memory-episodic-shared";

console.info = () => {};

const [b7Dir, horizonArg, knownKeysPath, knownQuotesPath, outPath] = process.argv.slice(2);
if (!b7Dir || !horizonArg || !knownKeysPath || !knownQuotesPath || !outPath) {
  throw new Error("usage: rebuild-b7-snapshot.mts <b7 dir> <N> <known-keys.json> <known-quotes.json> <out app.db>");
}
const horizon = Number(horizonArg);
const { TURNS } = (await import(`${b7Dir}/scenario.mts`)) as { TURNS: Array<{ user: string; assistant: string }> };
const { fillerTurn } = (await import(`${b7Dir}/filler.mts`)) as {
  fillerTurn: (turn: number) => { user: string; assistant: string };
};
type AuditRow = {
  id: number;
  source_turn: number;
  category: string;
  attribute: string;
  importance: string;
  fact_text: string;
  evidence_type: string | null;
  evidence_role: "user" | "assistant" | null;
};
const audit = JSON.parse(readFileSync(`${b7Dir}/audit/stored-T${horizon}.json`, "utf8")) as {
  completed_turns: number;
  episodic: AuditRow[];
};
const knownKeys = JSON.parse(readFileSync(knownKeysPath, "utf8")) as Record<string, string>;
const knownQuotes = JSON.parse(readFileSync(knownQuotesPath, "utf8")) as Record<string, string[]>;

const NAME_SUBJECTS: Array<[RegExp, string]> = [
  [/^(?:조?태형)/u, "taehyung"],
  [/^(?:렌|사용자|유저)/u, "user"],
  [/차세린/u, "cha_serin"],
  [/문정자/u, "moon_jeongja"],
  [/서다온/u, "seo_daon"],
  [/유하람/u, "yu_haram"],
  [/남궁현/u, "namgung_hyeon"],
  [/박철/u, "park_cheol"],
  [/염태오/u, "yeom_taeo"],
  [/강민호/u, "kang_minho"],
  [/한서윤|서윤/u, "han_seoyun"],
  [/윤도겸/u, "yoon_dogyeom"],
  [/백무진/u, "baek_mujin"],
  [/오지환/u, "oh_jihwan"],
];

function subjectOf(row: AuditRow): string {
  const known = knownKeys[row.fact_text];
  if (known) return known.split(":")[1]!;
  const head = row.fact_text.slice(0, 14);
  // These rows passed the original save guard, so a scene-narrated 렌 fact was not keyed to the user.
  if (row.evidence_role === "assistant" && /^렌/u.test(head)) return "ren_taehyung";
  for (const [re, subject] of NAME_SUBJECTS) if (re.test(head)) return subject;
  return "scene";
}

function bigrams(text: string): Set<string> {
  const compact = text.replace(/[^가-힣a-z0-9]/giu, "");
  const out = new Set<string>();
  for (let i = 0; i + 1 < compact.length; i++) out.add(compact.slice(i, i + 2));
  return out;
}

function spansOf(message: string): string[] {
  const spans = new Set<string>();
  for (const sentence of message.split(/(?<=[.!?…"])\s+/u)) {
    const trimmed = sentence.trim().replace(/^"|"$/gu, "").trim();
    if (trimmed) spans.add(trimmed);
  }
  for (const m of message.matchAll(/"([^"]{4,})"/gu)) spans.add(m[1]!.trim());
  return [...spans];
}

const ORIGINAL_QUOTE_BONUS = 1.5;

function quoteFor(row: AuditRow, message: string): string {
  const target = bigrams(row.fact_text);
  const original = (knownQuotes[String(row.source_turn)] ?? []).filter((quote) => message.includes(quote));
  let best = "";
  let bestScore = -1;
  for (const span of [...original, ...spansOf(message)]) {
    const grams = bigrams(span);
    let overlap = 0;
    for (const g of grams) if (target.has(g)) overlap += 1;
    const dice = (2 * overlap) / (grams.size + target.size || 1);
    const score = original.includes(span) ? dice * ORIGINAL_QUOTE_BONUS : dice;
    if (score > bestScore) {
      best = span;
      bestScore = score;
    }
  }
  return best;
}

if (existsSync(outPath)) rmSync(outPath);
const db = new Database(outPath);
ensureEpisodicMemoryFactsTable(db);
db.exec(
  "CREATE TABLE chat_memories (chat_id INTEGER PRIMARY KEY, memory_reset_after_message_id INTEGER, memory_epoch INTEGER NOT NULL DEFAULT 0)"
);
db.prepare("INSERT INTO chat_memories (chat_id) VALUES (1)").run();
db.exec(
  "CREATE TABLE messages (id INTEGER PRIMARY KEY, chat_id INTEGER, role TEXT, content TEXT, generation_status TEXT, model TEXT, user_message_id INTEGER, usage TEXT)"
);
const insertMessage = db.prepare(
  "INSERT INTO messages (id, chat_id, role, content, generation_status, model, user_message_id) VALUES (?, 1, ?, ?, 'completed', 'synthetic-replay', ?)"
);
insertMessage.run(1, "assistant", "(greeting)", null);

const byTurn = new Map<number, AuditRow[]>();
for (const row of audit.episodic) byTurn.set(row.source_turn, [...(byTurn.get(row.source_turn) ?? []), row]);

let attempted = 0;
let parseDropped = 0;
// The audit counted one extra completed turn on the T50/T80/T90 copies; the probed snapshots held exactly N.
const completedTurns = Math.min(horizon, audit.completed_turns);
for (let turn = 1; turn <= completedTurns; turn++) {
  const spec = turn <= TURNS.length ? TURNS[turn - 1]! : fillerTurn(turn);
  const userId = turn * 2;
  const assistantId = turn * 2 + 1;
  insertMessage.run(userId, "user", spec.user, null);
  insertMessage.run(assistantId, "assistant", spec.assistant, userId);
  const rows = byTurn.get(turn) ?? [];
  if (rows.length === 0) continue;
  attempted += rows.length;
  const parsed = parseSharedEpisodicSection(
    {
      extracted_facts: rows.map((row) => {
        const role = row.evidence_role ?? "assistant";
        return {
          category: row.category,
          subject: subjectOf(row),
          attribute: row.attribute,
          value: `b7_${row.id}`,
          importance: row.importance,
          fact_text: row.fact_text,
          evidence_type: row.evidence_type ?? "explicit_scene_event",
          evidence: { source_role: role, source_quote: quoteFor(row, role === "user" ? spec.user : spec.assistant) },
          corrects: "",
        };
      }),
    },
    []
  );
  if (parsed.facts.length !== rows.length) parseDropped += rows.length - parsed.facts.length;
  reconcileEpisodicMemoryFactsForGeneration(db, {
    chatId: 1,
    characterId: 18,
    userId: 1,
    sourceTurn: turn,
    sourceUserMessageId: userId,
    sourceUserText: spec.user,
    userPersona: "이름/호칭: 렌",
    evidenceBinding: { userMessageId: userId, assistantMessageId: assistantId },
    metadata: { extraction: "shared_initial_per_turn", assistant_message_id: assistantId, content_route: "safe" },
    facts: parsed.facts,
    isRegeneration: false,
  });
}

const stored = (db.prepare("SELECT COUNT(*) n FROM episodic_memory_facts").get() as { n: number }).n;
const unknownSubjects = audit.episodic.filter((row) => !knownKeys[row.fact_text]).length;
console.log(
  JSON.stringify({ horizon, completedTurns, auditRows: audit.episodic.length, attempted, parseDropped, stored, unknownSubjects })
);
db.close();

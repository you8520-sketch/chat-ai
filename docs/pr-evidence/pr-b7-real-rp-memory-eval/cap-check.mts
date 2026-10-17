// Usage: DATA_DIR=<snapshot copy> TURN=<completed+1> node --conditions=react-server --import tsx cap-check.mts
import Database from "better-sqlite3";
import {
  buildEpisodicCandidateScope,
  evaluateEpisodicRetrievalGuard,
  fetchEpisodicMemoryCandidatesForDebug,
  reconcileGlobalStateLikeFacts,
} from "../../../src/lib/episodicMemoryFacts";
import { LONG_QUESTIONS } from "./scenario.mts";

const db = new Database(`${process.env.DATA_DIR}/app.db`, { readonly: true });
const message = LONG_QUESTIONS.find((q) => q.id === "B3-seoyun")!.message;
const input = { chatId: 1, characterId: 18, userId: 1, currentTurn: Number(process.env.TURN), currentUserMessage: message };
const cands = fetchEpisodicMemoryCandidatesForDebug(db, input);
const scope = buildEpisodicCandidateScope(db, input, process.env)!;
const allowed = cands.rows.filter((r) => evaluateEpisodicRetrievalGuard(r).allowed);
const target = allowed.filter((r) => r.source_turn === 57 || r.source_turn === 64).map((r) => r.id);
for (const [label, prefer] of [
  ["prefer=all", new Set(allowed.map((r) => r.id))],
  ["prefer=seoyun-only", new Set(target)],
] as const) {
  const out = reconcileGlobalStateLikeFacts(db, scope, allowed, { preferRowIds: prefer });
  console.log(label, JSON.stringify({ allowed: allowed.length, target, kept: target.filter((id) => out.rows.some((r) => r.id === id)), stats: out.stats }));
}

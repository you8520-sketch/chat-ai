// Read-only dump of what the isolated B7 chat stored at one snapshot:
// Episodic facts (with evidence authority), 5-turn summaries, Global row,
// relationship ledger, plus a per-event presence map.
// Usage: node audit-memory.cjs <snapshot_dir> <out.json>
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const [snap, out] = process.argv.slice(2);
const db = new Database(path.join(snap, "app.db"), { readonly: true, fileMustExist: true });
db.pragma("query_only = 1");

const EVENT_KEYS = {
  E1_clue_stone: ["G-117", "균열석"],
  E2_npc_betrayal: ["서윤", "근신"],
  E3_relationship_break_and_repair: ["배정받은 가이드", "옥상", "페어 승인", "페어 신청"],
  E4_loss_and_comfort: ["지환"],
  E5_npc_help: ["민호", "재보정", "측정기 오차"],
  E6_injury_treatment_recovery: ["옆구리", "봉합", "완치"],
  E7_promise_cancelled: ["야시장", "탕후루"],
  E8_repeated_strawberry_milk: ["딸기우유"],
};

const completedTurns = db
  .prepare(
    "SELECT COUNT(*) n FROM messages WHERE chat_id=1 AND role='assistant' AND generation_status='completed' AND user_message_id IS NOT NULL"
  )
  .get().n;

const episodic = db
  .prepare(
    `SELECT id, source_turn, category, subject, attribute, value, importance, fact_text, metadata
     FROM episodic_memory_facts WHERE chat_id=1 ORDER BY source_turn, id`
  )
  .all()
  .map((r) => {
    const meta = JSON.parse(r.metadata || "{}");
    return {
      id: r.id,
      source_turn: r.source_turn,
      category: r.category,
      attribute: r.attribute,
      importance: r.importance,
      fact_text: r.fact_text,
      evidence_type: meta.memory_evidence_type ?? null,
      authority: meta.evidence?.authority ?? null,
      evidence_role: meta.evidence?.role ?? null,
      evidence_match: meta.evidence?.match ?? null,
    };
  });

const summaries = db
  .prepare(
    `SELECT turn_number, turn_end, summary_kind, length(summary) chars, summary
     FROM chat_turn_summaries WHERE chat_id=1 AND COALESCE(inactive,0)=0 ORDER BY turn_number`
  )
  .all();

const memoryRow = db
  .prepare(
    `SELECT recent_summary, archive_summary, summarized_turn_count, global_projection_kind,
            global_covered_through_turn FROM chat_memories WHERE chat_id=1`
  )
  .get();
const chat = db.prepare("SELECT memory_meta FROM chats WHERE id=1").get();

const events = {};
for (const [id, keys] of Object.entries(EVENT_KEYS)) {
  const hit = (text) => keys.filter((k) => text.includes(k));
  events[id] = {
    keys,
    episodic: episodic
      .filter((r) => hit(r.fact_text).length)
      .map((r) => ({ id: r.id, source_turn: r.source_turn, attribute: r.attribute, authority: r.authority, fact_text: r.fact_text })),
    summary_blocks: summaries.filter((s) => hit(s.summary).length).map((s) => `T${s.turn_number}-${s.turn_end}`),
    global_text_hits: hit(memoryRow?.recent_summary ?? ""),
    relationship_ledger_hits: hit(chat?.memory_meta ?? ""),
  };
}

const report = {
  snapshot: snap,
  completed_turns: completedTurns,
  counts: { episodic: episodic.length, summaries: summaries.length },
  global: {
    projection_kind: memoryRow?.global_projection_kind ?? null,
    covered_through_turn: memoryRow?.global_covered_through_turn ?? null,
    summarized_turn_count: memoryRow?.summarized_turn_count ?? null,
    recent_summary_chars: memoryRow?.recent_summary?.length ?? 0,
    recent_summary: memoryRow?.recent_summary ?? "",
    archive_summary: memoryRow?.archive_summary ?? "",
  },
  relationship_ledger: JSON.parse(chat?.memory_meta || "{}"),
  events,
  episodic,
  summaries,
};
fs.writeFileSync(out, JSON.stringify(report, null, 1));
console.log(
  JSON.stringify({
    snap,
    completed_turns: completedTurns,
    episodic: episodic.length,
    summaries: summaries.length,
    global_kind: report.global.projection_kind,
    global_chars: report.global.recent_summary_chars,
    events: Object.fromEntries(
      Object.entries(events).map(([k, v]) => [k, { ep: v.episodic.length, blocks: v.summary_blocks.length, global: v.global_text_hits.length > 0 }])
    ),
  })
);

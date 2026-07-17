import assert from "node:assert/strict";
import { describe, it, after } from "node:test";
import { getDb } from "@/lib/db";
import { loadPreviousStatusWidgetValues } from "./loadPrevious";

describe("loadPreviousStatusWidgetValues canonical filter", () => {
  const chatId = 9_100_017;
  const inserted: number[] = [];

  after(() => {
    const db = getDb();
    for (const id of inserted) {
      db.prepare("DELETE FROM messages WHERE id=?").run(id);
    }
  });

  it("uses latest completed values and skips failed/generating/interrupted", () => {
    const db = getDb();
    const insert = (
      status: string,
      values: Record<string, string>,
      content: string
    ) => {
      const r = db
        .prepare(
          `INSERT INTO messages (chat_id, role, content, model, generation_status, status_widget_values_json)
           VALUES (?, 'assistant', ?, '', ?, ?)`
        )
        .run(
          chatId,
          content,
          status,
          JSON.stringify({ character: values })
        );
      inserted.push(Number(r.lastInsertRowid));
    };

    insert("failed", { 날짜: "1월 1일", 현재시각: "00:00" }, "failed");
    insert("generating", { 날짜: "2월 2일", 현재시각: "02:00" }, "generating");
    insert(
      "completed",
      { 날짜: "3월 18일", 현재시각: "14:30", 장소: "복도" },
      "completed"
    );
    insert("interrupted", { 날짜: "12월 31일", 현재시각: "23:59" }, "interrupted");

    const prev = loadPreviousStatusWidgetValues(chatId);
    assert.ok(prev?.character);
    assert.equal(prev!.character!["날짜"], "3월 18일");
    assert.equal(prev!.character!["현재시각"], "14:30");
    assert.notEqual(prev!.character!["날짜"], "12월 31일");
    assert.notEqual(prev!.character!["날짜"], "2월 2일");
  });
});

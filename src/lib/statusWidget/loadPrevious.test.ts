import assert from "node:assert/strict";
import { describe, it, after } from "node:test";
import { getDb } from "@/lib/db";
import {
  loadPreviousStatusWidgetValues,
  loadPreviousStatusWidgetValuesDetailed,
} from "./loadPrevious";
import type { StatusWidget } from "./types";

const temporalWidget: StatusWidget = {
  version: 1,
  name: "c",
  placement: "bottom",
  htmlTemplate: "{{장소}}{{현재시각}}{{날짜}}{{속마음}}",
  fields: [
    { id: "장소", label: "장소", instruction: "장소" },
    { id: "현재시각", label: "현재시각", instruction: "HH:MM" },
    { id: "날짜", label: "날짜", instruction: "날짜" },
    { id: "속마음", label: "속마음", instruction: "내면" },
  ],
};

describe("loadPreviousStatusWidgetValues canonical filter", () => {
  const inserted: number[] = [];
  let chatSeq = 9_100_200;

  after(() => {
    const db = getDb();
    for (const id of inserted) {
      db.prepare("DELETE FROM messages WHERE id=?").run(id);
    }
  });

  const insert = (
    chatId: number,
    status: string,
    values: Record<string, string>,
    content: string
  ) => {
    const db = getDb();
    const r = db
      .prepare(
        `INSERT INTO messages (chat_id, role, content, model, generation_status, status_widget_values_json)
         VALUES (?, 'assistant', ?, '', ?, ?)`
      )
      .run(chatId, content, status, JSON.stringify({ character: values }));
    const id = Number(r.lastInsertRowid);
    inserted.push(id);
    return id;
  };

  it("uses latest completed values and skips failed/generating/interrupted", () => {
    const chatId = ++chatSeq;
    insert(chatId, "failed", { 날짜: "1월 1일", 현재시각: "00:00" }, "failed");
    insert(chatId, "generating", { 날짜: "2월 2일", 현재시각: "02:00" }, "generating");
    insert(
      chatId,
      "completed",
      { 날짜: "3월 18일", 현재시각: "14:30", 장소: "복도" },
      "completed"
    );
    insert(chatId, "interrupted", { 날짜: "12월 31일", 현재시각: "23:59" }, "interrupted");

    const prev = loadPreviousStatusWidgetValues(chatId);
    assert.ok(prev?.character);
    assert.equal(prev!.character!["날짜"], "3월 18일");
    assert.equal(prev!.character!["현재시각"], "14:30");
    assert.notEqual(prev!.character!["날짜"], "12월 31일");
    assert.notEqual(prev!.character!["날짜"], "2월 2일");
  });

  it("excludes regenerate target id and uses prior finalized turn", () => {
    const chatId = ++chatSeq;
    const older = insert(
      chatId,
      "completed",
      { 날짜: "3월 18일", 현재시각: "14:30", 장소: "복도" },
      "older"
    );
    const regenTarget = insert(
      chatId,
      "completed",
      { 날짜: "3월 19일", 현재시각: "16:00", 장소: "사령실" },
      "regen-target"
    );

    const detailed = loadPreviousStatusWidgetValuesDetailed(chatId, {
      excludeMessageId: regenTarget,
      characterWidget: temporalWidget,
    });
    assert.equal(detailed.anchorMessageId, older);
    assert.equal(detailed.values?.character?.["현재시각"], "14:30");
    assert.notEqual(detailed.values?.character?.["현재시각"], "16:00");
  });

  it("does not use current regeneration generation as anchor", () => {
    const chatId = ++chatSeq;
    const prior = insert(
      chatId,
      "completed",
      { 날짜: "3월 18일", 현재시각: "10:00", 장소: "마당" },
      "prior"
    );
    const currentGen = insert(
      chatId,
      "completed",
      { 날짜: "알 수 없음", 현재시각: "알 수 없음", 장소: "마당" },
      "current-gen"
    );

    const detailed = loadPreviousStatusWidgetValuesDetailed(chatId, {
      excludeMessageId: currentGen,
      characterWidget: temporalWidget,
    });
    assert.equal(detailed.anchorMessageId, prior);
    assert.equal(detailed.values?.character?.["현재시각"], "10:00");
  });

  it("1. does not mix date from latest row with clock from older row", () => {
    const chatId = ++chatSeq;
    insert(
      chatId,
      "completed",
      { 날짜: "3월 18일", 현재시각: "18:30", 장소: "성벽", 속마음: "침착하다" },
      "older-concrete"
    );
    const primary = insert(
      chatId,
      "completed",
      {
        날짜: "3월 19일",
        현재시각: "알 수 없음",
        장소: "사령실",
        속마음: "불안하다",
      },
      "latest-partial-unknown-clock"
    );

    const detailed = loadPreviousStatusWidgetValuesDetailed(chatId, {
      characterWidget: temporalWidget,
    });
    assert.equal(detailed.anchorMessageId, primary);
    assert.equal(detailed.values?.character?.["날짜"], "3월 19일");
    assert.equal(detailed.values?.character?.["장소"], "사령실");
    assert.equal(detailed.values?.character?.["속마음"], "불안하다");
    // Missing clock — must NOT borrow 18:30 from the older row.
    assert.equal(detailed.values?.character?.["현재시각"], undefined);
    assert.ok(detailed.skippedTemporalKeys.includes("현재시각"));
  });
});

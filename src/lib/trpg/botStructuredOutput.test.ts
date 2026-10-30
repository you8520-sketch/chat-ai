import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TRPG_ACTION_TYPES } from "./actionTypes";
import { BOT_EXPLORATION_NO_MOVE } from "./explorationMap";
import {
  buildTrpgBotResponseFormat,
  formatTrpgBotStructuredAsBody,
  parseTrpgBotStructuredAction,
} from "./botStructuredOutput";

describe("botStructuredOutput", () => {
  it("reuses the GM json_schema contract with a per-turn movePlan enum", () => {
    const format = buildTrpgBotResponseFormat([BOT_EXPLORATION_NO_MOVE, "table", "table>counter"]);
    assert.equal(format.type, "json_schema");
    assert.equal(format.json_schema.name, "trpg_bot_action");
    assert.equal(format.json_schema.strict, true);
    assert.deepEqual(format.json_schema.schema.required, ["prose", "actionType", "intent", "movePlan"]);
    assert.deepEqual(format.json_schema.schema.properties.actionType.enum, [...TRPG_ACTION_TYPES]);
    assert.deepEqual(format.json_schema.schema.properties.movePlan.enum, [
      BOT_EXPLORATION_NO_MOVE,
      "table",
      "table>counter",
    ]);
  });

  it("parses structured Bot JSON and ignores marker-shaped prose", () => {
    const raw = JSON.stringify({
      prose: '테이블로 다가선다.\n\n"먼저 앉자."',
      actionType: "free",
      intent: "중앙 테이블로 이동한다.",
      movePlan: "table",
    });
    const parsed = parseTrpgBotStructuredAction(raw);
    assert.ok(parsed);
    assert.equal(parsed.movePlan, "table");
    assert.match(formatTrpgBotStructuredAsBody(parsed), /먼저 앉자/);
    assert.equal(parseTrpgBotStructuredAction("출입문으로 이동한다."), null);
  });
});

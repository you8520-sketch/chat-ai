import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickStatForAction } from "./actionTypes";
import { parseTrpgBotAction, sanitizeBotActionText, TRPG_BOT_ACTION_TYPE_OPEN } from "./botActionParse";
import { TRPG_BOT_SYSTEM } from "./botActions";
import { DEFAULT_TRPG_STAT_DEFS } from "./stats";

describe("TRPG M1 AI action type ownership", () => {
  it("parses ACTION_TYPE + INTENT and never leaks the marker into prose", () => {
    const parsed = parseTrpgBotAction(
      `권태현은 마체테를 고쳐 쥐고 앞으로 나섰다.\n\n<<<ACTION_TYPE>>>\nattack\n<<<INTENT>>>\n권태현은 형체의 옆구리를 베려 했다.`
    );
    assert.equal(parsed.actionType, "attack");
    assert.match(parsed.intent, /베려 했다/);
    assert.doesNotMatch(parsed.prose, /ACTION_TYPE|INTENT/);
    assert.match(parsed.prose, /마체테/);
  });

  it("AI fixtures map to expected types and combat-relevant stats", () => {
    const attack = parseTrpgBotAction(`마체테를 휘두른다.\n<<<ACTION_TYPE>>>\nattack\n<<<INTENT>>>\n권태현은 형체를 베려 했다.`);
    assert.equal(attack.actionType, "attack");
    assert.equal(
      pickStatForAction({ actionType: attack.actionType, selectedStat: null, body: attack.intent, defs: DEFAULT_TRPG_STAT_DEFS }),
      "str"
    );

    const defend = parseTrpgBotAction(`렌 앞을 가로막는다.\n<<<ACTION_TYPE>>>\ndefend\n<<<INTENT>>>\n권태현은 렌 앞을 가로막으며 출입구 형체의 진입을 막으려 했다.`);
    assert.equal(defend.actionType, "defend");

    const investigate = parseTrpgBotAction(`형체의 움직임을 관찰한다.\n<<<ACTION_TYPE>>>\ninvestigate\n<<<INTENT>>>\n솔은 형체의 행동 패턴을 살피려 했다.`);
    assert.equal(investigate.actionType, "investigate");

    const banter = parseTrpgBotAction(`짧게 숨을 고르며 자리를 옮긴다.\n<<<ACTION_TYPE>>>\nfree\n<<<INTENT>>>\n솔은 렌 옆으로 자리를 옮기려 했다.`);
    assert.equal(banter.actionType, "free");
  });

  it("invalid or missing metadata falls back to free", () => {
    assert.equal(parseTrpgBotAction("그냥 앞으로 간다.").actionType, "free");
    assert.equal(parseTrpgBotAction("앞으로 간다.\n<<<ACTION_TYPE>>>\nexplode").actionType, "free");
  });

  it("sanitize keeps metadata off the visible prose reconstruction head", () => {
    const raw = `첫째 문장이다.\n\n<<<ACTION_TYPE>>>\ndefend\n<<<INTENT>>>\n막으려 했다.`;
    const sanitized = sanitizeBotActionText(raw);
    assert.match(sanitized, /<<<ACTION_TYPE>>>/);
    assert.equal(parseTrpgBotAction(sanitized).prose.includes(TRPG_BOT_ACTION_TYPE_OPEN), false);
  });

  it("bot prompt owns compact classification and pending outcomes", () => {
    assert.match(TRPG_BOT_SYSTEM, /<<<ACTION_TYPE>>>/);
    assert.match(TRPG_BOT_SYSTEM, /ordinary movement, posture, conversation, preparation/);
    assert.match(TRPG_BOT_SYSTEM, /mechanical outcomes remain open until round resolution/);
    assert.match(TRPG_BOT_SYSTEM, /keep that dependency conditional until GM resolution/);
  });
});

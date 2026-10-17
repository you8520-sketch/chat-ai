import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type Database from "better-sqlite3";

import {
  deleteEpisodicMemoryFactsByAssistantMessageIds,
  fetchEpisodicMemoryCandidatesForDebug,
  getEpisodicMemoryForPrompt,
} from "@/lib/episodicMemoryFacts";
import { openDb } from "@/lib/memory/memory-rp-benchmark-suite";

const env = {
  NODE_ENV: "development",
  MEMORY_FEATURE_ENABLED: "1",
  EPISODIC_MEMORY_RECALL_ENABLED: "1",
} as NodeJS.ProcessEnv;

type RowSpec = {
  turn: number;
  subject?: string;
  attribute: string;
  value: string;
  importance?: string;
  gloss: string;
  quote?: string;
  messageId?: number;
  authority?: "CURRENT_SCENE" | "USER_EXPLICIT" | "CHARACTER_CLAIM";
  chatId?: number;
};

function insert(db: Database.Database, spec: RowSpec): number {
  const messageId = spec.messageId ?? spec.turn * 10 + 2;
  const metadata = {
    memory_evidence_type: "explicit_scene_event",
    content_route: "safe",
    assistant_message_id: messageId,
    ...(spec.quote
      ? {
          evidence: {
            role: "assistant",
            message_id: messageId,
            quote: spec.quote,
            authority: spec.authority ?? "CURRENT_SCENE",
            match: "normalized_exact",
          },
        }
      : {}),
  };
  return Number(
    db
      .prepare(
        `INSERT INTO episodic_memory_facts
          (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
         VALUES (?, ?, 'character', ?, ?, ?, ?, ?, ?)`
      )
      .run(
        spec.chatId ?? 1,
        spec.turn,
        spec.subject ?? "enoch",
        spec.attribute,
        spec.value,
        spec.importance ?? "important",
        spec.gloss,
        JSON.stringify(metadata)
      ).lastInsertRowid
  );
}

const FILLER = [
  "에녹은 새벽에 검을 손질하며 말없이 앉아 있었다.",
  "에녹은 여관 마당에서 장작을 패 주었다.",
  "에녹이 지도 위의 남쪽 길을 손가락으로 짚었다.",
  "에녹은 유저에게 따뜻한 차를 건넸다.",
];

function fillTurns(db: Database.Database, from: number, to: number): void {
  for (let turn = from; turn < to; turn++) {
    insert(db, {
      turn,
      subject: "bg",
      attribute: "scene_event",
      value: `f${turn}`,
      importance: turn % 9 === 0 ? "important" : "normal",
      gloss: FILLER[turn % FILLER.length]!,
    });
  }
}

const BITE_QUOTE = "늑대가 에녹의 왼팔을 깊이 물어뜯었다.";
const RECOVERY_QUOTE = "치료를 마친 에녹의 왼팔은 완전히 회복되었다.";

/** The extractor may file the same occurrence under a state-style attribute such as `injury`. */
function seedInjuryHistory(horizon: number, attribute = "injury") {
  const db = openDb();
  fillTurns(db, 1, 30);
  const t30 = insert(db, {
    turn: 30,
    attribute,
    value: "left_arm_bitten",
    gloss: "에녹은 늑대에게 물려 왼팔을 크게 다쳤다.",
    quote: BITE_QUOTE,
  });
  fillTurns(db, 31, 80);
  const t80 = insert(db, {
    turn: 80,
    attribute,
    value: "left_arm_recovered",
    gloss: "에녹의 왼팔 부상은 치료 후 회복했다.",
    quote: RECOVERY_QUOTE,
  });
  fillTurns(db, 81, horizon);
  return { db, t30, t80 };
}

function recall(db: Database.Database, turn: number, query: string, chatId = 1) {
  return getEpisodicMemoryForPrompt(db, { chatId, currentTurn: turn, currentUserMessage: query }, env);
}

function lineIndex(block: string, quote: string): number {
  return block.split("\n").findIndex((line) => line.includes(quote));
}

describe("B6-1 — completed past occurrence survives its state-style key", () => {
  for (const horizon of [200, 500, 1000]) {
    describe(`currentTurn=${horizon}`, () => {
      it("current state: the recovery leads, so the old injury is not read as current", () => {
        const { db, t30, t80 } = seedInjuryHistory(horizon);
        const result = recall(db, horizon, "에녹 왼팔은 지금 괜찮아?");
        assert.equal(result.debug.find((d) => d.id === t80)?.final_rank, 1);
        const recovered = lineIndex(result.promptBlock, RECOVERY_QUOTE);
        const bitten = lineIndex(result.promptBlock, BITE_QUOTE);
        assert.ok(recovered >= 0);
        assert.ok(bitten < 0 || recovered < bitten, "recovery must precede the bite line");
        assert.ok(result.facts.some((fact) => fact.id === t80));
        assert.ok(t30 > 0);
      });

      it("why was it hurt: the T30 source quote reaches the block, without invented cause", () => {
        const { db, t30 } = seedInjuryHistory(horizon);
        const result = recall(db, horizon, "예전에 에녹 왼팔은 왜 다쳤었지?");
        assert.ok(result.facts.some((fact) => fact.id === t30));
        assert.match(result.promptBlock, new RegExp(BITE_QUOTE));
        assert.match(result.promptBlock, /\[T30\]/);
        assert.doesNotMatch(result.promptBlock, /함정|사냥|전투/);
      });

      it("when and how recovered: the T80 treatment/recovery source, via a conjugated question", () => {
        const { db, t80 } = seedInjuryHistory(horizon);
        const result = recall(db, horizon, "언제 어떻게 회복했어?");
        assert.deepEqual(
          result.facts.map((fact) => fact.id),
          [t80]
        );
        assert.match(result.promptBlock, /\[T80\]/);
        assert.match(result.promptBlock, new RegExp(RECOVERY_QUOTE));
      });

      it("still injured?: T80 comes first; the T30 line is only ever past history after it", () => {
        const { db, t80 } = seedInjuryHistory(horizon);
        const result = recall(db, horizon, "아직도 왼팔이 다친 상태야?");
        assert.equal(result.debug.find((d) => d.id === t80)?.final_rank, 1);
        const recovered = lineIndex(result.promptBlock, RECOVERY_QUOTE);
        const bitten = lineIndex(result.promptBlock, BITE_QUOTE);
        assert.ok(recovered >= 0);
        assert.ok(bitten < 0 || recovered < bitten);
      });

      it("an action-shaped extraction behaves the same as the state-shaped one", () => {
        const state = seedInjuryHistory(horizon, "injury");
        const action = seedInjuryHistory(horizon, "action");
        const query = "예전에 에녹 왼팔은 왜 다쳤었지?";
        const turns = (db: Database.Database) =>
          recall(db, horizon, query).facts.map((fact) => fact.source_turn).sort((a, b) => a - b);
        assert.deepEqual(turns(state.db).filter((t) => t === 30 || t === 80), [30, 80]);
        assert.deepEqual(turns(action.db).filter((t) => t === 30 || t === 80), [30, 80]);
      });
    });
  }

  it("before the recovery (T40) the injury is still the current state", () => {
    const { db, t30, t80 } = seedInjuryHistory(1000);
    const result = recall(db, 40, "에녹 왼팔은 지금 괜찮아?");
    assert.ok(result.facts.some((fact) => fact.id === t30));
    assert.equal(result.facts.some((fact) => fact.id === t80), false);
  });

  it("a second, independent injury keeps both the first history and the new state", () => {
    const { db, t30, t80 } = seedInjuryHistory(1000);
    const t150 = insert(db, {
      turn: 150,
      attribute: "injury",
      value: "right_leg_broken",
      gloss: "에녹은 오른다리가 부러져 절뚝였다.",
      quote: "에녹의 오른다리가 부러져 절뚝였다.",
    });
    const arm = recall(db, 1000, "예전에 에녹 왼팔은 왜 다쳤었지?");
    assert.ok(arm.facts.some((fact) => fact.id === t30));
    assert.ok(arm.facts.some((fact) => fact.id === t80));
    const leg = recall(db, 1000, "에녹 오른다리는 지금 어때?");
    assert.ok(leg.facts.some((fact) => fact.id === t150));
  });

  it("a state replaced by a later state (no completed row) still keeps latest-wins", () => {
    const db = openDb();
    fillTurns(db, 1, 200);
    const old = insert(db, {
      turn: 30,
      attribute: "location",
      value: "cafe",
      gloss: "에녹은 카페 안쪽 자리에 앉아 있다.",
      quote: "에녹이 카페 안쪽 자리에 앉았다.",
    });
    const latest = insert(db, {
      turn: 120,
      attribute: "location",
      value: "library",
      gloss: "에녹은 도서관 열람실에 앉아 있다.",
      quote: "에녹이 도서관 열람실에 앉았다.",
    });
    const result = recall(db, 200, "에녹은 지금 어디 앉아 있어?");
    assert.equal(result.facts.some((fact) => fact.id === old), false);
    assert.equal(result.facts.some((fact) => fact.id === latest), true);
  });

  it("legacy rows without a verified source stay latest-wins (nothing proves the occurrence)", () => {
    const db = openDb();
    fillTurns(db, 1, 30);
    const t30 = insert(db, {
      turn: 30,
      attribute: "injury",
      value: "left_arm_bitten",
      gloss: "에녹은 늑대에게 물려 왼팔을 크게 다쳤다.",
    });
    fillTurns(db, 31, 80);
    const t80 = insert(db, {
      turn: 80,
      attribute: "injury",
      value: "left_arm_recovered",
      gloss: "에녹의 왼팔 부상은 치료 후 회복했다.",
      quote: RECOVERY_QUOTE,
    });
    fillTurns(db, 81, 500);
    const result = recall(db, 500, "예전에 에녹 왼팔은 왜 다쳤었지?");
    assert.equal(result.facts.some((fact) => fact.id === t30), false);
    assert.equal(result.facts.some((fact) => fact.id === t80), true);
  });

  it("a character's unconfirmed claim is not kept as an occurrence", () => {
    const db = openDb();
    fillTurns(db, 1, 30);
    const claim = insert(db, {
      turn: 30,
      attribute: "injury",
      value: "claimed_wolf_bite",
      gloss: "에녹은 늑대에게 물렸다고 주장했다.",
      quote: "에녹은 늑대에게 물렸다고 말했다.",
      authority: "CHARACTER_CLAIM",
    });
    fillTurns(db, 31, 80);
    insert(db, {
      turn: 80,
      attribute: "injury",
      value: "left_arm_recovered",
      gloss: "에녹의 왼팔 부상은 치료 후 회복했다.",
      quote: RECOVERY_QUOTE,
    });
    fillTurns(db, 81, 500);
    const result = recall(db, 500, "예전에 에녹 왼팔은 왜 다쳤었지?");
    assert.equal(result.facts.some((fact) => fact.id === claim), false);
  });

  it("a guard-blocked completed row does not close the state (no fallback past a blocked latest)", () => {
    const db = openDb();
    fillTurns(db, 1, 30);
    const t30 = insert(db, {
      turn: 30,
      attribute: "injury",
      value: "left_arm_bitten",
      gloss: "에녹은 늑대에게 물려 왼팔을 크게 다쳤다.",
      quote: BITE_QUOTE,
    });
    fillTurns(db, 31, 80);
    insert(db, {
      turn: 80,
      attribute: "injury",
      value: "left_arm_recovered",
      gloss: '에녹이 말했다: "치료 후 회복했다.' + '"',
      quote: RECOVERY_QUOTE,
    });
    fillTurns(db, 81, 500);
    const result = recall(db, 500, "예전에 에녹 왼팔은 왜 다쳤었지?");
    assert.equal(result.facts.some((fact) => fact.id === t30), false);
  });

  it("deleting the recovery's source turns the injury back into the current state", () => {
    const { db, t30 } = seedInjuryHistory(500);
    assert.equal(deleteEpisodicMemoryFactsByAssistantMessageIds(db, 1, [80 * 10 + 2]), 1);
    const result = recall(db, 500, "에녹 왼팔은 지금 괜찮아?");
    assert.ok(result.facts.some((fact) => fact.id === t30));
    assert.equal(result.facts.some((fact) => fact.source_turn === 80), false);
  });

  it("a recovery in another chat does not close this chat's injury", () => {
    const { db, t30 } = seedInjuryHistory(1000);
    db.prepare("DELETE FROM episodic_memory_facts WHERE source_turn = 80 AND subject = 'enoch'").run();
    db.prepare("INSERT INTO chat_memories (chat_id) VALUES (2)").run();
    insert(db, {
      chatId: 2,
      turn: 80,
      attribute: "injury",
      value: "left_arm_recovered",
      gloss: "에녹의 왼팔 부상은 치료 후 회복했다.",
      quote: RECOVERY_QUOTE,
    });
    const result = recall(db, 1000, "에녹 왼팔은 지금 괜찮아?");
    assert.ok(result.facts.some((fact) => fact.id === t30));
  });
});

describe("B6-2 — repeated records: duplicates of one source cost one slot, real repeats stay", () => {
  const LOCK = "에녹이 문을 잠갔다.";

  function seedRepeats(horizon: number) {
    const db = openDb();
    const ids = { real: [] as number[], sameSource: [] as number[], legacy: [] as number[] };
    for (let turn = 1; turn < horizon; turn++) {
      insert(db, {
        turn,
        subject: "bg",
        attribute: "scene_event",
        value: `f${turn}`,
        importance: turn % 9 === 0 ? "important" : "normal",
        gloss: FILLER[turn % FILLER.length]!,
      });
      if ([100, 400, 700, 950].includes(turn)) {
        ids.real.push(
          insert(db, {
            turn,
            attribute: "action",
            value: `locked_door_${turn}`,
            gloss: "에녹은 유저가 떠나려 하자 문을 잠갔다.",
            quote: LOCK,
          })
        );
      }
      if (turn === 410) {
        ids.sameSource.push(
          insert(db, { turn, attribute: "action", value: "locked_door_410", gloss: "에녹은 유저가 떠나려 하자 문을 잠갔다.", quote: LOCK, messageId: 4102 }),
          insert(db, { turn, attribute: "response", value: "kept_user_inside", gloss: "에녹은 문을 잠가 유저를 붙잡았다.", quote: LOCK, messageId: 4102 })
        );
      }
      if (turn === 412) {
        ids.sameSource.push(
          insert(db, { turn, attribute: "action", value: "locked_door_412", gloss: "에녹은 유저가 떠나려 하자 문을 잠갔다.", quote: LOCK, messageId: 4102 })
        );
      }
      if ([200, 500].includes(turn)) {
        ids.legacy.push(
          insert(db, { turn, attribute: "action", value: `locked_door_legacy_${turn}`, gloss: "에녹은 유저가 떠나려 하자 문을 잠갔다." })
        );
      }
    }
    return { db, ids };
  }

  it("rows of one canonical source (same message and quote) occupy exactly one slot", () => {
    const { db, ids } = seedRepeats(1000);
    const result = recall(db, 1000, "에녹이 문을 잠갔던 적이 몇 번이었지?");
    const selectedSameSource = ids.sameSource.filter((id) => result.facts.some((fact) => fact.id === id));
    assert.equal(selectedSameSource.length, 1);
    const skipped = ids.sameSource.filter((id) => !selectedSameSource.includes(id));
    for (const id of skipped) {
      assert.equal(result.debug.find((d) => d.id === id)?.duplicate_reason, "duplicate_same_evidence");
    }
  });

  it("real repeats from different source messages are each recalled with their own turn", () => {
    const { db, ids } = seedRepeats(1000);
    const result = recall(db, 1000, "에녹이 문을 잠갔던 적이 몇 번이었지?");
    for (const id of ids.real) assert.ok(result.facts.some((fact) => fact.id === id));
    const lockTurns = result.facts
      .filter((fact) => fact.subject === "enoch")
      .map((fact) => fact.source_turn);
    assert.equal(new Set(lockTurns).size, lockTurns.length, "no turn is merged or listed twice");
    assert.deepEqual(
      [100, 400, 700, 950].filter((turn) => !lockTurns.includes(turn)),
      []
    );
  });

  it("identical glosses without a source at different turns are not merged", () => {
    const { db, ids } = seedRepeats(1000);
    const result = recall(db, 1000, "에녹이 문을 잠갔던 적이 몇 번이었지?");
    for (const id of ids.legacy) assert.ok(result.facts.some((fact) => fact.id === id));
  });

  it("repeats do not push out an old important event, and the #1648 T300 clue stays first", () => {
    const { db } = seedRepeats(1000);
    const betrayal = insert(db, {
      turn: 25,
      subject: "bella",
      attribute: "action",
      value: "betrayed_to_guard",
      importance: "critical",
      gloss: "벨라가 유저의 은신처를 경비대에 알려 유저를 넘겼다.",
      quote: "벨라가 은신처를 경비대에 알렸다.",
    });
    const letter = insert(db, {
      turn: 300,
      subject: "luka",
      attribute: "scene_event",
      value: "sealed_letter_found",
      importance: "normal",
      gloss: "루카가 등대 꼭대기에서 붉은 봉인이 찍힌 편지를 찾아냈다.",
      quote: "루카가 등대 꼭대기에서 붉은 봉인이 찍힌 편지를 찾아냈다.",
    });
    const first = recall(db, 1000, "벨라가 우리를 경비대에 넘겼던 거 말이야, 왜 그랬을까?");
    assert.equal(first.debug.find((d) => d.id === betrayal)?.final_rank, 1);
    const second = recall(db, 1000, "그때 등대에서 루카가 찾았던 붉은 봉인 편지 기억나?");
    assert.equal(second.debug.find((d) => d.id === letter)?.final_rank, 1);
  });

  it("more real repeats than slots: nothing is merged, the block stays within budget", () => {
    const db = openDb();
    for (let turn = 1; turn < 1000; turn++) {
      if (turn % 25 === 0) {
        insert(db, { turn, attribute: "action", value: `locked_door_${turn}`, gloss: "에녹은 유저가 떠나려 하자 문을 잠갔다.", quote: LOCK });
      }
    }
    const result = recall(db, 1000, "에녹이 문을 잠갔던 적이 몇 번이었지?");
    assert.equal(result.facts.length, 8);
    assert.equal(new Set(result.facts.map((fact) => fact.source_turn)).size, 8);
    assert.ok(result.promptBlock.length <= 1400);
  });

  it("an unrelated question injects nothing from the repeated history", () => {
    const { db } = seedRepeats(1000);
    const result = recall(db, 1000, "오늘 날씨 좋다.");
    assert.equal(result.facts.length, 0);
    assert.equal(result.promptBlock, "");
    const candidates = fetchEpisodicMemoryCandidatesForDebug(
      db,
      { chatId: 1, currentTurn: 1000, currentUserMessage: "오늘 날씨 좋다." },
      env
    );
    assert.ok(candidates.rows.length > 0);
  });
});

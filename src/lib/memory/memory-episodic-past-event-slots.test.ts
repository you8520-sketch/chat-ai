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
  evidenceType?: "explicit_scene_event" | "explicit_user_statement";
  chatId?: number;
};

function insert(db: Database.Database, spec: RowSpec): number {
  const messageId = spec.messageId ?? spec.turn * 10 + 2;
  const metadata = {
    memory_evidence_type: spec.evidenceType ?? "explicit_scene_event",
    content_route: "safe",
    assistant_message_id: messageId,
    ...(spec.quote
      ? {
          evidence: {
            role: spec.authority === "USER_EXPLICIT" ? "user" : "assistant",
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

  it("a guard-blocked latest is never recalled and no older state resurfaces past it", () => {
    const db = openDb();
    fillTurns(db, 1, 30);
    const t30 = insert(db, {
      turn: 30,
      attribute: "injury",
      value: "left_arm_bitten",
      gloss: "에녹은 늑대에게 물려 왼팔을 크게 다쳤다.",
      quote: BITE_QUOTE,
    });
    fillTurns(db, 31, 60);
    const bandaged = insert(db, {
      turn: 60,
      attribute: "injury",
      value: "left_arm_bandaged",
      gloss: "에녹의 왼팔은 붕대에 감겨 있다.",
      quote: "에녹의 왼팔에는 붕대가 감겨 있었다.",
    });
    fillTurns(db, 61, 80);
    const blocked = insert(db, {
      turn: 80,
      attribute: "injury",
      value: "left_arm_recovered",
      gloss: '에녹이 말했다: "치료 후 회복했다.' + '"',
      quote: RECOVERY_QUOTE,
    });
    fillTurns(db, 81, 500);
    const result = recall(db, 500, "예전에 에녹 왼팔은 왜 다쳤었지?");
    assert.equal(result.facts.some((fact) => fact.id === blocked), false);
    assert.equal(result.facts.some((fact) => fact.id === bandaged), false);
    assert.ok(result.facts.some((fact) => fact.id === t30), "the verified bite is history, not a fallback state");
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

describe("B8-2 — B7 rows: a later, separate injury of the same key keeps the old occurrence", () => {
  const FLANK_GLOSS = "태형은 진화형 크리처의 발톱에 왼쪽 옆구리를 찔렸다.";
  const FLANK_QUOTE = "발톱이 태형의 왼쪽 옆구리를 꿰뚫었다.";
  const STITCH_QUOTE = "그날 태형의 왼쪽 옆구리는 정식으로 열네 바늘 봉합되었다.";
  const RETURN_QUOTE = "오늘부터 현장 복귀 허가합니다.";
  const ANKLE_QUOTE = "태형은 계단 모서리에서 미끄러지며 오른쪽 발목을 접질렀다.";
  const CAUSE_QUESTION = "옆구리 다친 건 이제 다 나은 거지? 그때 왜 다쳤었지?";

  /** Same keys, importances, glosses and verified quotes as the B7 T500 snapshot rows 23/29/33/270. */
  function seedB7(horizon: number, flank: Partial<RowSpec> = {}) {
    const db = openDb();
    fillTurns(db, 1, 30);
    const t30 = insert(db, {
      turn: 30,
      subject: "taehyung",
      attribute: "injury",
      value: "left_flank_punctured",
      gloss: FLANK_GLOSS,
      quote: FLANK_QUOTE,
      ...flank,
    });
    fillTurns(db, 31, 44);
    const t44 = insert(db, {
      turn: 44,
      subject: "taehyung",
      attribute: "injury_treatment",
      value: "left_flank_stitches",
      gloss: "태형은 왼쪽 옆구리 상처를 열네 바늘로 봉합받았다.",
      quote: STITCH_QUOTE,
    });
    fillTurns(db, 45, 55);
    const t55 = insert(db, {
      turn: 55,
      subject: "taehyung",
      attribute: "medical_recovery",
      value: "fully_recovered",
      importance: "normal",
      gloss: "태형은 왼쪽 옆구리 부상에서 완전히 회복되어 현장 복귀 허가를 받았다.",
      quote: RETURN_QUOTE,
    });
    fillTurns(db, 56, 312);
    const t312 = insert(db, {
      turn: 312,
      subject: "taehyung",
      attribute: "injury",
      value: "sprained_right_ankle",
      importance: "normal",
      gloss: "태형은 순찰 중 계단에서 미끄러져 오른쪽 발목을 접질렀다.",
      quote: ANKLE_QUOTE,
    });
    fillTurns(db, 313, horizon);
    return { db, t30, t44, t55, t312 };
  }

  for (const horizon of [500, 1000]) {
    describe(`currentTurn=${horizon}`, () => {
      it("the old flank-cause question recalls T30's verified quote from Episodic alone", () => {
        const { db, t30, t55 } = seedB7(horizon);
        const result = recall(db, horizon, CAUSE_QUESTION);
        assert.ok(result.facts.some((fact) => fact.id === t30));
        assert.ok(result.facts.some((fact) => fact.id === t55));
        assert.ok(result.promptBlock.includes(`- [T30] [AI 장면 서술 발췌] “${FLANK_QUOTE}”`));
        assert.ok(result.promptBlock.includes(RETURN_QUOTE));
        assert.doesNotMatch(result.promptBlock, new RegExp(FLANK_GLOSS));
      });

      it("the recovery stays in view and the ankle stays the latest injury", () => {
        const { db, t55, t312 } = seedB7(horizon);
        const flank = recall(db, horizon, "옆구리는 지금도 아파?");
        assert.ok(flank.facts.some((fact) => fact.id === t55));
        assert.match(flank.promptBlock, /\[T55\]/);
        const now = recall(db, horizon, "지금 어디 다친 데 있어? 발목은 괜찮아?");
        assert.ok(now.facts.some((fact) => fact.id === t312));
        assert.equal(now.debug.find((d) => d.id === t312)?.final_rank, 1);
      });

      it("two distinct injuries are both kept, each with its own turn", () => {
        const { db, t30, t312 } = seedB7(horizon);
        const result = recall(db, horizon, "예전에 옆구리 찔렸던 거랑 발목 접질렀던 거 둘 다 기억나?");
        assert.ok(result.facts.some((fact) => fact.id === t30));
        assert.ok(result.facts.some((fact) => fact.id === t312));
        assert.match(result.promptBlock, /\[T30\][^\n]*옆구리/);
        assert.match(result.promptBlock, /\[T312\][^\n]*발목/);
      });
    });
  }

  it("a re-extraction of the same T30 source costs one slot", () => {
    const { db, t30 } = seedB7(500);
    const sameSource = insert(db, {
      turn: 30,
      subject: "taehyung",
      attribute: "combat_injury",
      value: "flank_clawed",
      gloss: "태형은 크리처의 발톱에 옆구리를 꿰뚫렸다.",
      quote: FLANK_QUOTE,
    });
    const resaved = insert(db, {
      turn: 30,
      subject: "taehyung",
      attribute: "injury",
      value: "left_flank_punctured",
      gloss: FLANK_GLOSS,
      quote: FLANK_QUOTE,
    });
    const result = recall(db, 500, CAUSE_QUESTION);
    const selected = [t30, sameSource, resaved].filter((id) => result.facts.some((fact) => fact.id === id));
    assert.equal(selected.length, 1);
    assert.equal(result.promptBlock.split(FLANK_QUOTE).length - 1, 1);
  });

  it("before the recovery the flank injury is recalled; it is never claimed recovered", () => {
    const { db, t30, t55 } = seedB7(1000);
    const result = recall(db, 50, "옆구리는 지금도 아파?");
    assert.ok(result.facts.some((fact) => fact.id === t30));
    assert.equal(result.facts.some((fact) => fact.id === t55), false);
  });

  it("present and copula-past states keep latest-wins under a verified source", () => {
    const db = openDb();
    fillTurns(db, 1, 300);
    const intern = insert(db, {
      turn: 40,
      subject: "daon",
      attribute: "organization_role",
      value: "intern",
      gloss: "서다온은 연구국 인턴이다.",
      quote: "연구국 인턴 서다온이 서류를 내밀었다.",
    });
    const internPast = insert(db, {
      turn: 90,
      subject: "daon",
      attribute: "organization_role",
      value: "intern_past",
      gloss: "서다온은 연구국 인턴이었다.",
      quote: "서다온은 아직 연구국 인턴이었다.",
    });
    const researcher = insert(db, {
      turn: 200,
      subject: "daon",
      attribute: "organization_role",
      value: "researcher",
      gloss: "서다온은 연구국 정식 연구원이다.",
      quote: "정식 연구원 배지를 단 서다온이 웃었다.",
    });
    const result = recall(db, 300, "서다온은 연구국에서 무슨 일 해?");
    assert.ok(result.facts.some((fact) => fact.id === researcher));
    assert.equal(result.facts.some((fact) => fact.id === intern), false);
    assert.equal(result.facts.some((fact) => fact.id === internPast), false);
  });

  it("an explicit user correction stays latest-wins", () => {
    const db = openDb();
    fillTurns(db, 1, 300);
    const wrong = insert(db, {
      turn: 40,
      subject: "user",
      attribute: "past_job",
      value: "cafe",
      gloss: "유저는 예전에 카페에서 일했다.",
      quote: "나 예전에 카페에서 일했어.",
      authority: "USER_EXPLICIT",
      evidenceType: "explicit_user_statement",
    });
    const corrected = insert(db, {
      turn: 120,
      subject: "user",
      attribute: "past_job",
      value: "bookstore",
      gloss: "유저는 예전에 카페가 아니라 서점에서 일했다.",
      quote: "아, 카페 아니고 서점에서 일했어.",
      authority: "USER_EXPLICIT",
      evidenceType: "explicit_user_statement",
    });
    const result = recall(db, 300, "내가 예전에 어디서 일했다고 했지?");
    assert.ok(result.facts.some((fact) => fact.id === corrected));
    assert.equal(result.facts.some((fact) => fact.id === wrong), false);
  });

  it("the same T30 text as a character claim or a legacy row is not promoted past T312", () => {
    for (const flank of [{ authority: "CHARACTER_CLAIM" as const }, { quote: undefined }]) {
      const { db, t30 } = seedB7(500, flank);
      const result = recall(db, 500, CAUSE_QUESTION);
      assert.equal(result.facts.some((fact) => fact.id === t30), false);
      assert.equal(result.promptBlock.includes(FLANK_QUOTE), false);
    }
  });

  it("regenerating or deleting T30's source turn removes the occurrence", () => {
    const { db, t30, t312 } = seedB7(500);
    assert.equal(deleteEpisodicMemoryFactsByAssistantMessageIds(db, 1, [30 * 10 + 2]), 1);
    const result = recall(db, 500, CAUSE_QUESTION);
    assert.equal(result.facts.some((fact) => fact.id === t30), false);
    assert.equal(result.promptBlock.includes(FLANK_QUOTE), false);
    assert.ok(recall(db, 500, "지금 어디 다친 데 있어? 발목은 괜찮아?").facts.some((fact) => fact.id === t312));
  });

  it("a memory reset before T30 and another chat's T30 stay out", () => {
    const { db, t30 } = seedB7(500);
    db.prepare("UPDATE episodic_memory_facts SET source_user_message_id = source_turn * 10 + 1").run();
    db.prepare("UPDATE chat_memories SET memory_reset_after_message_id = 400 WHERE chat_id = 1").run();
    const reset = recall(db, 500, CAUSE_QUESTION);
    assert.equal(reset.facts.some((fact) => fact.id === t30), false);
    assert.equal(reset.promptBlock.includes(FLANK_QUOTE), false);

    const other = seedB7(500);
    other.db.prepare("UPDATE episodic_memory_facts SET chat_id = 2 WHERE id = ?").run(other.t30);
    other.db.prepare("INSERT INTO chat_memories (chat_id) VALUES (2)").run();
    const fromChat1 = recall(other.db, 500, CAUSE_QUESTION);
    assert.equal(fromChat1.facts.some((fact) => fact.id === other.t30), false);
    assert.ok(recall(other.db, 500, CAUSE_QUESTION, 2).facts.some((fact) => fact.id === other.t30));
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EXPLORATION_ALARM_FLAG,
  EXPLORATION_ALARM_ROOM,
  EXPLORATION_ARCHIVE_ROOM,
  EXPLORATION_CLUE_FLAG,
  EXPLORATION_CLUE_TEXT,
  EXPLORATION_ENTRANCE,
  EXPLORATION_EXIT_ROOM,
  EXPLORATION_HIDDEN_EDGE,
  EXPLORATION_ITEM_NAME,
  EXPLORATION_LOOP_ROOM,
  EXPLORATION_PASSAGE_FLAG,
  displayExplorationAp,
  emptyExplorationState,
  explorationCanEscape,
  explorationCommandsFromMovementBody,
  explorationLayoutIndex,
  explorationMapHasCycle,
  explorationRoomsReachable,
  filterExplorationFlagsAdd,
  filterExplorationFlagsRemove,
  formatExplorationBotBrief,
  formatExplorationGmBlock,
  generateExplorationMap,
  legalExplorationCommands,
  priceExplorationCommands,
  projectPublicExploration,
  roomDegree,
  settleExplorationActor,
  spendExplorationAp,
  visibleExplorationNeighbors,
} from "./explorationMap";
import { explorationQueueCost, parseExplorationCommands } from "./explorationPublic";

describe("exploration map generation", () => {
  it("repeats a seed and can produce more than one connected layout", () => {
    const first = generateExplorationMap("alpha");
    assert.deepEqual(generateExplorationMap("alpha"), first);
    const layouts = new Set<number>();
    const edgeSets = new Set<string>();
    for (let i = 0; i < 24; i += 1) {
      const seed = `seed-${i}`;
      layouts.add(explorationLayoutIndex(seed));
      const map = generateExplorationMap(seed);
      assert.equal(map.rooms.length >= 7 && map.rooms.length <= 9, true);
      assert.equal(explorationRoomsReachable(map, false), true);
      assert.equal(explorationMapHasCycle(map, false), true);
      const entrance = map.rooms.find((room) => room.role === "start");
      assert.ok(entrance);
      assert.ok(roomDegree(map, entrance.id, false) >= 2);
      assert.ok(map.rooms.filter((room) => roomDegree(map, room.id, false) >= 3).length >= 2);
      assert.equal(map.events.length, 3);
      edgeSets.add(map.edges.map((edge) => edge.id).sort().join("|"));
    }
    assert.ok(layouts.size >= 2);
    assert.ok(edgeSets.size >= 2);
  });

  it("keeps unrevealed names, items, and the hidden passage out of the public map", () => {
    const state = emptyExplorationState("public-fog");
    const projected = projectPublicExploration({
      state,
      viewerParticipantId: 1,
      viewerLocation: EXPLORATION_ENTRANCE,
      roundNumber: 1,
    });
    const wire = JSON.stringify(projected);
    const exits = visibleExplorationNeighbors(state, EXPLORATION_ENTRANCE);
    assert.deepEqual(projected.rooms.map((room) => room.label).sort(), [EXPLORATION_ENTRANCE, ...exits].sort());
    assert.equal(projected.rooms.some((room) => room.label === EXPLORATION_ENTRANCE && room.current), true);
    assert.equal(projected.rooms.filter((room) => room.visited).length, 1);
    assert.equal(wire.includes(EXPLORATION_CLUE_TEXT), false);
    assert.equal(wire.includes(EXPLORATION_ITEM_NAME), false);
    assert.equal(wire.includes(EXPLORATION_ARCHIVE_ROOM), exits.includes(EXPLORATION_ARCHIVE_ROOM));
    assert.equal(wire.includes(EXPLORATION_LOOP_ROOM), false);
    assert.equal(wire.includes(EXPLORATION_HIDDEN_EDGE), false);
    assert.equal(wire.includes("event-clue"), false);
    assert.equal(projected.ap, 3);
    assert.equal(projected.legacy?.risk, 0);
  });

  it("refills action points on a new round, rejects a short budget, and reveals once", () => {
    const state = emptyExplorationState("ap-once");
    const archive = state.map.rooms.find((room) => room.id === EXPLORATION_ARCHIVE_ROOM)!;
    assert.throws(
      () =>
        priceExplorationCommands({
          state,
          fromRoomId: EXPLORATION_ENTRANCE,
          commands: [
            { op: "move", roomId: archive.publicId },
            { op: "move", roomId: archive.publicId },
            { op: "move", roomId: archive.publicId },
            { op: "search", depth: "careful" },
          ],
          apRemaining: 3,
        }),
      /행동력이 부족합니다|연결되지 않은 곳으로는 이동할 수 없습니다/
    );
    assert.throws(
      () =>
        priceExplorationCommands({
          state,
          fromRoomId: EXPLORATION_LOOP_ROOM,
          commands: [{ op: "move", roomId: EXPLORATION_ENTRANCE }],
          apRemaining: 3,
        }),
      /아직 발견하지 못한 통로입니다/
    );
    const spent = spendExplorationAp({
      state,
      participantId: 7,
      roundNumber: 1,
      roundId: 11,
      fromRoomId: EXPLORATION_ENTRANCE,
      commands: [{ op: "search", depth: "normal" }],
    });
    assert.equal(displayExplorationAp(spent, 7, 1), 2);
    assert.equal(displayExplorationAp(spent, 7, 2), 3);
    assert.equal(displayExplorationAp(spent, 8, 1), 3);
    const settled = settleExplorationActor({
      state: spent,
      pending: spent.pending[0]!,
      name: "현이",
      tier: "SUCCESS",
    });
    const again = settleExplorationActor({
      state: settled.state,
      pending: spent.pending[0]!,
      name: "현이",
      tier: "SUCCESS",
    });
    assert.equal(again.state.revealedEventIds.length, settled.state.revealedEventIds.length);
    assert.deepEqual(again.result.items, []);
    assert.equal(explorationQueueCost([{ op: "move", roomId: "r1" }, { op: "search", depth: "careful" }]), 3);
    assert.equal(parseExplorationCommands(null).length, 0);
    assert.throws(() => parseExplorationCommands([{ op: "fly" }]), /알 수 없는 탐험 명령입니다/);
    assert.equal(EXPLORATION_ALARM_FLAG.length < 80, true);
  });

  it("a failed search stays in place, reveals nothing, and keeps the spent points", () => {
    const state = emptyExplorationState("fail-search");
    const fork = state.map.edges.find(
      (edge) => !edge.hidden && (edge.from === EXPLORATION_ENTRANCE || edge.to === EXPLORATION_ENTRANCE)
    );
    assert.ok(fork);
    const dest = fork.from === EXPLORATION_ENTRANCE ? fork.to : fork.from;
    const spent = spendExplorationAp({
      state,
      participantId: 7,
      roundNumber: 1,
      roundId: 21,
      fromRoomId: EXPLORATION_ENTRANCE,
      commands: [
        { op: "search", depth: "normal" },
        { op: "move", roomId: dest },
      ],
    });
    assert.equal(displayExplorationAp(spent, 7, 1), 1);
    const failed = settleExplorationActor({
      state: spent,
      pending: spent.pending[0]!,
      name: "현이",
      tier: "FAILURE",
    });
    assert.equal(failed.result.location, null);
    assert.deepEqual(failed.result.items, []);
    assert.equal(failed.state.revealedEventIds.length, 0);
    assert.deepEqual(failed.state.visitedRoomIds, [EXPLORATION_ENTRANCE]);
    assert.equal(failed.state.risk, 1);
    assert.equal(displayExplorationAp(failed.state, 7, 1), 1);
    assert.equal(failed.result.lines.some((line) => line.includes("search failed")), true);
  });

  it("keeps an earlier move when a later search in the same submission fails", () => {
    const state = emptyExplorationState("move-then-search");
    const fork = state.map.edges.find(
      (edge) => !edge.hidden && (edge.from === EXPLORATION_ENTRANCE || edge.to === EXPLORATION_ENTRANCE)
    );
    assert.ok(fork);
    const dest = fork.from === EXPLORATION_ENTRANCE ? fork.to : fork.from;
    const spent = spendExplorationAp({
      state,
      participantId: 7,
      roundNumber: 1,
      roundId: 31,
      fromRoomId: EXPLORATION_ENTRANCE,
      commands: [
        { op: "move", roomId: dest },
        { op: "search", depth: "normal" },
      ],
    });
    const failed = settleExplorationActor({
      state: spent,
      pending: spent.pending[0]!,
      name: "현이",
      tier: "FAILURE",
    });
    assert.equal(failed.result.location, dest);
    assert.equal(failed.result.failed, true);
    assert.equal(failed.state.revealedEventIds.length, 0);
    assert.equal(failed.state.visitedRoomIds.includes(dest), true);
    assert.equal(failed.state.risk, 2);
    assert.equal(displayExplorationAp(failed.state, 7, 1), 1);
  });

  it("keeps the exit shut until the alarm, and every layout can still be escaped without the clue", () => {
    for (let layout = 0; layout < 3; layout += 1) {
      let seed = "";
      for (let i = 0; i < 80 && !seed; i += 1) {
        const candidate = `latch-${layout}-${i}`;
        if (explorationLayoutIndex(candidate) === layout) seed = candidate;
      }
      assert.ok(seed, `layout ${layout} needs a seed`);
      const state = emptyExplorationState(seed);
      assert.equal(explorationCanEscape(state.map), true);
      const exitEdge = state.map.edges.find(
        (edge) => !edge.hidden && (edge.from === EXPLORATION_EXIT_ROOM || edge.to === EXPLORATION_EXIT_ROOM)
      );
      assert.ok(exitEdge);
      const beside = exitEdge.from === EXPLORATION_EXIT_ROOM ? exitEdge.to : exitEdge.from;
      assert.throws(
        () =>
          priceExplorationCommands({
            state,
            fromRoomId: EXPLORATION_ENTRANCE,
            commands: [{ op: "move", roomId: EXPLORATION_EXIT_ROOM }],
            apRemaining: 3,
          }),
        /연결되지 않은 곳으로는 이동할 수 없습니다/
      );
      assert.throws(
        () =>
          priceExplorationCommands({
            state: { ...state, revealedEventIds: ["event-clue"] },
            fromRoomId: beside,
            commands: [{ op: "move", roomId: EXPLORATION_EXIT_ROOM }],
            apRemaining: 3,
          }),
        /출구 빗장은 경보가 울린 뒤에만 풀립니다/
      );
      const opened = priceExplorationCommands({
        state: { ...state, alarmFlagged: true, revealedEventIds: [] },
        fromRoomId: beside,
        commands: [{ op: "move", roomId: EXPLORATION_EXIT_ROOM }],
        apRemaining: 3,
      });
      assert.equal(opened.spent, 1);
      assert.equal(state.map.rooms.some((room) => room.id === EXPLORATION_ALARM_ROOM), true);
    }
    const declared = explorationCommandsFromMovementBody(emptyExplorationState("declare").map, "출구로 이동한다. 벽을 살핀다.");
    assert.deepEqual(declared, [{ op: "move", roomId: EXPLORATION_EXIT_ROOM }]);
  });

  it("keeps later legal moves and drops only the commands that fail price", () => {
    const state = emptyExplorationState("declare");
    const next = visibleExplorationNeighbors(state, EXPLORATION_ENTRANCE).find((roomId) => roomId !== EXPLORATION_EXIT_ROOM);
    assert.ok(next);
    assert.deepEqual(
      legalExplorationCommands({
        state,
        fromRoomId: EXPLORATION_ENTRANCE,
        commands: [
          { op: "move", roomId: EXPLORATION_EXIT_ROOM },
          { op: "move", roomId: next },
        ],
        apRemaining: 3,
      }),
      [{ op: "move", roomId: next }]
    );
    assert.deepEqual(
      legalExplorationCommands({
        state,
        fromRoomId: EXPLORATION_ENTRANCE,
        commands: [
          { op: "move", roomId: next },
          { op: "move", roomId: EXPLORATION_ENTRANCE },
          { op: "move", roomId: next },
          { op: "move", roomId: EXPLORATION_ENTRANCE },
        ],
        apRemaining: 3,
      }),
      [
        { op: "move", roomId: next },
        { op: "move", roomId: EXPLORATION_ENTRANCE },
        { op: "move", roomId: next },
      ]
    );
  });

  it("keeps remember-round positions as fact and does not treat an unattempted exit as happened", () => {
    const remember = formatExplorationGmBlock({
      opening: false,
      startName: EXPLORATION_ENTRANCE,
      seats: [
        { name: "현이", start: EXPLORATION_ARCHIVE_ROOM, end: EXPLORATION_ARCHIVE_ROOM, exits: [] },
        { name: "도윤", start: EXPLORATION_ENTRANCE, end: EXPLORATION_ENTRANCE, exits: [] },
        { name: "서하", start: EXPLORATION_ENTRANCE, end: EXPLORATION_ENTRANCE, exits: [] },
        { name: "도윤봇", start: EXPLORATION_ENTRANCE, end: EXPLORATION_ENTRANCE, exits: [] },
      ],
      resultLines: [],
      legacy: { alarm: true, risk: 6, flags: [EXPLORATION_CLUE_FLAG, EXPLORATION_ALARM_FLAG] },
    });
    assert.match(remember, /override earlier narration/);
    assert.match(remember, /Inventory on this map stays yours/);
    assert.doesNotMatch(remember, /not a trade/);
    assert.match(remember, /현이 is in 기록실\. They did not move this round\./);
    assert.match(remember, /도윤 is in 현관홀\. They did not move this round\./);
    assert.match(remember, /Alarm is already on\. The exit latch condition is already met\./);
    assert.match(remember, /Nobody has reached 출구\. Escape is not a fact\./);
    assert.doesNotMatch(remember, /can open/);
    assert.doesNotMatch(remember, /경보를 울려/);
    assert.doesNotMatch(remember, /현이 started in/);
    assert.doesNotMatch(remember, /moved .*출구/);
    const shut = formatExplorationGmBlock({
      opening: false,
      startName: EXPLORATION_ENTRANCE,
      seats: [{ name: "현이", start: EXPLORATION_ENTRANCE, end: EXPLORATION_ENTRANCE, exits: [] }],
      resultLines: [],
      legacy: { alarm: false, risk: 0, flags: [] },
    });
    assert.match(shut, /Alarm is off\. The exit latch is still shut\./);
    assert.doesNotMatch(shut, /already met/);
    const seeded = emptyExplorationState("gm-exits");
    const entranceExits = visibleExplorationNeighbors(seeded, EXPLORATION_ENTRANCE);
    const opening = formatExplorationGmBlock({
      opening: true,
      startName: EXPLORATION_ENTRANCE,
      seats: [
        { name: "현이", start: EXPLORATION_ENTRANCE, end: EXPLORATION_ENTRANCE, exits: entranceExits },
        { name: "도윤", start: EXPLORATION_ENTRANCE, end: EXPLORATION_ENTRANCE, exits: entranceExits },
      ],
      resultLines: [],
      legacy: { alarm: false, risk: 0, flags: [] },
    });
    assert.equal(opening.split(`Open passages from ${EXPLORATION_ENTRANCE}: ${entranceExits.join(", ")}.`).length, 2);
    assert.doesNotMatch(opening, /At least two passages|may be atmosphere|Server flags/);
    for (const hidden of [EXPLORATION_LOOP_ROOM, EXPLORATION_PASSAGE_FLAG, EXPLORATION_CLUE_FLAG, EXPLORATION_CLUE_TEXT]) {
      assert.equal(opening.includes(hidden), false, hidden);
    }
    const arrived = formatExplorationGmBlock({
      opening: false,
      startName: EXPLORATION_ENTRANCE,
      seats: [{ name: "현이", start: "북쪽복도", end: EXPLORATION_EXIT_ROOM, exits: [] }],
      resultLines: ["현이: moved 북쪽복도 → 출구."],
      legacy: { alarm: true, risk: 7, flags: [EXPLORATION_ALARM_FLAG] },
    });
    assert.match(arrived, /Only the people listed in 출구 are there\./);
    assert.doesNotMatch(arrived, /Nobody has reached 출구/);
    const moved = formatExplorationGmBlock({
      opening: false,
      startName: EXPLORATION_ENTRANCE,
      seats: [{ name: "현이", start: EXPLORATION_ENTRANCE, end: "중앙홀", exits: [] }],
      resultLines: ["현이: moved 현관홀 → 중앙홀."],
      legacy: { alarm: false, risk: 1, flags: [] },
    });
    assert.match(moved, /현이 started in 현관홀 and is now in 중앙홀\./);
    assert.match(moved, /현이: moved 현관홀 → 중앙홀\./);
    assert.match(moved, /Nobody has reached 출구/);
    const state = emptyExplorationState("bot-brief");
    const brief = formatExplorationBotBrief({
      roomId: EXPLORATION_ENTRANCE,
      neighbors: visibleExplorationNeighbors(state, EXPLORATION_ENTRANCE),
      startName: EXPLORATION_ENTRANCE,
      ap: 3,
      legacy: { alarm: false },
      party: [{ name: "서하", location: EXPLORATION_ENTRANCE }],
    });
    assert.match(brief, /You are in 현관홀/);
    assert.match(brief, /Open passages:/);
    assert.match(brief, /Action points left this turn: 3/);
    assert.doesNotMatch(brief, /순환로/);
    assert.deepEqual(
      filterExplorationFlagsAdd([EXPLORATION_ALARM_FLAG, EXPLORATION_CLUE_FLAG, "문_열림"], []),
      ["문_열림"]
    );
    assert.deepEqual(
      filterExplorationFlagsAdd(
        ["경보_활성화됨", "서고 단서: 낙서", EXPLORATION_ALARM_FLAG, EXPLORATION_PASSAGE_FLAG],
        [EXPLORATION_ALARM_FLAG, EXPLORATION_CLUE_FLAG]
      ),
      ["경보_활성화됨", "서고 단서: 낙서", EXPLORATION_ALARM_FLAG]
    );
    assert.deepEqual(
      filterExplorationFlagsRemove([
        EXPLORATION_ALARM_FLAG,
        EXPLORATION_CLUE_FLAG,
        EXPLORATION_PASSAGE_FLAG,
        "문_열림",
        "서고 단서: 낙서",
      ]),
      ["문_열림", "서고 단서: 낙서"]
    );
  });
});

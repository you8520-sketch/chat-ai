import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EXPLORATION_ALARM_FLAG,
  EXPLORATION_ALARM_ROOM,
  EXPLORATION_ARCHIVE_ROOM,
  EXPLORATION_CLUE_TEXT,
  EXPLORATION_ENTRANCE,
  EXPLORATION_EXIT_ROOM,
  EXPLORATION_HIDDEN_EDGE,
  EXPLORATION_ITEM_NAME,
  EXPLORATION_LOOP_ROOM,
  displayExplorationAp,
  emptyExplorationState,
  explorationCanEscape,
  explorationCommandsFromMovementBody,
  explorationLayoutIndex,
  explorationMapHasCycle,
  explorationRoomsReachable,
  generateExplorationMap,
  priceExplorationCommands,
  projectPublicExploration,
  roomDegree,
  settleExplorationActor,
  spendExplorationAp,
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
    assert.equal(projected.rooms.some((room) => room.label === "?"), true);
    assert.equal(projected.rooms.some((room) => room.label === EXPLORATION_ENTRANCE && room.current), true);
    assert.equal(wire.includes(EXPLORATION_CLUE_TEXT), false);
    assert.equal(wire.includes(EXPLORATION_ITEM_NAME), false);
    assert.equal(wire.includes(EXPLORATION_ARCHIVE_ROOM), false);
    assert.equal(wire.includes(EXPLORATION_HIDDEN_EDGE), false);
    assert.equal(wire.includes("event-clue"), false);
    assert.equal(projected.ap, 3);
    assert.equal(projected.risk, 0);
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
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  planTrpgAction,
  proposeTrpgAction,
  splitActionClauses,
  type TrpgActionProposal,
} from "./actionContract";
import { adventureExplorationState } from "./explorationMap";
import type { TrpgAdventure } from "./adventure";

const ADVENTURE: TrpgAdventure = {
  start: "hut",
  places: [
    { key: "hut", name: "뱃사공의 오두막", summary: "", role: "start" },
    { key: "wreck", name: "난파선 선창", summary: "", role: "site" },
  ],
  links: [{ from: "hut", to: "wreck" }],
  events: [],
};

const INVENTORY = [
  { id: "inv_remedy", name: "회복약", quantity: 1, equipped: false, slot: null },
];

function proposal(
  body: string,
  extra?: Partial<Parameters<typeof proposeTrpgAction>[0]>
): TrpgActionProposal {
  return proposeTrpgAction({
    body,
    actorParticipantId: 1,
    participantKind: "human",
    knownRooms: [
      { id: "hut", name: "뱃사공의 오두막" },
      { id: "wreck", name: "난파선 선창" },
    ],
    movementState: adventureExplorationState(ADVENTURE, "r1"),
    fromRoomId: "hut",
    inventory: INVENTORY,
    ...extra,
  });
}

describe("action contract", () => {
  it("preserves Korean compound order", () => {
    assert.deepEqual(splitActionClauses("회복약을 마시고 이동한다."), ["회복약을 마시고", "이동한다."]);
    assert.deepEqual(splitActionClauses("이동한 뒤 회복약을 마신다."), ["이동한 뒤", "회복약을 마신다."]);
  });

  it("keeps the negated named act and the positive remainder separate", () => {
    const p = proposal("칼을 뽑지 않고 두 손을 펼쳐 보인다.");
    assert.equal(p.acts.length, 2);
    assert.equal(p.acts[0]!.commitment, "negated");
    assert.equal(p.acts[1]!.commitment, "committed");
  });

  it("recognizes item use followed by movement without treating the sentence as negated", () => {
    const p = proposal("회복약을 마시고 난파선 선창으로 이동한다.");
    assert.deepEqual(
      p.acts.map((act) => act.kind),
      ["item_use", "move"]
    );
    assert.equal(p.acts[0]!.commitment, "committed");
    assert.equal(p.acts[1]!.commitment, "committed");
  });

  it("plans item use and movement in order", () => {
    const state = adventureExplorationState(ADVENTURE, "r1");
    const p = proposal("회복약을 마시고 난파선 선창으로 이동한다.");
    const plan = planTrpgAction({
      proposal: p,
      state,
      roundNumber: 1,
      fromRoomId: "hut",
      inventory: INVENTORY,
      offers: [],
      participantKind: "human",
    });
    assert.deepEqual(
      plan.acts.map((act) => [act.kind, act.status, act.apCost]),
      [
        ["item_use", "planned", 0],
        ["move", "planned", 1],
      ]
    );
  });

  it("does not execute a dependent act when the move prerequisite is unexecuted", () => {
    const state = adventureExplorationState(ADVENTURE, "r1");
    state.apRoundNumber = 1;
    state.apRemaining["1"] = 0;
    const p = proposal("난파선 선창으로 이동한 뒤 회복약을 마신다.");
    const plan = planTrpgAction({
      proposal: p,
      state,
      roundNumber: 1,
      fromRoomId: "hut",
      inventory: INVENTORY,
      offers: [],
      participantKind: "human",
    });
    assert.equal(plan.acts[0]!.kind, "move");
    assert.equal(plan.acts[0]!.status, "unexecuted");
    assert.equal(plan.acts[0]!.reason, "ap");
    assert.equal(plan.acts[1]!.kind, "item_use");
    assert.equal(plan.acts[1]!.status, "unexecuted");
    assert.equal(plan.acts[1]!.reason, "prerequisite_failed");
  });

  it("requires explicit acceptance for a human item take from an offer", () => {
    const state = adventureExplorationState(ADVENTURE, "r1");
    const p = proposal("주인이 내미는 메밀 봉투를 받아 든다.", {
      offers: ["볶은 메밀 봉투"],
    });
    const plan = planTrpgAction({
      proposal: p,
      state,
      roundNumber: 1,
      fromRoomId: "hut",
      inventory: INVENTORY,
      offers: ["볶은 메밀 봉투"],
      participantKind: "human",
    });
    assert.equal(plan.acts[0]!.kind, "item_take");
    assert.equal(plan.acts[0]!.status, "unexecuted");
    assert.equal(plan.acts[0]!.reason, "needs_acceptance");
  });

  it("treats UI command IDs as authoritative and does not re-read them from prose", () => {
    const p = proposeTrpgAction({
      body: "난파선 선창으로 내려간다.",
      actorParticipantId: 1,
      participantKind: "human",
      knownRooms: [
        { id: "hut", name: "뱃사공의 오두막" },
        { id: "wreck", name: "난파선 선창" },
      ],
      commands: [{ op: "move", roomId: "wreck" }],
      inventory: INVENTORY,
    });
    assert.equal(p.acts.length, 1);
    assert.equal(p.acts[0]!.source, "ui_command");
    assert.equal(p.acts[0]!.destinationRoomId, "wreck");
  });

  it("keeps the light-then-leave-then-farewell-close order from the successful fixture", () => {
    const lighthouse: TrpgAdventure = {
      start: "pier",
      places: [
        { key: "pier", name: "안개 부두", summary: "", role: "start" },
        { key: "hut", name: "뱃사공의 오두막", summary: "", role: "hub" },
        { key: "wreck", name: "난파선 선창", summary: "", role: "site" },
        { key: "lighthouse", name: "등대 기계실", summary: "", role: "goal" },
      ],
      links: [
        { from: "pier", to: "hut" },
        { from: "hut", to: "wreck" },
        { from: "wreck", to: "lighthouse" },
      ],
      events: [],
    };
    const state = adventureExplorationState(lighthouse, "r1");
    const oil = [{ id: "oil", name: "등대 기름", quantity: 1, equipped: false, slot: null }];
    const body =
      "등대 기름을 등잔에 붓고 불을 밝힌 뒤, 등대를 나와 부두로 내려간다. 뱃사공에게 마지막 작별 인사를 하고 이 모험을 끝낸다.";
    const p = proposeTrpgAction({
      body,
      actorParticipantId: 1,
      participantKind: "human",
      knownRooms: [
        { id: "pier", name: "안개 부두" },
        { id: "hut", name: "뱃사공의 오두막" },
        { id: "wreck", name: "난파선 선창" },
        { id: "lighthouse", name: "등대 기계실" },
      ],
      commands: [
        { op: "move", roomId: "wreck" },
        { op: "move", roomId: "hut" },
        { op: "move", roomId: "pier" },
      ],
      inventory: oil,
      movementState: state,
      fromRoomId: "lighthouse",
    });
    const plan = planTrpgAction({
      proposal: p,
      state,
      roundNumber: 5,
      fromRoomId: "lighthouse",
      inventory: oil,
      offers: [],
      participantKind: "human",
    });
    const kinds = plan.acts.filter((act) => act.status === "planned").map((act) => act.kind);
    assert.deepEqual(kinds, ["item_use", "other", "move", "move", "move", "talk", "other"]);
    assert.equal(p.endingIntent, "campaign_close");
    assert.equal(plan.acts.find((act) => act.kind === "item_use")?.item, "등대 기름");
    assert.deepEqual(
      plan.acts.filter((act) => act.kind === "move").map((act) => act.destinationRoomId),
      ["wreck", "hut", "pier"]
    );
  });
});

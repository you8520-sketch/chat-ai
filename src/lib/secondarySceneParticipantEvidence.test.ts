import Module from "module";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assessTrustedParticipantAdultStatus,
  buildAuthoritativeParticipantId,
  buildDynamicParticipantId,
  deriveEffectiveSecondaryAdultStatus,
  extractCurrentTurnSceneParticipantEvents,
  rejectPublicTrustedParticipantIdentity,
  toRestrictiveOnlyMetadata,
} from "./secondarySceneParticipantEvidence";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

describe("current-turn secondary participant extractor", () => {
  it("5. user minor ENTER → present/minor evidence", () => {
    const events = extractCurrentTurnSceneParticipantEvents(
      "17살 동생이 문을 열고 들어왔다."
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].action, "ENTER");
    assert.equal(events[0].displayName, "동생");
    assert.equal(events[0].attachedAge, 17);
  });

  it("matches named enter, here-present, and group join", () => {
    assert.deepEqual(
      extractCurrentTurnSceneParticipantEvents("민수가 방으로 들어왔다.").map(
        (e) => [e.action, e.displayName, e.attachedAge ?? null]
      ),
      [["ENTER", "민수", null]]
    );
    assert.deepEqual(
      extractCurrentTurnSceneParticipantEvents("동생도 여기 함께 있다.").map(
        (e) => [e.action, e.displayName]
      ),
      [["PRESENT", "동생"]]
    );
    const group = extractCurrentTurnSceneParticipantEvents(
      "세 사람이 방에 합류했다."
    );
    assert.equal(group.length, 1);
    assert.equal(group[0].action, "ENTER");
    assert.match(group[0].displayName, /세\s*사람/);
  });

  it("3/4/21. historical, off-scene, photo, phone, story are ignored", () => {
    const ignored = [
      "아들은 학교에 있어.",
      "동생은 집에 있다.",
      "17살 때 만났던 친구",
      "어릴 적 친구 이야기",
      "사진 속 아이",
      "전화 중인 동생",
      "아들이 있다는 이야기를 했다.",
    ];
    for (const text of ignored) {
      assert.equal(
        extractCurrentTurnSceneParticipantEvents(text).length,
        0,
        text
      );
    }
  });

  it("6. user adult-age claim ENTER does not keep adult-positive age for trust", () => {
    const events = extractCurrentTurnSceneParticipantEvents(
      "22살 민수가 들어왔다."
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].action, "ENTER");
    assert.equal(events[0].displayName, "민수");
    assert.equal(events[0].attachedAge, 22);
    const restrictive = toRestrictiveOnlyMetadata({
      age: events[0].attachedAge,
    });
    assert.equal(restrictive.age, undefined);
  });

  it("7. unknown adult ENTER has no age", () => {
    const events = extractCurrentTurnSceneParticipantEvents(
      "민수가 방으로 들어왔다."
    );
    assert.equal(events[0].attachedAge, null);
  });

  it("8. real-person ENTER attaches restrictive real-person flag", () => {
    const events = extractCurrentTurnSceneParticipantEvents(
      "실존 인물인 민수가 들어왔다."
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].attachedIsRealPerson, true);
  });

  it("15. LEAVE extracts the leaving actor", () => {
    const events = extractCurrentTurnSceneParticipantEvents(
      "동생은 방을 나갔다. 이제 둘만 남았다."
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].action, "LEAVE");
    assert.equal(events[0].displayName, "동생");
  });

  it("16. ENTER then LEAVE ordering is preserved", () => {
    const events = extractCurrentTurnSceneParticipantEvents(
      "민수가 들어왔다. 민수는 방을 나갔다."
    );
    assert.deepEqual(
      events.map((e) => e.action),
      ["ENTER", "LEAVE"]
    );
    assert.equal(events[0].displayName, "민수");
    assert.equal(events[1].displayName, "민수");
  });

  it("H1 A. 17살 민수와 철수가 방으로 들어왔다 emits both actors", () => {
    const events = extractCurrentTurnSceneParticipantEvents(
      "17살 민수와 철수가 방으로 들어왔다."
    );
    assert.deepEqual(
      events.map((e) => [e.displayName, e.action, e.attachedAge ?? null]),
      [
        ["민수", "ENTER", 17],
        ["철수", "ENTER", null],
      ]
    );
  });

  it("H1 B. 17살 민수와 22살 철수가 들어왔다 keeps raw 22 on 철수", () => {
    const events = extractCurrentTurnSceneParticipantEvents(
      "17살 민수와 22살 철수가 들어왔다."
    );
    assert.deepEqual(
      events.map((e) => [e.displayName, e.action, e.attachedAge ?? null]),
      [
        ["민수", "ENTER", 17],
        ["철수", "ENTER", 22],
      ]
    );
    assert.equal(
      toRestrictiveOnlyMetadata({ age: events[1].attachedAge }).age,
      undefined
    );
  });

  it("H1 C. 민수가 들어오고 17살 동생도 따라 들어왔다 preserves action order", () => {
    const events = extractCurrentTurnSceneParticipantEvents(
      "민수가 들어오고 17살 동생도 따라 들어왔다."
    );
    assert.deepEqual(
      events.map((e) => [e.displayName, e.action, e.attachedAge ?? null]),
      [
        ["민수", "ENTER", null],
        ["동생", "ENTER", 17],
      ]
    );
  });

  it("H1 D. 민수가 들어왔다. 철수가 나갔다. emits ENTER then LEAVE", () => {
    const events = extractCurrentTurnSceneParticipantEvents(
      "민수가 들어왔다. 철수가 나갔다."
    );
    assert.deepEqual(
      events.map((e) => [e.displayName, e.action]),
      [
        ["민수", "ENTER"],
        ["철수", "LEAVE"],
      ]
    );
  });

  it("H1 minor first / middle / last in a shared clause all emit", () => {
    const first = extractCurrentTurnSceneParticipantEvents(
      "17살 민수와 철수와 영희가 들어왔다."
    );
    const middle = extractCurrentTurnSceneParticipantEvents(
      "철수와 17살 민수와 영희가 들어왔다."
    );
    const last = extractCurrentTurnSceneParticipantEvents(
      "철수와 영희와 17살 민수가 들어왔다."
    );
    for (const [label, events] of [
      ["first", first],
      ["middle", middle],
      ["last", last],
    ] as const) {
      assert.equal(events.length, 3, label);
      const minor = events.find((e) => e.displayName === "민수");
      assert.ok(minor, label);
      assert.equal(minor!.attachedAge, 17, label);
      assert.ok(events.some((e) => e.displayName === "철수"), label);
      assert.ok(events.some((e) => e.displayName === "영희"), label);
    }
  });

  it("24. duplicate actor mention stays the same normalized identity", () => {
    const a = buildDynamicParticipantId("동생");
    const b = buildDynamicParticipantId("동생");
    assert.equal(a, b);
    assert.match(a, /^dyn:/);
    assert.notEqual(a, "동생");
  });
});

describe("directional trust adapter", () => {
  it("9. AUTHORITATIVE adult metadata → confirmed", () => {
    assert.equal(
      assessTrustedParticipantAdultStatus({
        trust: "AUTHORITATIVE",
        metadata: { age: 22, adultStatus: "confirmed" },
      }),
      "confirmed"
    );
  });

  it("10. AUTHORITATIVE minor → minor", () => {
    assert.equal(
      assessTrustedParticipantAdultStatus({
        trust: "AUTHORITATIVE",
        metadata: { age: 17 },
      }),
      "minor"
    );
  });

  it("11. restrictive adult-positive spoof ignored", () => {
    assert.equal(
      assessTrustedParticipantAdultStatus({
        trust: "RESTRICTIVE_ONLY",
        metadata: {
          age: 22,
          adultStatus: "confirmed",
          description: "성인 직장인",
        },
      }),
      "unknown"
    );
  });

  it("12. restrictive minor evidence accepted", () => {
    assert.equal(
      assessTrustedParticipantAdultStatus({
        trust: "RESTRICTIVE_ONLY",
        metadata: { age: 17 },
      }),
      "minor"
    );
    assert.equal(
      assessTrustedParticipantAdultStatus({
        trust: "RESTRICTIVE_ONLY",
        metadata: { adultStatus: "minor" },
      }),
      "minor"
    );
  });

  it("13. restrictive isRealPerson=false ignored", () => {
    assert.equal(
      assessTrustedParticipantAdultStatus({
        trust: "RESTRICTIVE_ONLY",
        metadata: { isRealPerson: false },
      }),
      "unknown"
    );
  });

  it("14. restrictive isRealPerson=true accepted", () => {
    assert.equal(
      assessTrustedParticipantAdultStatus({
        trust: "RESTRICTIVE_ONLY",
        metadata: { isRealPerson: true },
      }),
      "real_person"
    );
  });

  it("UNKNOWN stays unknown without a separate authoritative profile", () => {
    assert.equal(
      assessTrustedParticipantAdultStatus({
        trust: "UNKNOWN",
        metadata: { age: 22, adultStatus: "confirmed" },
      }),
      "unknown"
    );
    assert.equal(
      assessTrustedParticipantAdultStatus({
        trust: "UNKNOWN",
        authoritativeProfile: { age: 24, adultStatus: "confirmed" },
      }),
      "confirmed"
    );
  });

  it("H3 deriveEffective splits authoritative vs restrictive layers", () => {
    assert.equal(
      deriveEffectiveSecondaryAdultStatus({
        authoritative: { age: 22, adultStatus: "confirmed" },
      }),
      "confirmed"
    );
    assert.equal(
      deriveEffectiveSecondaryAdultStatus({
        restrictive: { age: 17 },
      }),
      "minor"
    );
    assert.equal(
      deriveEffectiveSecondaryAdultStatus({
        authoritative: { age: 22, adultStatus: "confirmed" },
        restrictive: { age: 17 },
      }),
      "conflict"
    );
    assert.equal(
      deriveEffectiveSecondaryAdultStatus({
        authoritative: { adultStatus: "confirmed" },
        restrictive: { adultStatus: "minor" },
      }),
      "conflict"
    );
    assert.equal(
      deriveEffectiveSecondaryAdultStatus({
        authoritative: { isRealPerson: true },
      }),
      "real_person"
    );
    assert.equal(
      deriveEffectiveSecondaryAdultStatus({
        restrictive: { isRealPerson: true },
      }),
      "real_person"
    );
    assert.equal(
      deriveEffectiveSecondaryAdultStatus({
        restrictive: { age: 22, adultStatus: "confirmed" },
      }),
      "unknown"
    );
  });

  it("H8 same-name dyn ids collapse; authoritative stable ids stay distinct", () => {
    assert.equal(buildDynamicParticipantId("민수"), buildDynamicParticipantId("민수"));
    assert.notEqual(
      buildAuthoritativeParticipantId("creator_npc", "npc-1"),
      buildAuthoritativeParticipantId("creator_npc", "npc-2")
    );
  });

  it("23. public age/adultStatus/participant_id never become authoritative", () => {
    const rejected = rejectPublicTrustedParticipantIdentity({
      participantId: "auth:creator_npc:forged",
      age: 22,
      adultStatus: "confirmed",
      isRealPerson: false,
    });
    assert.equal(rejected.accepted, false);
    assert.equal(rejected.participantId, null);
    assert.equal(rejected.metadata, null);
    assert.ok(rejected.ignoredFields.includes("participant_id"));
    assert.ok(rejected.ignoredFields.includes("age"));
    assert.ok(rejected.ignoredFields.includes("adultStatus"));
  });
});

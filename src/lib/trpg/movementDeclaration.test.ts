import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  declaredMovementGoals,
  describeMovementGoal,
  omitClausesAwayFromHere,
  omitLiveMovementClauses,
  parseMovementDeclaration,
} from "./movementDeclaration";

describe("movement declaration — bot stay fallback", () => {
  it("reads a live exit dash and does not read an aimed shot as travel", () => {
    assert.deepEqual(declaredMovementGoals("출구를 향해 전력 질주한다."), ["출구"]);
    assert.equal(
      describeMovementGoal(declaredMovementGoals("중앙홀 너머 빗장이 풀린 출구를 향해 전력 질주한다.")[0] ?? "").place,
      "출구"
    );
    assert.deepEqual(declaredMovementGoals("출구를 향해 화살을 쏜다."), []);
    assert.equal(parseMovementDeclaration("출구를 향해 화살을 쏜다.").live, false);
  });

  it("reads a follow into a named place and does not read a noun mention of moving", () => {
    const follow =
      "서하는 주 통로로 진입하는 데모유저의 뒤를 따라 이동하며, 손전등으로 바닥의 파편과 연구원들의 이동 흔적을 비추어 데모유저의 조사와 전진을 보조하려 했다.";
    assert.deepEqual(declaredMovementGoals(follow), ["서하는 주 통로"]);
    assert.equal(describeMovementGoal(declaredMovementGoals(follow)[0] ?? "").place, "통로");
    assert.deepEqual(declaredMovementGoals("복도로 이동 중이다."), ["복도"]);
    assert.deepEqual(declaredMovementGoals("주 통로로 이동한다."), ["주 통로"]);
    assert.deepEqual(declaredMovementGoals("데모유저가 주 통로로 들어가는 것을 본다."), []);
    assert.deepEqual(declaredMovementGoals('"주 통로로 이동하자." 하고 말한다.'), []);
    assert.deepEqual(declaredMovementGoals("주 통로로 이동하지 않고 그 자리에 남는다."), []);
    assert.deepEqual(declaredMovementGoals("제자리에 서서 도킹 베이를 비춘다."), []);
    assert.deepEqual(declaredMovementGoals("등대로 이어지는 길을 따라 걸으며 주변을 살핀다."), []);
    assert.deepEqual(declaredMovementGoals("주 통로로 돌을 던지고 돌아온다."), []);
    assert.deepEqual(declaredMovementGoals("주 통로로 들어가는 데모유저를 지켜보며 출발한다."), []);
    assert.deepEqual(declaredMovementGoals("주 통로로 이동"), ["주 통로"]);
    assert.deepEqual(declaredMovementGoals("연구원들의 이동 흔적을 비춘다."), []);
    assert.deepEqual(declaredMovementGoals("주 통로로 은신하며 이동한다."), ["주 통로"]);
    assert.deepEqual(declaredMovementGoals("주 통로로 달려 이동한다."), ["주 통로"]);
    assert.deepEqual(declaredMovementGoals("주 통로로 돌을 던진 후 이동한다."), []);
    assert.deepEqual(declaredMovementGoals("주 통로로 잠시 후 이동한다."), ["주 통로"]);
  });

  it("drops only clauses that priced a destination and keeps cover prose", () => {
    assert.equal(
      omitLiveMovementClauses("출구로 이동한다. 권태현의 옆에서 방어선을 유지한다."),
      "권태현의 옆에서 방어선을 유지한다"
    );
    assert.equal(omitLiveMovementClauses("출구를 향해 전력 질주한다."), "");
    assert.equal(omitLiveMovementClauses("자리를 지키며 동료를 엄호한다."), "자리를 지키며 동료를 엄호한다");
  });

  it("keeps remainder only when it names the current seat or a colocated companion", () => {
    const here = {
      here: "현관홀",
      colocatedNames: ["현이", "서하"],
      foreignPlaces: ["출구", "순환로", "권태현"],
    };
    assert.equal(omitClausesAwayFromHere({ body: "출구의 제어 패널을 조사한다", ...here }), "");
    assert.equal(omitClausesAwayFromHere({ body: "그곳의 제어 패널을 조사한다", ...here }), "");
    assert.equal(omitClausesAwayFromHere({ body: "권태현의 옆에서 방어선을 유지한다", ...here }), "");
    assert.equal(omitClausesAwayFromHere({ body: "자리를 지키며 동료를 엄호한다", ...here }), "");
    assert.equal(
      omitClausesAwayFromHere({ body: "현이 옆에서 방어선을 유지한다", ...here }),
      "현이 옆에서 방어선을 유지한다"
    );
    assert.equal(
      omitClausesAwayFromHere({ body: "현관홀에서 경계를 선다", ...here }),
      "현관홀에서 경계를 선다"
    );
    assert.equal(
      omitClausesAwayFromHere({
        body: "출구의 제어 패널을 조사한다",
        here: "순환로",
        colocatedNames: ["서하"],
        foreignPlaces: ["출구", "현관홀"],
      }),
      ""
    );
  });
});

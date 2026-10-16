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

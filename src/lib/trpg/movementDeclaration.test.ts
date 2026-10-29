import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clauseDeclaresFinishedResult,
  declaredMovementGoals,
  describeMovementGoal,
  omitClausesAwayFromHere,
  omitLiveMovementClauses,
  omitUnconfirmedAuthorityClauses,
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

  it("reads a body dash and exit rush as live movement without reviving an object throw", () => {
    assert.deepEqual(declaredMovementGoals("경보실 문턱으로 몸을 던졌다."), ["경보실 문턱"]);
    assert.deepEqual(declaredMovementGoals("출구 방향으로 쇄도했다."), ["출구 방향"]);
    assert.deepEqual(
      declaredMovementGoals("강이현은 경보실 문턱으로 몸을 던지며 출구 쪽으로 쇄도했다."),
      ["강이현은 경보실 문턱", "던지며 출구 쪽"]
    );
    assert.deepEqual(declaredMovementGoals("주 통로로 돌을 던지고 돌아온다."), []);
    assert.deepEqual(declaredMovementGoals("주 통로로 돌을 던진 후 이동한다."), []);
    for (const line of [
      "돌을 출구로 던졌다.",
      "시선을 경보실로 던졌다.",
      "탄환을 출구로 날렸다.",
      "출구로 돌을 던졌다.",
      "몸을 낮추고 돌을 출구로 던졌다.",
      "몸을 낮추고 탄환을 경보실로 날렸다.",
      "고개를 출구 쪽으로 던졌다.",
    ]) {
      assert.deepEqual(declaredMovementGoals(line), [], line);
      assert.equal(parseMovementDeclaration(line).live, false, line);
    }
    assert.deepEqual(declaredMovementGoals("돌을 내려놓고 몸을 출구로 던졌다."), ["출구"]);
    assert.equal(parseMovementDeclaration("돌을 내려놓고 몸을 출구로 던졌다.").live, true);
  });

  it("reads campaign #44 R11 body motion without pricing propelled objects", () => {
    const r11 =
      "이현은 쥐고 있던 접이식 석궁을 몸 안쪽으로 바짝 당겨 붙이며, 남쪽복도의 배관 엄폐물을 박차고 경보실 문턱으로 몸을 던졌다. 붉은 레이저가 빗겨나간 바닥의 기름막과 파편을 날렵하게 타고 넘어, 렌이 확보해 둔 출구 방향의 기둥 그늘을 향해 지체 없이 쇄도했다.";
    const goals = declaredMovementGoals(r11);
    assert.ok(goals.some((goal) => goal.includes("경보실")));
    assert.ok(goals.some((goal) => goal.includes("출구")));
    assert.equal(parseMovementDeclaration(r11).live, true);
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

  it("keeps a movement-free local clause and drops a foreign, deictic, or absent-seat clause", () => {
    const here = {
      here: "현관홀",
      colocatedNames: ["현이", "서하"],
      foreignPlaces: ["출구", "순환로", "권태현"],
    };
    assert.equal(omitClausesAwayFromHere({ body: "출구의 제어 패널을 조사한다", ...here }), "");
    assert.equal(omitClausesAwayFromHere({ body: "그곳의 제어 패널을 조사한다", ...here }), "");
    assert.equal(omitClausesAwayFromHere({ body: "권태현의 옆에서 방어선을 유지한다", ...here }), "");
    assert.equal(
      omitClausesAwayFromHere({ body: "자리를 지키며 동료를 엄호한다", ...here }),
      "자리를 지키며 동료를 엄호한다"
    );
    assert.equal(
      omitClausesAwayFromHere({ body: "잔을 테이블에 내려놓는다", ...here }),
      "잔을 테이블에 내려놓는다"
    );
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

  it("separates a finished result from the attempt and leaves an intentive exit in place", () => {
    assert.equal(clauseDeclaresFinishedResult("문은 열렸다"), true);
    assert.equal(clauseDeclaresFinishedResult("문은 이미 열렸다"), true);
    assert.equal(clauseDeclaresFinishedResult("잠긴 문을 연다"), false);
    assert.equal(clauseDeclaresFinishedResult("문을 열었다"), false);
    assert.equal(clauseDeclaresFinishedResult("문을 열고 나갈 준비를 한다"), false);
    assert.equal(clauseDeclaresFinishedResult("문을 열고 나갈 준비를 하려 했다"), false);
    assert.equal(
      clauseDeclaresFinishedResult("이미 열린 방폭 게이트를 통과해 지상 슬로프를 따라 센터 밖으로 나가려 한다"),
      false
    );
    assert.equal(clauseDeclaresFinishedResult("잠긴 문을 연다 문은 이미 열렸다"), false);
    assert.equal(
      omitUnconfirmedAuthorityClauses("잠긴 문을 연다. 문은 열렸다.", ["현이"]),
      "잠긴 문을 연다."
    );
    assert.equal(
      omitUnconfirmedAuthorityClauses("잠긴 문을 연다. 문은 이미 열렸다. 현이는 먼저 문을 연다.", ["현이"]),
      "잠긴 문을 연다."
    );
    assert.equal(
      omitUnconfirmedAuthorityClauses("잠긴 문을 연다 문은 이미 열렸다", ["현이"]),
      "잠긴 문을 연다 문은 이미 열렸다"
    );
    assert.equal(
      omitUnconfirmedAuthorityClauses("현이 옆에서 방어선을 유지한다. 권태현과 강이현을 본다.", ["현이", "권태현", "강이현"]),
      "현이 옆에서 방어선을 유지한다. 권태현과 강이현을 본다."
    );
    assert.equal(
      omitUnconfirmedAuthorityClauses('북쪽복도로 이동한다. "비켜."', ["현이"]),
      '북쪽복도로 이동한다. "비켜."'
    );
    const priced = omitUnconfirmedAuthorityClauses(
      "북쪽복도로 이동한다. 북쪽복도로 이동한다. 현이는 먼저 문을 연다. 문은 이미 열렸다.",
      ["현이"]
    );
    assert.equal(priced.startsWith("북쪽복도로 이동한다."), true);
    assert.doesNotMatch(priced, /현이는 먼저/);
    assert.doesNotMatch(priced, /이미 열렸/);
  });
});

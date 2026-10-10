/**
 * Shared fictional 라이크 18 / 렌 5-turn batch for #1486 Phase 2B/2C.
 * Not production chat logs. Not a second summary owner.
 */

export const PHASE2B_FIXTURE_IDENTITY =
  "이름/호칭: 라이크\n성별: 남\nPhase 2B fixture identity — not the production character sheet.";

export const PHASE2B_FIXTURE_PERSONA =
  "이름/호칭: 렌\n성별: 남\nPhase 2B fixture persona — not a live user row.";

export const PHASE2B_TURNS = [
  {
    turnIndex: 1,
    turn: {
      user: "저녁 일곱 시, 옥상에서 라이크에게 황동 라이터를 건넨다. 지난달에 처음 만난 건 맞잖아.",
      assistant:
        "라이크는 라이터를 받아 주머니에 넣었다. \"우린 어릴 때부터 알았어.\" 렌이 지난달에 처음 만났다고 하자 그는 어깨만 으쓱했다.",
    },
  },
  {
    turnIndex: 2,
    turn: {
      user: "여덟 시, 계단에서 떠나지 않고 남는다. 화를 풀 때까지 여기 있을게.",
      assistant:
        "라이크의 화가 가라앉고 그는 렌에게 미안하다고 했다. 렌이 남기로 한 뒤에야 목소리가 낮아졌다.",
    },
  },
  {
    turnIndex: 3,
    turn: {
      user: "같은 계단에 다시 앉아 라이크가 먼저 안길 때까지 따른다.",
      assistant:
        "라이크가 먼저 렌을 안았고 렌이 따랐다. 라이크는 받은 황동 라이터로 담배를 붙였다. 비슷한 침묵이 한 번 더 이어졌다.",
    },
  },
  {
    turnIndex: 4,
    turn: {
      user: "내일 아침 여섯 시에 역에서 기다리겠다는 말을 듣는다. 그래, 거기서 보자.",
      assistant:
        "라이크는 내일 아침 여섯 시에 역에서 기다리겠다고 약속했다. 렌이 받자 그는 짧게 고개를 끄덕였다.",
    },
  },
  {
    turnIndex: 5,
    turn: {
      user: "다음날 아침 여섯 시 십 분, 역에 조금 늦게 도착한다.",
      assistant:
        "라이크는 이미 역에서 기다리고 있었고 황동 라이터는 여전히 그의 주머니에 있었다. 시계는 여섯 시 십 분을 가리켰다.",
    },
  },
] as const;

export const PHASE2B_MUST_KEEP_FACTS = [
  { id: "time_order", sourceTurns: [1, 2, 5], tokens: ["일곱 시", "여덟 시", "여섯 시 십"] },
  { id: "actor_gift", sourceTurns: [1], tokens: ["황동 라이터", "건네"] },
  { id: "user_choice", sourceTurns: [2], tokens: ["떠나지 않고", "미안"] },
  { id: "emotion_change", sourceTurns: [2], tokens: ["화가", "미안"] },
  { id: "role_direction", sourceTurns: [3], tokens: ["먼저 안"] },
  { id: "claim_vs_fact", sourceTurns: [1], tokens: ["어릴 때부터", "지난달"] },
  { id: "promise", sourceTurns: [4, 5], tokens: ["여섯 시", "역에서"] },
  { id: "item_owner", sourceTurns: [1, 3, 5], tokens: ["황동 라이터", "주머니"] },
] as const;

export function missingPhase2bMustKeepIds(summary: string): string[] {
  return PHASE2B_MUST_KEEP_FACTS.filter((fact) =>
    fact.tokens.every((token) => !summary.includes(token))
  ).map((fact) => fact.id);
}

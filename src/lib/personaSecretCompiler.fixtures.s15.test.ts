/**
 * PR-S1.5 qualification fixtures (≥60).
 * Asserts: no invented unsupported facts, grounding, atomic split on clear compounds.
 */
import Module from "module";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compilePersonaSecretsDeterministic } from "@/lib/personaSecretCompilerDeterministic";
import { validatePersonaSecretCompilerResult } from "@/lib/personaSecretCompilerValidate";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

type Fixture = {
  id: string;
  category: string;
  source: string;
  minSecrets?: number;
  forbid?: RegExp;
};

function buildFixtures(): Fixture[] {
  const identity: Fixture[] = Array.from({ length: 10 }, (_, i) => ({
    id: `identity_${i + 1}`,
    category: "IDENTITY/ORIGIN",
    source: [
      "나는 이계 출신이다.",
      "진짜 이름은 숨기고 산다.",
      "위장 신분을 쓰고 있다.",
      "고향은 먼 차원이다.",
      "가짜 학생으로 행세한다.",
      "본명은 말하지 않는다.",
      "다른 세계 출신이다.",
      "신분을 속이고 있다.",
      "나는 원래 다른 곳에서 왔다.",
      "정체를 숨긴 채 산다.",
    ][i]!,
  }));

  const body: Fixture[] = Array.from({ length: 10 }, (_, i) => ({
    id: `body_${i + 1}`,
    category: "BODY_MARK",
    source: [
      "등에 문신이 있다.",
      "손목에 흉터가 있다.",
      "목에 낙인이 있다.",
      "어깨에 점이 있다.",
      "등에 검은 문신이 있다.",
      "왼손에 화상이 있다.",
      "쇄골 아래 표식이 있다.",
      "등에 문신이 있다, 그 문신은 저주의 의미다.",
      "허벅지에 흉터가 있다.",
      "등에 숨긴 문신이 있다.",
    ][i]!,
    minSecrets: i === 7 ? 2 : 1,
  }));

  const ability: Fixture[] = Array.from({ length: 10 }, (_, i) => ({
    id: `ability_${i + 1}`,
    category: "ABILITY/COST",
    source: [
      "치유 능력이 있다.",
      "불을 다루는 힘이 있다.",
      "치유 능력이 있다, 쓸 때마다 열이 나는 부작용이 있다.",
      "순간이동 능력이 있다.",
      "마법을 쓸 수 있다.",
      "치유 능력이 있다, 사용 후 반동이 온다.",
      "투시를 할 수 있다.",
      "능력을 쓰면 코피가 나는 부작용이 있다.",
      "재생 능력이 있다.",
      "힘을 쓰면 시야가 흐려지는 대가가 있다.",
    ][i]!,
    minSecrets: i === 2 || i === 5 ? 2 : 1,
    forbid: /힐링 웨이브|아쿠아 힐|스킬카드/,
  }));

  const health: Fixture[] = Array.from({ length: 8 }, (_, i) => ({
    id: `health_${i + 1}`,
    category: "HEALTH",
    source: [
      "희귀 질병을 앓고 있다.",
      "밤에 열이 난다.",
      "희귀 질병을 앓고 있다, 밤에 기침하는 증상이 있다.",
      "독에 중독되어 있다.",
      "만성 통증이 있다.",
      "감염을 숨기고 있다.",
      "약을 먹어야 한다.",
      "병의 원인을 모른다.",
    ][i]!,
    minSecrets: i === 2 ? 2 : 1,
  }));

  const financial: Fixture[] = Array.from({ length: 8 }, (_, i) => ({
    id: `fin_${i + 1}`,
    category: "FINANCIAL/CRIME",
    source: [
      "큰 빚이 있다.",
      "큰 빚이 있다, 도박 때문에 생겼다.",
      "사채를 썼다.",
      "훔친 돈이 있다.",
      "불법 거래를 했다.",
      "빚을 갚지 못했다.",
      "절도 전과가 있다.",
      "돈을 빌린 뒤 도망쳤다.",
    ][i]!,
    minSecrets: i === 1 ? 2 : 1,
    forbid: /채권자|독촉장|사채업자 김/,
  }));

  const past: Fixture[] = Array.from({ length: 8 }, (_, i) => ({
    id: `past_${i + 1}`,
    category: "PAST/AFFILIATION",
    source: [
      "과거에 큰 사고를 냈다.",
      "예전에 조직을 떠났다.",
      "그때 계약을 맺었다.",
      "과거 소속이 있다.",
      "옛 동료를 배신했다.",
      "과거에 살인을 목격했다.",
      "조직에서 도망쳤다.",
      "예전에 금기를 어겼다.",
    ][i]!,
    forbid: /천공기관|정보국 제7과|암살단 이름/,
  }));

  const adversarial: Fixture[] = [
    {
      id: "adv_1",
      category: "ADVERSARIAL",
      source: "빚이 있다. 하지만 채권자 이름은 적지 않는다.",
      forbid: /김채권|독촉장 번호/,
    },
    {
      id: "adv_2",
      category: "ADVERSARIAL",
      source: "능력이 있다. 기술명은 모른다.",
      forbid: /울티마|메테오/,
    },
    {
      id: "adv_3",
      category: "ADVERSARIAL",
      source: "문신이 있다. 조직 의미는 쓰지 않았다.",
      forbid: /암살단 문양|결사 인장/,
    },
    {
      id: "adv_4",
      category: "ADVERSARIAL",
      source: "만약 내가 이계 출신이라면 어떨까.",
    },
    {
      id: "adv_5",
      category: "ADVERSARIAL",
      source: "나는 이계 출신이 아니다. 그냥 설정 메모다.\n\n등에 문신이 있다.",
      minSecrets: 1,
    },
    {
      id: "adv_6",
      category: "ADVERSARIAL",
      source: "가정: 과거 기관에 다녔을 수도 있다. 확실하지 않다.",
      forbid: /중앙정보기관/,
    },
  ];

  return [...identity, ...body, ...ability, ...health, ...financial, ...past, ...adversarial];
}

describe("PR-S1.5 qualification fixtures", () => {
  const fixtures = buildFixtures();

  it(`has at least 60 fixtures (got ${fixtures.length})`, () => {
    assert.ok(fixtures.length >= 60);
  });

  it("all fixtures ground and avoid forbidden invention", () => {
    let invented = 0;
    let groundingFail = 0;
    let splitMiss = 0;

    for (const f of fixtures) {
      const result = compilePersonaSecretsDeterministic(f.source);
      const v = validatePersonaSecretCompilerResult(result, f.source);
      if (!v.ok) {
        groundingFail++;
        continue;
      }
      if (f.minSecrets != null && result.secrets.length < f.minSecrets) {
        splitMiss++;
      }
      const blob = JSON.stringify(result);
      if (f.forbid && f.forbid.test(blob)) {
        invented++;
      }
      // Facts must not introduce tokens absent from source for obvious inventions
      for (const s of result.secrets) {
        for (const q of s.sourceQuotes) {
          if (!f.source.includes(q) && !f.source.replace(/\s+/g, " ").includes(q.replace(/\s+/g, " "))) {
            groundingFail++;
          }
        }
      }
    }

    assert.equal(invented, 0, `invented=${invented}`);
    assert.equal(groundingFail, 0, `groundingFail=${groundingFail}`);
    const clearSplitFixtures = fixtures.filter((f) => (f.minSecrets ?? 1) >= 2);
    const splitAccuracy =
      clearSplitFixtures.length === 0
        ? 1
        : 1 - splitMiss / clearSplitFixtures.length;
    assert.ok(splitAccuracy >= 0.95, `splitAccuracy=${splitAccuracy}`);
  });
});

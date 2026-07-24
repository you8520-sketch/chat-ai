import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compileCanonPlanV1 } from "@/lib/canonPlan/compiler";
import {
  detectFundamentalConstraint,
  inferSalienceWithReason,
  isDeterministicHazardResponse,
  isMandatoryCapabilityCost,
  isStrongImpossibilityLaw,
} from "@/lib/canonPlan/canonSalience";
import { AUDIT_FIXTURES } from "../../../data/canon-core-audit/fixtures";
import { ATOMIC_FACTS } from "../../../data/canon-core-audit/manifests";
import {
  compilePlan,
  matchFactChunks,
  salienceStatusForFact,
} from "../../../data/canon-core-audit/reconcile-harness";

const NOW = "2026-07-24T00:00:00.000Z";
const WORLD = (title: string, body: string) => `${title}\n${body}`;

function infer(text: string, sectionTitle: string, bucket: "world" | "character" = "world") {
  return inferSalienceWithReason({ text, sectionTitle, bucket });
}

function compileRaw(raw: string) {
  const r = compileCanonPlanV1({ creatorRawDescription: raw, now: NOW });
  assert.equal(r.ok, true);
  return r.plan!;
}

function factSalience(factId: string) {
  const fact = ATOMIC_FACTS.find((f) => f.id === factId)!;
  const plan = compilePlan(AUDIT_FIXTURES.find((f) => f.id === fact.fixtureId)!.creatorRawDescription);
  const { sourceStatus, chunks } = matchFactChunks(fact, plan);
  return salienceStatusForFact(sourceStatus, chunks, plan);
}

describe("Phase 2B — F1 strong impossibility positives", () => {
  const positives = [
    { text: "죽은 사람은 어떤 마법으로도 되살릴 수 없다.", section: "[세계관 — 부활]" },
    { text: "어떤 의식으로도 죽은 자를 되살릴 수 없다.", section: "[세계관 — 부활]" },
    { text: "누구도 죽은 자를 완전히 부활시킬 수 없다.", section: "[불변의 세계법칙]" },
    { text: "절대로 죽은 자를 되살릴 수 없다.", section: "[세계관 — 마법]" },
    { text: "No magic can ever resurrect the dead under any circumstance.", section: "[세계관 — 부활]" },
  ];
  for (const [i, p] of positives.entries()) {
    it(`F1 positive ${i + 1}`, () => {
      assert.equal(isStrongImpossibilityLaw(p.text), true);
      const d = infer(p.text, p.section);
      assert.equal(d.salience, "core");
      assert.ok(
        d.reason === "FUNDAMENTAL_IMPOSSIBILITY" || d.reason === "EXPLICIT_LAW_SECTION",
        d.reason
      );
    });
  }
});

describe("Phase 2B — F2 mandatory cost positives", () => {
  const positives = [
    { text: "마법을 사용할수록 사용자의 수명이 줄어든다.", section: "[세계관 — 마법]" },
    { text: "주문을 쓸수록 생명력이 영구적으로 감소한다.", section: "[세계관 — 마법]" },
    { text: "능력을 사용할 때마다 기억 하나를 잃는다.", section: "[능력]" },
    { text: "Every use of magic permanently reduces the user's lifespan.", section: "[세계관 — 마법]" },
    { text: "스킬을 발동할 때마다 생명력을 소모한다.", section: "[능력]" },
  ];
  for (const [i, p] of positives.entries()) {
    it(`F2 positive ${i + 1}`, () => {
      assert.equal(isMandatoryCapabilityCost(p.text), true);
      const bucket = p.section.includes("능력") ? "character" : "world";
      const d = infer(p.text, p.section, bucket);
      assert.equal(d.salience, "core");
    });
  }
});

describe("Phase 2B — F3 hazard response positives", () => {
  const positives = [
    { text: "코어 근처에서 총성을 내면 동조체가 몰려든다.", section: "[세계관]" },
    { text: "코어 near gunshot triggers hostile sync bodies to converge.", section: "[world lore]" },
    { text: "감염 구역 안에서 총을 쏘면 적대 개체가 몰려든다.", section: "[세계관 — 감염]" },
    { text: "코어 근처에서 발포하면 동조체가 추적한다.", section: "[세계관]" },
    { text: "If a gunshot rings near the core, sync bodies swarm.", section: "[세계관]" },
  ];
  for (const [i, p] of positives.entries()) {
    it(`F3 positive ${i + 1}`, () => {
      assert.equal(isDeterministicHazardResponse(p.text), true);
      assert.equal(infer(p.text, p.section).salience, "core");
    });
  }
});

describe("Phase 2B — frozen fixture target facts", () => {
  it("fl-A1/fl-A2/fl-A4 → CORE", () => {
    assert.equal(factSalience("fl-A1"), "CORE");
    assert.equal(factSalience("fl-A2"), "CORE");
    assert.equal(factSalience("fl-A4"), "CORE");
  });

  it("contextual residuals remain DORMANT", () => {
    for (const id of ["eno-A5", "hd-A1", "hd-A2", "fam-A1", "sur-A1", "sur-A2", "sur-A3"]) {
      assert.equal(factSalience(id), "DORMANT", id);
    }
  });
});

describe("Phase 2B — hard negatives (>=35)", () => {
  const negatives: Array<{ text: string; section: string; bucket?: "world" | "character" | "player" | "scenario_meta" }> = [
    { text: "비가 오면 상점 주인은 일찍 문을 닫는다.", section: "[세계관]" },
    { text: "왕이 죽으면 제국은 혼란에 빠진다.", section: "[세계관]" },
    { text: "피곤하면 커피를 마신다.", section: "[성격]" },
    { text: "호감도 80 이상이면 비밀 루트가 열린다.", section: "[비밀]" },
    { text: "경보가 울리면 경비병들이 문으로 모인다.", section: "[세계관]" },
    { text: "기생종은 소음에 반응한다.", section: "[세계관 — 기생종]" },
    { text: "북쪽 관문 너머의 안개는 시야를 10m 이하로 줄인다.", section: "[세계관 — 북쪽 관문]" },
    { text: "유저만 알고 있는 절대 규칙: 되살릴 수 없다.", section: "[비밀]", bucket: "player" },
    { text: "숨겨진 부활 루트: 죽은 자도 되살릴 수 있다.", section: "[비밀]" },
    { text: "오늘은 비가 와서 갈 수 없다.", section: "[세계관]" },
    { text: "문이 잠겨 들어갈 수 없다.", section: "[세계관]" },
    { text: "그는 사람을 쉽게 믿을 수 없다.", section: "[성격]" },
    { text: "지금은 능력을 사용할 수 없다.", section: "[능력]" },
    { text: "매일 약초를 돌본다.", section: "[세계관 — 약초]" },
    { text: "3년 전 리사이틀에서 패닉으로 연주를 멈췄다.", section: "[배경]" },
    { text: "연료 부족 시 체온이 급락한다.", section: "[세계관 — 연료]" },
    { text: "돈을 쓰면 잔액이 줄어든다.", section: "[세계관]" },
    { text: "특정 조건 충족 시 폭주 이벤트가 발생한다.", section: "[시스템]" },
    { text: "상태 표시 창은 매 턴 갱신된다.", section: "[시스템 명령]", bucket: "scenario_meta" },
    { text: "카일은 검은 깃발의 정보원이다.", section: "[비밀]" },
    { text: "코어가 0이 되면 즉사한다.", section: "[세계관 — 마나 코어]" },
    { text: "퇴장 포탈은 클리어 전까지 열리지 않는다.", section: "[세계관 — 던전 규칙]" },
    { text: "필터 없이 마시면 48시간 내 발열.", section: "[세계관 — 식수]" },
    { text: "총알은 교환 불가 자원이다.", section: "[세계관 — 무기]" },
    { text: "가문 구성원은 외부인과 혼인 전까지 가문 비밀을 누설할 수 없다.", section: "[세계관 — 가문 규율]" },
    { text: "던전 안에서는 NPC가 아닌 모든 존재가 적대적이다.", section: "[세계관 — 던전 규칙]" },
    { text: "마나 코어는 헌터의 생명력과 연결된다.", section: "[세계관 — 마나 코어]" },
    { text: "브레인 포드는 숙주 머리에 들러붙어 뇌를 파먹는다.", section: "[세계관 — 브레인 포드]" },
    { text: "폭주한 센티넬은 주변을 파괴한 뒤 소멸한다.", section: "[세계관 — 폭주]" },
    { text: "친절은 검증 전까지 감염 징후다.", section: "[불변의 세계법칙]" },
    { text: "역변은 이기는 게 아니라 견디고 봉인하는 것이다.", section: "[불변의 세계법칙]" },
    { text: "에녹은 성채 최정예 저격수였다.", section: "[배경]" },
    { text: "피를 마시면 단기간 초인적 감각을 얻지만, 다음 날 극심한 허약이 온다.", section: "[능력]" },
    { text: "밤의 금기: 달빛 아래서 타인의 피를 마시는 행위는 마을에서 사형이다.", section: "[세계관]" },
    { text: "Hidden resurrection route unlocks at affection 90.", section: "[secret]" },
    { text: "Cannot enter because the door is locked today.", section: "[world lore]" },
  ];

  it(`blocks ${negatives.length} hard negatives from F1/F2/F3`, () => {
    assert.ok(negatives.length >= 35);
    for (const n of negatives) {
      const bucket = n.bucket ?? (n.section.includes("능력") || n.section.includes("배경") || n.section.includes("성격") ? "character" : "world");
      const d = inferSalienceWithReason({ text: n.text, sectionTitle: n.section, bucket });
      assert.notEqual(d.reason, "FUNDAMENTAL_IMPOSSIBILITY", n.text);
      assert.notEqual(d.reason, "FUNDAMENTAL_MANDATORY_COST", n.text);
      assert.notEqual(d.reason, "FUNDAMENTAL_HAZARD_RESPONSE", n.text);
      if (bucket === "player" || bucket === "scenario_meta") {
        assert.equal(d.salience, "dormant");
      }
    }
  });
});

describe("Phase 2B — adversarial near misses", () => {
  it("F1 near misses stay dormant", () => {
    for (const text of [
      "오늘은 비가 와서 갈 수 없다.",
      "문이 잠겨 들어갈 수 없다.",
      "그는 사람을 쉽게 믿을 수 없다.",
      "지금은 능력을 사용할 수 없다.",
    ]) {
      assert.equal(isStrongImpossibilityLaw(text), false);
    }
  });

  it("F2 near misses stay dormant", () => {
    for (const text of ["연료 부족 시 체온이 급락한다.", "매일 약초를 돌본다.", "3년 전 한 번 목숨을 잃었다."]) {
      assert.equal(isMandatoryCapabilityCost(text), false);
    }
  });

  it("F3 near misses stay dormant", () => {
    for (const text of [
      "비가 오면 상점 주인은 문을 닫는다.",
      "경보가 울리면 경비병이 문으로 모인다.",
      "기생종은 소음에 반응한다.",
    ]) {
      assert.equal(isDeterministicHazardResponse(text), false);
    }
  });
});

describe("Phase 2B — detectFundamentalConstraint unit", () => {
  it("returns null without world/system context", () => {
    assert.equal(
      detectFundamentalConstraint({ text: "죽은 사람은 되살릴 수 없다.", bucket: "character", sectionTitle: "[성격]" }),
      null
    );
  });
});

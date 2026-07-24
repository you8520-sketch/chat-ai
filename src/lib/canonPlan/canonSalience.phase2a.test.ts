import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compileCanonPlanV1 } from "@/lib/canonPlan/compiler";
import {
  EXPLICIT_LAW_SECTION_TITLE,
  inferSalienceWithReason,
  isGenuinePlotHook,
  isPermanentRampageLaw,
} from "@/lib/canonPlan/canonSalience";

const NOW = "2026-07-24T00:00:00.000Z";

function compileRaw(raw: string) {
  const r = compileCanonPlanV1({ creatorRawDescription: raw, now: NOW });
  assert.equal(r.ok, true);
  return r.plan!;
}

function chunkWithText(plan: ReturnType<typeof compileRaw>, needle: string) {
  const c = plan.chunks.find((x) => x.text.includes(needle));
  assert.ok(c, `missing chunk containing: ${needle}`);
  return c;
}

describe("Phase 2A salience — positive regressions", () => {
  it("A. [불변의 세계법칙] sentence without marker in chunk text → CORE", () => {
    const plan = compileRaw(
      ["[불변의 세계법칙]", "총성은 죽음을 부른다.", "기원종은 피해야 하는 재난이다."].join("\n")
    );
    const gun = chunkWithText(plan, "총성은 죽음");
    assert.equal(gun.salience, "core");
    assert.equal(plan.coreIds.includes(gun.id), true);
    assert.doesNotMatch(gun.text, /불변|절대/);
  });

  it("B. character ability permanent rule with 절대 규칙 → CORE in character bucket", () => {
    const plan = compileRaw(
      [
        "[능력]",
        "능력을 사용할 때마다 기억 하나를 잃는다.",
        "절대 규칙: 되돌릴 수 없다.",
      ].join("\n")
    );
    const rule = chunkWithText(plan, "절대 규칙");
    assert.equal(rule.bucket, "character");
    assert.equal(rule.salience, "core");
  });

  it("C. 절대로 variant in valid law section → CORE", () => {
    const plan = compileRaw(
      ["[불변의 세계법칙]", "준서는 절대로 자기 손을 함부로 다루지 않는다."].join("\n")
    );
    const c = chunkWithText(plan, "절대로");
    assert.equal(c.salience, "core");
  });

  it("D. sentinel permanent rampage law in system/law section → CORE", () => {
    const plan = compileRaw(
      [
        "[시스템 법칙]",
        "가이드와 장시간 접촉하지 못한 센티넬은 결국 폭주한다.",
      ].join("\n")
    );
    const c = chunkWithText(plan, "폭주");
    assert.equal(c.salience, "core");
    assert.equal(isGenuinePlotHook(c.text), false);
    assert.equal(isPermanentRampageLaw(c.text), true);
  });
});

describe("Phase 2A salience — negative regressions", () => {
  it("A. 폭주 route unlock stays DORMANT", () => {
    const text = "호감도 80 이상이면 폭주 루트가 해금된다.";
    assert.equal(isGenuinePlotHook(text), true);
    const d = inferSalienceWithReason({ text, bucket: "character", sectionTitle: "[비밀]" });
    assert.equal(d.salience, "dormant");
    assert.equal(d.reason, "PLOT_HOOK");
  });

  it("B. 폭주 트리거 / event unlock stays DORMANT", () => {
    for (const text of [
      "특정 조건 충족 시 폭주 트리거가 발생한다.",
      "폭주 이벤트 해금 조건: 호감 90",
    ]) {
      assert.equal(isGenuinePlotHook(text), true);
      assert.equal(
        inferSalienceWithReason({ text, bucket: "scenario_meta", sectionTitle: "[시스템]" }).salience,
        "dormant"
      );
    }
  });

  it("C. player-only secret with 절대 규칙 never CORE", () => {
    const plan = compileRaw("유저만 알고 있는 절대 규칙: 숨겨진 회귀 루트.");
    const player = plan.chunks.find((c) => c.bucket === "player" || /유저만/.test(c.text));
    assert.ok(player);
    assert.equal(player!.salience, "dormant");
    assert.equal(plan.coreIds.includes(player!.id), false);
  });

  it("D. scenario_meta law-like words never CORE", () => {
    const d = inferSalienceWithReason({
      text: "상태 표시 창은 매 턴 갱신된다. 루프 트리거 조건.",
      bucket: "scenario_meta",
      sectionTitle: "[시스템 명령]",
    });
    assert.equal(d.salience, "dormant");
    assert.equal(d.reason, "RESTRICTED_BUCKET");
  });

  it("E. casual causal lore X→Y not CORE", () => {
    const plan = compileRaw(["[세계관]", "비가 오면 상점 주인은 일찍 문을 닫는다."].join("\n"));
    const c = chunkWithText(plan, "비가 오면");
    assert.equal(c.salience, "dormant");
  });

  it("F. historical consequence not CORE", () => {
    const plan = compileRaw(["[세계관]", "왕이 죽으면 제국은 혼란에 빠진다."].join("\n"));
    const c = chunkWithText(plan, "왕이 죽으면");
    assert.equal(c.salience, "dormant");
  });
});

describe("Phase 2A explicit law section classifier", () => {
  it("matches intended titles and rejects bare 규칙 mentions", () => {
    assert.equal(EXPLICIT_LAW_SECTION_TITLE.test("[불변의 세계법칙]"), true);
    assert.equal(EXPLICIT_LAW_SECTION_TITLE.test("[시스템 법칙]"), true);
    assert.equal(EXPLICIT_LAW_SECTION_TITLE.test("[성격]"), false);
    assert.equal(EXPLICIT_LAW_SECTION_TITLE.test("이 규칙은 참고용이다"), false);
  });
});

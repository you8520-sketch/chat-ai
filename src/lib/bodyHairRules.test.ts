import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveHairDescriptionPolicy, sanitizeHairDescriptions } from "@/lib/bodyHairRules";

const defaultPolicy = resolveHairDescriptionPolicy("male", "", "female");

describe("sanitizeHairDescriptions", () => {
  it("keeps philtrum (인중) lip contact — not beard policy", () => {
    const input =
      "에쉬의 입술이 렌의 인중을 스쳤다. 젖은 감촉이 입가를 훑었다.";
    const out = sanitizeHairDescriptions(input, defaultPolicy);
    assert.match(out, /인중을 스쳤다/);
  });

  it("keeps goosebump phrasing (털이 서리친 몸) — not body-hair policy", () => {
    const input = "전율이 흐르며 털이 서리친 몸이 떨렸다. 숨이 가빠졌다.";
    const out = sanitizeHairDescriptions(input, defaultPolicy);
    assert.match(out, /털이 서리친 몸/);
  });

  it("drops explicit body-hair sentences", () => {
    const input = "그의 검은 털이 복슬거렸다. 시선이 멈췄다.";
    const out = sanitizeHairDescriptions(input, defaultPolicy);
    assert.doesNotMatch(out, /검은 털/);
    assert.match(out, /시선이 멈췄다/);
  });

  it("drops beard sentences when setting disallows beard", () => {
    const input = "턱수염이 거칠게 자라 있었다. 그는 고개를 돌렸다.";
    const out = sanitizeHairDescriptions(input, defaultPolicy);
    assert.doesNotMatch(out, /턱수염/);
    assert.match(out, /고개를 돌렸다/);
  });

  it("returns original text when every part would be dropped", () => {
    const input = "턱수염만 보였다.";
    const out = sanitizeHairDescriptions(input, defaultPolicy);
    assert.equal(out, input);
  });

  it("emits diagnostic log when violations are found", () => {
    const logs: unknown[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => {
      if (args[0] === "[hair-sanitize-diagnostic]") logs.push(args[1]);
    };
    try {
      sanitizeHairDescriptions("음모가 보였다. 숨을 고르며.", defaultPolicy);
    } finally {
      console.log = orig;
    }
    assert.equal(logs.length, 1);
    const row = logs[0] as Record<string, unknown>;
    assert.equal(row.violation_count, 1);
    assert.equal(row.replacement_scope, "partial");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  evaluateCastRelationshipGraph,
  normalizeOfficialCastRelationships,
  reconcileReplacementPublicRelationships,
  resolveOfficialCastRelationshipTarget,
  type CastRelationship,
} from "@/lib/officialSupply/castRelationships";
import { evaluateInternalRegionConsistency, internalWorldRegions } from "@/lib/officialSupply/worldQa";

const cast = [
  { draftKey: "a", name: "볼프강 폰 발켄하임" },
  { draftKey: "b", name: "루시안 바스케스" },
  { draftKey: "c", name: "이노센트 0호" },
  { draftKey: "d", name: "노엘 벨로체" },
];
const rel = (target: string, pub = "공개 관계", privateOpinion = "속내", hidden = ""): CastRelationship => ({
  target,
  public: pub,
  privateOpinion,
  hidden,
});
const ctx = (selfDraftKey: string) => ({ cast, selfDraftKey, removedNames: ["발레리아 드 솔레이"] });

describe("canonical cast relationship target owner", () => {
  it("3/9. a given-name alias resolves to the one canonical full name and is persisted that way", () => {
    const r = resolveOfficialCastRelationshipTarget("볼프강", ctx("b"));
    assert.deepEqual(r, { ok: true, draftKey: "a", canonical: "볼프강 폰 발켄하임", viaAlias: true });
    const n = normalizeOfficialCastRelationships([rel("볼프강"), rel("노엘"), rel("루시안 바스케스")], ctx("c"));
    assert.deepEqual(n.relationships.map((x) => x.target), ["볼프강 폰 발켄하임", "노엘 벨로체", "루시안 바스케스"]);
    assert.deepEqual(n.renamed, [
      { from: "볼프강", to: "볼프강 폰 발켄하임" },
      { from: "노엘", to: "노엘 벨로체" },
    ]);
    assert.equal(resolveOfficialCastRelationshipTarget("루시안바스케스", ctx("a")).ok, true);
  });

  it("4. a given name shared by two cast members is ambiguous and rejected", () => {
    const twins = [...cast, { draftKey: "e", name: "볼프강 슈타인" }];
    const r = resolveOfficialCastRelationshipTarget("볼프강", { cast: twins, selfDraftKey: "b" });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.code, "relationship_ambiguous_alias");
    assert.equal(resolveOfficialCastRelationshipTarget("볼프강 슈타인", { cast: twins, selfDraftKey: "b" }).ok, true);
    const n = normalizeOfficialCastRelationships([rel("볼프강")], { cast: twins, selfDraftKey: "b" });
    assert.deepEqual(n.issues.map((i) => i.code), ["relationship_ambiguous_alias"]);
    assert.deepEqual(n.relationships, []);
  });

  it("an alias shared with a removed member is ambiguous too (never guessed)", () => {
    const r = resolveOfficialCastRelationshipTarget("노엘", { cast, selfDraftKey: "a", removedNames: ["노엘 그레이"] });
    assert.equal(!r.ok && r.code, "relationship_ambiguous_alias");
  });

  it("5. self relationships are rejected (and dropped by the repair)", () => {
    const r = resolveOfficialCastRelationshipTarget("이노센트 0호", ctx("c"));
    assert.equal(!r.ok && r.code, "relationship_self");
    const n = normalizeOfficialCastRelationships([rel("이노센트 0호"), rel("루시안")], ctx("c"));
    assert.deepEqual(n.dropped, [{ target: "이노센트 0호", code: "relationship_self" }]);
    assert.deepEqual(n.relationships.map((x) => x.target), ["루시안 바스케스"]);
  });

  it("6/7. removed and unknown targets are rejected; unknown blocks persistence", () => {
    const removedAlias = resolveOfficialCastRelationshipTarget("발레리아", ctx("a"));
    assert.equal(!removedAlias.ok && removedAlias.code, "relationship_removed_target");
    const removed = resolveOfficialCastRelationshipTarget("발레리아 드 솔레이", ctx("a"));
    assert.equal(!removed.ok && removed.code, "relationship_removed_target");
    const unknown = resolveOfficialCastRelationshipTarget("카시안", ctx("a"));
    assert.equal(!unknown.ok && unknown.code, "relationship_unknown_target");
    const n = normalizeOfficialCastRelationships([rel("카시안"), rel("발레리아")], ctx("a"));
    assert.deepEqual(n.issues.map((i) => i.code), ["relationship_unknown_target"]);
    assert.deepEqual(n.dropped.map((d) => d.code), ["relationship_removed_target"]);
  });

  it("8. alias + full name for the same person is a duplicate", () => {
    const n = normalizeOfficialCastRelationships([rel("볼프강"), rel("볼프강 폰 발켄하임")], ctx("b"));
    assert.deepEqual(n.issues.map((i) => i.code), ["relationship_duplicate_target"]);
    assert.equal(n.relationships.length, 1);
  });

  it("graph QA: non-canonical, self, duplicate and removed links all fail", () => {
    const qa = evaluateCastRelationshipGraph(
      [
        { draftKey: "a", name: "볼프강 폰 발켄하임", relationships: [rel("루시안"), rel("루시안 바스케스")] },
        { draftKey: "b", name: "루시안 바스케스", relationships: [rel("발레리아 드 솔레이")] },
        { draftKey: "c", name: "이노센트 0호", relationships: [rel("이노센트 0호")] },
        { draftKey: "d", name: "노엘 벨로체", relationships: [] },
      ],
      { removedNames: ["발레리아 드 솔레이"] }
    );
    const codes = new Set(qa.errors.map((e) => e.code));
    for (const code of ["relationship_not_canonical", "relationship_duplicate_target", "relationship_removed_target", "relationship_self"]) {
      assert.ok(codes.has(code), code);
    }
  });

  it("10. replacement reconciliation adds only public awareness; 11. private/hidden are never forced", () => {
    const entries = [
      { draftKey: "a", name: "볼프강 폰 발켄하임", publicRole: "북부 방벽 수호사령관", relationships: [rel("루시안 바스케스")] },
      { draftKey: "b", name: "루시안 바스케스", publicRole: "브로커", relationships: [rel("볼프강 폰 발켄하임")] },
      {
        draftKey: "n",
        name: "에드릭",
        publicRole: "대신전 이단심문관",
        relationships: [rel("볼프강 폰 발켄하임", "군사 정보를 주고받는다.", "위험하다", "보고서 사본"), rel("루시안 바스케스", "")],
      },
    ];
    const before = evaluateCastRelationshipGraph(entries, { replacedDraftKeys: ["n"] });
    assert.ok(before.errors.some((e) => e.code === "relationship_replacement_one_way"));
    const additions = reconcileReplacementPublicRelationships(entries, ["n"]);
    assert.deepEqual(additions.get("a"), [
      { target: "에드릭", public: "대신전 이단심문관. 공개된 접점(에드릭 측): 군사 정보를 주고받는다.", privateOpinion: "", hidden: "" },
    ]);
    assert.equal(additions.has("b"), false, "no public tie declared → no awareness invented");
    const after = evaluateCastRelationshipGraph(
      entries.map((e) => ({ ...e, relationships: [...e.relationships, ...(additions.get(e.draftKey) ?? [])] })),
      { replacedDraftKeys: ["n"] }
    );
    assert.deepEqual(after.errors, []);
    assert.deepEqual(after.stats.oneWay, [["n", "b"]], "general asymmetry is reported, not forced");
  });
});

describe("internal world regions", () => {
  const regions = internalWorldRegions("제국 수도 '아르카디아', 서부 해상 무역권 '벨로체', 북부 방벽 요새 '발켄하임', 남부 곡창지대 '플로라'");

  it("1. 벨로체 is parsed as an internal region of the world", () => {
    assert.deepEqual(regions, ["아르카디아", "벨로체", "발켄하임", "플로라"]);
  });

  it("2. a sheet tied to an internal region fails on foreign/enemy/defeated-state identity", () => {
    for (const bad of ["벨로체의 외국 귀족 인질", "벨로체 적국 귀족", "벨로체 패전국 후계자", "벨로체로 귀국할 조건"]) {
      const qa = evaluateInternalRegionConsistency(bad, regions);
      assert.equal(qa.ok, false, bad);
      assert.equal(qa.errors[0]!.code, "region_foreign_state_conflict");
    }
    const ok = evaluateInternalRegionConsistency("황실과 맞섰던 제국 서부 해상 무역권 벨로체 가문의 후계자이자 휴전 보증 인질. 귀환 조건", regions);
    assert.deepEqual(ok.errors, []);
    assert.deepEqual(evaluateInternalRegionConsistency("먼 외국에서 온 상인", regions).errors, [], "no internal region named");
  });
});

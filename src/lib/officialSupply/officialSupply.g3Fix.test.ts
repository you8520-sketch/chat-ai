import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { findAdultTermsInText, characterAdultTextBlob } from "@/lib/characterAdultText";
import { generateOfficialCharacterBible, generateOfficialPortfolioReplacement, type OfficialAuthorTransport } from "@/lib/officialSupply/author";
import { evaluateRelationBibleContract, type OfficialCharacterBible } from "@/lib/officialSupply/bible";
import { evaluateUserRelationPremise } from "@/lib/officialSupply/userRelationStart";
import { loadRelationStartCandidates } from "@/lib/officialSupply/relationStartCandidates";

const G3 = path.join(process.cwd(), "docs/official-supply/reviews/g3-2026-10-28/candidates");

type BriefFile = {
  name: string;
  rpHook: string;
  userRelation: { type: "free" | "role_bound" | "relationship_bound"; fixed: string };
  marketFit: { userRelationship: string; oneLineConflict: string; differentiationTwist: string };
};

function loadPair(key: string): { brief: BriefFile; bible: OfficialCharacterBible } {
  const dir = path.join(G3, key);
  return {
    brief: JSON.parse(fs.readFileSync(path.join(dir, "brief.json"), "utf8")) as BriefFile,
    bible: JSON.parse(fs.readFileSync(path.join(dir, "bible.assembled.json"), "utf8")) as OfficialCharacterBible,
  };
}

describe("G3 fix: SFW false positive and FREE premise", () => {
  for (const key of ["g3-rofan-a", "g3-rofan-b"] as const) {
    it(`${key} original manuscript is not an adult-term hit and its FREE plan contradicts the premise`, () => {
      const { brief, bible } = loadPair(key);
      assert.equal(brief.userRelation.type, "free");
      assert.equal(bible.userRelationship.type, "free");
      const blob = characterAdultTextBlob({
        name: bible.identity.name,
        tagline: bible.publicProfile.tagline,
        description: bible.publicProfile.detailedDescription ?? bible.publicProfile.description,
        greeting: bible.greeting,
        creatorComment: bible.publicProfile.creatorComment,
        tags: bible.publicProfile.tags,
      });
      assert.deepEqual(findAdultTermsInText(blob), [], key);
      const briefPremise = evaluateUserRelationPremise(brief.userRelation.type, [
        brief.rpHook,
        brief.marketFit.userRelationship,
        brief.marketFit.oneLineConflict,
        brief.marketFit.differentiationTwist,
      ]);
      assert.equal(briefPremise.ok, false, key);
      assert.ok(briefPremise.errors.some((e) => e.code === "bible_user_rel_free_premise"));
      const bibleQa = evaluateRelationBibleContract(bible);
      assert.ok(bibleQa.errors.some((e) => e.code === "bible_user_rel_free_premise"), key);
    });
  }

  it("rejects each saved G3 brief before any character-bible provider call", async () => {
    const transport: OfficialAuthorTransport = {
      label: "never-call",
      async completeJson() {
        throw new Error("unexpected provider call");
      },
    };
    for (const key of ["g3-rofan-a", "g3-rofan-b"] as const) {
      const { brief } = loadPair(key);
      await assert.rejects(
        generateOfficialCharacterBible({
          transport,
          part1: { brief, worldName: "에테르노스", worldContext: "", siblingSketches: [] },
          voice: { name: brief.name, age: 30, adultCandidate: false, speechDirection: "", npcDemand: "없음" },
          bonds: { name: brief.name, age: 30, adultCandidate: false, speechDirection: "", npcDemand: "없음", rpHook: brief.rpHook, castList: [] },
        }),
        /FREE premise requires/,
      );
    }
  });

  it("rejects the saved portfolio prose after the planning call, before character generation", async () => {
    const portfolio = (["g3-rofan-a", "g3-rofan-b"] as const).map((key) => loadPair(key).brief);
    let calls = 0;
    const transport: OfficialAuthorTransport = {
      label: "saved-portfolio",
      async completeJson() {
        calls += 1;
        return { text: JSON.stringify({ portfolio }), model: "offline", inputTokens: 1, outputTokens: 1, costUsd: 0, providerRequestId: null };
      },
    };
    await assert.rejects(
      generateOfficialPortfolioReplacement({
        transport,
        replacement: {
          worldName: "에테르노스",
          centralPremise: "재건",
          factionNames: [],
          locationNames: [],
          market: {
            targetLocale: "ko-KR",
            marketPriority: "kr",
            signalLines: [],
            namingProfile: "western_rofan",
            marketRoleMix: {
              proven: { min: 0, max: 8 },
              proven_twist: { min: 0, max: 8 },
              experimental: { min: 0, max: 8 },
            },
            maxPrimaryTropeRepeat: 2,
            coreTags: { min: 4, max: 8 },
          },
          castIntent: "",
          keptSiblings: [],
          slots: [
            { slot: 11, gender: "male", adultCandidate: false, direction: "" },
            { slot: 12, gender: "male", adultCandidate: false, direction: "" },
          ],
        },
      }),
      /FREE premise requires/,
    );
    assert.equal(calls, 1);
  });

  it("keeps the three relation-start candidates and the published Wolfgang sheet", () => {
    for (const candidate of loadRelationStartCandidates()) {
      assert.equal(evaluateRelationBibleContract(candidate.bible).ok, true, candidate.key);
      const type = candidate.brief.userRelation?.type ?? "free";
      if (type === "free") {
        assert.equal(evaluateUserRelationPremise("free", [candidate.brief.rpHook]).ok, true, candidate.key);
      }
    }
    const wolfgang = JSON.parse(fs.readFileSync(
      path.join(process.cwd(), "src/lib/officialSupply/pilot/characters/pilot-rf-02.json"),
      "utf8",
    )) as { bible: OfficialCharacterBible };
    const qa = evaluateRelationBibleContract(wolfgang.bible);
    assert.equal(qa.errors.some((e) => e.code === "bible_user_rel_free_premise"), false);
  });
});

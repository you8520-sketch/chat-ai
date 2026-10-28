import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  generateOfficialCharacterBible, reviseOfficialCharacterVoice, createAuthorCostReport, withAuthorAccounting,
  type OfficialAuthorTransport, type OfficialVoiceRevisionField,
} from "@/lib/officialSupply/author";
import { evaluateRelationBibleContract, type OfficialCharacterBible } from "@/lib/officialSupply/bible";
import { evaluateUserRelationPremise } from "@/lib/officialSupply/userRelationStart";
import { compileRelationStartDraft, loadRelationStartCandidates } from "@/lib/officialSupply/relationStartCandidates";
import { composeOfficialSystemPrompt, computeTextLockHash } from "@/lib/officialSupply/characterText";
import { composeOfficialCreatorComment } from "@/lib/officialSupply/publicProfileText";
import { findAdultTermsInText } from "@/lib/characterAdultText";

const original = JSON.parse(fs.readFileSync("docs/official-supply/reviews/g2-2026-10-28/g1-original/first-generation.json", "utf8"));
const g1 = original.bible as OfficialCharacterBible;
const voice = { name: "테오", age: 28, adultCandidate: false, speechDirection: "현장 말투", npcDemand: "없음" };
function transport(response: unknown): OfficialAuthorTransport {
  return { label: "offline-g2", async completeJson() {
    return { text: JSON.stringify(response), model: "offline", inputTokens: 10, outputTokens: 20, costUsd: 0.001, providerRequestId: null };
  } };
}

describe("G2 G1 source regression", () => {
  it("accepts the SFW manuscript without accepting its FREE role contradiction", () => {
    assert.deepEqual(findAdultTermsInText(g1.publicProfile.detailedDescription ?? ""), []);
    assert.ok(evaluateRelationBibleContract(g1).errors.some(e => e.code === "bible_user_rel_free_premise"));
    for (const candidate of loadRelationStartCandidates()) assert.equal(evaluateRelationBibleContract(candidate.bible).ok, true, candidate.key);
    for (const text of ["당신과 대화하며 신뢰를 쌓는다.", "당신이 공명 능력을 갖췄다면 회로를 살펴볼 수 있다.", "그는 당신 없이는 버틸 수 없다고 말한다."]) {
      assert.equal(evaluateUserRelationPremise("free", [text]).ok, true, text);
    }
  });
  it("rejects G1's incompatible brief before any provider call", async () => {
    let calls = 0;
    await assert.rejects(generateOfficialCharacterBible({
      transport: { label: "never-call", async completeJson() { calls++; throw new Error("unexpected provider call"); } },
      part1: { brief: original.brief, worldName: "에테르노스", worldContext: "", siblingSketches: [] },
      voice,
      bonds: { ...voice, rpHook: original.brief.rpHook, castList: [] },
    }), /FREE premise requires/);
    assert.equal(calls, 0);
  });
  it("keeps all three planned types through the same three-stage generator", async () => {
    for (const candidate of loadRelationStartCandidates()) {
      const draft = compileRelationStartDraft(candidate);
      const authored = { ...candidate.bible, publicProfile: { ...candidate.bible.publicProfile, detailedDescription: draft.description, creatorComment: composeOfficialCreatorComment(draft) } };
      const captured: string[] = [];
      const mock: OfficialAuthorTransport = { ...transport(authored), async completeJson(input) {
        captured.push(input.user);
        return transport(authored).completeJson(input);
      } };
      const { bible, completions } = await generateOfficialCharacterBible({ transport: mock,
        part1: { brief: candidate.brief, worldName: "에테르노스", worldContext: candidate.bible.situation.worldContext, siblingSketches: [] },
        voice: { ...voice, name: candidate.brief.name, age: candidate.brief.age },
        bonds: { ...voice, name: candidate.brief.name, age: candidate.brief.age, rpHook: candidate.brief.rpHook, castList: [] },
      });
      assert.equal(bible.userRelationship.type, candidate.brief.userRelation?.type);
      assert.equal(evaluateRelationBibleContract(bible).ok, true);
      assert.equal(completions.length, 3);
      for (const input of captured) assert.ok(input.includes(`유저 관계 시작 유형: ${bible.userRelationship.type}`));
    }
  });
  it("retains G1 proficiency, world, causal past, self-drive and greeting in v2 without rewriting v1", () => {
    const candidate = { key: "g2-theo-preview", brief: original.brief, bible: g1 };
    const v1 = compileRelationStartDraft(candidate);
    const v2 = compileRelationStartDraft({ ...candidate, bible: { ...g1, promptStandard: "compact_rp_v2" } });
    const wire = composeOfficialSystemPrompt(v2);
    for (const a of g1.abilities) assert.ok(wire.includes(a.level.replace(/[.!?。！？]+$/u, "")), a.name);
    for (const e of g1.backstory.events) for (const text of [e.event, e.choice, e.residue]) assert.ok(wire.includes(text));
    for (const text of Object.values(g1.rpEngine.selfDrive!)) assert.ok(wire.includes(text.replace(/[.!?。！？]+$/u, "")));
    assert.equal(v2.sections.worldAndSituation, v1.sections.worldAndSituation);
    assert.equal(v2.greeting, g1.greeting);
    assert.equal(v2.description, v1.description);
    assert.equal(v2.creatorComment, v1.creatorComment);
    assert.equal(v2.speech.examples, g1.speech.examples);
    assert.deepEqual(g1.appearance, original.bible.appearance);
    assert.notEqual(computeTextLockHash(v2), computeTextLockHash(v1));
    assert.equal(v1.sections.characterCore, original.draft.sections.characterCore);
  });
});

describe("G2 atomic Voice revision", () => {
  it("replays the actual G1 first correction: no pitch is erased and its settled cost remains counted", async () => {
    const response = JSON.parse(fs.readFileSync("docs/official-supply/reviews/g2-2026-10-28/g1-original/provider-responses/call-04.json", "utf8"));
    const costs = JSON.parse(fs.readFileSync("docs/official-supply/reviews/g2-2026-10-28/g1-original/cost-usage.json", "utf8"));
    const text = response.choices[0].message.content;
    const before = structuredClone(g1);
    const report = createAuthorCostReport();
    const replay: OfficialAuthorTransport = { label: "G1-captured-response-no-network", async completeJson() {
      return { text, model: response.model, inputTokens: response.usage.prompt_tokens, outputTokens: response.usage.completion_tokens, costUsd: costs.report.lines[3].costUsd, providerRequestId: null };
    } };
    await assert.rejects(reviseOfficialCharacterVoice({ transport: withAuthorAccounting(replay, report, { draftKey: "g2", workflowAttempt: 1 }), bible: g1, voice, fields: ["publicDescription"], reasons: ["bible_pitch_band"] }), /publicProfile.description/);
    assert.deepEqual(g1, before);
    assert.equal(g1.publicProfile.description.length, 194);
    assert.equal(report.physicalAttempts, 1);
    assert.equal(report.billedCostUsd, 0.000968);
  });
  for (const [field, response] of [
    ["publicDescription", { speech: g1.speech }],
    ["publicDescription", { publicProfile: { description: "  " } }],
    ["greeting", { greeting: "" }], ["greeting", {}],
    ["tags", { publicProfile: { tags: [] } }],
    ["speech", { speech: { description: "partial speech" } }],
  ] as [OfficialVoiceRevisionField, unknown][]) {
    it(`rejects missing/empty ${field}, preserves every field and counts its billed response`, async () => {
      const bible = structuredClone(g1), before = structuredClone(bible);
      const report = createAuthorCostReport();
      const accounted = withAuthorAccounting(transport(response), report, { draftKey: "g2", workflowAttempt: 1 });
      await assert.rejects(reviseOfficialCharacterVoice({ transport: accounted, bible, voice, fields: [field], reasons: ["offline regression"] }), /requested fields missing or empty/);
      assert.deepEqual(bible, before);
      assert.equal(report.physicalAttempts, 1);
      assert.equal(report.billedCostUsd, 0.001);
      assert.equal(report.inputTokens, 10);
    });
  }
  it("applies a valid selected field while ignoring unsolicited changes", async () => {
    const { bible } = await reviseOfficialCharacterVoice({ transport: transport({ publicProfile: { description: "유효한 보정 소개", detailedDescription: "do not copy" }, greeting: "do not copy" }), bible: g1, voice, fields: ["publicDescription"], reasons: [] });
    assert.deepEqual(bible, { ...g1, publicProfile: { ...g1.publicProfile, description: "유효한 보정 소개" } });
  });
});

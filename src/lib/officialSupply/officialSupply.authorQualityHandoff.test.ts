import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as review from "@/lib/officialSupply/characterReview";
import { compileRelationStartDraft, loadRelationStartCandidates } from "@/lib/officialSupply/relationStartCandidates";
import { buildOfficialCharacterFormBody, computeTextLockHash } from "@/lib/officialSupply/characterText";
import { parseCharacterFormBody } from "@/lib/characterFormSave";
import { composeOfficialCreatorComment } from "@/lib/officialSupply/publicProfileText";
import { buildRelationStartWire } from "@/lib/officialSupply/relationStartWire";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { getDb } from "@/lib/db";
import { evaluateRelationBibleContract } from "@/lib/officialSupply/bible";

describe("A1 canon review evidence (synthetic mutations of existing fixture)", () => {
  before(() => installIsolatedTestDatabase());
  after(() => uninstallIsolatedTestDatabase());
  const candidate = () => structuredClone(loadRelationStartCandidates()[0]);

  it("surfaces conflicting author statements and a character denial without deciding seal authenticity", () => {
    const c = candidate();
    c.bible.backstory.events[0].event = "명령서에 찍힌 인장은 볼프강의 진짜 인장이다.";
    c.bible.secrets = ["명령서의 인장은 위조됐을 가능성이 있다."];
    c.bible.greeting = '볼프강이 명령서를 짚었다. "나는 그 문서에 서명하지 않았다."';
    const packet = review.buildOfficialCanonReviewEvidence(c.bible, compileRelationStartDraft(c));
    assert.equal(packet.status, "REQUIRES_GPT_REVIEW");
    assert.equal(packet.semanticVerdict, null);
    assert.deepEqual(packet.sources.backstory, c.bible.backstory.events);
    assert.deepEqual(packet.sources.secrets, c.bible.secrets);
    assert.equal(packet.sources.greeting, c.bible.greeting);
    assert.equal(packet.unresolved.find(r => r.topic === "canon_provenance")?.status, "REQUIRES_GPT_REVIEW");
    assert.deepEqual(c.bible.secrets, ["명령서의 인장은 위조됐을 가능성이 있다."]);
  });

  it("separates repeated props from the independent reporting principle and exposes its deletion", () => {
    const c = candidate();
    c.bible.behaviorRules = ["장갑을 정리한다. 핵심 보고는 미루지 않는다.", "병력 명단을 대조한다.", "장갑을 정리한다."];
    const draft = compileRelationStartDraft(c);
    const packet = review.buildOfficialCanonReviewEvidence(c.bible, draft);
    const rule = packet.preservationChecks.find(r => r.text === "핵심 보고는 미루지 않는다.");
    assert.equal(rule?.preservation, "EXACT_PRESENT");
    assert.equal(packet.preservationChecks.filter(r => r.text === "장갑을 정리한다.").length, 2);
    const altered = { ...draft, speech: { ...draft.speech, traits: draft.speech.traits.replace("핵심 보고는 미루지 않는다.", "") } };
    assert.equal(review.buildOfficialCanonReviewEvidence(c.bible, altered).preservationChecks.find(r => r.text === rule?.text)?.preservation, "REVIEW_REQUIRED");
  });

  it("reports absent old selfDrive and leaves generic but structural-valid drive unresolved", () => {
    const c = candidate();
    delete c.bible.rpEngine.selfDrive;
    assert.equal(review.buildOfficialCanonReviewEvidence(c.bible, compileRelationStartDraft(c)).unresolved.find(r => r.topic === "self_drive_grounding")?.status, "MISSING_SOURCE");
    c.bible.rpEngine.selfDrive = { goal: "모든 어려움을 극복하고 더 나은 세상을 스스로 만든다", ownMove: "스스로 노력하고 매일 새로운 도전을 찾아 움직인다", setback: "실패하면 소중한 것을 잃고 다시 일어나야 한다" };
    assert.equal(evaluateRelationBibleContract(c.bible).ok, true, "structure alone cannot establish causal grounding");
    const packet = review.buildOfficialCanonReviewEvidence(c.bible, compileRelationStartDraft(c));
    assert.equal(packet.semanticVerdict, null);
    assert.equal(packet.unresolved.find(r => r.topic === "self_drive_grounding")?.status, "REQUIRES_GPT_REVIEW");
    assert.deepEqual(packet.sources.selfDrive, c.bible.rpEngine.selfDrive);
    assert.deepEqual(packet.sources.abilities, c.bible.abilities);
  });

  it("keeps public manuscripts, greeting, speech and Text Lock in the existing staged save path", () => {
    for (const c of loadRelationStartCandidates()) {
      const original = JSON.stringify(c.bible);
      const draft = compileRelationStartDraft(c);
      const hash = computeTextLockHash(draft);
      const body = buildOfficialCharacterFormBody({ draft, appearanceBlock: "", assets: [{ url: "/uploads/a1.webp", tag: "대표", width: 1024, height: 1536, viewerBlur: false }] });
      const parsed = parseCharacterFormBody(body, { id: 7001, nickname: "a1-staging", is_adult: 1 });
      assert.equal(parsed.ok, true, !parsed.ok ? parsed.error : "");
      assert.equal(body.description, draft.description);
      assert.equal(body.creator_comment, composeOfficialCreatorComment(draft));
      assert.equal(body.greeting, c.bible.greeting);
      assert.equal(body.speech_examples, c.bible.speech.examples);
      const packet = review.buildOfficialCanonReviewEvidence(c.bible, draft);
      assert.equal(packet.compiled.description, body.description);
      assert.equal(packet.compiled.creatorComment, body.creator_comment);
      assert.equal(computeTextLockHash(draft), hash);
      assert.equal(JSON.stringify(c.bible), original);
    }
  });

  it("saves public manuscripts and delivers the independent principle through chunks/final RP assembly", async () => {
    const c = candidate();
    const original = compileRelationStartDraft(c);
    c.key = "a1-isolated-wire";
    const description = `${original.description}\n창턱에는 푸른 돌로 누른 통행증이 놓여 있다.`;
    c.bible.publicProfile.detailedDescription = description;
    c.bible.publicProfile.creatorComment = composeOfficialCreatorComment(original);
    c.bible.behaviorRules.push("핵심 보고는 미루지 않는다.");
    const result = await buildRelationStartWire(c);
    assert.equal(result.draft.description, description);
    assert.equal(result.settingOverflowChars, 0);
    assert.ok(result.systemPrompt.includes("핵심 보고는 미루지 않는다"));
    assert.ok(result.systemPrompt.includes(c.bible.identity.name));
    const stored = getDb().prepare("SELECT description, creator_comment FROM characters WHERE name=? ORDER BY id DESC LIMIT 1").get(c.bible.identity.name) as { description: string; creator_comment: string };
    assert.equal(stored.description, description);
    assert.equal(stored.creator_comment, c.bible.publicProfile.creatorComment);
    assert.ok(!result.systemPrompt.includes("푸른 돌로 누른 통행증"), "public copy is a display surface, not a second RP canon source");
    assert.equal(result.draft.creatorComment, c.bible.publicProfile.creatorComment);
  });
});

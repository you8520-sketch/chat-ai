import assert from "node:assert/strict";
import { after, before, describe, it, mock } from "node:test";
import * as review from "@/lib/officialSupply/characterReview";
import { compileRelationStartDraft, loadRelationStartCandidates } from "@/lib/officialSupply/relationStartCandidates";
import { buildOfficialCharacterFormBody, computeTextLockHash } from "@/lib/officialSupply/characterText";
import { parseCharacterFormBody } from "@/lib/characterFormSave";
import { composeOfficialCreatorComment } from "@/lib/officialSupply/publicProfileText";
import { buildRelationStartWire } from "@/lib/officialSupply/relationStartWire";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { getDb } from "@/lib/db";
import { evaluateRelationBibleContract } from "@/lib/officialSupply/bible";
import fs from "node:fs";
import {
  generateOfficialCharacterBible, reviseOfficialCharacterVoice, createAuthorCostReport,
  withAuthorAccounting, withOfficialAuthorCallBudget, OfficialAuthorCallBudget,
  OfficialAuthorTruncatedError, OFFICIAL_CHARACTER_CALL_CAP, recordWorkflowRetry,
  type OfficialAuthorTransport, type OfficialAuthorRawCompletion,
} from "@/lib/officialSupply/author";
import { estimateTokens } from "@/lib/tokenEstimate";

type Candidate = ReturnType<typeof loadRelationStartCandidates>[number];
type AuthorInput = Parameters<OfficialAuthorTransport["completeJson"]>[0];
const mockCompletion = (data: unknown): OfficialAuthorRawCompletion => ({
  text: typeof data === "string" ? data : JSON.stringify(data), model: "OFFLINE_MOCK",
  inputTokens: 10, outputTokens: 20, costUsd: 0.01, providerRequestId: null,
});
function authoredFixture(c: Candidate) {
  const draft = compileRelationStartDraft(c);
  return { ...c.bible, publicProfile: {
    ...c.bible.publicProfile, detailedDescription: draft.description,
    creatorComment: composeOfficialCreatorComment(draft),
  } };
}
function generationInput(c: Candidate, transport: OfficialAuthorTransport) {
  return {
    transport,
    part1: { brief: c.brief, worldName: "테스트 세계", worldContext: c.bible.situation.worldContext, siblingSketches: [] },
    voice: { name: c.bible.identity.name, age: c.bible.identity.age, adultCandidate: false, speechDirection: c.brief.speechDirection, npcDemand: "없음", userRelation: c.brief.userRelation, marketFit: c.brief.marketFit },
    bonds: { name: c.bible.identity.name, age: c.bible.identity.age, adultCandidate: false, rpHook: c.brief.rpHook, castList: [], userRelation: c.brief.userRelation },
  };
}

describe("A1 GPT review: input reuse and unchanged retry/accounting", () => {
  it("rebuilds read-only review from pre-image source and ignores an obsolete embedded canonReview", () => {
    const filePath = `${process.cwd()}/src/lib/officialSupply/pilot/characters/pilot-rf-03.json`;
    const source = JSON.parse(fs.readFileSync(filePath, "utf8"));
    delete source.appearance;
    source.canonReview = { status: "STALE_EMBEDDED_EVIDENCE_SENTINEL" };
    const original = fs.readFileSync;
    const stub = mock.method(fs, "readFileSync", ((...args: Parameters<typeof fs.readFileSync>) => {
      if (String(args[0]) === filePath) return JSON.stringify(source);
      return original(...args);
    }) as typeof fs.readFileSync);
    try {
      const report = review.buildOfficialCharacterReviewReport("pilot-rf-03");
      assert.ok(report.includes("appearance lock not authored; narrative review only"));
      assert.ok(report.includes("REQUIRES_GPT_REVIEW"));
      assert.ok(!report.includes("STALE_EMBEDDED_EVIDENCE_SENTINEL"));
    } finally { stub.mock.restore(); }
  });

  it("reduces all four fixture inputs without losing selected complete causal facts", async () => {
    const initial = JSON.parse(fs.readFileSync("docs/pr-evidence/pr-official-quality-a1/input-metrics.json", "utf8"));
    for (const c of loadRelationStartCandidates()) {
      const calls: AuthorInput[] = [];
      const authored = authoredFixture(c);
      const transport: OfficialAuthorTransport = { label: "offline", async completeJson(input) { calls.push(input); return mockCompletion(authored); } };
      const { bible } = await generateOfficialCharacterBible(generationInput(c, transport));
      assert.equal(calls.length, 3);
      const old = initial.rows.find((r: { fixture: string }) => r.fixture === c.key);
      const now = calls.reduce((n, call) => n + estimateTokens(`${call.system}\n${call.user}`), 0);
      assert.ok(now < old.estimatedInputTokensAfter, `${c.key}: ${now} < ${old.estimatedInputTokensAfter}`);
      const facts = [
        ...c.bible.backstory.events.flatMap(e => [e.event, e.choice, e.residue]),
        ...c.bible.abilities.flatMap(a => [a.name, a.scope, a.limit, a.cost]),
        ...c.bible.values.desires, ...c.bible.values.coreValues, ...c.bible.values.nonNegotiable,
        c.bible.personality.behavioral, c.bible.contradiction, c.bible.situation.personalSituation, c.bible.situation.userEntry,
      ].filter(Boolean);
      for (const call of calls.slice(1)) for (const fact of facts) {
        assert.ok(call.user.includes(fact) || call.user.includes(JSON.stringify(fact).slice(1, -1)), `${call.task}: lost ${fact}`);
      }
      assert.equal(bible.publicProfile.detailedDescription, authored.publicProfile.detailedDescription);
      assert.equal(bible.publicProfile.creatorComment, authored.publicProfile.creatorComment);
    }
  });

  it("omits public-only world/looks in targeted revisions while preserving untouched manuscripts", async () => {
    for (const fields of [["speech"], ["tags"], ["greeting"]] as const) {
      const c = structuredClone(loadRelationStartCandidates()[0]);
      const current = authoredFixture(c);
      current.appearance.eyeColor = "PUBLIC_LOOKS_ONLY_SENTINEL";
      current.situation.worldContext = "PUBLIC_WORLD_ONLY_SENTINEL";
      current.situation.userEntry = "OPENING_ENTRY_ONLY_SENTINEL";
      const calls: AuthorInput[] = [];
      const transport: OfficialAuthorTransport = { label: "offline-revision", async completeJson(input) { calls.push(input); return mockCompletion(current); } };
      const { bible } = await reviseOfficialCharacterVoice({ transport, bible: current, voice: generationInput(c, transport).voice, fields, reasons: ["synthetic QA correction"] });
      assert.equal(calls.length, 1);
      assert.ok(!calls[0].user.includes("PUBLIC_LOOKS_ONLY_SENTINEL"));
      assert.ok(!calls[0].user.includes("PUBLIC_WORLD_ONLY_SENTINEL"));
      assert.equal(calls[0].user.includes("OPENING_ENTRY_ONLY_SENTINEL"), fields[0] === "greeting");
      assert.equal(bible.publicProfile.detailedDescription, current.publicProfile.detailedDescription);
      assert.equal(bible.publicProfile.creatorComment, current.publicProfile.creatorComment);
      assert.deepEqual(bible.backstory, current.backstory);
      assert.deepEqual(bible.rpEngine.selfDrive, current.rpEngine.selfDrive);
    }
  });

  it("keeps complete long causal clauses and late facts instead of restoring a character cap", async () => {
    const c = structuredClone(loadRelationStartCandidates()[0]);
    c.bible.backstory.events[0].event += " 서로 다른 증언의 출처를 기록했다.".repeat(100);
    c.bible.backstory.events[0].residue += " 인물은 진위를 모른다고 말했다.";
    c.bible.appearance.eyes += " 오른쪽 눈은 다쳤으나 완전히 실명한 것은 아니다.";
    const authored = authoredFixture(c);
    const calls: AuthorInput[] = [];
    await generateOfficialCharacterBible(generationInput(c, { label: "offline-long", async completeJson(input) { calls.push(input); return mockCompletion(authored); } }));
    for (const call of calls.slice(1)) {
      assert.ok(call.user.includes(c.bible.backstory.events[0].event));
      assert.ok(call.user.includes(c.bible.backstory.events[0].residue));
      assert.ok(call.user.includes(c.bible.situation.userEntry));
    }
    assert.ok(calls[1].user.includes(c.bible.appearance.eyes));
  });

  for (const defect of ["missing", "html", "malformed", "provider", "truncated"] as const) {
    it(`audits the existing outer retry after ${defect} Voice: Part1 reruns, paid mock attempts count once`, async () => {
      const c = loadRelationStartCandidates()[0];
      const data = authoredFixture(c);
      const report = createAuthorCostReport();
      const budget = new OfficialAuthorCallBudget(OFFICIAL_CHARACTER_CALL_CAP);
      const tasks: string[] = [];
      let firstVoice = true;
      const inner: OfficialAuthorTransport = { label: "offline-cost-audit", async completeJson(input) {
        tasks.push(input.task);
        if (input.task === "character_bible_voice" && firstVoice) {
          firstVoice = false;
          if (defect === "provider") throw new Error("synthetic provider failure without usage");
          if (defect === "truncated") throw new OfficialAuthorTruncatedError(input.task, mockCompletion(data));
          if (defect === "malformed") return mockCompletion("{not-json");
          return mockCompletion({ ...data, publicProfile: { ...data.publicProfile, detailedDescription: defect === "missing" ? "" : `<p>${data.publicProfile.detailedDescription}</p>` } });
        }
        return mockCompletion(data);
      } };
      // Mirrors the audited pilot runWorkflowStep attempts; no product retry owner is added.
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (attempt > 1) recordWorkflowRetry(report);
        const transport = withOfficialAuthorCallBudget(withAuthorAccounting(inner, report, { draftKey: c.key, workflowAttempt: attempt }), budget);
        try { await generateOfficialCharacterBible(generationInput(c, transport)); break; }
        catch (error) { if (attempt === 3) throw error; }
      }
      assert.deepEqual(tasks, ["character_bible_1", "character_bible_voice", "character_bible_1", "character_bible_voice", "character_bible_bonds"]);
      assert.equal(report.physicalAttempts, 5);
      assert.equal(report.workflowRetries, 1);
      assert.equal(budget.used, 5);
      assert.equal(report.failedProviderAttempts, ["provider", "truncated"].includes(defect) ? 1 : 0);
      assert.equal(report.lines[1].costUsd, defect === "provider" ? null : 0.01);
      assert.ok(Math.abs(report.billedCostUsd - (defect === "provider" ? 0.04 : 0.05)) < 1e-9);
    });
  }

  it("three persistent manuscript failures consume six calls, no Bonds, and exhaust the unchanged opt-in cap", async () => {
    const c = loadRelationStartCandidates()[0];
    const data = authoredFixture(c);
    data.publicProfile.creatorComment = "";
    const report = createAuthorCostReport();
    const budget = new OfficialAuthorCallBudget(OFFICIAL_CHARACTER_CALL_CAP);
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) recordWorkflowRetry(report);
      const inner: OfficialAuthorTransport = { label: "offline-persistent", async completeJson() { return mockCompletion(data); } };
      const transport = withOfficialAuthorCallBudget(withAuthorAccounting(inner, report, { draftKey: c.key, workflowAttempt: attempt }), budget);
      await assert.rejects(() => generateOfficialCharacterBible(generationInput(c, transport)), /author_public_manuscript_invalid/);
    }
    assert.equal(report.physicalAttempts, 6);
    assert.equal(report.workflowRetries, 2);
    assert.equal(report.lines.some(l => l.task === "character_bible_bonds"), false);
    assert.equal(budget.used, 6);
    assert.throws(() => budget.consume("character_bible_1"), /budget 6 exhausted/);
  });
});

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

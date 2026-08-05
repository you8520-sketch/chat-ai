/**
 * Human-gold recall gates for redesigned RP quality detectors.
 *
 * Run:
 *   node --conditions=react-server --import tsx --test src/lib/rpHumanGoldFixtures.test.ts
 *
 * Do not use these detectors for live prompt comparison until recall is 100%.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  detectAdministrativeSubplot,
  detectExternalSceneTakeover,
  detectHumanGoldLabels,
  detectIntrusiveExternalSpeaker,
  detectPrematureClosure,
  detectSemanticRepetition,
  detectTemporalRewind,
  detectUserInputReauthoring,
  detectUserStateInvention,
  goldFixtureRecall,
} from "@/lib/rpHumanGoldFixtures";

type FixtureFile = {
  required_detections: Array<{
    id: string;
    attempt_id: string;
    must_detect: string[];
  }>;
  raw_by_attempt: Record<string, string>;
  previous_assistant_by_attempt?: Record<string, string>;
  user_input_by_attempt?: Record<string, string>;
};

const fixturePath = join(
  process.cwd(),
  "src/lib/fixtures/rpHumanGoldFixtureCases.json"
);
const fixtures = JSON.parse(readFileSync(fixturePath, "utf8")) as FixtureFile;

describe("rpHumanGoldFixtures recall gates", () => {
  it("human hard-fail fixture recall is 100%", () => {
    const result = goldFixtureRecall({
      required: fixtures.required_detections,
      rawByAttempt: fixtures.raw_by_attempt,
      previousAssistantByAttempt: fixtures.previous_assistant_by_attempt,
      userInputByAttempt: fixtures.user_input_by_attempt,
    });
    assert.equal(
      result.recall,
      1,
      `recall ${result.recall} failures=${result.failures.join(" | ")}`
    );
    assert.equal(result.pass, true);
  });

  it("Sample A / C243-02: external scene intrusion", () => {
    const text = fixtures.raw_by_attempt["C243-02"]!;
    assert.equal(detectIntrusiveExternalSpeaker(text), true);
    assert.equal(detectExternalSceneTakeover(text), true);
  });

  it("C243-01: external takeover + premature closure", () => {
    const text = fixtures.raw_by_attempt["C243-01"]!;
    assert.equal(detectExternalSceneTakeover(text), true);
    assert.equal(detectPrematureClosure(text), true);
  });

  it("C243-04: temporal rewind + user-input reauthoring", () => {
    const text = fixtures.raw_by_attempt["C243-04"]!;
    const prev = fixtures.previous_assistant_by_attempt!["C243-04"]!;
    const user = fixtures.user_input_by_attempt!["C243-04"]!;
    assert.equal(
      detectTemporalRewind({ text, previousAssistantText: prev, turnIndex: 2 }),
      true
    );
    assert.equal(detectUserInputReauthoring({ text, userInput: user }), true);
    const labels = detectHumanGoldLabels({
      text,
      previousAssistantText: prev,
      userInput: user,
      turnIndex: 2,
    });
    assert.ok(labels.includes("TEMPORAL_REWIND"));
    assert.ok(labels.includes("USER_INPUT_REAUTHORING"));
  });

  it("C243-06: named NPC administrative subplot", () => {
    const text = fixtures.raw_by_attempt["C243-06"]!;
    assert.equal(detectIntrusiveExternalSpeaker(text), true);
    assert.equal(detectAdministrativeSubplot(text), true);
  });

  it("Turn1 repeated psychology: semantic repetition", () => {
    const text = fixtures.raw_by_attempt["C243-03"]!;
    assert.equal(detectSemanticRepetition(text), true);
  });

  it("invented S-grade / guide wave: unsupported user state", () => {
    assert.equal(
      detectUserStateInvention(fixtures.raw_by_attempt["C243-10"]!),
      true
    );
    assert.equal(
      detectUserStateInvention(fixtures.raw_by_attempt["C243-04"]!),
      true
    );
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildLengthInstruction,
  buildLengthInstructionProductionCandidate,
  buildMandatoryLengthScopeGuideline,
  buildSingleShotLengthReminder,
  buildTerminalLengthOverrideBlock,
  normalizeTargetResponseChars,
} from "@/lib/responseLength";
import { buildContext } from "@/services/contextBuilder";
import { parseCharacterSetting } from "@/utils/characterParser";
import { formatSelectedPersonaForPrompt } from "@/lib/userPersonas";
import { formatUserNoteForPrompt } from "@/lib/persona";
import { formatMemoryMetaForPrompt, parseMemoryMeta } from "@/lib/chatMemory";

describe("buildLengthInstruction", () => {
  it("uses C-full mandatory numeric targets (production)", () => {
    const block = buildLengthInstruction();
    assert.match(block, /\[LENGTH CONTROL & SCENE EXPANSION\]/);
    assert.match(block, /TARGET: 2,400 characters/);
    assert.match(block, /Minimum acceptable: 1,920 characters \(80% floor\)/);
    assert.match(
      block,
      /Mandatory: You must not end the scene until reaching the 80% minimum floor/
    );
    assert.match(block, /Target length is MANDATORY, not aspirational/);
    assert.match(block, /\[NO INPUT ECHO — STRICT\]/);
    assert.match(block, /CEILING: 5,000/);
    assert.match(block, /<TURN_HANDOFF_AND_PACING>/);
    assert.match(block, /godmodding \[B\] is NEVER acceptable/);
    assert.match(block, /ONE continuous response/);
    assert.doesNotMatch(block, /Write a highly detailed, immersive response/);
    assert.doesNotMatch(block, /end naturally when the moment is complete/);
    assert.doesNotMatch(block, /\[TIME DILATION — MICRO-PACING TECHNIQUE\]/);
  });

  it("normalizes 2500 input to aim 2400 with 1920 floor in prompt", () => {
    assert.equal(normalizeTargetResponseChars(2500), 2400);
    const block = buildLengthInstruction(2500);
    assert.match(block, /TARGET: 2,400 characters/);
    assert.match(block, /Minimum acceptable: 1,920 characters \(80% floor\)/);
  });

  it("legacy 2000/3000 DB values still resolve unified aim in prompt", () => {
    for (const legacy of [2000, 3000]) {
      const block = buildLengthInstruction(legacy);
      assert.match(block, /TARGET: 2,400 characters/);
      assert.match(block, /Minimum acceptable: 1,920 characters \(80% floor\)/);
      assert.match(block, /CEILING: 5,000/);
    }
  });

  it("buildMandatoryLengthScopeGuideline formats floor from aim", () => {
    const g = buildMandatoryLengthScopeGuideline(2400);
    assert.match(g, /^TARGET: 2,400 characters/);
    assert.match(g, /Minimum acceptable: 1,920 characters \(80% floor\)/);
  });

  it("single-shot reminder defers to LENGTH CONTROL without Time Dilation", () => {
    const tail = buildSingleShotLengthReminder();
    assert.match(tail, /\[LENGTH CONTROL & SCENE EXPANSION\]/);
    assert.match(tail, /한 번에/);
    assert.match(tail, /<TURN_HANDOFF_AND_PACING>/);
    assert.doesNotMatch(tail, /Time Dilation/);
  });

  it("omits duplicate status length line when every-turn status window", () => {
    const block = buildLengthInstruction(undefined, { statusWindowEveryTurn: true });
    assert.doesNotMatch(block, /RP length = prose\/dialogue only/);
  });

  it("omits duplicate status length line when Flash firewall owns status (OpenRouter)", () => {
    const block = buildLengthInstruction(undefined, { htmlFlashOwned: true });
    assert.doesNotMatch(block, /RP length = prose\/dialogue only/);
    assert.match(block, /<TURN_HANDOFF_AND_PACING>/);
  });

  it("production candidate uses mandatory scope wording without numeric min quotas", () => {
    const block = buildLengthInstructionProductionCandidate();
    assert.match(block, /required scope target, not merely a suggestion/);
    assert.match(block, /Do not conclude the scene after a single reaction/);
    assert.match(block, /\[NO INPUT ECHO — STRICT\]/);
    assert.match(block, /CEILING: 5,000/);
    assert.doesNotMatch(block, /TARGET: 2,400 characters/);
    assert.doesNotMatch(block, /80% floor/);
  });

  it("OpenRouter dynamicBlock has C-full only — no legacy soft wording", () => {
    const charName = "백하율";
    const persona = "렌";
    const chunks = parseCharacterSetting({
      characterId: "mock-1",
      characterName: charName,
      gender: "male",
      systemPrompt: "# 성격\n차분.",
      world: "# 세계관\n현대.",
      exampleDialog: `유저: hi\n${charName}: …`,
      statusWindowPrompt: "",
    });
    const built = buildContext({
      charName,
      personaDisplayName: persona,
      chunks,
      userPersona: formatSelectedPersonaForPrompt(persona, "other", "20대."),
      userNotePrompt: formatUserNoteForPrompt(""),
      longTermMemory: "",
      memoryMeta: formatMemoryMetaForPrompt(
        parseMemoryMeta(JSON.stringify({ affection: 40, trust: 35 }))
      ),
      shortTermHistory: [],
      currentUserMessage: "밤이 깊었어.",
      nsfw: true,
      gender: "male",
      userPersonaGender: "other",
      userImpersonation: false,
      novelModeEnabled: false,
      targetResponseChars: 2500,
      completedTurns: 5,
      genres: ["공포/추리"],
      userNickname: persona,
      modelId: "google/gemini-2.5-pro",
      provider: "openrouter",
    });
    const dyn = built.openRouterSystemSplit?.dynamicBlock ?? "";
    const lengthSec = built.meta.trackedSections?.find((s) => s.id === "rule-length-control");
    assert.ok(lengthSec?.text);
    assert.equal(lengthSec!.text, buildLengthInstruction(2500));

    assert.match(dyn, /\[LENGTH CONTROL & SCENE EXPANSION\]/);
    assert.match(dyn, /TARGET: 2,400 characters/);
    assert.match(dyn, /Minimum acceptable: 1,920 characters \(80% floor\)/);
    assert.match(
      dyn,
      /Mandatory: You must not end the scene until reaching the 80% minimum floor/
    );

    const legacySoft = [
      /Write a highly detailed, immersive response/,
      /end naturally when the moment is complete/,
      /Do not rush the scene/,
      /natural narrative flow/,
      /internal thoughts, sensory details/,
    ];
    for (const pattern of legacySoft) {
      assert.doesNotMatch(dyn, pattern, `legacy soft wording still in dynamicBlock: ${pattern}`);
      assert.doesNotMatch(lengthSec!.text, pattern);
    }

    const sections = built.meta.trackedSections ?? [];
    const lastSection = sections[sections.length - 1];
    assert.equal(lastSection?.id, "rule-terminal-length-override");
    assert.match(lastSection!.text, /\[최우선 절대 지침/);
    assert.match(lastSection!.text, /최소 3,000자 이상 절대 보장 필수/);
    assert.ok(
      built.systemPrompt.trimEnd().endsWith(buildTerminalLengthOverrideBlock().trim()),
      "terminal override must be last block in full system prompt"
    );
    assert.ok(
      dyn.trimEnd().endsWith(buildTerminalLengthOverrideBlock().trim()),
      "terminal override must be last block in OpenRouter dynamicBlock"
    );
  });
});

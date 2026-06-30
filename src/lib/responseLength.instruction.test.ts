import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import {
  appendCompactTerminalLengthToUserTurn,
  buildCompactTerminalLengthAbsoluteTail,
  buildLengthInstruction,
  buildSingleShotLengthReminder,
  buildTerminalLengthOverrideBlock,
  buildTerminalLengthOverrideRecencyBlock,
  normalizeTargetResponseChars,
} from "@/lib/responseLength";
import { buildTurnHandoffAndPacingBlock } from "@/lib/turnHandoffAndPacing";

async function withServerOnlyMock<T>(fn: () => Promise<T>): Promise<T> {
  const require = createRequire(import.meta.url);
  require.cache[require.resolve("server-only")] = {
    exports: {},
    loaded: true,
    id: "server-only",
    filename: "server-only",
  } as NodeModule;
  return fn();
}

function countOccurrences(hay: string, needle: string): number {
  let c = 0;
  let i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) {
    c++;
    i += needle.length;
  }
  return c;
}

describe("buildLengthInstruction", () => {
  it("uses Phase 13 LENGTH CONTROL block as sole numeric source", () => {
    const block = buildLengthInstruction();
    assert.match(block, /\[LENGTH CONTROL & SCENE EXPANSION\]/);
    assert.match(block, /TARGET_LENGTH: 3,200\+ 한국어 글자/);
    assert.match(block, /MINIMUM_FLOOR: 2,700\+/);
    assert.match(block, /\[NO INPUT ECHO — STRICT\]/);
    assert.match(block, /Never paraphrase the user's input/);
    assert.match(block, /\[SCENE CONTINUATION PRIORITY\]/);
    assert.match(block, /\[NARRATIVE DENSITY\]/);
    assert.match(block, /\[MOMENT-TO-MOMENT WRITING\]/);
    assert.match(block, /한 문단에 병합하라는 뜻이 아니다/);
    assert.match(block, /한 줄·한 문단에 붙여 쓰라는 뜻이 아니다/);
    assert.doesNotMatch(block, /따라붙게 한다/);
    assert.match(block, /\[NO GENERIC REACTIONS\]/);
    assert.doesNotMatch(block, /8~10/);
    assert.doesNotMatch(block, /4~5줄/);
    assert.doesNotMatch(block, /\[SCENE COMPLETION CONTROL\]/);
    assert.doesNotMatch(block, /\[LENGTH BUDGET\]/);
    assert.doesNotMatch(block, /\[SCENE COMPLETION\]/);
    assert.doesNotMatch(block, /CEILING:/);
    assert.doesNotMatch(block, /Write a highly detailed, immersive response/);
    assert.doesNotMatch(block, /end naturally when the moment is complete/);
    assert.doesNotMatch(block, /\[TIME DILATION — MICRO-PACING TECHNIQUE\]/);
  });

  it("null targetInput uses default aim (not floor)", () => {
    const block = buildLengthInstruction(null);
    assert.match(block, /TARGET_LENGTH: 3,200\+/);
    assert.match(block, /MINIMUM_FLOOR: 2,700\+/);
  });

  it("ignores legacy per-user aim — always unified 3200 / 2700", () => {
    for (const legacy of [2400, 2700, 2800, 3000]) {
      assert.equal(normalizeTargetResponseChars(legacy), 3200);
      const block = buildLengthInstruction(legacy);
      assert.match(block, /TARGET_LENGTH: 3,200\+ 한국어 글자/);
      assert.match(block, /MINIMUM_FLOOR: 2,700\+/);
    }
  });

  it("legacy 2000/3000 DB values remap to unified aim in prompt", () => {
    for (const legacy of [2000, 3000]) {
      const block = buildLengthInstruction(legacy);
      assert.match(block, /TARGET_LENGTH: 3,200\+ 한국어 글자/);
      assert.match(block, /MINIMUM_FLOOR: 2,700\+/);
      assert.doesNotMatch(block, /CEILING:/);
    }
  });

  it("appendCompactTerminalLengthToUserTurn adds tail at user bottom", () => {
    const out = appendCompactTerminalLengthToUserTurn("밤이 깊었어.", 3200);
    assert.match(out, /^밤이 깊었어\./);
    assert.match(out, /TARGET_LENGTH 3,200\+/);
    assert.match(out, /단일 응답 최대 전개·미달 조기 종료 금지\.$/);
  });

  it("single-shot reminder defers to LENGTH CONTROL without Time Dilation", () => {
    const tail = buildSingleShotLengthReminder();
    assert.match(tail, /\[LENGTH CONTROL & SCENE EXPANSION\]/);
    assert.match(tail, /\[SCENE CONTINUATION PRIORITY\]/);
    assert.doesNotMatch(tail, /<TURN_HANDOFF_AND_PACING>/);
  });

  it("omits duplicate status length line when every-turn status window", () => {
    const block = buildLengthInstruction(undefined, { statusWindowEveryTurn: true });
    assert.doesNotMatch(block, /RP length = prose\/dialogue only/);
  });

  it("omits duplicate status length line when Flash firewall owns status (OpenRouter)", () => {
    const block = buildLengthInstruction(undefined, { htmlFlashOwned: true });
    assert.doesNotMatch(block, /RP length = prose\/dialogue only/);
  });

  it("compact terminal tail uses tier constants at absolute end", () => {
    const tail = buildCompactTerminalLengthAbsoluteTail(undefined);
    assert.match(tail, /TARGET_LENGTH 3,200\+/);
    assert.match(tail, /MINIMUM_FLOOR 2,700\+/);
    assert.match(tail, /단일 응답 최대 전개·미달 조기 종료 금지\./);
    assert.doesNotMatch(tail, /\[TERMINAL LENGTH AUTHORITY\]/);
    assert.doesNotMatch(tail, /\[최우선 절대 지침\]/);
    assert.equal(buildTerminalLengthOverrideRecencyBlock(undefined), tail);
  });

  it("terminal override is compact tail only at absolute end", () => {
    const block = buildTerminalLengthOverrideBlock(3200);
    assert.equal(block, buildCompactTerminalLengthAbsoluteTail(3200));
    assert.match(block, /단일 응답 최대 전개·미달 조기 종료 금지\.$/);
    assert.doesNotMatch(block, /<TURN_HANDOFF_AND_PACING>/);
    assert.doesNotMatch(block, /\[TERMINAL LENGTH AUTHORITY\]/);
  });

  it("OpenRouter dynamicBlock — one numeric length block, one full handoff", async () => {
    await withServerOnlyMock(async () => {
      const { buildContext } = await import("@/services/contextBuilder");
      const { parseCharacterSetting } = await import("@/utils/characterParser");
      const { formatUserNoteForPrompt } = await import("@/lib/persona");
      const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("@/lib/chatMemory");

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
        userPersona: `이름/호칭: ${persona}\n20대.`,
        userNote: formatUserNoteForPrompt(""),
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
        targetResponseChars: 2800,
        completedTurns: 5,
        genres: ["공포/추리"],
        userNickname: persona,
        modelId: "google/gemini-2.5-pro",
        provider: "openrouter",
      });
      const dyn = built.openRouterSystemSplit?.dynamicBlock ?? "";
      const sys = built.systemPrompt ?? "";
      const lengthSec = built.meta.trackedSections?.find((s) => s.id === "rule-length-control");
      assert.ok(lengthSec?.text);
      assert.equal(lengthSec!.text, buildLengthInstruction(3200));

      assert.ok(countOccurrences(sys, "[LENGTH CONTROL & SCENE EXPANSION]") >= 1);
      assert.equal(countOccurrences(sys, "TARGET_LENGTH:"), 1);
      assert.equal(countOccurrences(sys, "MINIMUM_FLOOR:"), 1);
      assert.equal(countOccurrences(sys, "CEILING:"), 0);
      assert.equal(countOccurrences(sys, "3,200"), 2, "LENGTH CONTROL + compact terminal tail cite unified aim");
      assert.equal(countOccurrences(sys, "2,800"), 0);

      assert.equal((sys.match(/<\/TURN_HANDOFF_AND_PACING>/g) ?? []).length, 1);

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
      assert.match(lastSection!.text, /단일 응답 최대 전개·미달 조기 종료 금지\./);
      assert.doesNotMatch(lastSection!.text, /<TURN_HANDOFF_AND_PACING>/);
      assert.doesNotMatch(lastSection!.text, /\[TERMINAL LENGTH AUTHORITY\]/);
      assert.doesNotMatch(lastSection!.text, /\[최우선 절대 지침\]/);
      const handoffSec = sections.find((s) => s.id === "turn-handoff-and-pacing");
      assert.ok(handoffSec?.text);
      assert.match(handoffSec!.text, /<TURN_HANDOFF_AND_PACING>/);
      assert.ok(
        built.systemPrompt.trimEnd().endsWith(buildTerminalLengthOverrideBlock(3200).trim()),
        "terminal override must be last block in full system prompt"
      );
      assert.ok(
        dyn.trimEnd().endsWith(buildTerminalLengthOverrideBlock(3200).trim()),
        "terminal override must be last block in OpenRouter dynamicBlock"
      );
    });
  });
});

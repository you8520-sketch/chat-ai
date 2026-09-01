import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyNovelParagraph,
  formatNovelProseForDisplay,
  resolveNovelDisplayParagraphs,
} from "@/lib/novelParagraphs";
import { buildTrpgBotActionUserBlock, TRPG_BOT_SYSTEM } from "./botActions";

const DENSE = `이현은 몸을 낮췄다. "야, 렌. 기다려." 그는 골목을 봤다.`;
const SPACED = `이현은 몸을 낮췄다.\n\n"야, 렌. 기다려."\n\n그는 골목을 봤다.`;

function kinds(raw: string, streaming = false): string[] {
  const paras = streaming
    ? resolveNovelDisplayParagraphs(raw, { streaming: true })
    : formatNovelProseForDisplay(raw);
  return paras.map((p) => classifyNovelParagraph(p));
}

describe("TRPG bot prose layout", () => {
  it("owns paragraph rules in one PROSE LAYOUT system block", () => {
    assert.equal((TRPG_BOT_SYSTEM.match(/\[PROSE LAYOUT\]/g) ?? []).length, 1);
    assert.match(TRPG_BOT_SYSTEM, /Narration and actual spoken dialogue are separate paragraphs/);
    const user = buildTrpgBotActionUserBlock({
      characterName: "이현",
      description: "신중",
      greeting: "기다려.",
      systemPrompt: "신중하다.",
      previousGmNarration: "골목이 어둡다.",
      campaignMemory: "",
      humanActions: [{ playerName: "렌", text: "골목을 본다." }],
    });
    assert.doesNotMatch(user, /\[PROSE LAYOUT\]/);
    assert.doesNotMatch(user, /Narration and actual spoken dialogue/);
    const proseLayout = TRPG_BOT_SYSTEM.slice(
      TRPG_BOT_SYSTEM.indexOf("[PROSE LAYOUT]"),
      TRPG_BOT_SYSTEM.indexOf("After the finished prose")
    );
    assert.doesNotMatch(proseLayout, /character contract/);
    assert.doesNotMatch(proseLayout, /300–800/);
  });

  it("splits dense spoken dialogue with the regular-chat paragraph rules", () => {
    assert.deepEqual(kinds(DENSE), ["narration", "dialogue", "narration"]);
    const paras = formatNovelProseForDisplay(DENSE);
    assert.match(paras[0] ?? "", /몸을 낮췄다/);
    assert.match(paras[1] ?? "", /야, 렌/);
    assert.match(paras[2] ?? "", /골목을 봤다/);
  });

  it("keeps dense and blank-line bot raw on the same display rules", () => {
    assert.deepEqual(kinds(DENSE), kinds(SPACED));
    assert.deepEqual(kinds(DENSE), ["narration", "dialogue", "narration"]);
  });

  it("keeps reveal and final paragraph kinds semantically identical", () => {
    assert.deepEqual(kinds(DENSE, true), kinds(DENSE, false));
    assert.deepEqual(kinds(SPACED, true), kinds(SPACED, false));
  });
});

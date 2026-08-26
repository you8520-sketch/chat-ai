import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  classifyNovelParagraph,
  formatNovelProseForDisplay,
  groupAuthorParagraphs,
  groupNovelParagraphs,
  novelParagraphSpacingClass,
  resolveNovelDisplayParagraphs,
  stabilizeStreamingNovelParagraphs,
} from "@/lib/novelParagraphs";
import { splitTrpgGmProseForAssets } from "@/lib/trpg/trpgTaggedProse";

const GM_GAP = "mt-[calc(1em*var(--chat-paragraph-gap-scale,1))]";

function gmParagraphs(text: string, streaming = false) {
  return resolveNovelDisplayParagraphs(text, { streaming });
}

function gmSpacingBetween(first: string, second: string) {
  const a = classifyNovelParagraph(first);
  const b = classifyNovelParagraph(second);
  return novelParagraphSpacingClass(b, a, "gm");
}

describe("TRPG GM prose spacing policy", () => {
  it("A: narration → narration gets readable gm gap", () => {
    const text =
      "첫 번째 지문 문단입니다. 어둠 속 복도를 따라 발걸음 소리만이 울려 퍼졌고, 등불 불빛은 벽면에 기괴한 그림자를 드리웠다.\n\n두 번째 지문 문단입니다. 문 너머에서 금속성 소리가 들려왔고, 공기 중에는 녹슨 냄새가 배어 있었다.";
    const paragraphs = gmParagraphs(text);
    assert.equal(paragraphs.length, 2);
    assert.equal(gmSpacingBetween(paragraphs[0]!, paragraphs[1]!), GM_GAP);
  });

  it("B: narration → dialogue splits into separate blocks with gap", () => {
    const text = "어둠 속에서 발소리가 들렸다.\n\n\"누구냐.\"";
    const paragraphs = gmParagraphs(text);
    assert.equal(paragraphs.length, 2);
    assert.equal(classifyNovelParagraph(paragraphs[0]!), "narration");
    assert.equal(classifyNovelParagraph(paragraphs[1]!), "dialogue");
    assert.equal(gmSpacingBetween(paragraphs[0]!, paragraphs[1]!), GM_GAP);
  });

  it("C: dialogue → narration splits into separate blocks with gap", () => {
    const text = "\"멈춰.\"\n\n경비원이 손을 들었다.";
    const paragraphs = gmParagraphs(text);
    assert.equal(paragraphs.length, 2);
    assert.equal(classifyNovelParagraph(paragraphs[0]!), "dialogue");
    assert.equal(classifyNovelParagraph(paragraphs[1]!), "narration");
    assert.equal(gmSpacingBetween(paragraphs[0]!, paragraphs[1]!), GM_GAP);
  });

  it("D: dialogue → dialogue stays distinct speech blocks with gap", () => {
    const text = "\"첫 번째 대사.\"\n\n\"두 번째 대사.\"";
    const paragraphs = gmParagraphs(text);
    assert.equal(paragraphs.length, 2);
    assert.equal(classifyNovelParagraph(paragraphs[0]!), "dialogue");
    assert.equal(classifyNovelParagraph(paragraphs[1]!), "dialogue");
    assert.equal(gmSpacingBetween(paragraphs[0]!, paragraphs[1]!), GM_GAP);
  });

  it("E: asset vs no-asset paths share paragraph count and spacing owner", () => {
    const prose =
      "대합실이 흔들린다.\n\n\"조심해.\"\n\n먼지가 내려앉았다.";
    const assetProse = `${prose}\n[태그: 대합실]`;
    const plain = gmParagraphs(prose);
    const assetParts = splitTrpgGmProseForAssets(assetProse, {
      scenarioAssets: [{ url: "/hall.webp", tag: "대합실", chat: true }],
      characterCatalog: [],
      campaignId: 1,
      roundNumber: 2,
    });
    const textPart = assetParts.find((p) => p.kind === "text");
    assert.ok(textPart);
    const withAsset = gmParagraphs(textPart!.text);
    assert.deepEqual(withAsset, plain);
    assert.equal(gmSpacingBetween(plain[0]!, plain[1]!), GM_GAP);
    assert.equal(gmSpacingBetween(plain[1]!, plain[2]!), GM_GAP);

    const named = readFileSync("src/app/trpg/TrpgNamedProse.tsx", "utf8");
    assert.match(named, /function TrpgGmProseBody/);
    assert.match(named, /paragraphMode="ai"/);
    assert.match(named, /paragraphSpacingMode="gm"/);
    assert.doesNotMatch(named, /italic font-semibold text-sky-100/);
  });

  it("F: streaming progressive reveal keeps committed paragraph boundaries stable", () => {
    const full = "첫 지문입니다. 복도 끝에서 바람이 스쳤다.\n\n\"대사.\"\n\n다음 지문입니다. 문틈으로 빛이 새었다.";
    const mid = "첫 지문입니다. 복도 끝에서 바람이 스쳤다.\n\n";
    const early = "첫 지문입니다. 복도 끝에서 바람이 스쳤다.";
    const finalParas = formatNovelProseForDisplay(full);
    const midParas = resolveNovelDisplayParagraphs(mid, { streaming: true });
    const stabilizedMid = stabilizeStreamingNovelParagraphs(
      resolveNovelDisplayParagraphs(early, { streaming: true }),
      midParas
    );
    assert.equal(stabilizedMid[0], finalParas[0]);
    assert.equal(resolveNovelDisplayParagraphs(full, { streaming: false }).join("\n\n"), finalParas.join("\n\n"));
    assert.equal(stabilizedMid.length, 1);
    assert.equal(finalParas.length, 3);
  });

  it("G: non-GM author mode spacing is unchanged", () => {
    assert.equal(novelParagraphSpacingClass("narration", "narration", "author"), "mt-0");
    assert.equal(novelParagraphSpacingClass("dialogue", "narration", "author"), "mt-0");
    assert.equal(
      novelParagraphSpacingClass("narration", "narration", "ai"),
      GM_GAP
    );
    assert.equal(groupAuthorParagraphs("line1\nline2").length, 2);
  });
});

describe("TRPG GM prose renderer ownership", () => {
  it("uses novelParagraphSpacingClass gm mode as single spacing owner", () => {
    assert.equal(novelParagraphSpacingClass("dialogue", "narration", "gm"), GM_GAP);
    assert.equal(novelParagraphSpacingClass("narration", "dialogue", "gm"), GM_GAP);
    assert.equal(novelParagraphSpacingClass("narration", "narration", "gm"), GM_GAP);
    assert.equal(novelParagraphSpacingClass("narration", null, "gm"), "");

    const novelText = readFileSync("src/components/NovelText.tsx", "utf8");
    assert.match(novelText, /paragraphSpacingMode\?: "default" \| "gm"/);
    assert.match(novelText, /paragraphSpacingMode === "gm"/);

    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /paragraphSpacingMode="gm"/);
    assert.match(room, /streaming=\{revealNarration\}/);
  });

  it("uses AI paragraph grouping for GM scene beats, not author mode", () => {
    const mixed = "지문 한 줄.\n\"대사 한 줄.\"";
    const authorLines = mixed.split("\n").map((l) => l.trimEnd());
    const aiGrouped = groupNovelParagraphs(mixed);
    assert.equal(authorLines.length, 2);
    assert.equal(aiGrouped.length, 2);
    assert.equal(classifyNovelParagraph(aiGrouped[0]!), "narration");
    assert.equal(classifyNovelParagraph(aiGrouped[1]!), "dialogue");
  });
});

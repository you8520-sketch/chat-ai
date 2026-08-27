import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  classifyNovelParagraph,
  novelParagraphSpacingClass,
  resolveNovelDisplayParagraphs,
  stabilizeStreamingNovelParagraphs,
} from "@/lib/novelParagraphs";
import { parseTrpgSceneSpeech } from "./sceneSpeech";
import { splitTrpgGmProseForAssets } from "./trpgTaggedProse";

/** GM scene beats use the shared AI paragraph owner (display-only). */
function gmParagraphs(text: string, streaming = false, previous?: string[]) {
  return resolveNovelDisplayParagraphs(text, {
    streaming,
    previousStreamingParagraphs: streaming ? previous : undefined,
  });
}

function paragraphKinds(text: string) {
  return gmParagraphs(text).map((p) => classifyNovelParagraph(p));
}

function textPartsFromTaggedProse(text: string) {
  return splitTrpgGmProseForAssets(text, {
    scenarioAssets: [],
    characterCatalog: [],
    campaignId: 1,
    roundNumber: 1,
  })
    .filter((part) => part.kind === "text")
    .flatMap((part) => gmParagraphs(part.text));
}

describe("GM prose readability — shared AI paragraph owner", () => {
  it("CASE A — inline narration + dialogue splits into narration / dialogue / narration", () => {
    const input = '태현은 문을 바라봤다. "잠깐, 안쪽에 뭐가 있어." 그는 손을 들었다.';
    assert.deepEqual(paragraphKinds(input), ["narration", "dialogue", "narration"]);
  });

  it("CASE B — curly double quotes split like straight quotes", () => {
    const input = "복도가 조용해졌다. \u201C움직이지 마.\u201D 먼지가 떨어졌다.";
    assert.deepEqual(paragraphKinds(input), ["narration", "dialogue", "narration"]);
  });

  it("CASE C — narrated quote stays one narration block", () => {
    const input = '그는 예전의 "다시 오겠다"는 말을 떠올렸다.';
    assert.deepEqual(gmParagraphs(input), [input]);
    assert.deepEqual(paragraphKinds(input), ["narration"]);
  });

  it("CASE D — written text cue stays narration without invented speaker", () => {
    const input = '벽에는 "접근 금지"라고 쓰여 있었다.';
    const beats = parseTrpgSceneSpeech(input, ["강이현"]);
    assert.equal(beats.length, 1);
    assert.equal(beats[0]?.speaker, null);
    assert.deepEqual(paragraphKinds(input), ["narration"]);
  });

  it("CASE E — explicit speaker beat unchanged at sceneSpeech layer", () => {
    const input = '복도에 금속음이 울렸다.\n강이현: "저쪽부터 보자."';
    const beats = parseTrpgSceneSpeech(input, ["강이현"]);
    assert.equal(beats.length, 2);
    assert.equal(beats[0]?.speaker, null);
    assert.equal(beats[1]?.speaker, "강이현");
  });

  it("CASE F — consecutive named speakers remain separate beats", () => {
    const input = '강이현: "왼쪽."\n권태현: "오른쪽."';
    const beats = parseTrpgSceneSpeech(input, ["강이현", "권태현"]);
    assert.equal(beats.length, 2);
    assert.equal(beats[0]?.speaker, "강이현");
    assert.equal(beats[1]?.speaker, "권태현");
  });

  it("CASE G — blank-line narration preserves semantic paragraph boundaries", () => {
    const beats = parseTrpgSceneSpeech("첫 지문이다.\n\n둘째 지문이다.", []);
    assert.equal(beats.length, 2);
    assert.equal(beats[0]?.speaker, null);
    assert.equal(beats[1]?.speaker, null);
    assert.match(beats[0]?.text ?? "", /첫 지문/);
    assert.match(beats[1]?.text ?? "", /둘째 지문/);
  });

  it("CASE I — multi-paragraph GM table-talk uses shared paragraph owner", () => {
    const body = "첫 문단입니다.\n\n둘째 문단입니다.";
    assert.ok(gmParagraphs(body).length >= 1);
    assert.doesNotMatch(
      fs.readFileSync("src/app/trpg/TrpgNamedProse.tsx", "utf8"),
      /body\.split\(\/\\n\{2,\}\/\)/
    );
  });

  it("table-talk quote-internal blank line stays one dialogue paragraph", () => {
    const straight = '"첫 문장.\n\n같은 화자의 둘째 문장."';
    const curly = `\u201C첫 문장.\n\n같은 화자의 둘째 문장.\u201D`;
    for (const input of [straight, curly]) {
      const paragraphs = gmParagraphs(input);
      assert.equal(paragraphs.length, 1, input);
      assert.equal(classifyNovelParagraph(paragraphs[0]!), "dialogue", input);
      assert.doesNotMatch(paragraphs[0]!, /\n\n/);
    }
  });

  it("table-talk narration / dialogue / narration uses shared spacing transitions", () => {
    const body = '첫 서술 문단.\n\n"실제 대사."\n\n둘째 서술 문단.';
    const kinds = paragraphKinds(body);
    assert.deepEqual(kinds, ["narration", "dialogue", "narration"]);
    assert.equal(
      novelParagraphSpacingClass(kinds[1]!, kinds[0]!, "ai"),
      novelParagraphSpacingClass("dialogue", "narration", "ai")
    );
    assert.equal(
      novelParagraphSpacingClass(kinds[2]!, kinds[1]!, "ai"),
      novelParagraphSpacingClass("narration", "dialogue", "ai")
    );
    assert.match(novelParagraphSpacingClass(kinds[1]!, kinds[0]!, "ai"), /1\.5em/);
    assert.match(novelParagraphSpacingClass(kinds[2]!, kinds[1]!, "ai"), /1\.5em/);
  });

  it("global narrated quote stays narration; actual dialogue still splits", () => {
    const narrated = '그는 예전의 "다시 오겠다"는 말을 떠올렸다.';
    assert.deepEqual(paragraphKinds(narrated), ["narration"]);
    const spoken = '그는 멈췄다. "가자." 그는 돌아섰다.';
    assert.deepEqual(paragraphKinds(spoken), ["narration", "dialogue", "narration"]);
  });

  it("CASE H — unlabeled GM beat with mixed prose routes through AI formatter", () => {
    const beats = parseTrpgSceneSpeech(
      '태현은 고개를 들었다. "거기서 멈춰." 그는 손을 뻗었다.',
      ["권태현"]
    );
    assert.equal(beats.length, 1);
    assert.deepEqual(paragraphKinds(beats[0]!.text), ["narration", "dialogue", "narration"]);
  });

  it("CASE J — GM table-talk quoted dialogue uses shared dialogue split", () => {
    const body = '상황을 정리하면, "저쪽부터 확인하자." 가 좋겠다.';
    assert.deepEqual(paragraphKinds(body), ["narration", "dialogue", "narration"]);
  });

  it("CASE K — asset parity: plain and tagged text paths share paragraph arrays", () => {
    const prose = '복도가 어두웠다. "조용히." 그는 멈췄다.';
    const tagged = `[태그: 폐역]\n${prose}`;
    assert.deepEqual(textPartsFromTaggedProse(tagged), gmParagraphs(prose));
  });

  it("CASE L — streaming keeps previously committed paragraph boundaries stable", () => {
    const prefix = "첫 지문입니다.";
    const mid = '첫 지문입니다.\n\n"대사..."';
    const final = '첫 지문입니다.\n\n"대사..."\n\n다음 지문...';

    const step1 = gmParagraphs(prefix, true);
    const step2 = gmParagraphs(mid, true, step1);
    const step3 = gmParagraphs(final, true, step2);

    assert.deepEqual(step1, ["첫 지문입니다."]);
    assert.deepEqual(step2.slice(0, 1), step1);
    assert.deepEqual(step3.slice(0, step2.length - 1), step2.slice(0, step2.length - 1));

    const frozen = stabilizeStreamingNovelParagraphs(step2, step3);
    assert.deepEqual(frozen.slice(0, step2.length - 1), step2.slice(0, step2.length - 1));
  });
});

describe("GM prose readability — SceneTurn wiring", () => {
  it("CASE M — one SceneTurn quote root; scene beats use paragraphMode ai", () => {
    const room = fs.readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    const sceneTurnBlock = room.slice(room.indexOf("function SceneTurn"));
    const assistantCount = (sceneTurnBlock.match(/data-quote-assistant/g) ?? []).length;
    assert.equal(assistantCount, 1);
    assert.match(sceneTurnBlock, /paragraphMode="ai"/);
    assert.match(sceneTurnBlock, /dialogueAccent=\{false\}/);
    assert.match(sceneTurnBlock, /contentStreaming=\{revealNarration && gmRevealProgressive\}/);
    assert.match(sceneTurnBlock, /trpgSceneBeatSpacingClass/);
  });

  it("CASE N — action cards keep existing author/ai paragraph modes", () => {
    const room = fs.readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /paragraphMode=\{action\.kind === "ai_character" \? "ai" : "author"\}/);
  });

  it("CASE O — NovelText defaults unchanged; GM uses generic opt-in props only", () => {
    const novel = fs.readFileSync("src/components/NovelText.tsx", "utf8");
    const named = fs.readFileSync("src/app/trpg/TrpgNamedProse.tsx", "utf8");
    assert.match(novel, /paragraphMode = "ai"/);
    assert.match(novel, /inlineFirstParagraph = false/);
    assert.doesNotMatch(novel, /gmTableTalk|proseVariant|paragraphSpacingMode/);
    assert.doesNotMatch(named, /gmTableTalkTypography|gmSceneBeatSpacing/);
    assert.doesNotMatch(named, /body\.split\(\/\\n\{2,\}\/\)/);
    assert.match(named, /paragraphMode="ai"/);
    assert.match(named, /dialogueAccent=\{false\}/);
    assert.match(named, /contentStreaming \?\? reveal/);
    assert.match(named, /inlineFirstParagraph/);
    assert.match(named, /proseClassName/);
    assert.doesNotMatch(named, /proseVariant/);
  });
});

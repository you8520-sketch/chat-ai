import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildChatComicImagePrompt } from "@/lib/chatComicGeneration";
import {
  compileChatComicPanelSpec,
  renderChatComicPanelSpecSection,
  resolveComicPanelFormat,
} from "@/lib/chatComicPanelSpec";
import {
  COMIC_PANEL_BENCHMARK_FIXTURES,
  scenePlanForFixture,
} from "@/lib/chatComicPanelSpec.fixtures";
import { formatApprovedScenePlanForComic } from "@/lib/chatImageScenePlan";
import {
  bindChatImageReferencePack,
  buildChatDuoVisualSubjects,
} from "@/lib/chatImageVisualIdentity";

function duoSubjects(characterName: string, personaName: string) {
  return bindChatImageReferencePack({
    subjectsInImageOrder: buildChatDuoVisualSubjects({
      characterName,
      characterGender: "male",
      characterImageUrl: `/ref/${characterName}`,
      characterSavedAppearance: "",
      characterAppearanceMode: "image_only",
      personaName,
      personaGender: "female",
      personaImageUrl: `/ref/${personaName}`,
      personaSavedAppearance: "",
      personaAppearanceMode: "image_only",
    }),
  }).subjects;
}

describe("chatComicPanelSpec compiler", () => {
  it("maps panel counts to format ids", () => {
    assert.equal(resolveComicPanelFormat(2), "2panel");
    assert.equal(resolveComicPanelFormat(3), "3koma");
    assert.equal(resolveComicPanelFormat(4), "4panel");
  });

  it("renders NAI-style panel blocks with camera, layout, and speech bubble separation", () => {
    const fixture = COMIC_PANEL_BENCHMARK_FIXTURES[0]!;
    const plan = scenePlanForFixture(fixture);
    const spec = compileChatComicPanelSpec({
      plan,
      personaName: fixture.expectedCast.persona,
      characterName: fixture.expectedCast.character,
      subjects: duoSubjects(fixture.expectedCast.character, fixture.expectedCast.persona),
    });
    const rendered = renderChatComicPanelSpecSection(spec);

    assert.match(rendered, /COMIC PANEL SPEC/);
    assert.match(rendered, /Format: 2panel \(2 panels\)/);
    assert.match(rendered, /Hero focus:/);
    assert.match(rendered, /Hero event ids:/);
    assert.match(rendered, /Cast:/);
    assert.match(rendered, /\[Panel 1 — Opening beat\]/);
    assert.match(rendered, /Camera:/);
    assert.match(rendered, /Layout: A left, B right — maintain stable orientation across panels/);
    assert.match(rendered, /Speech bubble \(B \/ persona\):/);
    assert.match(rendered, /SFX: \(none — do not render sound-effect text\)/);
    assert.match(rendered, /Continuity rules:/);
    assert.match(rendered, /Global must avoid:/);
    assert.doesNotMatch(rendered, /^PANEL 1$/m);
  });

  it("uses format-specific beat roles for 3koma and 4panel", () => {
    const three = compileChatComicPanelSpec({
      plan: scenePlanForFixture(COMIC_PANEL_BENCHMARK_FIXTURES[3]!),
      personaName: "서연",
      characterName: "도윤",
      subjects: duoSubjects("도윤", "서연"),
    });
    assert.equal(three.panels[2]?.beatRole, "Closing beat");
    assert.match(
      renderChatComicPanelSpecSection(three),
      /3-panel rhythm: opening → middle → closing beat/
    );

    const four = compileChatComicPanelSpec({
      plan: scenePlanForFixture(COMIC_PANEL_BENCHMARK_FIXTURES[7]!),
      personaName: "한별",
      characterName: "시우",
      subjects: duoSubjects("시우", "한별"),
    });
    assert.equal(four.panels[3]?.beatRole, "Closing beat");
    assert.match(
      renderChatComicPanelSpecSection(four),
      /4-panel rhythm: opening → beat 2 → beat 3 → closing beat/
    );
  });

  it("buildChatComicImagePrompt uses COMIC PANEL SPEC instead of APPROVED SCENE PLAN", () => {
    const fixture = COMIC_PANEL_BENCHMARK_FIXTURES[0]!;
    const prompt = buildChatComicImagePrompt({
      characterName: fixture.expectedCast.character,
      characterGender: "male",
      personaName: fixture.expectedCast.persona,
      personaGender: "male",
      plan: scenePlanForFixture(fixture),
    });
    assert.match(prompt, /COMIC PANEL SPEC/);
    assert.match(prompt, /\[Panel 1 — Opening beat\]/);
    assert.doesNotMatch(prompt, /APPROVED SCENE PLAN/);
    assert.match(prompt, /STRICT CLOSED TEXT WHITELIST/);
    assert.doesNotMatch(prompt, /romantic-comedy timing/i);
  });
});

describe("chatComicPanelSpec frozen benchmark A/B", () => {
  for (const fixture of COMIC_PANEL_BENCHMARK_FIXTURES) {
    it(`${fixture.id}: structured compiler adds panel-spec sections vs legacy prose`, () => {
      const plan = scenePlanForFixture(fixture);
      const legacy = formatApprovedScenePlanForComic(plan);
      const structured = renderChatComicPanelSpecSection(
        compileChatComicPanelSpec({
          plan,
          personaName: fixture.expectedCast.persona,
          characterName: fixture.expectedCast.character,
          subjects: duoSubjects(fixture.expectedCast.character, fixture.expectedCast.persona),
        })
      );

      assert.match(legacy, /PANEL 1/);
      assert.doesNotMatch(legacy, /\[Panel 1 —/);
      assert.doesNotMatch(legacy, /Camera:/);

      assert.match(structured, /\[Panel 1 —/);
      assert.match(structured, /Camera:/);
      assert.match(structured, /Framing:/);
      assert.match(structured, /Layout:/);
      assert.match(structured, /Speech bubble/);
      assert.match(structured, /Hero focus:/);
      assert.equal(
        (structured.match(/\[Panel \d+/g) ?? []).length,
        fixture.panelCount
      );

      for (const line of fixture.expectedDialogue) {
        assert.match(structured, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      }
    });
  }
});

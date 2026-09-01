import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ChatImageCastGroundedSubject } from "./chatImageCastManifest";
import {
  compileChatComicPanelSpec,
  countActionDirectiveDuplicates,
  countEmptyActingDirectives,
  countForcedGenreDirectives,
  renderChatComicPanelSpecSection,
} from "./chatComicPanelSpec";
import { buildDeterministicScenePlan, buildSceneSourceMessages } from "./chatImageScenePlan";
import {
  bindChatImageReferencePack,
  buildChatDuoVisualSubjects,
} from "./chatImageVisualIdentity";

function groundedSubject(
  partial: Pick<ChatImageCastGroundedSubject, "role" | "name" | "included"> &
    Partial<ChatImageCastGroundedSubject>
): ChatImageCastGroundedSubject {
  return {
    key: partial.role,
    role: partial.role,
    name: partial.name,
    included: partial.included,
    importance: partial.importance ?? "primary",
    referenceImageUrl: partial.referenceImageUrl ?? "",
    sourceKind: partial.sourceKind ?? "main_character",
    visualRole: partial.visualRole ?? partial.role,
    gender: partial.gender ?? "unknown",
    appearanceMode: partial.appearanceMode ?? "image_only",
    savedAppearance: partial.savedAppearance ?? "",
    attachReference: partial.attachReference ?? true,
    eventSubjectIds: partial.eventSubjectIds ?? [],
    mentionNames: partial.mentionNames ?? [],
    compositionGoal: partial.compositionGoal ?? "",
  };
}

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

describe("chatComicPanelSpec cast label stability", () => {
  it("persona hidden uses visual subject A for main character", () => {
    const shuffled = [
      groundedSubject({ role: "main_character", name: "태현", included: true }),
    ];
    const subjects = duoSubjects("태현", "렌");

    const plan = buildDeterministicScenePlan(
      buildSceneSourceMessages([
        { id: 1, role: "assistant", content: '"안녕."' },
      ]),
      2
    );
    const spec = compileChatComicPanelSpec({
      plan,
      personaName: "렌",
      characterName: "태현",
      visibility: { personaVisible: false },
      castSelected: shuffled,
      subjects,
    });
    const rendered = renderChatComicPanelSpecSection(spec);
    assert.match(rendered, /A = chat character \(태현\)/);
    assert.match(rendered, /Speech bubble \(A \/ character\)/);
    assert.doesNotMatch(rendered, /B = chat character \(태현\)/);
    assert.match(rendered, /SUBJECT A \(태현\) centered; persona off-camera only/);
  });

  it("visual-order compile ignores selectedCast array order shuffle", () => {
    const plan = buildDeterministicScenePlan(
      buildSceneSourceMessages([{ id: 1, role: "user", content: '"안녕."' }]),
      2
    );
    const subjects = duoSubjects("태현", "렌");
    const ordered = compileChatComicPanelSpec({
      plan,
      personaName: "렌",
      characterName: "태현",
      castSelected: [
        groundedSubject({ role: "persona", name: "렌", included: true }),
        groundedSubject({ role: "main_character", name: "태현", included: true }),
      ],
      subjects,
    }).cast;
    const shuffled = compileChatComicPanelSpec({
      plan,
      personaName: "렌",
      characterName: "태현",
      castSelected: [
        groundedSubject({ role: "main_character", name: "태현", included: true }),
        groundedSubject({ role: "persona", name: "렌", included: true }),
      ],
      subjects,
    }).cast;
    assert.deepEqual(shuffled, ordered);
    assert.deepEqual(ordered, [
      { label: "A", role: "chat character", name: "태현" },
      { label: "B", role: "user persona", name: "렌" },
    ]);
  });
});

describe("chatComicPanelSpec neutral semantics", () => {
  it("does not force punchline beat roles in 3-panel output", () => {
    const plan = buildDeterministicScenePlan(
      buildSceneSourceMessages([
        { id: 1, role: "user", content: "*비가 내린다*" },
        { id: 2, role: "assistant", content: "조용히 우산을 건넨다." },
      ]),
      3
    );
    const spec = compileChatComicPanelSpec({
      plan,
      personaName: "렌",
      characterName: "태현",
      subjects: duoSubjects("태현", "렌"),
    });
    assert.equal(countForcedGenreDirectives(spec), 0);
    assert.match(renderChatComicPanelSpecSection(spec), /Closing beat/);
    assert.doesNotMatch(renderChatComicPanelSpecSection(spec), /punchline/i);
  });

  it("does not emit empty acting or expressions directives for dialogue-only panels", () => {
    const plan = buildDeterministicScenePlan(
      buildSceneSourceMessages([
        { id: 1, role: "assistant", content: '태현이 "가지 마."라고 말했다.' },
      ]),
      2
    );
    const spec = compileChatComicPanelSpec({
      plan,
      personaName: "렌",
      characterName: "태현",
      subjects: duoSubjects("태현", "렌"),
    });
    assert.equal(countEmptyActingDirectives(spec), 0);
    assert.equal(countActionDirectiveDuplicates(spec), 0);
    const rendered = renderChatComicPanelSpecSection(spec);
    assert.doesNotMatch(rendered, /^Expressions:/m);
    assert.doesNotMatch(rendered, /^Acting:\s*$/m);
  });
});

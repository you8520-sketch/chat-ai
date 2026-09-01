import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ChatImageCastGroundedSubject } from "./chatImageCastManifest";
import {
  buildStableCastLabels,
  compileChatComicPanelSpec,
  countEmptyActingDirectives,
  countForcedGenreDirectives,
  renderChatComicPanelSpecSection,
} from "./chatComicPanelSpec";
import { buildDeterministicScenePlan, buildSceneSourceMessages } from "./chatImageScenePlan";

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

describe("chatComicPanelSpec cast label stability", () => {
  it("persona hidden keeps main character on label B regardless of array order", () => {
    const shuffled = [
      groundedSubject({ role: "main_character", name: "태현", included: true }),
    ];
    const cast = buildStableCastLabels({
      selectedCast: shuffled,
      visibility: { personaVisible: false },
      personaName: "렌",
      characterName: "태현",
    });
    assert.deepEqual(cast, [{ label: "B", role: "main_character", name: "태현" }]);

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
    });
    const rendered = renderChatComicPanelSpecSection(spec);
    assert.match(rendered, /B = main_character \(태현\)/);
    assert.match(rendered, /Speech bubble \(B \/ character\)/);
    assert.doesNotMatch(rendered, /A = main_character/);
  });

  it("role-stable labels ignore selectedCast array order shuffle", () => {
    const ordered = buildStableCastLabels({
      selectedCast: [
        groundedSubject({ role: "persona", name: "렌", included: true }),
        groundedSubject({ role: "main_character", name: "태현", included: true }),
      ],
      visibility: { personaVisible: true },
      personaName: "렌",
      characterName: "태현",
    });
    const shuffled = buildStableCastLabels({
      selectedCast: [
        groundedSubject({ role: "main_character", name: "태현", included: true }),
        groundedSubject({ role: "persona", name: "렌", included: true }),
      ],
      visibility: { personaVisible: true },
      personaName: "렌",
      characterName: "태현",
    });
    assert.deepEqual(shuffled, ordered);
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
    });
    assert.equal(countEmptyActingDirectives(spec), 0);
    const rendered = renderChatComicPanelSpecSection(spec);
    assert.doesNotMatch(rendered, /^Expressions:/m);
    assert.doesNotMatch(rendered, /^Acting:\s*$/m);
  });
});

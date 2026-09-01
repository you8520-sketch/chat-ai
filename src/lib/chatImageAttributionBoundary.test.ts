import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  countMalformedAttributionBenchmarkCorpus,
  countMalformedAttributionLdFixtures,
} from "./chatImageAttributionAudit";
import {
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
  extractDeterministicEvents,
  isMalformedAttributionText,
} from "./chatImageScenePlan";
import { compileChatComicPanelSpec, renderChatComicPanelSpecSection } from "./chatComicPanelSpec";

const ATTRIBUTION_FIXTURES = [
  {
    id: "A",
    content: '태현이 렌의 손목을 붙잡고 "가지 마."라고 말했다.',
    dialogue: ["가지 마."],
    visualIncludes: ["손목"],
    visualExcludes: ["라고 말했다"],
  },
  {
    id: "B",
    content: '지훈이 눈을 크게 뜨며 "진짜?"라고 되물었다.',
    dialogue: ["진짜?"],
    visualIncludes: ["눈을 크게 뜨며"],
    visualExcludes: ["라고 되물었다", "라고 되물"],
  },
  {
    id: "C",
    content: '도윤이 작게 "…고마워."라고 말한다.',
    dialogue: ["…고마워."],
    visualIncludes: ["작게"],
    visualExcludes: ["라고 말한다"],
  },
  {
    id: "D",
    content: '현우가 황급히 돌아서며 "아, 미안!"이라고 외친다.',
    dialogue: ["아, 미안!"],
    visualIncludes: ["황급히 돌아서며"],
    visualExcludes: ["이라고 외친다", "이라고 외친"],
  },
  {
    id: "E",
    content: '그가 고개를 숙이며 "미안해."라고 속삭였다.',
    dialogue: ["미안해."],
    visualIncludes: ["고개를 숙이며"],
    visualExcludes: ["라고 속삭"],
  },
  {
    id: "F",
    content: '그녀는 "왜?"라고 물었다.',
    dialogue: ["왜?"],
    visualIncludes: [],
    visualExcludes: ["라고 물었다"],
  },
  {
    id: "G",
    content: '"괜찮아."라고 답했다.',
    dialogue: ["괜찮아."],
    visualIncludes: [],
    visualExcludes: ["라고 답했다"],
  },
  {
    id: "H",
    content: '"알았어."라고 말하며 손을 뻗었다.',
    dialogue: ["알았어."],
    visualIncludes: ["손을 뻗었다"],
    visualExcludes: ["라고 말하며"],
  },
  {
    id: "I",
    content: '"알았어."라고 말했다. 그는 문을 닫았다.',
    dialogue: ["알았어."],
    visualIncludes: ["문을 닫았다"],
    visualExcludes: ["라고 말했다"],
  },
  {
    id: "J",
    content: '그는 "첫째."라고 말하고 잠시 멈췄다가 "둘째."라고 덧붙였다.',
    dialogue: ["첫째.", "둘째."],
    visualIncludes: ["멈췄다"],
    visualExcludes: ["라고 말하고", "라고 덧붙"],
  },
  {
    id: "K",
    content: '민수가 "잠깐."이라고 말하며 손을 들었다. 잠시 뒤 "가자."라고 덧붙였다.',
    dialogue: ["잠깐.", "가자."],
    visualIncludes: ["손을 들었다"],
    visualExcludes: ["이라고 말하며", "라고 덧붙"],
  },
] as const;

const USER_ATTRIBUTION_FIXTURES = [
  {
    id: "U1",
    role: "user" as const,
    content: '"좋아."라고 말했다.',
    dialogue: ["좋아."],
    visualExcludes: ["라고 말했다"],
  },
  {
    id: "U2",
    role: "user" as const,
    content: '"좋아."라고 말하며 손을 흔든다.',
    dialogue: ["좋아."],
    visualIncludes: ["손을 흔든다"],
    visualExcludes: ["라고 말하며"],
  },
  {
    id: "U3",
    role: "user" as const,
    content: '"됐어."라며 웃었다.',
    dialogue: ["됐어."],
    visualIncludes: ["웃었다"],
    visualExcludes: ["라며 웃었다"],
  },
  {
    id: "U4",
    role: "assistant" as const,
    content: '"됐어."라며 웃었다.',
    dialogue: ["됐어."],
    visualIncludes: ["웃었다"],
    visualExcludes: ["라며 웃었다"],
  },
  {
    id: "U5",
    role: "user" as const,
    content: '"안녕." 그리고 우리 어디 갈까?',
    dialogue: ["안녕.", "그리고 우리 어디 갈까?"],
    visualExcludes: [],
  },
] as const;

function runAttributionFixture(fixture: {
  id: string;
  content: string;
  role: "user" | "assistant";
  dialogue: readonly string[];
  visualIncludes?: readonly string[];
  visualExcludes: readonly string[];
}) {
  const messages = buildSceneSourceMessages([{ id: 1, role: fixture.role, content: fixture.content }]);
  const events = extractDeterministicEvents(messages);
  const dialogueTexts = events.filter((event) => event.kind === "dialogue").map((event) => event.text);
  for (const line of fixture.dialogue) {
    assert.ok(dialogueTexts.includes(line), `${fixture.id} dialogue missing ${line}`);
  }
  for (const banned of fixture.visualExcludes) {
    assert.ok(
      !dialogueTexts.some((text) => text.includes(banned)),
      `${fixture.id} fake dialogue bubble ${banned}`
    );
  }
  const plan = buildDeterministicScenePlan(messages, 2);
  const rendered = renderChatComicPanelSpecSection(
    compileChatComicPanelSpec({
      plan,
      personaName: "렌",
      characterName: "태현",
    })
  );
  const corpus = [
    plan.heroScene,
    ...plan.panels.flatMap((panel) => [
      panel.situation,
      panel.personaAction ?? "",
      panel.characterAction ?? "",
      ...panel.dialogue.map((line) => line.text),
    ]),
    rendered,
  ].join("\n");
  for (const needle of fixture.visualIncludes ?? []) {
    assert.match(corpus, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  for (const banned of fixture.visualExcludes) {
    assert.doesNotMatch(corpus, new RegExp(banned.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(isMalformedAttributionText(banned), true, `${fixture.id} detector for ${banned}`);
  }
}

describe("chatImageAttributionBoundary fixtures", () => {
  for (const fixture of ATTRIBUTION_FIXTURES) {
    it(`${fixture.id} preserves dialogue and suppresses post-quote attribution`, () => {
      runAttributionFixture({
        ...fixture,
        role: "assistant",
      });
    });
  }

  for (const fixture of USER_ATTRIBUTION_FIXTURES) {
    it(`${fixture.id} (${fixture.role}) preserves user-side quote attribution boundary`, () => {
      runAttributionFixture(fixture);
    });
  }

  it("L dialogue-only source stays valid without invented visual beats", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "user", content: '"안녕."' },
      { id: 2, role: "assistant", content: '"반가워."' },
    ]);
    const plan = buildDeterministicScenePlan(messages, 2);
    const spec = compileChatComicPanelSpec({
      plan,
      personaName: "렌",
      characterName: "태현",
    });
    const rendered = renderChatComicPanelSpecSection(spec);
    assert.doesNotMatch(rendered, /^Acting:\s*$/m);
    assert.doesNotMatch(rendered, /^Expressions:\s*$/m);
    assert.match(rendered, /Speech bubble/);
  });
});

describe("chatImageAttributionBoundary corpus counters", () => {
  it("MALFORMED_ATTRIBUTION_COUNT is zero across LD + benchmark fixtures", () => {
    assert.equal(countMalformedAttributionLdFixtures(), 0);
    assert.equal(countMalformedAttributionBenchmarkCorpus(), 0);
  });

  it("negative control detects malformed attribution residue", () => {
    assert.equal(isMalformedAttributionText("라고 말한다."), true);
    assert.equal(isMalformedAttributionText("지훈이 눈을 크게 뜨며"), false);
  });
});
